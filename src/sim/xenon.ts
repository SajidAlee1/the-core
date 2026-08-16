import { XENON } from './constants'

/**
 * Xenon-135 — the slow villain.
 *
 *   dI/dt = γ_I·Σf·φ − λ_I·I
 *   dX/dt = γ_X·Σf·φ + λ_I·I − λ_X·X − σ_X·X·φ
 *
 * Xe-135 has a thermal absorption cross-section of 2.6 million barns, among the
 * largest of any nuclide. At equilibrium in a power reactor it is worth roughly
 * −2700 pcm: a third of the total control rod worth, spent entirely on
 * compensating for one fission product.
 *
 * ── Why it lags ────────────────────────────────────────────────────────────
 *
 * Look at the two yields: γ_I = 0.0639, γ_X = 0.00237. Twenty-seven times more
 * Xe-135 arrives by I-135 decay than directly from fission. So the xenon
 * inventory is fed by a reservoir of iodine with a 6.6 hour half-life.
 *
 * While the reactor runs, xenon is destroyed as fast as it appears, because
 * σ_X·φ dominates its own decay — it is being burned out by the very neutron
 * flux it is poisoning. Shut down, and that burnout stops instantly while the
 * iodine reservoir keeps decaying into xenon for hours. Xenon therefore PEAKS
 * roughly 9–11 hours AFTER shutdown, not during operation.
 *
 * If the core lacks the rod worth to overcome that peak, restart is physically
 * impossible until it decays — a window operators call XENON DEAD TIME. Nothing
 * an operator wants changes it.
 *
 * This is also the mechanism behind Chernobyl: a xenon-poisoned core, and rods
 * withdrawn far past limits to compensate for a poison that would decay on its
 * own schedule regardless. The honest way to tell that story is not as
 * spectacle, but as the arithmetic on this page.
 */

export type XenonState = {
  /** I-135 concentration, normalised so equilibrium at full power = 1. */
  iodine: number
  /** Xe-135 concentration, same normalisation. */
  xenon: number
}

/**
 * Normalised flux at which xenon burnout balances its decay.
 *
 * Concentrations are carried in units of their own full-power equilibrium, which
 * keeps the numbers near 1 and avoids carrying absolute atom densities and
 * macroscopic cross-sections that would only ever appear as a ratio. `phi` below
 * is therefore power fraction, not neutrons/cm²·s.
 *
 * `burnoutRate` is σ_X·φ at full power, s⁻¹. For a typical power reactor flux
 * (~3e13 n/cm²·s) with σ_X = 2.6e-18 cm², that is ~7.8e-5 s⁻¹ — about four times
 * λ_X, which is exactly why xenon is suppressed while running and surges when
 * the flux stops.
 */
export const BURNOUT_RATE = 7.8e-5

/** Equilibrium xenon and iodine at a steady power fraction. */
export function xenonEquilibrium(powerFraction: number): XenonState {
  const phi = Math.max(0, powerFraction)
  // dI/dt = 0 → I = γ_I·φ/λ_I, normalised so full power gives 1.
  const iodine = phi
  // dX/dt = 0 → X = (γ_X·φ + λ_I·I) / (λ_X + σ_X·φ)
  const production = XENON.gammaX * phi + XENON.gammaI * iodine
  const removal = XENON.lambdaX + BURNOUT_RATE * phi
  const referenceProduction = XENON.gammaX + XENON.gammaI
  const referenceRemoval = XENON.lambdaX + BURNOUT_RATE
  const xenon = (production / removal) / (referenceProduction / referenceRemoval)
  return { iodine, xenon }
}

/**
 * One xenon step. `dt` in seconds — this system is slow (hours), so it is
 * normally driven under time compression.
 *
 * Implicit in the removal terms so a large compressed step stays stable; the
 * production terms are explicit, which is fine because they are bounded.
 */
export function stepXenon(state: XenonState, powerFraction: number, dt: number): XenonState {
  const phi = Math.max(0, powerFraction)

  // Iodine: produced by fission, removed only by its own decay. It does not
  // absorb neutrons meaningfully, so shutting down does not stop it decaying —
  // which is the whole reason the xenon peak happens after shutdown.
  const iodine = (state.iodine + dt * XENON.lambdaI * phi) / (1 + dt * XENON.lambdaI)

  // Xenon: fed directly by fission AND by iodine decay; removed by its own decay
  // AND by neutron capture. That last term vanishes at shutdown.
  const gammaRatio = XENON.gammaX / (XENON.gammaX + XENON.gammaI)
  const iodineRatio = XENON.gammaI / (XENON.gammaX + XENON.gammaI)
  const referenceRemoval = XENON.lambdaX + BURNOUT_RATE

  const production =
    referenceRemoval * (gammaRatio * phi + iodineRatio * XENON.lambdaI * iodine / XENON.lambdaI)
  const removal = XENON.lambdaX + BURNOUT_RATE * phi

  const xenon = (state.xenon + dt * production) / (1 + dt * removal)
  return { iodine, xenon }
}

/**
 * Xenon reactivity, always negative.
 *
 * `worthAtEquilibrium` is the reactivity of full-power equilibrium xenon,
 * conventionally about −2700 pcm in a large PWR.
 */
export const xenonReactivity = (state: XenonState, worthAtEquilibrium = -0.027) =>
  worthAtEquilibrium * state.xenon

/**
 * Time to the post-shutdown xenon peak, seconds, and its magnitude.
 *
 * Found by integrating `stepXenon` forward rather than by a closed-form
 * expression. That is deliberate: a separate analytic predictor can DISAGREE
 * with the simulation it is meant to describe, and here one did.
 *
 * The first version of this function assumed I and X each decayed on their own
 * exponential and solved λ_I·I = λ_X·X from the initial ratio. But X is fed by I
 * — that coupling is the entire phenomenon — so the approximation returned
 * 11.29 h against an exact 8.49 h, a 33 % error, while looking perfectly
 * plausible because it landed inside the "9–11 hours" range every textbook
 * quotes. Searching the actual model cannot drift from the actual model.
 *
 * The peak time is genuinely flux-dependent: at σ_X·φ = 7.8e-5 s⁻¹ (a PWR at
 * ~3e13 n/cm²·s) it is 8.5 h and ~1.9x equilibrium; at 1e14 it moves out to
 * 10.3 h and grows. Quoting a single number without the flux would be the same
 * kind of false precision.
 */
export function findXenonPeak(state: XenonState): { seconds: number; magnitude: number } {
  // 30 s steps over 48 h. Xenon's own timescale is hours, so this is finer than
  // it needs to be and still costs under six thousand iterations — the function
  // is called on demand for "skip to the peak", not per frame.
  const dt = 30
  const horizon = 48 * 3600
  let current = state
  let best = state.xenon
  let bestAt = 0

  for (let t = dt; t <= horizon; t += dt) {
    current = stepXenon(current, 0, dt)
    if (current.xenon > best) {
      best = current.xenon
      bestAt = t
    } else if (bestAt > 0) {
      // Past the maximum — xenon is monotonic on each side of it, so stop.
      break
    }
  }

  return { seconds: bestAt, magnitude: best }
}

/** Convenience wrapper for callers that only need the timing. */
export const timeToXenonPeak = (state: XenonState) => findXenonPeak(state).seconds
