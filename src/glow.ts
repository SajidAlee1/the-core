import { state } from './state'

/**
 * The room responds to the reactor.
 *
 * The page palette was fixed while the core it describes went from dead to
 * blazing. That is a missed opportunity and, worse, it makes the two read as
 * unrelated things sharing a screen — a control panel over here, a glowing
 * cylinder over there.
 *
 * So a single number, `--glow`, is written to the document root every frame and
 * every colour in the sheet is mixed against it. As power rises the room cools
 * and darkens toward Cherenkov blue: at cold shutdown you are in a bright
 * daylit hall, at full power you are sitting in the light the reactor is
 * making.
 *
 * This is CALIBRE's mood system with the picker removed. Nobody chooses it —
 * the reactor does it to the room, which is the whole point.
 *
 * One custom property, mixed in CSS. No per-element JavaScript, no re-render,
 * and adding a new component gets the behaviour for free.
 */

let raf = 0
let current = 0

/**
 * How lit the room is, 0..1.
 *
 * LOGARITHMIC in power, not a power law — and this was wrong the first time.
 *
 * `p^0.4` is right for the Cherenkov render, where the quantity is brightness
 * and the eye is comparing one glow to another. It is wrong for the room,
 * because power spans ten decades and that curve leaves the entire startup
 * invisible: at 0.0003 % of rated — a reactor that is critical, climbing, and
 * the most interesting it will ever be — it returns 0.01, and nothing happens.
 * You would need roughly 1 % power before the walls moved at all.
 *
 * The strip chart already plots power on a log axis for exactly this reason.
 * The room should follow the same scale, so it responds across the whole
 * approach rather than only at the end of it: six decades from source range to
 * rated, mapped linearly onto the palette.
 */
function target(): number {
  const p = Math.max(state().powerFraction, 1e-12)
  const decades = (Math.log10(p) + 6) / 6 // 1e-6 -> 0, 1e0 -> 1
  return Math.max(0, Math.min(1, decades))
}

/** sRGB hex -> [r,g,b] 0..255 */
function hex(h: string): [number, number, number] {
  const v = h.trim().replace('#', '')
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ]
}

/**
 * Blend two colours, gamma-correct.
 *
 * Mixing in plain sRGB drags a warm sage toward a deep blue through a dead grey
 * at the midpoint. Squaring into approximately-linear light first keeps the
 * transit chromatic, which is the same reason `color-mix(in oklab, ...)` exists.
 *
 * Done here in JavaScript rather than in CSS because the CSS route silently did
 * not re-resolve: the rules applied (background-image correctly cleared) but the
 * colour stayed pinned at its glow-0 value, while text colours using the exact
 * same expression tracked fine. Rather than keep guessing at the cascade, the
 * mix is computed once per frame and handed to CSS as a finished colour. One
 * source of truth, and it can be verified by reading the property back.
 */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hex(a)
  const [br, bg, bb] = hex(b)
  const k = Math.max(0, Math.min(1, t))
  const ch = (x: number, y: number) =>
    Math.round(Math.sqrt(x * x * (1 - k) + y * y * k))
  return `rgb(${ch(ar, br)}, ${ch(ag, bg)}, ${ch(ab, bb)})`
}

/** Room palette at rest, and where each token travels as the core comes up. */
const RAMP: [name: string, cold: string, hot: string, amount: number][] = [
  ['--room-bg', '#d8dcd0', '#071a2b', 0.86],
  ['--room-panel', '#a9b19f', '#0d3350', 0.82],
  ['--room-face', '#ece9dc', '#123f63', 0.84],
  ['--room-edge', '#b4ad96', '#2f6f9e', 0.7],
  ['--room-ink', '#23281f', '#dcefff', 0.94],
  ['--room-dim', '#5d6555', '#8fc0e0', 0.86],
  ['--room-paper', '#f3f0e4', '#0c2b45', 0.84],
]

/**
 * Selectors that take each colour. Kept here rather than in the sheet because
 * the whole point is that this is the ONE place the room's colour is decided.
 */
const RULES = (c: Record<string, string>) => `
body { background-color: ${c['--room-bg']}; }
.panel, .controls {
  background-image: none;
  background-color: ${c['--room-panel']};
}
.readout, .chart, .bars, .procedure, .masthead-plate, .hero, .narrative-live > div {
  background-image: none;
  background-color: ${c['--room-face']};
  border-color: ${c['--room-edge']};
}
.readout-value, .hero-value, .bar--total .bar-value, .plate-name,
.narrative-live dd, .procedure-step, .masthead-title h1, .narrative-title,
.world-name, .chart-head h2, .procedure-head h2, .bars-head h2 {
  color: ${c['--room-ink']};
}
.readout-label, .bar-label, .chart-note, .procedure-why, .hero-sub,
.narrative-body, .person dd, .control-hint, .bars-foot, .masthead-title p {
  color: ${c['--room-dim']};
}
`

/**
 * The palette is applied through a stylesheet this module owns, not through
 * custom properties consumed by rules elsewhere.
 *
 * The custom-property route failed in a way I could not account for: the
 * property was demonstrably set on the root, the winning rule demonstrably read
 * it with `var(--room-face, …)`, and the computed value was demonstrably the
 * fallback. Rather than keep guessing, this appends a real <style> element —
 * last in the document, so last in the cascade — containing finished colours.
 *
 * It is also simply clearer: one module decides the room's colour and emits it,
 * instead of a value crossing into CSS and being reassembled by rules scattered
 * through a thousand-line sheet.
 */
function sheet(): HTMLStyleElement {
  let el = document.getElementById('room-palette') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'room-palette'
    document.head.appendChild(el)
  }
  return el
}

export function startGlow() {
  if (raf) return
  const style = sheet()
  const root = document.documentElement
  // Reduced motion still gets the colour — it is information, not decoration —
  // but arrives without the slow ramp.
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let last = -1
  const tick = () => {
    const t = target()
    // Eased rather than snapped. Power can move a decade in a second, and a
    // palette that jumped with it would strobe.
    current = still ? t : current + (t - current) * 0.04

    // Only touch the DOM on a visible change. Writing a custom property
    // invalidates style for the whole document, so doing it for a 0.0001 delta
    // is a full restyle for nothing.
    const rounded = Math.round(current * 200) / 200
    if (rounded !== last) {
      // --glow is still published: the 3D scene and anything else that wants a
      // plain 0..1 intensity can read it without knowing about the palette.
      root.style.setProperty('--glow', String(rounded))

      const colours: Record<string, string> = {}
      for (const [name, cold, hot, amount] of RAMP) {
        colours[name] = mix(cold, hot, rounded * amount)
      }
      style.textContent = RULES(colours)
      last = rounded
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

export function stopGlow() {
  cancelAnimationFrame(raf)
  raf = 0
}
