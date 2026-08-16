import { COEFF, DELAYED_GROUPS, PCM, type DelayedGroup } from './constants'

/**
 * The four variants, as parameter sets over one simulation.
 *
 * This is the Towers structure: six towers were six parameter sets and six
 * assembly functions over one geometry builder. Here, four reactors are four
 * parameter sets over one point-kinetics core. Nothing about the physics is
 * special-cased per variant — only the numbers differ, which is what makes the
 * claim "these are really four different reactors" true rather than cosmetic.
 *
 * Λ genuinely differs between them and it matters: a graphite- or ZrH-moderated
 * core has a longer neutron generation time than a light-water one, which is
 * part of why they feel different to operate.
 */

export type ReactorKind = 'triga' | 'pwr' | 'bwr' | 'msre'

export type ReactorSpec = {
  kind: ReactorKind
  name: string
  /** Where and when — this drives the room's art direction, see PLAN.md §2.5 */
  place: string
  year: number

  // ── kinetics ──
  groups: DelayedGroup[]
  /** Mean neutron generation time, s. */
  lambdaGen: number
  /** Effective delayed neutron fraction. Falls through core life as Pu-239 builds. */
  betaEff: number

  // ── reactivity ──
  /**
   * Reactivity of the core with rods FULLY WITHDRAWN, cold, clean and (for a
   * PWR) unborated. Positive — a core with no excess reactivity could never
   * reach power, let alone run for a cycle as fuel burns up.
   *
   * With rods inserted the balance becomes `coldCleanExcess − rodWorth`, which
   * must be comfortably negative: that difference IS the shutdown margin, and
   * it is the number a plant is licensed on. Without this term the model has
   * rods-fully-in sitting exactly at critical, which no reactor does and which
   * makes every rod position meaningless.
   */
  coldCleanExcess: number
  /** Total worth of all control rods, dimensionless Δρ. */
  rodWorth: number
  /**
   * TRIGA's pneumatic transient rod, worth several dollars on its own. Separate
   * from the control banks because it is fired, not driven — it leaves the core
   * in ~100 ms and is what takes the reactor prompt supercritical on purpose.
   */
  transientRodWorth: number
  /**
   * Startup neutron source strength, normalised. Sized so a fully shut-down
   * core sits near n = 1e-8 of rated, which is where a source-range detector
   * actually reads.
   *
   * Not optional and not cosmetic: without it a subcritical core decays toward
   * zero with no floor, and the 1/M plot describes a multiplication that the
   * neutron population is not actually doing.
   */
  neutronSource: number
  /** Fuel (Doppler / prompt) temperature coefficient, Δρ per °C. Always negative. */
  alphaFuel: number
  /** Moderator temperature coefficient, Δρ per °C. */
  alphaMod: number
  /** Soluble boron worth, Δρ per ppm. Zero where boron is not used as shim. */
  alphaBoron: number
  /** Boron concentration at cold shutdown, ppm. */
  boronColdShutdown: number

  // ── thermal ──
  /** Rated thermal power, W. */
  ratedPower: number
  /** Coolant inlet temperature, °C. */
  tInlet: number
  /** Nominal average coolant temperature at power, °C. */
  tAvg: number
  /** Saturation temperature at operating pressure, °C. Margin to this is DNBR. */
  tSat: number
  pressureBar: number

  /** Can a visitor honestly see Cherenkov light? See PLAN.md §2. */
  cherenkovVisible: boolean
  /** Whether the transient (pulse) rod exists. TRIGA only. */
  canPulse: boolean
  signature: string
}

/**
 * TRIGA Mark II — the one you can actually look at.
 *
 * Built first, because it is the only variant where the blue glow is honestly
 * visible rather than a cutaway convention, and because its pulse is the single
 * best moment available to this project.
 *
 * The U-ZrH fuel has a large PROMPT negative temperature coefficient — roughly
 * four times a PWR's Doppler coefficient — because heating the zirconium hydride
 * shifts its neutron energy spectrum. That is what makes the reactor pulsable:
 * you can take it far past prompt critical on purpose and the fuel shuts it down
 * within milliseconds, before anything can be damaged. It is the only common
 * reactor designed to be driven into the regime every other reactor exists to
 * avoid.
 */
export const TRIGA: ReactorSpec = {
  kind: 'triga',
  name: 'TRIGA Mark II',
  place: 'University research reactor',
  year: 1968,
  groups: DELAYED_GROUPS,
  // Longer than a PWR: the ZrH moderator slows neutrons over a longer path.
  lambdaGen: 4.3e-5,
  betaEff: 0.007,
  // +500 pcm with rods out. Shutdown margin is therefore −4500 pcm, and the
  // core goes critical near 74 % withdrawal.
  coldCleanExcess: 500 * PCM,
  rodWorth: 5000 * PCM,
  // ~$2.5 on its own — fired pneumatically, not driven.
  transientRodWorth: 1750 * PCM,
  // Sized so rods-in (−4500 pcm) sits at n ≈ 1e-8: S = n·|ρ|/Λ.
  neutronSource: 1.05e-5,
  // ~4x the PWR Doppler coefficient. This number is the whole reason TRIGA
  // pulses are safe, so it deserves to be visible in the UI.
  alphaFuel: -11 * PCM,
  alphaMod: -8 * PCM,
  alphaBoron: 0,
  boronColdShutdown: 0,
  ratedPower: 250e3, // 250 kW steady; pulses peak near 250 MW for ~10 ms
  tInlet: 20,
  tAvg: 32,
  tSat: 100, // open pool, atmospheric
  pressureBar: 1,
  cherenkovVisible: true,
  canPulse: true,
  signature: 'Pulse mode — prompt supercritical on purpose, and self-limiting',
}

/** Westinghouse 4-loop PWR. The reference plant for most published data. */
export const PWR: ReactorSpec = {
  kind: 'pwr',
  name: 'Westinghouse 4-loop PWR',
  place: 'Commercial power station',
  year: 1975,
  groups: DELAYED_GROUPS,
  lambdaGen: 2.0e-5,
  betaEff: 0.0065,
  // A fresh PWR core has FAR more excess reactivity than its rods can hold —
  // 21 800 pcm against 8 000 pcm of rod worth. That deficit is precisely why
  // soluble boron exists: 2 000 ppm is worth −20 000 pcm, and without it the
  // core could not be shut down at all. Cold shutdown works out at −6 200 pcm.
  coldCleanExcess: 21_800 * PCM,
  rodWorth: 8000 * PCM,
  transientRodWorth: 0,
  neutronSource: 3.1e-5,
  alphaFuel: COEFF.fuelTemp,
  alphaMod: COEFF.modTemp,
  alphaBoron: COEFF.boron,
  boronColdShutdown: 2000,
  ratedPower: 3411e6,
  tInlet: 288,
  tAvg: 292,
  tSat: 373,
  pressureBar: 155,
  cherenkovVisible: false, // 200 mm of steel between you and it
  canPulse: false,
  signature: 'Boron shim — coarse chemical control the rods trim against',
}

/** General Electric BWR/4. Rods enter from BELOW, because steam occupies the top. */
export const BWR: ReactorSpec = {
  kind: 'bwr',
  name: 'General Electric BWR/4',
  place: 'Commercial power station',
  year: 1980,
  groups: DELAYED_GROUPS,
  lambdaGen: 2.4e-5,
  betaEff: 0.0064,
  // No boron shim, so the rods must hold the whole excess down alone — which is
  // why a BWR carries far more rods than a PWR of the same output.
  coldCleanExcess: 800 * PCM,
  rodWorth: 9000 * PCM,
  transientRodWorth: 0,
  neutronSource: 3.4e-5,
  alphaFuel: -2.3 * PCM,
  // Strongly negative: boiling drives voids, voids remove moderator. This is
  // also the control mechanism — recirculation flow changes void fraction, and
  // therefore power, without moving a rod.
  alphaMod: -60 * PCM,
  alphaBoron: 0,
  boronColdShutdown: 0,
  ratedPower: 3293e6,
  tInlet: 278,
  tAvg: 286,
  tSat: 286, // saturated by design — it is a boiling reactor
  pressureBar: 71,
  cherenkovVisible: false,
  canPulse: false,
  signature: 'Recirculation flow control — power steered by voids, not rods',
}

/**
 * Molten-Salt Reactor Experiment, Oak Ridge, 1965.
 *
 * The fuel is dissolved in the coolant, so there is no fuel element to melt. Its
 * signature is the freeze plug: a plug of frozen salt held solid by a cooling
 * fan. Lose power and the fan stops, the plug melts, and the entire fuel charge
 * drains by gravity into subcritical tanks. No operator, no electricity, no
 * decision. They demonstrated it by shutting the reactor down and going home for
 * the weekend.
 */
export const MSRE: ReactorSpec = {
  kind: 'msre',
  name: 'Molten-Salt Reactor Experiment',
  place: 'Oak Ridge National Laboratory',
  year: 1965,
  groups: DELAYED_GROUPS,
  // Graphite moderation — much longer generation time than light water.
  lambdaGen: 4.0e-4,
  // Notably low: the fuel CIRCULATES, so some precursors decay outside the core
  // and their neutrons are lost to the chain. A real and unusual effect.
  betaEff: 0.0064 * 0.7,
  coldCleanExcess: 400 * PCM,
  rodWorth: 4000 * PCM,
  transientRodWorth: 0,
  neutronSource: 9.0e-7,
  alphaFuel: -4.9 * PCM,
  alphaMod: -3.4 * PCM,
  alphaBoron: 0,
  boronColdShutdown: 0,
  ratedPower: 8e6,
  tInlet: 635,
  tAvg: 663,
  tSat: 1400, // salt boils far above any operating temperature
  pressureBar: 1,
  cherenkovVisible: false,
  canPulse: false,
  signature: 'Freeze plug — walk-away safe with no operator and no power',
}

export const REACTORS: Record<ReactorKind, ReactorSpec> = {
  triga: TRIGA,
  pwr: PWR,
  bwr: BWR,
  msre: MSRE,
}

export const REACTOR_ORDER: ReactorKind[] = ['triga', 'pwr', 'bwr', 'msre']
