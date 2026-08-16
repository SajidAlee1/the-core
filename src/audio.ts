import { state } from './state'

/**
 * The sound of a reactor starting up.
 *
 * The count-rate clicks are the point. A source-range detector produces one
 * pulse per neutron it catches, so the audible rate is proportional to the
 * neutron population — and during approach to criticality that means sparse
 * ticks accelerating into a texture and finally into a tone. Operators listened
 * to exactly this before they had digital meters, and it is the single most
 * legible way to feel `1/M → 0` without reading a number.
 *
 * The rate is real: it comes from the same `n` the panel displays, so the sound
 * is a measurement rather than an effect.
 *
 * Everything here follows the bus/ramp/schedule discipline: no gain is ever
 * assigned directly (a step in gain is a click), events are scheduled on the
 * audio clock rather than with setTimeout, and nothing starts until a gesture.
 */

let ctx: AudioContext | null = null
let master: GainNode
let clickBus: GainNode
let toneBus: GainNode
let alarmBus: GainNode
let enabled = false
let raf = 0

/** Clicks already scheduled up to this audio-clock time. */
let scheduledTo = 0
/** How far ahead to schedule. Long enough to survive a dropped frame. */
const HORIZON = 0.25

/** Pre-rendered click, so each pulse costs one buffer source and nothing else. */
let clickBuffer: AudioBuffer | null = null

function makeClick(ac: AudioContext) {
  // A detector pulse is a sharp transient, not a tone: noise through a fast
  // decay. Rendering it once and replaying is far cheaper than building an
  // oscillator envelope hundreds of times a second, which is exactly what the
  // count rate demands near criticality.
  const length = Math.floor(ac.sampleRate * 0.012)
  const buf = ac.createBuffer(1, length, ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < length; i++) {
    const t = i / length
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 9)
  }
  return buf
}

function ensure(): AudioContext {
  if (ctx) return ctx
  ctx = new (window.AudioContext || (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()

  master = ctx.createGain()
  master.gain.value = 0.0001
  master.connect(ctx.destination)

  // Separate buses so a busy count rate cannot drown the alarms, and so the
  // mute control touches exactly one node.
  clickBus = ctx.createGain(); clickBus.gain.value = 0.55; clickBus.connect(master)
  toneBus = ctx.createGain(); toneBus.gain.value = 0.0001; toneBus.connect(master)
  alarmBus = ctx.createGain(); alarmBus.gain.value = 0.0001; alarmBus.connect(master)

  clickBuffer = makeClick(ctx)

  // Above a few hundred hertz the ear stops resolving individual clicks and
  // starts hearing pitch. Rather than fight that, a quiet tone fades in as the
  // rate climbs — which is what a real count-rate meter sounds like at power.
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.value = 130
  const shaper = ctx.createBiquadFilter()
  shaper.type = 'lowpass'
  shaper.frequency.value = 900
  osc.connect(shaper).connect(toneBus)
  osc.start()

  // Short-period alarm: two detuned squares, deliberately unpleasant.
  const a1 = ctx.createOscillator(); a1.type = 'square'; a1.frequency.value = 660
  const a2 = ctx.createOscillator(); a2.type = 'square'; a2.frequency.value = 664
  const alarmGain = ctx.createGain(); alarmGain.gain.value = 0.18
  a1.connect(alarmGain); a2.connect(alarmGain); alarmGain.connect(alarmBus)
  a1.start(); a2.start()

  scheduledTo = ctx.currentTime
  return ctx
}

/**
 * Count rate from the neutron population.
 *
 * Clicks per second, log-mapped: the population spans ten decades and a linear
 * mapping would be silent for nine of them. Capped where the ear stops
 * resolving individual pulses and the tone takes over.
 */
function countRate(): number {
  const n = Math.max(state().kinetics.n, 1e-12)
  // n = 1e-8 at cold shutdown -> ~2 counts/s; n = 1e-4 -> ~120/s.
  const decades = Math.log10(n) + 12
  return Math.max(0, Math.min(140, Math.pow(decades, 2.1) * 0.28))
}

function schedule() {
  if (!ctx || !enabled || !clickBuffer) return
  const now = ctx.currentTime
  if (scheduledTo < now) scheduledTo = now

  const rate = countRate()
  if (rate <= 0.01) { scheduledTo = now; return }

  while (scheduledTo < now + HORIZON) {
    // Radioactive decay is a Poisson process, so the gaps between counts are
    // exponentially distributed. Evenly spaced clicks sound like a metronome
    // and are the giveaway that a counter is fake — the irregularity IS the
    // physics.
    const gap = -Math.log(1 - Math.random()) / rate
    scheduledTo += gap
    if (scheduledTo > now + HORIZON) break

    const src = ctx.createBufferSource()
    src.buffer = clickBuffer
    // A few percent of pitch variance per pulse, so repeats do not read as one
    // looping sample.
    src.playbackRate.value = 0.92 + Math.random() * 0.16
    const g = ctx.createGain()
    g.gain.value = 0.5 + Math.random() * 0.5
    src.connect(g).connect(clickBus)
    // Scheduled on the audio clock. setTimeout drifts audibly at these rates.
    src.start(scheduledTo)
  }
}

function tick() {
  if (ctx && enabled) {
    const s = state()
    const now = ctx.currentTime
    const rate = countRate()

    // Tone fades in where clicks stop resolving.
    const toneLevel = Math.max(0.0001, Math.min(0.09, (rate - 60) / 500))
    toneBus.gain.linearRampToValueAtTime(toneLevel, now + 0.15)

    // Alarm on a short period — faster than an operator can react to.
    const t = s.period
    const alarm = (isFinite(t) && t > 0 && t < 10) || s.promptCritical
    alarmBus.gain.linearRampToValueAtTime(alarm ? 0.5 : 0.0001, now + 0.08)

    schedule()
  }
  raf = requestAnimationFrame(tick)
}

/** Unlock on the first gesture of any kind — on a page like this it is a click
 *  or a drag, but never assume which. */
export function armAudio() {
  const go = () => {
    ensure()
    if (ctx && ctx.state === 'suspended') ctx.resume()
    for (const ev of EVENTS) window.removeEventListener(ev, go)
  }
  const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
  for (const ev of EVENTS) window.addEventListener(ev, go, { passive: true })

  document.addEventListener('visibilitychange', () => {
    if (ctx && !document.hidden && ctx.state === 'suspended') ctx.resume()
  })

  if (!raf) raf = requestAnimationFrame(tick)
}

export function setAudioEnabled(on: boolean) {
  enabled = on
  const ac = on ? ensure() : ctx
  if (!ac) return
  if (ac.state === 'suspended') ac.resume()
  // Exponential ramps track loudness better than linear ones, but cannot reach
  // zero — hence the epsilon rather than 0.
  master.gain.exponentialRampToValueAtTime(on ? 0.5 : 0.0001, ac.currentTime + 0.25)
  if (on) scheduledTo = ac.currentTime
}

export const isAudioEnabled = () => enabled
