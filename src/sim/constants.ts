/**
 * Physical constants.
 *
 * Every value here carries its source. The accuracy claim this project makes is
 * only worth anything if the numbers are checkable, so a constant without a
 * citation is a bug.
 *
 * Sources:
 *   [Keepin]  G.R. Keepin, "Physics of Nuclear Kinetics", Addison-Wesley 1965.
 *             Delayed neutron data for thermal fission of U-235.
 *   [Lamarsh] Lamarsh & Baratta, "Introduction to Nuclear Engineering", 3rd ed.
 *   [DOE]     DOE Fundamentals Handbook, Nuclear Physics and Reactor Theory,
 *             DOE-HDBK-1019/1-93 and /2-93.
 *   [ANS]     ANSI/ANS-5.1, Decay Heat Power in Light Water Reactors.
 */

/** One delayed-neutron precursor group. */
export type DelayedGroup = {
  /** Fraction of fission neutrons emitted by this group's precursors. */
  beta: number
  /** Decay constant, s^-1. */
  lambda: number
}

/**
 * Six-group delayed neutron data, thermal fission of U-235. [Keepin]
 *
 * These six numbers are the reason reactors are controllable at all. Prompt
 * neutrons appear in ~1e-14 s; if they were the whole story the neutron
 * generation time would be ~2e-5 s and a 0.1% reactivity error would double
 * power in milliseconds — far faster than any mechanism could respond. Because
 * 0.65% of neutrons arrive seconds to a minute late, the *effective* generation
 * time at small reactivity is ~0.1 s, and a human can operate the machine.
 */
export const DELAYED_GROUPS: DelayedGroup[] = [
  { beta: 0.000215, lambda: 0.0124 }, // T½ 55.9 s
  { beta: 0.001424, lambda: 0.0305 }, // T½ 22.7 s
  { beta: 0.001274, lambda: 0.111 },  // T½ 6.24 s
  { beta: 0.002568, lambda: 0.301 },  // T½ 2.30 s
  { beta: 0.000748, lambda: 1.14 },   // T½ 0.61 s
  { beta: 0.000273, lambda: 3.01 },   // T½ 0.23 s
]

/** Total delayed neutron fraction, U-235 thermal. Sum of the table above. */
export const BETA = DELAYED_GROUPS.reduce((s, g) => s + g.beta, 0) // 0.006502

/**
 * Mean neutron generation time, s. [Lamarsh §7.2]
 *
 * Light-water thermal spectrum. This is the number that makes the point kinetics
 * equations stiff: it is ~800x smaller than a 16 ms animation frame, which is
 * why the integrator in kinetics.ts must be implicit. See PLAN.md §1.2.
 */
export const LAMBDA_GEN = 2.0e-5

/** Reactivity unit conversions. */
export const PCM = 1e-5
/** One dollar of reactivity == beta. Prompt critical is exactly $1.00. */
export const DOLLAR = BETA

/**
 * Reactivity coefficients, PWR at hot zero power. [DOE-HDBK-1019/2, Module 3]
 *
 * Both are negative, and that is the whole safety argument: a reactor that heats
 * up loses reactivity and slows itself down, with no operator and no electricity
 * involved. A positive coefficient is what makes a core capable of running away.
 */
export const COEFF = {
  /**
   * Fuel temperature (Doppler) coefficient, Δρ per °C of fuel.
   *
   * This is resonance broadening in U-238 — as the fuel heats, its absorption
   * resonances widen and capture more neutrons. It is prompt, because it depends
   * on fuel temperature rather than heat having to travel anywhere. That
   * immediacy is what terminates a power excursion before anything melts.
   */
  fuelTemp: -2.5 * PCM,
  /**
   * Moderator temperature coefficient, Δρ per °C of coolant.
   *
   * Negative at operating boron concentration. Goes POSITIVE at high boron
   * (beginning of cycle), because hotter water is less dense and therefore
   * carries less of the boron poison out of the core than it loses moderation.
   * This is why beginning-of-cycle startups are handled with extra care.
   */
  modTemp: -35 * PCM,
  /** Boron worth, Δρ per ppm. [DOE-HDBK-1019/2] */
  boron: -10 * PCM,
} as const

/**
 * Total control rod worth, all banks, pcm. [Lamarsh §7.6, typical PWR]
 * The withdrawal curve is S-shaped, not linear — see reactivity.ts.
 */
export const TOTAL_ROD_WORTH = 8000 * PCM

/**
 * Xenon-135 poisoning. [Lamarsh §7.4]
 *
 * Xe-135 has an absorption cross-section of 2.6e6 barns — among the largest of
 * any nuclide. It is why a reactor shut down from full power may be physically
 * unable to restart for many hours regardless of what the operator wants.
 */
export const XENON = {
  /** I-135 decay constant, s^-1. T½ = 6.57 h. */
  lambdaI: 2.87e-5,
  /** Xe-135 decay constant, s^-1. T½ = 9.17 h. */
  lambdaX: 2.09e-5,
  /** Fission yield of I-135. */
  gammaI: 0.0639,
  /**
   * Direct fission yield of Xe-135. Note it is ~27x smaller than iodine's —
   * most Xe-135 arrives by I-135 decay, which is exactly why the xenon peak
   * lags shutdown by ~9-11 h instead of appearing immediately.
   */
  gammaX: 0.00237,
  /** Microscopic absorption cross-section, cm^2 (2.6e6 barns). */
  sigmaX: 2.6e-18,
} as const

/**
 * Decay heat, Way-Wigner correlation. [ANS-5.1 / Lamarsh §8.2]
 *
 * Fission stops the instant the rods drop. Heat does not: fission-product decay
 * still produces ~6.5% of rated power immediately after shutdown, ~1% an hour
 * later. This is why cooling must continue after a reactor is "off", and it is
 * the direct cause of the Fukushima accident.
 */
export const DECAY_HEAT = {
  coefficient: 0.066,
  exponent: -0.2,
} as const

/** Thermal reference points, Westinghouse 4-loop PWR. [DOE-HDBK-1019/2] */
export const PWR_THERMAL = {
  /** °C — nominal average coolant temperature at power. */
  tAvg: 292,
  tCold: 288,
  tHot: 324,
  /** Saturation temperature at 2250 psia, °C. Margin to this is the DNBR story. */
  tSat: 373,
  pressurePsia: 2250,
  /** °C — cold shutdown ceiling (200 °F). */
  tColdShutdown: 93,
} as const
