import { advance, equilibrium, makeConfig, maxStableStep, period, sourceLevel, startupRate, step, toDollars, type KineticsConfig, type KineticsState } from './kinetics'
import { kEff, reactivityBalance, subcriticalMultiplication, type ReactivityTerms } from './reactivity'
import { REACTORS, type ReactorKind, type ReactorSpec } from './reactors'
import { POINT_OF_ADDING_HEAT, saturationMargin, stepThermal, thermalParams, type ThermalParams, type ThermalState } from './thermal'
import { decayHeatFraction } from './decayHeat'
import { stepXenon, xenonEquilibrium, xenonReactivity, type XenonState } from './xenon'
import { checkTrips } from './protection'

/**
 * The whole reactor, integrated.
 *
 * This module owns the ONE mutable state object the rest of the application
 * reads. Nothing here imports React or Three — `src/sim/` is a pure numerical
 * library that runs in Node, which is what makes the accuracy claim testable
 * rather than merely asserted (PLAN.md §4).
 *
 * The coupling order within a step matters and is deliberate:
 *
 *   1. reactivity from the CURRENT temperatures and poisons
 *   2. neutronics with that reactivity
 *   3. thermal from the resulting power
 *   4. xenon from the resulting flux
 *
 * Evaluating feedback before the neutronics rather than after is what makes the
 * loop stable at large steps. Doing it the other way round lets power and
 * temperature chase each other by a full step and produces a spurious
 * oscillation that looks exactly like a real xenon or moderator instability —
 * the most confusing possible bug, because the artefact resembles the physics.
 */

export type OperatorInputs = {
  /** Control rod withdrawal, 0 = fully inserted, 1 = fully withdrawn. */
  rodWithdrawal: number
  /** Soluble boron, ppm. Ignored where the variant has no boron shim. */
  boronPpm: number
  /** Wall-clock seconds per simulated second. 1, 60 or 3600. */
  timeScale: number
  scrammed: boolean
  /** Fraction of the TRIGA transient rod currently ejected, 0..1. */
  transientEjected: number
}

export type ReactorState = {
  spec: ReactorSpec
  kinetics: KineticsState
  thermal: ThermalState
  xenon: XenonState
  terms: ReactivityTerms

  /** Seconds of simulated time since the session began. */
  clock: number
  /** Thermal power, W. Includes decay heat after a scram. */
  power: number
  /** Fraction of rated power. */
  powerFraction: number
  rho: number
  dollars: number
  kEff: number
  /** Reactor period, s. Infinity when steady. */
  period: number
  /** Startup rate, decades per minute. */
  sur: number
  /** Subcritical multiplication, for the count-rate meter. */
  multiplication: number
  /** Margin to coolant saturation, °C. */
  saturationMargin: number

  scrammed: boolean
  /** Simulated seconds since the scram, or 0. */
  sinceScram: number
  /** Simulated seconds the core has operated above the point of adding heat. */
  operatingSeconds: number
  promptCritical: boolean
  /** Peak power fraction seen this session — the pulse leaves a mark. */
  peakPowerFraction: number
  /** Set if a numerical excursion had to be caught. Surfaced, never hidden. */
  faulted: boolean
  /** True while the TRIGA transient rod is out — the one licensed way to be prompt. */
  pulsing: boolean
  /** Label of the protection trip that scrammed the reactor, or null. */
  trippedBy: string | null
  /** Why that trip exists. Shown to the visitor, because the reason is the lesson. */
  trippedReason: string | null
}

export type Reactor = {
  state: ReactorState
  inputs: OperatorInputs
  params: ThermalParams
  config: KineticsConfig
  /** Seconds each trip condition has held continuously. */
  tripHeld: Record<string, number>
}

/**
 * Ceiling on substeps per frame.
 *
 * At 3600x a frame is 60 s of simulated time; at a 0.05 s step that is 1200
 * iterations, comfortably inside this. The cap only bites during a genuine fast
 * transient, where it means simulated time advances more slowly than the
 * requested compression — the sim visibly slows rather than quietly taking steps
 * too large to be right. Being late is recoverable; being wrong is not.
 */
const MAX_SUBSTEPS = 20_000

/**
 * Step size for the coupled loop.
 *
 * Three constraints, whichever is tightest:
 *
 *   1. the prompt neutron mode, above prompt critical (see maxStableStep)
 *   2. the current e-folding time, so feedback is sampled many times per
 *      doubling rather than once per doubling
 *   3. a plain ceiling, so a quiet reactor under heavy time compression does not
 *      burn iterations it does not need
 *
 * Constraint 2 is the one that was missing, and it is the one that mattered:
 * a reactor on a 1 s period needs its temperature feedback evaluated at ~0.05 s,
 * not at 1 s.
 */
function coupledStep(rho: number, state: ReactorState, config: KineticsConfig): number {
  const ceiling = 0.05
  const prompt = maxStableStep(rho, ceiling, config)

  // Previous frame's period. Using a stale value is fine — it only ever tightens
  // the step, and it tightens it a frame before the transient gets going.
  const efold = Math.abs(state.period)
  const feedback = isFinite(efold) && efold > 0 ? Math.max(1e-4, efold / 20) : ceiling

  return Math.max(1e-5, Math.min(ceiling, prompt, feedback))
}

/** A reactor at cold shutdown: rods in, cold, no poison, source-driven only. */
export function createReactor(kind: ReactorKind = 'triga'): Reactor {
  const spec = REACTORS[kind]
  // makeConfig, not a literal: the group fractions must be rescaled so Σβᵢ
  // equals the declared β_eff, or the critical point silently shifts by the
  // difference. See the note on makeConfig.
  const config: KineticsConfig = makeConfig(
    spec.groups, spec.lambdaGen, spec.betaEff, spec.neutronSource,
  )

  // Source-driven neutron level at cold shutdown, solved from the source rather
  // than guessed: n = S·Λ/|ρ|. A reactor with no neutrons has nothing to
  // multiply, and the whole approach to criticality is the measurement of that
  // multiplication (reactivity.ts).
  const shutdownRho = spec.coldCleanExcess - spec.rodWorth + spec.alphaBoron * spec.boronColdShutdown
  const kinetics = equilibrium(Math.max(1e-12, sourceLevel(shutdownRho, config)), config)

  const state: ReactorState = {
    spec,
    kinetics,
    thermal: { tFuel: spec.tInlet, tCoolant: spec.tInlet },
    xenon: { iodine: 0, xenon: 0 },
    terms: {
      rods: 0, boron: 0, fuelTemp: 0, modTemp: 0, xenon: 0, transient: 0, total: 0,
    },
    clock: 0,
    power: 0,
    powerFraction: 0,
    rho: 0,
    dollars: 0,
    kEff: 1,
    period: Infinity,
    sur: 0,
    multiplication: 1,
    saturationMargin: spec.tSat - spec.tInlet,
    scrammed: false,
    sinceScram: 0,
    operatingSeconds: 0,
    promptCritical: false,
    peakPowerFraction: 0,
    faulted: false,
    pulsing: false,
    trippedBy: null,
    trippedReason: null,
  }

  return {
    state,
    inputs: {
      rodWithdrawal: 0,
      boronPpm: spec.boronColdShutdown,
      timeScale: 1,
      scrammed: false,
      transientEjected: 0,
    },
    params: thermalParams(spec),
    config,
    tripHeld: {},
  }
}

/**
 * Advance the whole reactor by `wallSeconds` of real time.
 *
 * Mutates `reactor.state` in place — this object is read by the render loop
 * every frame, and allocating a new state object per frame would hand the
 * garbage collector 60 objects a second for no benefit (PLAN.md §5).
 */
export function stepReactor(reactor: Reactor, wallSeconds: number): void {
  const { state, inputs, params, config, tripHeld } = reactor
  const spec = state.spec

  // Clamp the wall step before scaling: a backgrounded tab returns with a
  // multi-second delta, and at 3600x that would be days of simulated time in
  // one frame.
  const simSeconds = Math.min(wallSeconds, 0.25) * inputs.timeScale
  if (simSeconds <= 0) return

  // A scram drops the rods below their fully-inserted worth: shutdown margin is
  // deliberately deeper than "rods in" during normal operation, and the reactor
  // must go decisively subcritical rather than merely critical-ish.
  const effectiveWithdrawal = inputs.scrammed ? 0 : inputs.rodWithdrawal
  const scramMargin = inputs.scrammed ? -0.02 : 0

  const before = state.kinetics.n
  let terms = state.terms
  let power = state.power
  let elapsed = 0
  let iterations = 0

  /**
   * The coupled loop.
   *
   * All four systems advance TOGETHER in one substepped loop. An earlier version
   * substepped only the neutronics and then stepped thermal once per frame with
   * the whole interval, which is a real bug rather than an approximation: at 60x
   * compression a frame is 1 s of simulated time, and at +500 pcm the power
   * e-folds in about 1 s. The Doppler feedback that should have limited the rise
   * therefore arrived a full step late, the loop overshot, oscillated, and
   * diverged to NaN — with the panel showing NaN MW and infinite temperatures.
   *
   * Feedback is only stabilising if it is evaluated on the timescale of the
   * thing it is supposed to stabilise.
   */
  while (elapsed < simSeconds - 1e-12 && iterations++ < MAX_SUBSTEPS) {
    // ── 1. Reactivity, from the state as it currently stands ──
    terms = reactivityBalance(spec, {
      rodWithdrawal: effectiveWithdrawal,
      boronPpm: inputs.boronPpm,
      tFuel: state.thermal.tFuel,
      tCoolant: state.thermal.tCoolant,
      xenonRho: xenonReactivity(state.xenon),
      tReference: spec.tInlet,
      transientEjected: inputs.scrammed ? 0 : inputs.transientEjected,
    })
    terms.total += scramMargin

    const dt = Math.min(coupledStep(terms.total, state, config), simSeconds - elapsed)

    // ── 2. Neutronics ──
    state.kinetics = advance(state.kinetics, terms.total, dt, dt, config)

    // ── 3. Power ──
    //
    // Fission power is proportional to n. Decay heat is added separately after a
    // scram, because it does NOT scale with the neutron population — it comes
    // from fission products already present, and it is why the core still needs
    // cooling when the chain reaction has stopped.
    power = state.kinetics.n * spec.ratedPower
    if (inputs.scrammed && state.operatingSeconds > 0) {
      power += spec.ratedPower * decayHeatFraction(state.sinceScram + elapsed, state.operatingSeconds)
    }

    // ── 4. Thermal, on the same step as the feedback that reads it ──
    state.thermal = stepThermal(state.thermal, power, params, dt)

    // ── 5. Xenon ──
    state.xenon = stepXenon(state.xenon, power / spec.ratedPower, dt)

    elapsed += dt

    // ── 6. Physical bounds ──
    //
    // A last line of defence, not the fix — the coupled stepping above is what
    // keeps the loop stable. But once any value goes non-finite it propagates
    // through every downstream readout in a single frame and the whole panel
    // reads NaN with nothing to indicate where it started. Catching it at the
    // source keeps the reactor recoverable and the failure legible.
    //
    // Fuel cannot get colder than its coolant inlet, and no reactor survives
    // 5000 °C; clamping to that range turns a numerical excursion into a
    // visibly pinned instrument rather than a dead page.
    if (!Number.isFinite(state.kinetics.n) || state.kinetics.n < 0) {
      state.kinetics = equilibrium(1e-8, config)
      state.faulted = true
      break
    }
    if (!Number.isFinite(state.thermal.tFuel) || !Number.isFinite(state.thermal.tCoolant)) {
      state.thermal = { tFuel: spec.tInlet, tCoolant: spec.tInlet }
      state.faulted = true
      break
    }
    state.thermal.tFuel = Math.min(5000, Math.max(spec.tInlet - 50, state.thermal.tFuel))
    state.thermal.tCoolant = Math.min(3000, Math.max(spec.tInlet - 50, state.thermal.tCoolant))
    if (!Number.isFinite(state.xenon.xenon)) state.xenon = { iodine: 0, xenon: 0 }
  }

  // ── 6. Derived readouts ──
  state.clock += elapsed
  state.terms = terms
  state.power = power
  state.powerFraction = power / spec.ratedPower
  state.rho = terms.total
  state.dollars = toDollars(terms.total, spec.betaEff)
  state.kEff = kEff(terms.total)
  state.multiplication = subcriticalMultiplication(state.kEff)
  // Measured over the time ACTUALLY simulated. The substep cap can make that
  // less than requested, and dividing by the request would misreport the period.
  state.period = period(before, state.kinetics.n, elapsed)
  state.sur = startupRate(state.period)
  state.saturationMargin = saturationMargin(spec, state.thermal)
  state.promptCritical = terms.total >= spec.betaEff
  state.scrammed = inputs.scrammed
  state.pulsing = inputs.transientEjected > 0
  state.peakPowerFraction = Math.max(state.peakPowerFraction, state.powerFraction)

  // ── Reactor protection ──
  //
  // Checked AFTER the readouts are derived, because the trips read the same
  // measured quantities an operator does rather than internal state. A real
  // protection system sees instruments, not the core.
  if (!inputs.scrammed) {
    const trip = checkTrips(state, spec, tripHeld, elapsed)
    if (trip) {
      inputs.scrammed = true
      inputs.rodWithdrawal = 0
      inputs.transientEjected = 0
      state.scrammed = true
      state.trippedBy = trip.label
      state.trippedReason = trip.reason
    }
  }

  // The transient rod falls back in under gravity a fraction of a second after
  // firing. Without this the pulse would be a step insertion that never ends,
  // and the core would sit prompt supercritical instead of pulsing.
  if (inputs.transientEjected > 0) {
    inputs.transientEjected = Math.max(0, inputs.transientEjected - elapsed / 0.5)
  }

  if (inputs.scrammed) state.sinceScram += elapsed
  else {
    state.sinceScram = 0
    if (state.powerFraction > POINT_OF_ADDING_HEAT) state.operatingSeconds += elapsed
  }
}

/**
 * Fire the TRIGA transient rod.
 *
 * The pneumatic rod is ejected in ~100 ms, inserting several dollars of
 * reactivity and taking the core PROMPT SUPERCRITICAL on purpose. Power rises by
 * six orders of magnitude in milliseconds and is then terminated — not by any
 * control system, but by the fuel's own prompt negative temperature coefficient,
 * which subtracts more reactivity than the rod inserted before anything can be
 * damaged.
 *
 * This is the one regime where the naive integrator is wrong by twelve orders of
 * magnitude and still looks convincing, which is why `maxStableStep` exists.
 */
export function pulse(reactor: Reactor): void {
  if (!reactor.state.spec.canPulse) return
  reactor.inputs.transientEjected = 1
}

/** Drop the rods. Reversible only by an explicit reset, as in a real plant. */
export function scram(reactor: Reactor): void {
  reactor.inputs.scrammed = true
}

export function resetScram(reactor: Reactor): void {
  reactor.inputs.scrammed = false
  reactor.inputs.rodWithdrawal = 0
  reactor.inputs.transientEjected = 0
  reactor.state.trippedBy = null
  reactor.state.trippedReason = null
  // A reset that leaves these behind means the next run starts carrying the
  // last one's history: a stale numerical-fault flag, and a peak-power mark
  // from an excursion that is over.
  reactor.state.faulted = false
  reactor.state.peakPowerFraction = 0
  for (const k of Object.keys(reactor.tripHeld)) reactor.tripHeld[k] = 0
}

/**
 * Jump the reactor to a steady state at a given power fraction.
 *
 * Used by the scroll narrative to place the core where a section needs it
 * without making the visitor wait out a real startup, and by the xenon section
 * to establish an operating history worth poisoning. Sets the precursors and
 * xenon to their equilibrium values, so nothing settles spuriously afterwards.
 */
export function settleAt(reactor: Reactor, powerFraction: number, operatingHours = 24): void {
  const { state, config } = reactor
  state.kinetics = equilibrium(powerFraction, config)
  state.xenon = xenonEquilibrium(powerFraction)
  state.power = powerFraction * state.spec.ratedPower
  state.powerFraction = powerFraction
  state.operatingSeconds = operatingHours * 3600

  // Run the thermal model to its own steady state rather than solving it: a few
  // hundred steps is instant and cannot disagree with stepThermal().
  for (let i = 0; i < 4000; i++) {
    state.thermal = stepThermal(state.thermal, state.power, reactor.params, 0.05)
  }
}

export { step, advance }
