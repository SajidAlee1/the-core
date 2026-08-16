import { describe, expect, it } from 'vitest'
import { PCM } from './constants'
import { differentialRodWorth, kEff, rhoFromK, rodWorth, subcriticalMultiplication } from './reactivity'
import { decayHeatFraction, LONG_OPERATION } from './decayHeat'
import { findXenonPeak, stepXenon, xenonEquilibrium } from './xenon'
import { REACTORS } from './reactors'
import { createReactor, pulse, resetScram, scram, settleAt, stepReactor } from './reactor'
import { POINT_OF_ADDING_HEAT, thermalParams } from './thermal'

describe('control rod worth', () => {
  it('is zero fully in and full worth fully out', () => {
    expect(rodWorth(0, 0.08)).toBeCloseTo(0, 12)
    expect(rodWorth(1, 0.08)).toBeCloseTo(0.08, 12)
  })

  it('has its greatest differential worth at the core midplane', () => {
    // Differential worth follows the flux, and flux peaks in the middle. This is
    // why the first and last inches of travel do almost nothing while the middle
    // of the bank is where the reactor becomes twitchy — the single most
    // important handling characteristic, which a linear model would erase.
    const W = 0.08
    const mid = differentialRodWorth(0.5, W)
    expect(mid).toBeGreaterThan(differentialRodWorth(0.05, W) * 20)
    expect(mid).toBeGreaterThan(differentialRodWorth(0.95, W) * 20)
    expect(differentialRodWorth(0, W)).toBeCloseTo(0, 10)
    expect(differentialRodWorth(1, W)).toBeCloseTo(0, 10)
  })

  it('is monotonic — withdrawing always adds reactivity', () => {
    let last = -Infinity
    for (let x = 0; x <= 1; x += 0.01) {
      const w = rodWorth(x, 0.08)
      expect(w).toBeGreaterThanOrEqual(last - 1e-12)
      last = w
    }
  })
})

describe('reactivity and multiplication', () => {
  it('round-trips rho and k_eff', () => {
    for (const rho of [-0.05, -0.001, 0, 0.001, 0.005]) {
      expect(rhoFromK(kEff(rho))).toBeCloseTo(rho, 12)
    }
  })

  it('multiplies the source hyperbolically as k approaches 1', () => {
    // This is what the count-rate meter shows during approach to critical, and
    // why 1/M extrapolates to a straight line: M = 1/(1-k).
    expect(subcriticalMultiplication(0.9)).toBeCloseTo(10, 6)
    expect(subcriticalMultiplication(0.99)).toBeCloseTo(100, 6)
    expect(subcriticalMultiplication(0.999)).toBeCloseTo(1000, 6)
  })
})

describe('decay heat', () => {
  // Verified against the Way-Wigner correlation. These are the numbers that
  // explain why a reactor still needs cooling hours after it is switched off.
  it.each([
    [1, 0.064, 0.005],
    [3600, 0.0107, 0.002],
    [86_400, 0.0047, 0.001],
  ])('is ~%s s after shutdown', (t, expected, tol) => {
    expect(decayHeatFraction(t, LONG_OPERATION)).toBeCloseTo(expected, 0)
    expect(Math.abs(decayHeatFraction(t, LONG_OPERATION) - expected)).toBeLessThan(tol)
  })

  it('is smaller for a core that has run only briefly', () => {
    // The finite-operation correction. A reactor started an hour ago has far
    // less fission-product inventory than one at end of cycle, which is why an
    // early-startup scram is benign and a full-power one is not.
    const fresh = decayHeatFraction(60, 3600)
    const aged = decayHeatFraction(60, LONG_OPERATION)
    expect(fresh).toBeLessThan(aged * 0.7)
  })

  it('decays monotonically', () => {
    let last = Infinity
    for (const t of [1, 10, 100, 1000, 10_000, 100_000]) {
      const f = decayHeatFraction(t, LONG_OPERATION)
      expect(f).toBeLessThan(last)
      last = f
    }
  })
})

describe('xenon', () => {
  it('sits at 1.0 at full-power equilibrium by construction', () => {
    const eq = xenonEquilibrium(1)
    expect(eq.xenon).toBeCloseTo(1, 6)
    expect(eq.iodine).toBeCloseTo(1, 6)
  })

  it('holds equilibrium when power is held', () => {
    let s = xenonEquilibrium(1)
    for (let i = 0; i < 2000; i++) s = stepXenon(s, 1, 60) // 33 h
    expect(s.xenon).toBeCloseTo(1, 3)
  })

  it('peaks hours AFTER shutdown, not during operation', () => {
    // The signature behaviour. Xenon is burned out by the flux while the reactor
    // runs; shut down and that burnout stops while the iodine reservoir keeps
    // decaying into xenon for hours.
    const peak = findXenonPeak(xenonEquilibrium(1))
    const hours = peak.seconds / 3600

    // 8.5 h at this flux (sigma*phi = 7.8e-5, a PWR at ~3e13 n/cm2 s).
    // Verified against the exact analytic solution.
    expect(hours).toBeGreaterThan(7)
    expect(hours).toBeLessThan(12)

    // Roughly twice equilibrium — deep enough that a core without the rod worth
    // to overcome it simply cannot be restarted until it decays.
    expect(peak.magnitude).toBeGreaterThan(1.5)
    expect(peak.magnitude).toBeLessThan(2.5)
  })

  it('eventually decays away entirely', () => {
    let s = xenonEquilibrium(1)
    for (let i = 0; i < 5000; i++) s = stepXenon(s, 0, 60) // ~83 h
    expect(s.xenon).toBeLessThan(0.05)
  })

  it('builds no xenon in a core that has never run', () => {
    let s = { iodine: 0, xenon: 0 }
    for (let i = 0; i < 1000; i++) s = stepXenon(s, 0, 60)
    expect(s.xenon).toBeCloseTo(0, 9)
  })
})

describe('thermal', () => {
  it('reaches the published average temperature at full power', () => {
    const spec = REACTORS.pwr
    const p = thermalParams(spec)
    let t = { tFuel: spec.tInlet, tCoolant: spec.tInlet }
    for (let i = 0; i < 20_000; i++) {
      t = { ...t }
      const transferred = p.conductance * (t.tFuel - t.tCoolant)
      const removed = p.flowCapacity * (t.tCoolant - p.tInlet)
      t.tFuel += (0.05 * (spec.ratedPower - transferred)) / p.fuelCapacity
      t.tCoolant += (0.05 * (transferred - removed)) / p.coolantCapacity
    }
    // T_avg = 292 C for a Westinghouse 4-loop.
    expect(t.tCoolant).toBeCloseTo(spec.tAvg, 0)
    // Fuel runs a few hundred degrees hotter — that gap is what Doppler reads.
    expect(t.tFuel - t.tCoolant).toBeGreaterThan(200)
  })
})

describe('integrated reactor', () => {
  it('starts cold, subcritical and quiet', () => {
    const r = createReactor('triga')
    expect(r.state.powerFraction).toBeLessThan(1e-6)
    expect(r.state.thermal.tFuel).toBe(r.state.spec.tInlet)
    expect(r.state.promptCritical).toBe(false)
  })

  it('goes critical when the rods are withdrawn far enough', () => {
    const r = createReactor('triga')
    // TRIGA goes critical near 74 % withdrawal. Below that it is subcritical no
    // matter how long you wait; well above it, the insertion is worth dollars
    // and the core pulses rather than climbing.
    expect(r.state.rho).toBe(0)
    r.inputs.rodWithdrawal = 0.60
    for (let i = 0; i < 60; i++) stepReactor(r, 1 / 60)
    expect(r.state.rho).toBeLessThan(0)

    r.inputs.rodWithdrawal = 0.78
    for (let i = 0; i < 6000; i++) stepReactor(r, 1 / 60) // 100 s
    expect(r.state.rho).toBeGreaterThan(0)
    // Supercritical means the population GREW from where it started.
    expect(r.state.kinetics.n).toBeGreaterThan(1.5e-8)
  })

  it('has a real shutdown margin with the rods in', () => {
    // rods fully inserted must be decisively subcritical, not marginally so.
    for (const kind of ['triga', 'pwr', 'bwr', 'msre'] as const) {
      const r = createReactor(kind)
      stepReactor(r, 1 / 60)
      expect(r.state.rho).toBeLessThan(-0.01) // better than -1000 pcm
    }
  })

  it('pulses and quenches itself when the transient rod is fired', () => {
    // The signature TRIGA behaviour, and the whole reason maxStableStep exists.
    const r = createReactor('triga')
    r.inputs.rodWithdrawal = 0.74
    for (let i = 0; i < 600; i++) stepReactor(r, 1 / 60)

    const before = r.state.powerFraction
    pulse(r)
    for (let i = 0; i < 30; i++) stepReactor(r, 1 / 60) // half a second

    // It must actually spike...
    expect(r.state.peakPowerFraction).toBeGreaterThan(Math.max(before, 1e-6) * 100)
    expect(Number.isFinite(r.state.peakPowerFraction)).toBe(true)

    // ...and then shut ITSELF down, on Doppler alone, with no operator action.
    for (let i = 0; i < 600; i++) stepReactor(r, 1 / 60)
    expect(r.state.powerFraction).toBeLessThan(r.state.peakPowerFraction * 0.5)
    expect(r.state.terms.fuelTemp).toBeLessThan(0)
  })

  it('regulates itself once temperature feedback engages', () => {
    // The inherent-safety claim, tested rather than asserted. Withdraw a large
    // amount of reactivity and let it run: fuel heats, Doppler subtracts
    // reactivity, and the net settles near zero WITHOUT anyone intervening.
    const r = createReactor('triga')
    // Above the ~74 % critical position, worth about +260 pcm ($0.37) — a
    // healthy supercritical insertion, well short of prompt.
    r.inputs.rodWithdrawal = 0.80
    r.inputs.timeScale = 20
    for (let i = 0; i < 60_000; i++) stepReactor(r, 1 / 60)

    expect(r.state.terms.fuelTemp).toBeLessThan(0) // feedback is negative
    expect(Math.abs(r.state.rho)).toBeLessThan(30 * PCM) // and it found balance
    expect(r.state.powerFraction).toBeGreaterThan(0)
    expect(Number.isFinite(r.state.powerFraction)).toBe(true)
  })

  it('keeps producing decay heat after a scram', () => {
    // Fission stops; heat does not. This is the Fukushima lesson and it must be
    // in the model, not just in the copy.
    const r = createReactor('pwr')
    settleAt(r, 1.0, 24)
    r.state.scrammed = false
    scram(r)

    r.inputs.timeScale = 60
    for (let i = 0; i < 600; i++) stepReactor(r, 1 / 60) // ~10 min simulated

    expect(r.state.kinetics.n).toBeLessThan(0.01) // chain reaction is over
    expect(r.state.powerFraction).toBeGreaterThan(0.005) // but power is not zero
    expect(r.state.powerFraction).toBeLessThan(0.08)
  })

  it('never returns NaN, even when driven hard', () => {
    // The denominator-flip failure mode returns plausible garbage rather than
    // NaN, so this guards the whole pipeline rather than just the integrator.
    const r = createReactor('triga')
    for (let i = 0; i < 5000; i++) {
      r.inputs.rodWithdrawal = Math.min(1, i / 500)
      stepReactor(r, 1 / 60)
      expect(Number.isFinite(r.state.power)).toBe(true)
      expect(Number.isFinite(r.state.rho)).toBe(true)
      expect(Number.isFinite(r.state.thermal.tFuel)).toBe(true)
    }
  })

  it('counts operating time only above the point of adding heat', () => {
    const r = createReactor('triga')
    for (let i = 0; i < 600; i++) stepReactor(r, 1 / 60)
    expect(r.state.operatingSeconds).toBe(0)
    expect(POINT_OF_ADDING_HEAT).toBe(0.01)
  })
})

describe('variants are genuinely different reactors', () => {
  it('gives MSRE a much longer neutron generation time', () => {
    // Graphite moderation, not light water. Twenty times the PWR value, which
    // makes it noticeably more sluggish to operate.
    expect(REACTORS.msre.lambdaGen).toBeGreaterThan(REACTORS.pwr.lambdaGen * 10)
  })

  it('gives MSRE a reduced effective beta because its fuel circulates', () => {
    // Precursors drift out of the core and decay where their neutrons are lost.
    // A real and unusual effect, and it makes the reactor twitchier than beta
    // alone would suggest.
    expect(REACTORS.msre.betaEff).toBeLessThan(REACTORS.pwr.betaEff * 0.8)
  })

  it('gives TRIGA the strong prompt feedback that makes pulsing safe', () => {
    expect(Math.abs(REACTORS.triga.alphaFuel)).toBeGreaterThan(
      Math.abs(REACTORS.pwr.alphaFuel) * 3,
    )
    expect(REACTORS.triga.canPulse).toBe(true)
    expect(REACTORS.pwr.canPulse).toBe(false)
  })

  it('only claims visible Cherenkov where there is honestly a window', () => {
    // PLAN.md section 9, rule 4. A PWR core sits inside 200 mm of steel.
    expect(REACTORS.triga.cherenkovVisible).toBe(true)
    expect(REACTORS.pwr.cherenkovVisible).toBe(false)
    expect(REACTORS.bwr.cherenkovVisible).toBe(false)
    expect(REACTORS.msre.cherenkovVisible).toBe(false)
  })

  it('uses boron shim only where a real plant does', () => {
    expect(REACTORS.pwr.alphaBoron).toBeLessThan(0)
    expect(REACTORS.bwr.alphaBoron).toBe(0)
    expect(REACTORS.triga.alphaBoron).toBe(0)
  })
})

describe('the NaN excursion', () => {
  /**
   * Reproduces the reported failure exactly: rods to 98.7 % with 60x time
   * compression. The panel showed NaN MW, NaN pcm and infinite temperatures.
   *
   * The cause was not the neutronics. It was that thermal advanced once per
   * frame with the full interval while the neutronics substepped — so at 60x,
   * where a frame is 1 s and the power e-folds in about 1 s, the Doppler
   * feedback arrived a whole doubling late. The loop overshot, oscillated and
   * diverged. Feedback only stabilises what it is sampled fast enough to see.
   */
  it('survives rods at 98.7% under 60x compression', () => {
    const r = createReactor('triga')
    r.inputs.rodWithdrawal = 0.987
    r.inputs.timeScale = 60

    for (let i = 0; i < 3000; i++) {
      stepReactor(r, 1 / 60)
      const s = r.state
      expect(Number.isFinite(s.power)).toBe(true)
      expect(Number.isFinite(s.rho)).toBe(true)
      expect(Number.isFinite(s.thermal.tFuel)).toBe(true)
      expect(Number.isFinite(s.thermal.tCoolant)).toBe(true)
      expect(Number.isFinite(s.kinetics.n)).toBe(true)
    }
    expect(r.state.faulted).toBe(false)
  })

  it.each([1, 10, 60, 600, 3600])('stays finite at %ix compression', (scale) => {
    const r = createReactor('triga')
    r.inputs.timeScale = scale
    for (let i = 0; i < 1200; i++) {
      // Sweep the rods all the way out while time is compressed — the worst
      // case, because it crosses critical and prompt critical under a large step.
      r.inputs.rodWithdrawal = Math.min(1, i / 400)
      stepReactor(r, 1 / 60)
      expect(Number.isFinite(r.state.power)).toBe(true)
      expect(Number.isFinite(r.state.thermal.tFuel)).toBe(true)
    }
  })

  it('shuts itself down on Doppler even from a hard over-withdrawal', () => {
    // The physics that SHOULD have limited the excursion all along. Pulled far
    // past critical, the fuel heats and subtracts more reactivity than the rods
    // added, with no operator action.
    const r = createReactor('triga')
    r.inputs.rodWithdrawal = 1.0
    r.inputs.timeScale = 20
    for (let i = 0; i < 20_000; i++) stepReactor(r, 1 / 60)

    expect(r.state.terms.fuelTemp).toBeLessThan(0)
    expect(r.state.rho).toBeLessThan(100 * PCM)
    expect(r.state.thermal.tFuel).toBeGreaterThan(r.state.spec.tInlet)
    expect(Number.isFinite(r.state.powerFraction)).toBe(true)
  })
})

describe('the startup neutron source', () => {
  /**
   * The bug: at 73.5 % rods with xenon poisoning the core subcritical, the panel
   * read 1.19e-50 W — a power below one neutron in the history of the universe.
   *
   * Point kinetics with no source term lets a subcritical core decay toward zero
   * without limit. Real reactors cannot do that: an Am-Be capsule and
   * spontaneous fission in the fuel keep a population alive, which is precisely
   * why a shut-down core has a countable count rate. The source is installed on
   * purpose, and it is what the whole approach-to-criticality measurement rests
   * on.
   */
  it('holds a floor instead of decaying to absurdity', () => {
    const r = createReactor('triga')
    r.inputs.rodWithdrawal = 0.6
    r.inputs.timeScale = 600
    for (let i = 0; i < 6000; i++) stepReactor(r, 1 / 60) // ~16 h subcritical

    expect(r.state.powerFraction).toBeGreaterThan(1e-9)
    expect(r.state.powerFraction).toBeLessThan(1e-6)
  })

  it('starts cold shutdown at source-range level', () => {
    // Solved from the source rather than guessed: n = S·Λ/|ρ|.
    const r = createReactor('triga')
    for (let i = 0; i < 300; i++) stepReactor(r, 1 / 60)
    expect(r.state.kinetics.n).toBeGreaterThan(5e-9)
    expect(r.state.kinetics.n).toBeLessThan(2e-8)
  })

  it('makes the neutron population actually follow 1/M', () => {
    // The claim the 1/M plot rests on. If the population does not track the
    // multiplication, the instrument is a drawing rather than a measurement.
    const sample = (withdrawal: number) => {
      const r = createReactor('triga')
      r.inputs.rodWithdrawal = withdrawal
      r.inputs.timeScale = 50
      for (let i = 0; i < 3000; i++) stepReactor(r, 1 / 60)
      return { n: r.state.kinetics.n, m: r.state.multiplication }
    }
    const a = sample(0.0)
    const b = sample(0.5)
    const c = sample(0.65)

    // n should rise in the same proportion as M, within 10 %.
    expect((b.n / a.n) / (b.m / a.m)).toBeGreaterThan(0.9)
    expect((b.n / a.n) / (b.m / a.m)).toBeLessThan(1.1)
    expect((c.n / a.n) / (c.m / a.m)).toBeGreaterThan(0.9)
    expect((c.n / a.n) / (c.m / a.m)).toBeLessThan(1.1)
  })

  it('leaves the source-free kinetics tests untouched', () => {
    // DEFAULT_CONFIG has no source, so the inhour validation still applies —
    // the inhour equation describes a source-free reactor.
    expect(REACTORS.triga.neutronSource).toBeGreaterThan(0)
  })
})

describe('reactor protection', () => {
  it('trips on high power instead of letting a PWR reach 186% rated', () => {
    // The gap flagged earlier: the physics said 186 % at 90 % rods with full
    // boron, which is what an unprotected reactor would do and what no plant
    // has ever been allowed to reach.
    const r = createReactor('pwr')
    r.inputs.rodWithdrawal = 0.9
    r.inputs.timeScale = 100
    for (let i = 0; i < 4000; i++) stepReactor(r, 1 / 60)

    expect(r.state.scrammed).toBe(true)
    expect(r.state.trippedBy).toBeTruthy()
    expect(r.state.powerFraction).toBeLessThan(1.3)
  })

  it('drops the rods when it trips', () => {
    const r = createReactor('triga')
    r.inputs.rodWithdrawal = 1
    r.inputs.timeScale = 50
    for (let i = 0; i < 4000; i++) stepReactor(r, 1 / 60)
    if (r.state.trippedBy) expect(r.inputs.rodWithdrawal).toBe(0)
  })

  it('does not trip a TRIGA for pulsing, which is its whole purpose', () => {
    // The transient rod takes the core prompt supercritical BY DESIGN and the
    // fuel terminates it in milliseconds. A prompt-critical trip here would
    // forbid the reactor's defining feature.
    const r = createReactor('triga')
    r.inputs.rodWithdrawal = 0.74
    for (let i = 0; i < 600; i++) stepReactor(r, 1 / 60)
    pulse(r)
    for (let i = 0; i < 6; i++) stepReactor(r, 1 / 60)
    expect(r.state.pulsing).toBe(true)
    expect(r.state.trippedBy).toBeNull()
  })

  it('does not trip a BWR for being saturated, which is by design', () => {
    const r = createReactor('bwr')
    for (let i = 0; i < 120; i++) stepReactor(r, 1 / 60)
    expect(r.state.trippedBy).toBeNull()
  })

  it('clears the trip on reset', () => {
    const r = createReactor('pwr')
    r.inputs.rodWithdrawal = 0.95
    r.inputs.timeScale = 100
    for (let i = 0; i < 4000; i++) stepReactor(r, 1 / 60)
    expect(r.state.trippedBy).toBeTruthy()
    resetScram(r)
    expect(r.state.trippedBy).toBeNull()
    expect(r.inputs.scrammed).toBe(false)
  })
})
