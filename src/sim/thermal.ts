import type { ReactorSpec } from './reactors'

/**
 * Two-node lumped thermal model: fuel, and coolant.
 *
 *   C_F·dT_F/dt = P − h·(T_F − T_C)
 *   C_C·dT_C/dt = h·(T_F − T_C) − ṁ·cp·(T_C − T_in)
 *
 * Two nodes is a deliberate choice, not a shortcut waiting to be improved. What
 * the simulation needs from thermal-hydraulics is the FEEDBACK PATH — power
 * heats fuel, fuel temperature subtracts reactivity, reactivity changes power —
 * and two nodes reproduce that loop with the right time constants. The fuel node
 * responds in seconds (which is why Doppler feels prompt) and the coolant node
 * in tens of seconds (which is why moderator feedback lags and can oscillate).
 *
 * What two nodes CANNOT do is spatial: hot channels, axial flux shape, departure
 * from nucleate boiling at a specific rod. PLAN.md §9 requires that limitation be
 * stated on the page rather than hidden, because a simulation that quietly
 * implies more resolution than it has is worse than one that admits its scope.
 */

export type ThermalState = {
  /** Volume-average fuel temperature, °C. */
  tFuel: number
  /** Average coolant temperature, °C. */
  tCoolant: number
}

export type ThermalParams = {
  /** Fuel heat capacity, J/°C. */
  fuelCapacity: number
  /** Coolant heat capacity in-core, J/°C. */
  coolantCapacity: number
  /** Fuel-to-coolant conductance, W/°C. */
  conductance: number
  /** Mass flow × specific heat, W/°C. Zero means natural circulation only. */
  flowCapacity: number
  tInlet: number
}

/**
 * Thermal parameters scaled from rated power.
 *
 * Rather than inventing absolute masses, these are derived so the STEADY-STATE
 * temperature rises match each reactor's published operating points — the fuel
 * sits a few hundred degrees above coolant at full power, and coolant rises from
 * inlet to average by the documented amount. Time constants then follow.
 */
export function thermalParams(spec: ReactorSpec): ThermalParams {
  const p = spec.ratedPower
  // Full-power fuel-to-coolant ΔT. ~250 °C is representative for oxide fuel; a
  // TRIGA rod sits much closer to its coolant because the power density is low.
  const fuelRise = spec.kind === 'triga' ? 180 : 250
  const coolantRise = Math.max(4, spec.tAvg - spec.tInlet)

  return {
    conductance: p / fuelRise,
    flowCapacity: p / coolantRise,
    // Time constants: fuel ~4 s, coolant ~12 s. These are what make Doppler
    // read as instant and moderator feedback read as lagging.
    fuelCapacity: (p / fuelRise) * 4,
    coolantCapacity: (p / coolantRise) * 12,
    tInlet: spec.tInlet,
  }
}

/**
 * One thermal step. Explicit is fine here — unlike the neutronics, the time
 * constants are seconds, not microseconds, so a 10 ms step is four hundred times
 * finer than the fastest mode.
 *
 * `power` is watts, `dt` seconds.
 */
export function stepThermal(
  state: ThermalState,
  power: number,
  p: ThermalParams,
  dt: number,
): ThermalState {
  const transferred = p.conductance * (state.tFuel - state.tCoolant)
  const removed = p.flowCapacity * (state.tCoolant - p.tInlet)

  const tFuel = state.tFuel + (dt * (power - transferred)) / p.fuelCapacity
  const tCoolant = state.tCoolant + (dt * (transferred - removed)) / p.coolantCapacity

  return { tFuel, tCoolant }
}

/**
 * Margin to saturation, °C — how far the coolant is from boiling.
 *
 * In a PWR this is the number that matters: the plant is pressurised
 * specifically so the water does NOT boil, and losing that margin is losing the
 * heat transfer mechanism the core depends on. In a BWR it is meaningless by
 * design, because the coolant is already saturated — which is why the readout
 * should be labelled differently per variant rather than shown blindly.
 */
export const saturationMargin = (spec: ReactorSpec, t: ThermalState) =>
  spec.tSat - t.tCoolant

/** Fraction of rated power. */
export const powerFraction = (spec: ReactorSpec, watts: number) => watts / spec.ratedPower

/**
 * Point of adding heat.
 *
 * Below roughly 1 % of rated power, fission heat is small compared with what the
 * pumps and ambient losses contribute, so temperature does not respond to
 * reactivity and there is no feedback — the reactor behaves as a pure
 * exponential amplifier. Above it, temperature feedback engages and the reactor
 * starts regulating itself. Operators name this crossing because the machine
 * genuinely changes character there, and the UI should mark it.
 */
export const POINT_OF_ADDING_HEAT = 0.01
