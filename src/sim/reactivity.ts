import type { ReactorSpec } from './reactors'

/**
 * The reactivity balance.
 *
 * Everything the operator does, and everything the reactor does back, arrives
 * here as a term in one sum:
 *
 *   ρ = ρ_rods + ρ_boron + ρ_doppler + ρ_moderator + ρ_xenon + ρ_source
 *
 * Keeping the terms separate rather than collapsing them to a single number is
 * the most educational decision in the project: the UI shows each as its own
 * bar, so the visitor can watch the reactor push back. Pull rods and the rod bar
 * rises; the core heats and the Doppler bar grows negative to meet it; the sum
 * settles near zero without anyone asking it to. That is what "inherently
 * stable" means, and it is far more convincing seen than described.
 */

export type ReactivityTerms = {
  /**
   * Rod bank contribution, measured from fully inserted. Combines the core's
   * built-in excess with how much of it the rods are currently holding down, so
   * this term is deeply negative at cold shutdown and rises toward the excess as
   * the banks come out.
   */
  rods: number
  boron: number
  fuelTemp: number
  modTemp: number
  xenon: number
  /** TRIGA transient rod. Zero unless a pulse is in progress. */
  transient: number
  total: number
}

/**
 * Integral control rod worth as a function of withdrawal fraction.
 *
 *   ρ(x) = W·( x − sin(2πx)/2π )
 *
 * The S-curve, not a straight line. Its derivative is W·(1 − cos 2πx), which is
 * zero at both ends and peaks at the core midplane — differential worth follows
 * the flux, and flux is highest in the middle. This is why the first inches of
 * withdrawal do almost nothing, the middle of the bank is where the reactor
 * "comes alive", and the last inches do almost nothing again.
 *
 * An operator feels this as the rods becoming twitchy halfway out, and a linear
 * model would misrepresent the single most important handling characteristic of
 * the machine.
 */
export function rodWorth(withdrawal: number, totalWorth: number): number {
  const x = Math.min(1, Math.max(0, withdrawal))
  return totalWorth * (x - Math.sin(2 * Math.PI * x) / (2 * Math.PI))
}

/**
 * Differential rod worth, Δρ per unit withdrawal — the slope of the above.
 * Displayed live, because it is what tells the operator how much a given pull
 * is about to be worth.
 */
export function differentialRodWorth(withdrawal: number, totalWorth: number): number {
  const x = Math.min(1, Math.max(0, withdrawal))
  return totalWorth * (1 - Math.cos(2 * Math.PI * x))
}

/**
 * Full reactivity balance.
 *
 * Temperature terms are referenced to the cold-shutdown condition, so a cold
 * core contributes zero and every degree of heatup subtracts reactivity. Both
 * coefficients are negative, which is the entire inherent-safety argument: a
 * reactor that heats up slows down, with no operator and no electricity
 * involved.
 */
export function reactivityBalance(spec: ReactorSpec, s: {
  rodWithdrawal: number
  boronPpm: number
  tFuel: number
  tCoolant: number
  /** Xenon-135 reactivity, already negative. From xenon.ts. */
  xenonRho: number
  tReference: number
  /** Fraction of the transient rod ejected, 0..1. TRIGA pulses only. */
  transientEjected?: number
}): ReactivityTerms {
  // The core's own excess, minus however much the rods are still holding down.
  // At full insertion this is `coldCleanExcess − rodWorth` — the shutdown
  // margin, and comfortably negative. At full withdrawal it is the excess
  // itself. Without the excess term, rods-in would sit exactly at critical,
  // which no reactor does.
  const rods = spec.coldCleanExcess - spec.rodWorth + rodWorth(s.rodWithdrawal, spec.rodWorth)

  // Boron always subtracts, in proportion to concentration. A PWR startup is
  // mostly hours of slow dilution with the rods only trimming — 2000 ppm is
  // worth −20 000 pcm, far more than the rods can supply, which is exactly why
  // a large PWR needs a chemical shim at all.
  const boron = spec.alphaBoron * s.boronPpm

  // Doppler. Prompt, because it depends on fuel temperature rather than on heat
  // having to travel anywhere — which is what lets it terminate an excursion
  // before any mechanical system could react.
  const fuelTemp = spec.alphaFuel * (s.tFuel - s.tReference)
  const modTemp = spec.alphaMod * (s.tCoolant - s.tReference)

  const transient = (s.transientEjected ?? 0) * spec.transientRodWorth

  const total = rods + boron + fuelTemp + modTemp + s.xenonRho + transient
  return { rods, boron, fuelTemp, modTemp, xenon: s.xenonRho, transient, total }
}

/**
 * Rod withdrawal at which the core goes critical, given everything else.
 *
 * Solved by bisection on the monotonic worth curve. This is what the 1/M plot
 * predicts during a real startup, and having it available means the UI can show
 * the operator's estimate converging on the true answer as rods come out —
 * which is the entire point of plotting 1/M rather than just pulling and hoping.
 */
export function criticalWithdrawal(spec: ReactorSpec, otherTerms: number): number {
  const target = -(spec.coldCleanExcess - spec.rodWorth + otherTerms)
  if (target <= 0) return 0
  if (target >= spec.rodWorth) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (rodWorth(mid, spec.rodWorth) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * Subcritical multiplication of the startup neutron source.
 *
 * A shut-down reactor is not neutron-free: a source (Am-Be, Sb-Be, or just
 * spontaneous fission in the fuel) keeps a population alive, and a subcritical
 * core multiplies it by M = 1/(1−k). As k approaches 1 the count rate climbs
 * hyperbolically, which is what the detectors see during approach to critical.
 *
 * Without a source the count rate would be zero until the instant of
 * criticality, and there would be nothing to extrapolate — startup would be a
 * blind step rather than a measurement. This is why the source is installed.
 */
export function subcriticalMultiplication(k: number): number {
  if (k >= 0.999999) return 1e6
  return 1 / (1 - k)
}

/** k_eff from reactivity. ρ = (k−1)/k, so k = 1/(1−ρ). */
export const kEff = (rho: number) => 1 / (1 - rho)

/** Reactivity from k_eff. */
export const rhoFromK = (k: number) => (k - 1) / k
