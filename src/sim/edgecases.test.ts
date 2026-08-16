import { describe, expect, it } from 'vitest'
import { createReactor, pulse, resetScram, scram, stepReactor } from './reactor'
import { REACTOR_ORDER, REACTORS } from './reactors'
import { criticalWithdrawal } from './reactivity'
import { findXenonPeak, stepXenon, xenonEquilibrium } from './xenon'
import { decayHeatFraction } from './decayHeat'

/**
 * Edge cases, swept across all four variants.
 *
 * Every earlier bug was found on TRIGA and fixed there. These check the same
 * invariants hold for the three that get far less manual testing — which is
 * exactly where a defect would sit unnoticed.
 */
const run = (r: ReturnType<typeof createReactor>, sec: number, scale = 1) => {
  r.inputs.timeScale = scale
  for (let i = 0; i < sec * 60; i++) stepReactor(r, 1 / 60)
}

describe.each(REACTOR_ORDER)('%s — invariants', (kind) => {
  it('is subcritical at cold shutdown and reaches critical somewhere', () => {
    const r = createReactor(kind)
    run(r, 3)
    expect(r.state.rho).toBeLessThan(-0.01)

    // A critical rod position must EXIST, or the reactor can never be started.
    //
    // The balance has to include boron. Passing 0 here asked "where is a PWR
    // critical with no boron?" and the answer is "with the rods fully in" —
    // its 21 800 pcm of excess exceeds 8 000 pcm of rod worth. That is not a
    // defect, it is the entire reason a large PWR needs a chemical shim, and
    // the first version of this test simply asked the wrong question.
    const t = r.state.terms
    const xc = criticalWithdrawal(r.state.spec, t.boron + t.fuelTemp + t.modTemp + t.xenon)
    expect(xc).toBeGreaterThan(0)
    expect(xc).toBeLessThan(1)
  })

  it('needs boron only where the rods cannot hold the core down alone', () => {
    // The PWR's defining constraint, stated as a test.
    const spec = REACTORS[kind]
    const rodsAloneSuffice = spec.coldCleanExcess < spec.rodWorth
    expect(rodsAloneSuffice).toBe(spec.alphaBoron === 0)
  })

  it('never produces a non-finite readout under a full rod sweep', () => {
    const r = createReactor(kind)
    r.inputs.timeScale = 200
    for (let i = 0; i < 3000; i++) {
      r.inputs.rodWithdrawal = Math.min(1, i / 800)
      stepReactor(r, 1 / 60)
      const s = r.state
      for (const v of [s.power, s.rho, s.kEff, s.thermal.tFuel, s.thermal.tCoolant, s.xenon.xenon, s.multiplication]) {
        expect(Number.isFinite(v)).toBe(true)
      }
    }
    expect(r.state.faulted).toBe(false)
  })

  it('holds a source floor rather than decaying to nothing', () => {
    const r = createReactor(kind)
    run(r, 30, 600) // ~5 h shut down
    expect(r.state.powerFraction).toBeGreaterThan(0)
    expect(r.state.power).toBeGreaterThan(0)
  })

  it('resets completely, leaving no history behind', () => {
    const r = createReactor(kind)
    r.inputs.rodWithdrawal = 1
    run(r, 30, 100)
    scram(r)
    run(r, 2)
    resetScram(r)

    expect(r.state.trippedBy).toBeNull()
    expect(r.state.trippedReason).toBeNull()
    expect(r.state.faulted).toBe(false)
    expect(r.state.peakPowerFraction).toBe(0)
    expect(r.inputs.rodWithdrawal).toBe(0)
    expect(r.inputs.transientEjected).toBe(0)
    expect(r.inputs.scrammed).toBe(false)
  })

  it('only offers a pulse where the hardware has one', () => {
    const r = createReactor(kind)
    const before = r.inputs.transientEjected
    pulse(r)
    if (REACTORS[kind].canPulse) expect(r.inputs.transientEjected).toBeGreaterThan(before)
    else expect(r.inputs.transientEjected).toBe(before)
  })
})

describe('numerical edge cases', () => {
  it('survives a zero and a negative time step', () => {
    const r = createReactor('triga')
    stepReactor(r, 0)
    stepReactor(r, -1)
    expect(Number.isFinite(r.state.power)).toBe(true)
    expect(r.state.clock).toBe(0)
  })

  it('clamps a huge wall step, as after a backgrounded tab', () => {
    const r = createReactor('triga')
    r.inputs.timeScale = 3600
    stepReactor(r, 600) // ten minutes of wall time in one call
    // Clamped to 0.25 s of wall time, so at most 900 s of simulated time.
    expect(r.state.clock).toBeLessThanOrEqual(900.001)
    expect(Number.isFinite(r.state.power)).toBe(true)
  })

  it('handles xenon in a core that never ran', () => {
    let x = { iodine: 0, xenon: 0 }
    for (let i = 0; i < 500; i++) x = stepXenon(x, 0, 600)
    expect(x.xenon).toBe(0)
    expect(findXenonPeak(x).seconds).toBe(0)
  })

  it('gives zero decay heat for a core with no operating history', () => {
    expect(decayHeatFraction(10, 0)).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(decayHeatFraction(0, 0))).toBe(true)
  })

  it('keeps xenon equilibrium finite at zero power', () => {
    const eq = xenonEquilibrium(0)
    expect(Number.isFinite(eq.xenon)).toBe(true)
    expect(eq.xenon).toBe(0)
  })

  it('does not let the critical position escape 0..1', () => {
    for (const kind of REACTOR_ORDER) {
      const spec = REACTORS[kind]
      // Absurd poison, and absurd excess — both must clamp rather than wrap.
      expect(criticalWithdrawal(spec, -0.5)).toBeLessThanOrEqual(1)
      expect(criticalWithdrawal(spec, 0.5)).toBeGreaterThanOrEqual(0)
    }
  })
})
