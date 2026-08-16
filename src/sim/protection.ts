import type { ReactorSpec } from './reactors'
import type { ReactorState } from './reactor'

/**
 * The reactor protection system.
 *
 * Without it the model lets you do things a real plant physically prevents. A
 * PWR at 90 % rods and full boron settles at 186 % of rated power with fuel at
 * 760 °C — which is what the physics says, and which no operator has ever been
 * allowed to reach, because the plant trips first.
 *
 * That gap matters for a project whose claim is accuracy. A simulation that
 * reproduces the neutronics faithfully but omits the machine that stops it is
 * not modelling a reactor; it is modelling a reactor with its safety systems
 * removed, which is a different and much less honest object.
 *
 * Every trip here is a real one, and each is deliberately dumb: a fixed
 * threshold on a single measured quantity, no interpretation, no judgement.
 * Protection systems are built that way on purpose — the thing that stops the
 * reactor must be simpler than the thing that runs it, or it cannot be trusted.
 */

export type Trip = {
  id: string
  label: string
  /** Why this limit exists, shown when it fires. */
  reason: string
  fires: (s: ReactorState, spec: ReactorSpec) => boolean
  /**
   * Seconds the condition must hold before the trip actually fires.
   *
   * Real bistables have a time delay, and this is why: instantaneous readings
   * spike during any rod movement, and a protection system that fired on every
   * spike would make the plant unoperable. The first version here had no delay
   * and tripped the reactor during ordinary startups.
   */
  delay: number
  /**
   * Minimum power fraction for this trip to be armed.
   *
   * Real plants call these permissives (P-6, P-10 in a PWR) and they exist
   * because some measurements are meaningless at source range — a "short
   * period" computed from a handful of neutrons is noise, not a transient.
   */
  armAbove: number
}

export const TRIPS: Trip[] = [
  {
    id: 'power',
    label: 'High power',
    reason:
      'Above 120 % of rated, the fuel and the cooling system are outside what ' +
      'they were designed and licensed for. Nothing subtle — a threshold on a ' +
      'flux measurement.',
    fires: (s) => s.powerFraction > 1.2,
    delay: 0.5,
    armAbove: 0,
  },
  {
    id: 'period',
    label: 'Short period',
    reason:
      'Power e-folding faster than every 5 seconds. Not dangerous yet, but ' +
      'accelerating faster than an operator could intervene — the trip exists ' +
      'to stop the transient while it is still small.',
    fires: (s) => isFinite(s.period) && s.period > 0 && s.period < 5,
    delay: 1.0,
    // Below a millionth of rated the period is computed from a population so
    // small that ordinary statistical wobble looks like a transient.
    armAbove: 1e-6,
  },
  {
    id: 'temp',
    label: 'High fuel temperature',
    reason:
      'Fuel approaching its design limit. Cladding fails long before the fuel ' +
      'melts, and the cladding is the first barrier holding fission products ' +
      'inside the rod.',
    fires: (s, spec) => s.thermal.tFuel > (spec.kind === 'triga' ? 550 : 1200),
    delay: 0.5,
    armAbove: 0,
  },
  {
    id: 'saturation',
    label: 'Loss of subcooling',
    reason:
      'Coolant within 5 °C of boiling. A PWR is pressurised precisely so the ' +
      'water does NOT boil — losing that margin means losing the heat transfer ' +
      'the core depends on.',
    // Meaningless in a BWR, which is saturated by design. Applying it there
    // would trip the plant for operating normally.
    fires: (s, spec) => spec.kind !== 'bwr' && s.saturationMargin < 5,
    delay: 1.0,
    armAbove: 1e-4,
  },
  {
    id: 'prompt',
    label: 'Prompt critical',
    reason:
      'ρ ≥ β. The chain now sustains on prompt neutrons alone and the delayed ' +
      'groups no longer moderate it. This is the line nobody crosses by ' +
      'accident.',
    // TRIGA's transient rod takes the core prompt supercritical BY DESIGN, and
    // the fuel's own temperature coefficient terminates it in milliseconds. A
    // trip here would forbid the reactor's defining feature.
    fires: (s, spec) => s.promptCritical && !(spec.canPulse && s.pulsing),
    delay: 0.2,
    armAbove: 0,
  },
]

/**
 * Advance the trip timers and return whichever has held long enough to fire.
 *
 * `held` accumulates simulated seconds per trip id and is reset the moment a
 * condition clears, so only a sustained excursion trips the plant. Order in
 * TRIPS is priority order.
 *
 * A TRIGA pulse suppresses everything: the transient rod is a licensed
 * evolution that deliberately goes prompt supercritical, and the fuel's own
 * temperature coefficient terminates it in milliseconds. Tripping on it would
 * forbid the reactor's defining feature.
 */
export function checkTrips(
  s: ReactorState,
  spec: ReactorSpec,
  held: Record<string, number>,
  dt: number,
): Trip | null {
  if (spec.canPulse && s.pulsing) {
    for (const t of TRIPS) held[t.id] = 0
    return null
  }

  let fired: Trip | null = null
  for (const t of TRIPS) {
    const active = s.powerFraction >= t.armAbove && t.fires(s, spec)
    held[t.id] = active ? (held[t.id] ?? 0) + dt : 0
    if (!fired && held[t.id] >= t.delay) fired = t
  }
  return fired
}
