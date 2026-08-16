import { describe, expect, it } from 'vitest'
import { BETA, DELAYED_GROUPS, LAMBDA_GEN, PCM } from './constants'
import {
  advance, equilibrium, makeConfig, maxStableStep, period, startupRate, step, toDollars,
} from './kinetics'
import { REACTOR_ORDER, REACTORS } from './reactors'

/**
 * Validation against the inhour equation.
 *
 * The integrator is checked against an INDEPENDENT analytic solution rather than
 * against remembered numbers, because a hand-copied expected value only proves
 * the transcription. The inhour equation
 *
 *   ρ = Λ/T + Σᵢ βᵢ/(1 + λᵢ·T)
 *
 * relates a step reactivity insertion to the asymptotic (stable) reactor period,
 * and it is derived from the same physics by a completely different route — the
 * roots of the characteristic equation rather than time integration. If the
 * numerical trajectory settles onto the period the inhour equation predicts,
 * both are almost certainly right.
 *
 * The one hand-checked anchor is +100 pcm → ~54.9 s, which validates the inhour
 * solver itself. That figure appears in every reactor theory text.
 */
function inhourRho(periodSeconds: number): number {
  let rho = LAMBDA_GEN / periodSeconds
  for (const g of DELAYED_GROUPS) rho += g.beta / (1 + g.lambda * periodSeconds)
  return rho
}

/** Invert the inhour equation by bisection. Monotonic in T for positive periods. */
function inhourPeriod(rho: number): number {
  let lo = 1e-4
  let hi = 1e6
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi) // geometric bisection — T spans many decades
    if (inhourRho(mid) > rho) lo = mid
    else hi = mid
  }
  return Math.sqrt(lo * hi)
}

describe('inhour reference solver', () => {
  it('reproduces the textbook +100 pcm stable period', () => {
    // ~54.9 s. The canonical worked example in Lamarsh and DOE-HDBK-1019/2.
    expect(inhourPeriod(100 * PCM)).toBeCloseTo(54.9, 0)
  })

  it('puts prompt critical at $1.00', () => {
    // At ρ = β the period collapses toward the prompt generation time. It must
    // be small enough that no mechanical system could respond — that is the
    // entire reason $1.00 is the line nobody crosses deliberately.
    expect(inhourPeriod(BETA)).toBeLessThan(0.1)
    expect(toDollars(BETA)).toBeCloseTo(1.0, 10)
  })
})

describe('point kinetics integrator', () => {
  it('holds steady state at zero reactivity', () => {
    // Started at equilibrium, a critical reactor must not drift. This catches
    // the most common integrator bug: precursor equations that leak neutrons.
    let s = equilibrium(1)
    for (let i = 0; i < 10_000; i++) s = step(s, 0, 0.01) // 100 s
    expect(s.n).toBeCloseTo(1, 9)
  })

  it('is stable at frame-rate steps despite Λ = 2e-5 s', () => {
    // Explicit Euler diverges here within a few steps. This is the test that
    // proves the implicit formulation was necessary rather than merely tidy.
    let s = equilibrium(1)
    for (let i = 0; i < 600; i++) s = step(s, 200 * PCM, 1 / 60)
    expect(Number.isFinite(s.n)).toBe(true)
    expect(s.n).toBeGreaterThan(1)
  })

  it.each([50, 100, 300, 400, 500, 600, 640])(
    'settles onto the inhour period for +%i pcm',
    (pcm) => {
      const rho = pcm * PCM
      const expected = inhourPeriod(rho)

      // Settle for many periods so the short-lived transient roots have decayed
      // and only the stable period remains. Capped so a long period (812 s at
      // 10 pcm) does not make the suite crawl.
      const settle = Math.min(300, Math.max(40, expected * 40))
      let s = advance(equilibrium(1), rho, settle)

      // The measuring interval must be SHORT relative to the period being
      // measured. Sampling a 0.29 s period over a 0.5 s window reported a 94 %
      // error that was pure measurement artefact — the integrator was fine. Any
      // finite-difference estimate of an exponential rate has this trap.
      const dt = Math.min(0.2, expected / 50)
      const before = s.n
      s = advance(s, rho, dt, dt / 20)
      const measured = period(before, s.n, dt)

      // 0.5 % across the entire subcritical-to-$0.98 range. Backward Euler is
      // first-order and slightly damped, so the bias is consistently negative.
      expect(measured).toBeGreaterThan(expected * 0.995)
      expect(measured).toBeLessThan(expected * 1.005)
    },
  )

  it('resolves a prompt-supercritical pulse instead of inventing one', () => {
    // The TRIGA pulse is deliberately prompt supercritical, so it is the one
    // regime where the frame-rate step is not merely inaccurate but wrong by
    // orders of magnitude. Convergence under refinement is the only honest test.
    const rho = 2 * BETA // $2.00
    const converged = advance(equilibrium(1), rho, 0.01, 1e-6).n

    // ~51. Sanity-check the order against prompt-only growth: the excursion
    // runs on Λ/(ρ−β) = 3.1 ms, so 10 ms is ~3.25 e-foldings.
    expect(converged).toBeGreaterThan(20)
    expect(converged).toBeLessThan(200)

    // The default call must land near the converged answer WITHOUT the caller
    // having to know about the pulse — that is what maxStableStep is for.
    const auto = advance(equilibrium(1), rho, 0.01).n
    expect(auto / converged).toBeGreaterThan(0.95)
    expect(auto / converged).toBeLessThan(1.05)
  })

  it('never lets the implicit denominator flip sign', () => {
    // Passing a 10 ms step at $2.00 straight to step() drives the denominator
    // negative and returns ~4e12 — a plausible-looking runaway that is entirely
    // numerical. maxStableStep must make that unreachable through advance().
    expect(maxStableStep(2 * BETA)).toBeLessThan(1e-4)
    expect(maxStableStep(0)).toBe(0.01)
    expect(maxStableStep(100 * PCM)).toBe(0.01)
  })

  it('produces a prompt drop on negative insertion', () => {
    // Insert −500 pcm. Power falls almost instantly by roughly β/(β−ρ) — the
    // prompt jump — and then decays slowly on the delayed precursors. The slow
    // tail is why a reactor cannot be turned off quickly, only turned down.
    let s = equilibrium(1)
    const rho = -500 * PCM

    s = advance(s, rho, 0.5)
    const promptJump = s.n
    expect(promptJump).toBeLessThan(0.6) // sharp initial fall
    expect(promptJump).toBeGreaterThan(0.3) // but NOT to zero

    s = advance(s, rho, 60)
    // 60 s later it is still falling, governed by the 55.9 s group.
    expect(s.n).toBeLessThan(promptJump)
    expect(s.n).toBeGreaterThan(0)
  })

  it('runs away above prompt critical', () => {
    // Past ρ = β the chain sustains on prompt neutrons alone and the delayed
    // groups stop mattering. Period collapses by orders of magnitude.
    let sub = equilibrium(1)
    let sup = equilibrium(1)
    sub = advance(sub, 0.9 * BETA, 1)
    sup = advance(sup, 1.1 * BETA, 1)
    expect(sup.n / sub.n).toBeGreaterThan(100)
  })

  it('is independent of the caller\'s step size', () => {
    // The same elapsed time must give the same answer whether it arrived as one
    // frame or sixty. Without this, time compression would silently change the
    // physics and a dropped frame would perturb the trajectory.
    const rho = 150 * PCM
    const coarse = advance(equilibrium(1), rho, 120, 0.01)
    const fine = advance(equilibrium(1), rho, 120, 0.001)
    expect(coarse.n / fine.n).toBeCloseTo(1, 2)
  })

  it('converts period to startup rate in decades per minute', () => {
    // SUR = 26.06/T. Operators limit startup to ~1 dpm, which is a 26 s period —
    // so the +100 pcm insertion above is already about half the allowed rate.
    expect(startupRate(26.06)).toBeCloseTo(1, 6)
    expect(startupRate(inhourPeriod(100 * PCM))).toBeCloseTo(0.475, 2)
  })
})

describe('beta consistency — the invariant the equations depend on', () => {
  // The prompt term uses beta; the precursor sources use the individual beta_i.
  // If they disagree, steady state is not at rho = 0 and "critical" quietly
  // means something else. This bug reported rho = +49.7 pcm on a reactor whose
  // power was falling, with no NaN and no warning.
  it('rescales group fractions to match a declared beta_eff', () => {
    const cfg = makeConfig(DELAYED_GROUPS, 4.3e-5, 0.007)
    const summed = cfg.groups.reduce((s, g) => s + g.beta, 0)
    expect(summed).toBeCloseTo(0.007, 12)
    expect(cfg.beta).toBeCloseTo(summed, 15)
  })

  it('preserves the relative distribution between groups', () => {
    // Scaling must not change which precursors dominate — that pattern is the
    // fission yield and is not ours to alter.
    const cfg = makeConfig(DELAYED_GROUPS, 4.3e-5, 0.007)
    for (let i = 0; i < DELAYED_GROUPS.length; i++) {
      expect(cfg.groups[i].beta / cfg.beta).toBeCloseTo(DELAYED_GROUPS[i].beta / BETA, 12)
      expect(cfg.groups[i].lambda).toBe(DELAYED_GROUPS[i].lambda)
    }
  })

  it.each(REACTOR_ORDER)('holds steady at rho = 0 for %s', (kind) => {
    // The regression test. Every variant must sit still at zero reactivity;
    // any drift means beta and the groups have come apart again.
    const spec = REACTORS[kind]
    const cfg = makeConfig(spec.groups, spec.lambdaGen, spec.betaEff)
    let s = equilibrium(1, cfg)
    for (let i = 0; i < 20_000; i++) s = step(s, 0, 0.01, cfg) // 200 s
    expect(s.n).toBeCloseTo(1, 8)
  })
})
