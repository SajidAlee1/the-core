import { describe, expect, it } from 'vitest'
import { createReactor, scram, stepReactor, type Reactor } from './reactor'

/**
 * Every step of the startup procedure must be reachable.
 *
 * A guided sequence with an unsatisfiable condition is worse than no guidance:
 * the visitor does everything right and the page silently refuses to acknowledge
 * it. This walks the whole procedure the way a person would and asserts each
 * gate opens.
 *
 * The thresholds here are duplicated from Procedure.tsx deliberately — the UI
 * module imports React, and src/sim stays free of it (PLAN.md §4). If they drift
 * apart this test fails, which is the point.
 */
const run = (r: Reactor, seconds: number, scale = 1) => {
  r.inputs.timeScale = scale
  for (let i = 0; i < seconds * 60; i++) stepReactor(r, 1 / 60)
}

describe('startup procedure is completable', () => {
  it('walks cold shutdown to decay heat', { timeout: 60_000 }, () => {
    const r = createReactor('triga')

    // 1. shut down
    run(r, 5)
    expect(r.state.rho).toBeLessThan(-0.02)

    // 2. multiplication climbs
    r.inputs.rodWithdrawal = 0.5
    run(r, 5)
    expect(r.state.multiplication).toBeGreaterThan(40)

    // 3. approach critical
    r.inputs.rodWithdrawal = 0.74
    run(r, 20)
    expect(r.state.rho).toBeGreaterThan(-0.002)
    expect(r.state.rho).toBeLessThan(0.0005)

    // 5. raise power
    r.inputs.rodWithdrawal = 0.80
    run(r, 40, 200)
    expect(r.state.powerFraction).toBeGreaterThan(0.001)

    // 6. self-regulation — Doppler negative and the net back near zero
    run(r, 60, 200)
    expect(r.state.terms.fuelTemp).toBeLessThan(-0.0003)
    expect(Math.abs(r.state.rho)).toBeLessThan(0.0004)

    // 7. xenon builds to a visible amount.
    // Driven at 3600x so this is ~60 h of reactor time in 3600 steps rather
    // than 2.4 million — the sim is step-size independent, so the answer is the
    // same either way.
    run(r, 60, 3600)
    expect(r.state.xenon.xenon).toBeGreaterThan(0.04)

    // 8. scram, and decay heat persists
    scram(r)
    run(r, 30, 10)
    expect(r.state.scrammed).toBe(true)
    expect(r.state.sinceScram).toBeGreaterThan(5)
    expect(r.state.powerFraction).toBeGreaterThan(0)
    expect(Number.isFinite(r.state.powerFraction)).toBe(true)
  })

  it('cannot reach criticality without withdrawing past the critical position', { timeout: 30_000 }, () => {
    // The gate that makes the procedure honest: no amount of waiting takes a
    // subcritical core critical.
    const r = createReactor('triga')
    r.inputs.rodWithdrawal = 0.6
    run(r, 30, 400)
    expect(r.state.rho).toBeLessThan(0)
    expect(r.state.powerFraction).toBeLessThan(1e-6)
  })
})

describe('the procedure cannot dead-end', () => {
  /**
   * Reported: scramming during the xenon step left the sequence stuck. Xenon
   * decays once the reactor is shut down, so that gate had closed permanently
   * and there was no way past it.
   *
   * The UI's look-ahead handles this, but the underlying invariant is worth
   * pinning here: after a scram, a LATER step's condition must be satisfiable
   * even though the earlier one is not.
   */
  it('leaves the scram step reachable even if xenon never built', () => {
    const r = createReactor('triga')
    r.inputs.rodWithdrawal = 0.80
    run(r, 40, 200)

    // Xenon deliberately still below the step-7 gate.
    expect(r.state.xenon.xenon).toBeLessThan(0.04)

    // Step 8's condition must still become true.
    scram(r)
    run(r, 30, 10)
    expect(r.state.scrammed).toBe(true)
    expect(r.state.sinceScram).toBeGreaterThan(5)
  })

  it('drops the rods to the bottom on a scram', () => {
    // The rod bank indicator reads from the same withdrawal the balance uses,
    // so a scram that leaves the input at 85% makes the control disagree with
    // the reactor. The effective position must be zero.
    const r = createReactor('triga')
    // Just past critical and left alone, so the protection system has no reason
    // to act. At 85 % the plant now trips on its own before this test can
    // sample a running state — which is the protection working, not a fault.
    r.inputs.rodWithdrawal = 0.76
    run(r, 20)
    expect(r.state.trippedBy).toBeNull()
    const live = r.state.terms.rods

    scram(r)
    run(r, 2)
    // Fully-inserted worth: coldCleanExcess - rodWorth.
    expect(r.state.terms.rods).toBeCloseTo(
      r.state.spec.coldCleanExcess - r.state.spec.rodWorth, 6,
    )
    expect(r.state.terms.rods).toBeLessThan(live)
  })
})
