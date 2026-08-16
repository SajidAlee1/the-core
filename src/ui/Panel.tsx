import { useEffect, useRef } from 'react'
import { state } from '../state'
import { toPcm } from '../sim/kinetics'

/**
 * The instrument panel.
 *
 * Every value is written straight to a DOM text node from one rAF loop. None of
 * it passes through React state — see state.ts for why. The components below
 * render structure once and then never re-render.
 */

type ReadoutProps = {
  label: string
  unit?: string
  /** Called each frame; returns the string to display. */
  read: () => string
  /** Optional per-frame class, for alarm states. */
  status?: () => string
  wide?: boolean
}

/** One engraved-label instrument. */
function Readout({ label, unit, read, status, wide }: ReadoutProps) {
  const value = useRef<HTMLSpanElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frame = 0
    let lastText = ''
    let lastStatus = ''
    const tick = () => {
      const text = read()
      // Only touch the DOM when the string actually changed. Most readouts are
      // stable for many frames, and an unnecessary textContent write forces
      // layout on a node that did not change.
      if (text !== lastText && value.current) {
        value.current.textContent = text
        lastText = text
      }
      if (status && box.current) {
        const s = status()
        if (s !== lastStatus) {
          box.current.dataset.status = s
          lastStatus = s
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [read, status])

  return (
    <div className={`readout${wide ? ' readout--wide' : ''}`} ref={box}>
      <span className="readout-label">{label}</span>
      <span className="readout-value">
        <span ref={value}>—</span>
        {unit && <i className="readout-unit">{unit}</i>}
      </span>
    </div>
  )
}

const fmt = (v: number, digits = 2) =>
  !isFinite(v) ? '∞' : v.toFixed(digits)

/** Power spans ten decades from source range to full power — always exponential. */
function fmtPower(fraction: number, rated: number) {
  const w = fraction * rated
  // Exponential below 0.1 W, not below 1e-3. A source-range reactor sits around
  // 1.7e-3 W, and `toFixed(2)` rendered that as a flat "0.00 W" — which reads
  // as a dead reactor rather than as one ticking over on its startup source.
  if (w < 0.1) return w.toExponential(2)
  if (w < 1e3) return w.toFixed(2)
  if (w < 1e6) return (w / 1e3).toFixed(2)
  return (w / 1e6).toFixed(2)
}

function powerUnit(fraction: number, rated: number) {
  const w = fraction * rated
  if (w < 1e3) return 'W'
  if (w < 1e6) return 'kW'
  return 'MW'
}

/**
 * The trip banner.
 *
 * A protection trip is the most important thing that can happen on this page, so
 * it interrupts rather than appearing as another readout — and it explains WHY
 * the limit exists, because the reason is the lesson. "High power" alone teaches
 * nothing; "above 120 % the fuel is outside what it was licensed for" does.
 */
function TripBanner() {
  const box = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const reason = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let frame = 0
    let last: string | null = ''
    const tick = () => {
      const s = state()
      if (s.trippedBy !== last) {
        last = s.trippedBy
        if (box.current) box.current.hidden = !s.trippedBy
        if (label.current) label.current.textContent = s.trippedBy ?? ''
        if (reason.current) reason.current.textContent = s.trippedReason ?? ''
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="trip" ref={box} hidden role="status">
      <span className="trip-tag">Reactor trip</span>
      <strong ref={label} />
      <span className="trip-reason" ref={reason} />
    </div>
  )
}

/**
 * The hero readout.
 *
 * Power was one tile among twelve, at the same size and weight as "Margin to
 * sat." — so nothing landed. It is the number the entire page exists to
 * produce, and giving it its own block at six times the type size is the single
 * change that decides what a screenshot of this communicates.
 *
 * Contrast IS the hierarchy: everything else can stay small precisely because
 * this is large.
 */
function HeroPower() {
  const value = useRef<HTMLSpanElement>(null)
  const unit = useRef<HTMLSpanElement>(null)
  const pct = useRef<HTMLSpanElement>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frame = 0
    let lv = '', lu = '', lp = '', ls = ''
    const tick = () => {
      const s = state()
      const v = fmtPower(s.powerFraction, s.spec.ratedPower)
      const u = powerUnit(s.powerFraction, s.spec.ratedPower)
      const p = `${(s.powerFraction * 100).toPrecision(3)}% of rated`
      if (v !== lv && value.current) { value.current.textContent = v; lv = v }
      if (u !== lu && unit.current) { unit.current.textContent = u; lu = u }
      if (p !== lp && pct.current) { pct.current.textContent = p; lp = p }
      const st = s.promptCritical || s.powerFraction > 1.2 ? 'alarm'
        : s.rho > 0 ? 'live' : 'normal'
      if (st !== ls && box.current) { box.current.dataset.status = st; ls = st }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="hero" ref={box}>
      <span className="hero-label">Reactor power</span>
      <span className="hero-value">
        <span ref={value}>0.00</span>
        <span className="hero-unit" ref={unit}>W</span>
      </span>
      <span className="hero-sub" ref={pct}>—</span>
    </div>
  )
}

export default function Panel() {
  return (
    <div className="panel">
      <TripBanner />
      <HeroPower />
      <div className="panel-row">
        <Readout
          label="Reactivity"
          unit="pcm"
          read={() => {
            // Rounded BEFORE the sign is chosen. Otherwise -0.4 pcm prints as
            // "-0", which reads as a defect rather than as zero.
            const v = Math.round(toPcm(state().rho)) || 0
            return (v > 0 ? '+' : '') + v
          }}
          status={() => {
            const s = state()
            if (s.promptCritical) return 'alarm'
            if (s.rho > 0) return 'live'
            return 'normal'
          }}
        />
        <Readout
          label="Reactivity"
          unit="$"
          read={() => {
            const v = Number(state().dollars.toFixed(3)) || 0
            return (v > 0 ? '+' : '') + v.toFixed(3)
          }}
          status={() => (state().promptCritical ? 'alarm' : 'normal')}
        />
      </div>

      <div className="panel-row">
        <Readout
          label="Period"
          unit="s"
          read={() => {
            const t = state().period
            // Beyond about an hour the reactor is steady for any practical
            // purpose, and "-58165.7 s" reads as a malfunction rather than as
            // "nothing is happening". Operators call this a flat period.
            if (!isFinite(t) || Math.abs(t) > 3600) return 'STEADY'
            return (t > 0 ? '+' : '') + t.toFixed(1)
          }}
          status={() => {
            const t = state().period
            // A period under 10 s is faster than an operator can comfortably
            // control and is an alarm on a real console.
            if (isFinite(t) && t > 0 && t < 10) return 'alarm'
            return 'normal'
          }}
        />
        <Readout
          label="Startup rate"
          unit="dpm"
          read={() => {
            const v = Number(state().sur.toFixed(2)) || 0
            return (v > 0 ? '+' : '') + v.toFixed(2)
          }}
          // Startups are administratively limited to 1 decade per minute.
          status={() => (state().sur > 1 ? 'alarm' : 'normal')}
        />
        <Readout label="k-effective" read={() => fmt(state().kEff, 5)} />
        <Readout
          label="Multiplication"
          unit="M"
          read={() => {
            const m = state().multiplication
            return m > 9999 ? m.toExponential(1) : m.toFixed(0)
          }}
        />
      </div>

      <div className="panel-row">
        <Readout label="Fuel temp" unit="°C" read={() => fmt(state().thermal.tFuel, 1)} />
        <Readout label="Coolant temp" unit="°C" read={() => fmt(state().thermal.tCoolant, 1)} />
        <Readout
          label="Margin to sat."
          unit="°C"
          read={() => fmt(state().saturationMargin, 1)}
          status={() => (state().saturationMargin < 10 ? 'alarm' : 'normal')}
        />
        <Readout
          label="Xenon-135"
          unit="×eq"
          read={() => fmt(state().xenon.xenon, 3)}
        />
      </div>

      <div className="panel-row panel-row--time">
        <Readout
          label="Elapsed"
          read={() => {
            const t = state().clock
            const h = Math.floor(t / 3600)
            const m = Math.floor((t % 3600) / 60)
            const s = Math.floor(t % 60)
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          }}
          wide
        />
      </div>
    </div>
  )
}
