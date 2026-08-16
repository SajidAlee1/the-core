import { createReactor, pulse, resetScram, scram, stepReactor, type Reactor } from './sim/reactor'
import type { ReactorKind } from './sim/reactors'

/**
 * The one bridge between the simulation and everything that draws.
 *
 * A single mutable module object, exactly as CALIBRE's `scroll.ts` did it: the
 * frame loop writes, `useFrame` and the panel's own rAF loop read, and React
 * never sees a per-frame value. A seven-digit readout updating at 60 Hz through
 * React state would re-render the whole tree sixty times a second and reconcile
 * the 3D scene graph along with it.
 *
 * React renders the CHROME here — which buttons exist, which room is on screen.
 * It never renders the NUMBERS.
 */

export const sim: { reactor: Reactor } = { reactor: createReactor('triga') }

/** Convenience accessor — always the live state, never a snapshot. */
export const state = () => sim.reactor.state
export const inputs = () => sim.reactor.inputs

/**
 * Ring buffer of recent power history, for the strip chart.
 *
 * Written by the driver below, read by the chart's own rAF loop. Fixed capacity
 * and a moving head rather than an array that grows — a chart running for an
 * hour at 60 Hz would otherwise accumulate 216 000 entries and the allocation
 * churn would show up as periodic GC hitches.
 */
export const CHART_CAPACITY = 900
export const chart = {
  power: new Float32Array(CHART_CAPACITY),
  rho: new Float32Array(CHART_CAPACITY),
  head: 0,
  filled: 0,
  /** Simulated seconds between samples. Set by the chart speed control. */
  interval: 1,
  lastSample: 0,
}

function sample() {
  const s = state()
  if (s.clock - chart.lastSample < chart.interval) return
  chart.lastSample = s.clock
  chart.power[chart.head] = s.powerFraction
  chart.rho[chart.head] = s.rho
  chart.head = (chart.head + 1) % CHART_CAPACITY
  chart.filled = Math.min(CHART_CAPACITY, chart.filled + 1)
}

/**
 * One driver loop for the whole application.
 *
 * The reactor must keep integrating whether or not anything is rendering it —
 * that independence is the entire point of having a clock separate from scroll
 * (PLAN.md §6). Scroll moves the camera and the argument; the physics does not
 * care.
 */
let raf = 0
let last = 0
let running = false

export function startSim() {
  if (running) return
  running = true
  last = performance.now()
  const tick = (now: number) => {
    const delta = (now - last) / 1000
    last = now
    stepReactor(sim.reactor, delta)
    sample()
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

export function stopSim() {
  running = false
  cancelAnimationFrame(raf)
}

export function selectReactor(kind: ReactorKind) {
  sim.reactor = createReactor(kind)
  chart.head = 0
  chart.filled = 0
  chart.lastSample = 0
}

export function resetChart() {
  chart.head = 0
  chart.filled = 0
  chart.lastSample = state().clock
}

/**
 * Zero-argument wrappers over the sim's operations.
 *
 * The sim functions take a `Reactor` explicitly so they stay pure and testable.
 * The UI has exactly one reactor and should not have to reach into the module
 * object to name it, so these bind to whichever reactor is current — including
 * after a variant switch, which replaces the object entirely.
 */
export const firePulse = () => pulse(sim.reactor)
export const doScram = () => scram(sim.reactor)
export const doResetScram = () => resetScram(sim.reactor)

if (import.meta.env.DEV) {
  Object.assign(window as unknown as Record<string, unknown>, { __sim: sim, __chart: chart })
}
