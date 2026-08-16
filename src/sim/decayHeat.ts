import { DECAY_HEAT } from './constants'

/**
 * Decay heat — the reason a reactor is never really "off".
 *
 * When the rods drop, fission stops within milliseconds. The heat does not.
 * Fission products already in the fuel keep decaying, and they produce about
 * 6.5 % of rated power immediately after shutdown, ~1 % an hour later, ~0.4 % a
 * day later.
 *
 * For a 3400 MW reactor that is 220 MW the instant after scram, and still
 * 14 MW a day later. It has to go somewhere. This is why cooling must continue
 * after shutdown, why every plant has multiple independent ways to do it, and
 * why the Fukushima Daiichi accident happened: the reactors scrammed correctly
 * and shut down correctly, and then lost the power to remove decay heat.
 *
 * Way-Wigner correlation [ANS-5.1, Lamarsh §8.2]:
 *
 *   P(t)/P₀ = 0.066·[ t^(−0.2) − (t + t_op)^(−0.2) ]
 *
 * with t seconds since shutdown and t_op seconds of prior operation at P₀. The
 * second term is the correction for finite operating history — a reactor run for
 * an hour has far less inventory than one run for a year, which is why a fresh
 * startup can be scrammed with little consequence and an end-of-cycle core
 * cannot.
 */

/**
 * Decay heat as a fraction of the power level before shutdown.
 *
 * `secondsSinceShutdown` — clamped below at 1 s, because the correlation
 * diverges at t=0 and is not valid in the first second anyway (delayed neutrons
 * still dominate there).
 * `secondsOperated` — prior operating time at that power.
 */
export function decayHeatFraction(secondsSinceShutdown: number, secondsOperated: number): number {
  const t = Math.max(1, secondsSinceShutdown)
  const op = Math.max(1, secondsOperated)
  const { coefficient, exponent } = DECAY_HEAT
  const fraction = coefficient * (Math.pow(t, exponent) - Math.pow(t + op, exponent))
  return Math.max(0, fraction)
}

/** Absolute decay heat, watts. */
export const decayHeatPower = (
  powerBeforeShutdown: number,
  secondsSinceShutdown: number,
  secondsOperated: number,
) => powerBeforeShutdown * decayHeatFraction(secondsSinceShutdown, secondsOperated)

/**
 * Reference points a visitor can check the model against, for `docs/validation.md`
 * and for the panel's own annotation. Computed from an infinite-operation core so
 * they match the figures quoted in textbooks and NRC material.
 */
export const DECAY_HEAT_LANDMARKS = [
  { label: '1 second', seconds: 1 },
  { label: '1 minute', seconds: 60 },
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86_400 },
  { label: '1 month', seconds: 2_592_000 },
] as const

/** Long operating history — one year — used for the landmark table. */
export const LONG_OPERATION = 365 * 86_400
