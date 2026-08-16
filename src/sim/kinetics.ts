import { BETA, DELAYED_GROUPS, LAMBDA_GEN, type DelayedGroup } from './constants'

/**
 * Point kinetics — the neutron population, integrated for real.
 *
 *   dn/dt  = ((ρ − β)/Λ)·n + Σᵢ λᵢ·Cᵢ
 *   dCᵢ/dt = (βᵢ/Λ)·n − λᵢ·Cᵢ
 *
 * n is the neutron population (proportional to thermal power), Cᵢ the
 * concentration of delayed-neutron precursors in group i, ρ the reactivity.
 *
 * ── Why this is integrated implicitly ──────────────────────────────────────
 *
 * Λ is 2e-5 s in a PWR. A display frame is 1.6e-2 s. That is a stiffness ratio
 * near 1000:1, and explicit Euler is stable only for dt < 2Λ/|ρ−β| — roughly
 * microseconds. Stepping it explicitly at frame rate does not "drift"; it
 * diverges to Infinity within a handful of frames.
 *
 * Backward Euler is unconditionally stable, and for this system it solves in
 * closed form rather than with a matrix solve. Substituting the implicit
 * precursor update
 *
 *   Cᵢ' = (Cᵢ + dt·(βᵢ/Λ)·n') / (1 + dt·λᵢ)
 *
 * into the implicit n equation and collecting n' gives the single expression in
 * `step()`. Seven coupled ODEs, no linear algebra, no stability limit.
 *
 * Backward Euler is first-order and numerically damped, so it slightly UNDER-
 * predicts a fast excursion. Being conservative is the right direction to be
 * wrong for a teaching tool, but it is why `maxStableStep` exists rather than a
 * fixed step: see the prompt-critical note there.
 *
 * ── Measured accuracy (docs/validation.md) ─────────────────────────────────
 *
 *   +100 pcm   inhour 54.921 s   integrator 54.915 s   −0.01 %
 *   +500 pcm   inhour  1.185 s   integrator  1.184 s   −0.05 %
 *   +640 pcm   inhour  0.118 s   integrator  0.118 s   −0.05 %
 */

/**
 * Per-variant kinetics parameters.
 *
 * Λ and β genuinely differ between reactor types — MSRE's graphite moderation
 * gives a generation time twenty times a PWR's, and its circulating fuel carries
 * precursors out of the core, cutting effective β by ~30 %. Hardcoding light-
 * water values would make three of the four variants quietly wrong.
 */
export type KineticsConfig = {
  groups: DelayedGroup[]
  lambdaGen: number
  beta: number
  /**
   * Startup neutron source, in neutrons per second in the same normalised units
   * as `n`. Zero means a source-free core.
   *
   * Every real reactor has one — an Am-Be or Sb-Be capsule, plus spontaneous
   * fission in the fuel itself. It is installed deliberately, and it is the
   * reason a shut-down core has a countable neutron population instead of none.
   *
   * Without it, a subcritical core decays exponentially toward zero with no
   * floor, and the panel eventually reports things like 1.19e-50 W — a power
   * level below one neutron in the history of the universe. Worse, the whole
   * approach-to-criticality story becomes fiction: `subcriticalMultiplication`
   * says the source is being amplified by M = 1/(1−k), but with no source there
   * is nothing to amplify and the neutron population does not follow it.
   *
   * With a source, a subcritical core settles at n = S·Λ/|ρ|, which IS the
   * subcritical multiplication — the count rate climbs hyperbolically toward
   * criticality exactly as the 1/M plot describes. The physics and the
   * instrument finally agree.
   */
  source?: number
}

export const DEFAULT_CONFIG: KineticsConfig = {
  groups: DELAYED_GROUPS,
  lambdaGen: LAMBDA_GEN,
  beta: BETA,
}

/**
 * Build a config with a specified β_eff, rescaling the group fractions to match.
 *
 * **β must equal Σβᵢ exactly.** The equations use β in the prompt term
 * `(ρ−β)/Λ·n` and the individual βᵢ in the precursor source terms, and the two
 * only balance at steady state if they agree. Declaring β_eff = 0.0070 while the
 * tabulated groups sum to 0.006502 silently moves the critical point by the
 * difference — 49.8 pcm — so the reactor reports ρ = +49.7 pcm while power
 * slowly falls. Every readout stays finite and plausible, and the model is
 * simply wrong about what "critical" means.
 *
 * β_eff genuinely does vary — it falls through core life as Pu-239 builds in,
 * and MSRE's circulating fuel carries precursors out of the core entirely — so
 * the answer is to scale the groups, not to abandon the parameter. The relative
 * distribution between groups is a fission-yield pattern and is preserved; only
 * the total moves. This is how β_eff adjustments are made in practice.
 *
 * Use this rather than building a `KineticsConfig` literal.
 */
export function makeConfig(
  groups: DelayedGroup[],
  lambdaGen: number,
  betaEff: number,
  source = 0,
): KineticsConfig {
  const tabulated = groups.reduce((s, g) => s + g.beta, 0)
  const scale = betaEff / tabulated
  const scaled = groups.map((g) => ({ beta: g.beta * scale, lambda: g.lambda }))
  return {
    groups: scaled,
    lambdaGen,
    // Recomputed from the scaled groups rather than taking betaEff on trust, so
    // the invariant holds exactly in floating point.
    beta: scaled.reduce((s, g) => s + g.beta, 0),
    source,
  }
}

export type KineticsState = {
  /** Neutron population. Arbitrary units; only ratios are physical. */
  n: number
  /** Delayed-neutron precursor concentrations, one per group. */
  precursors: number[]
}

/**
 * Equilibrium state at a given neutron level.
 *
 * At steady state dCᵢ/dt = 0, so Cᵢ = βᵢ·n/(Λ·λᵢ). Starting anywhere else means
 * the precursors have to fill or drain first, which shows up as a spurious
 * transient over the first minute — long enough to be mistaken for physics.
 */
/**
 * Neutron level a subcritical core settles at, given its source.
 *
 *   n = S·Λ / |ρ|
 *
 * This is subcritical multiplication expressed as a population rather than a
 * ratio. It diverges as ρ → 0, which is correct: at criticality the source no
 * longer needs to sustain anything, and the population is set by history rather
 * than by the source.
 */
export function sourceLevel(rho: number, cfg: KineticsConfig = DEFAULT_CONFIG): number {
  const S = cfg.source ?? 0
  if (S <= 0 || rho >= 0) return 0
  return (S * cfg.lambdaGen) / Math.abs(rho)
}

export function equilibrium(n: number, cfg: KineticsConfig = DEFAULT_CONFIG): KineticsState {
  return {
    n,
    precursors: cfg.groups.map((g) => (g.beta * n) / (cfg.lambdaGen * g.lambda)),
  }
}

/**
 * One backward-Euler step. `rho` is dimensionless; `dt` is seconds.
 * Mutates nothing.
 */
export function step(
  state: KineticsState,
  rho: number,
  dt: number,
  cfg: KineticsConfig = DEFAULT_CONFIG,
): KineticsState {
  const { n, precursors } = state
  const { groups, lambdaGen, beta } = cfg

  // Numerator: current population plus what the precursors hand over this step.
  let sumDecay = 0
  // Denominator correction: precursors CREATED during this step also decay
  // during it. Dropping this term is the classic subtle error — it loses
  // neutrons and quietly biases every reported period long.
  let sumFeedback = 0

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const denom = 1 + dt * g.lambda
    sumDecay += (g.lambda * precursors[i]) / denom
    sumFeedback += (g.lambda * g.beta) / denom
  }

  // The source adds neutrons at a constant rate regardless of k, so it sits
  // alongside the precursor contribution in the numerator.
  const numerator = n + dt * (sumDecay + (cfg.source ?? 0))
  const denominator =
    1 - (dt * (rho - beta)) / lambdaGen - ((dt * dt) / lambdaGen) * sumFeedback

  // Below prompt critical (ρ < β) the term −dt(ρ−β)/Λ is positive, so the
  // denominator exceeds 1 and this is unconditionally safe.
  //
  // ABOVE prompt critical it can pass through zero and go negative, at which
  // point the step returns a large positive number that looks exactly like a
  // physical runaway and is entirely numerical. This is the most dangerous
  // failure mode in the simulation, because it is plausible: a $2.00 pulse
  // stepped at 10 ms returns 4.2e12 instead of 51 — eleven orders out, with no
  // NaN to catch it. `maxStableStep` makes it unreachable; this clamp is a last
  // resort, not the defence.
  const nNext = numerator / Math.max(denominator, 1e-12)

  const next: number[] = new Array(groups.length)
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    next[i] = (precursors[i] + dt * (g.beta / lambdaGen) * nNext) / (1 + dt * g.lambda)
  }

  return { n: nNext, precursors: next }
}

/**
 * Largest step that resolves the prompt neutron mode at this reactivity.
 *
 * Measured convergence at ρ = $2.00 over 10 ms (docs/validation.md):
 *
 *   maxStep 1e-2 → 4.2380e+12   ← garbage, and it looks like physics
 *   maxStep 1e-3 → 1.0138e+02
 *   maxStep 1e-4 → 5.3603e+01
 *   maxStep 1e-5 → 5.1001e+01
 *   maxStep 1e-6 → 5.0753e+01   ← converged
 *
 * The dividing line is exactly prompt critical, because that is where the prompt
 * mode stops decaying and starts growing on the Λ/(ρ−β) timescale. Below it the
 * delayed groups set the pace and 10 ms is generous — measured error at $0.98 is
 * −0.05 %. Above it they are irrelevant and the step must resolve Λ/(ρ−β), which
 * at $2.00 is 3.1 ms.
 *
 * 2 % of that timescale converges to within ~1 %, costing a few hundred steps for
 * a 10 ms pulse. That is the difference between a TRIGA pulse that is real and
 * one that is a convincing fiction.
 */
export function maxStableStep(
  rho: number,
  ceiling = 0.01,
  cfg: KineticsConfig = DEFAULT_CONFIG,
): number {
  if (rho < 0.9 * cfg.beta) return ceiling
  const promptTime = cfg.lambdaGen / Math.max(Math.abs(rho - cfg.beta), 1e-9)
  return Math.min(ceiling, 0.02 * promptTime)
}

/**
 * Advance by an arbitrary wall-clock interval, substepping internally.
 *
 * Decoupling the physics step from the frame step matters three times over: a
 * dropped frame must not change the answer, time compression (60x/3600x for
 * watching xenon) must not degrade accuracy by taking hour-long steps, and a
 * prompt excursion must not be flattened by a step chosen for the display.
 */
export function advance(
  state: KineticsState,
  rho: number,
  seconds: number,
  maxStep = 0.01,
  cfg: KineticsConfig = DEFAULT_CONFIG,
): KineticsState {
  const limit = maxStableStep(rho, maxStep, cfg)
  let remaining = seconds
  let current = state
  // Bounded so a pathological time-compression value cannot hang the tab.
  let guard = 0
  while (remaining > 1e-12 && guard++ < 500_000) {
    const dt = Math.min(limit, remaining)
    current = step(current, rho, dt, cfg)
    remaining -= dt
  }
  return current
}

/**
 * Reactor period: the time for power to change by a factor of e.
 *
 * Measured from the actual trajectory rather than solved from the inhour
 * equation, so it stays meaningful mid-transient — which is when an operator
 * actually reads it. Positive = rising, negative = falling.
 *
 * `dt` must be SHORT relative to the period being measured. Sampling a 0.29 s
 * period over a 0.5 s window reports a 94 % error that is pure measurement
 * artefact; every finite-difference estimate of an exponential rate has this
 * trap. Callers displaying a live period should sample over ~T/50.
 */
export function period(nPrev: number, nNow: number, dt: number): number {
  if (nPrev <= 0 || nNow <= 0 || dt <= 0) return Infinity
  const rate = Math.log(nNow / nPrev) / dt
  if (Math.abs(rate) < 1e-12) return Infinity
  return 1 / rate
}

/**
 * Startup rate, decades per minute — what the operator's meter shows.
 *
 * SUR = 26.06/T with T in seconds. The constant is 60/ln(10): seconds per minute
 * over the natural log of ten, turning an e-folding period into powers of ten per
 * minute. Startups are typically limited to 1 dpm, which is a 26 s period.
 */
export function startupRate(periodSeconds: number): number {
  if (!isFinite(periodSeconds) || periodSeconds === 0) return 0
  return 26.06 / periodSeconds
}

/**
 * Inverse count rate ratio — the 1/M plot, the oldest tool in reactor startup.
 *
 * With a neutron source present, a subcritical core multiplies it by
 * M = 1/(1−k). Plotting 1/M against rod position gives a line that extrapolates
 * to zero exactly where the core goes critical. Operators plot it BEFORE pulling
 * each increment, so criticality is predicted rather than discovered — which is
 * the entire difference between a startup and an accident.
 */
export function inverseMultiplication(countRate0: number, countRate: number): number {
  if (countRate <= 0) return 1
  return countRate0 / countRate
}

/** Prompt critical: ρ ≥ β, i.e. $1.00. Past here delayed neutrons no longer help. */
export const isPromptCritical = (rho: number, beta = BETA) => rho >= beta

/** Reactivity in dollars. $1.00 is prompt critical, by definition. */
export const toDollars = (rho: number, beta = BETA) => rho / beta

/** Reactivity in pcm (per cent mille, 1e-5). */
export const toPcm = (rho: number) => rho / 1e-5
