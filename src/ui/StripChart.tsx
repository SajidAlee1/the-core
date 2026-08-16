import { useEffect, useRef } from 'react'
import { CHART_CAPACITY, chart, state } from '../state'

/**
 * The strip-chart recorder.
 *
 * A pen drawing power on paper that advances. This is the signature object of
 * the project (PLAN.md §2.5): live data visualisation that is also a physical
 * thing with materials, and historically exactly how reactor power was recorded.
 *
 * Power is plotted on a LOGARITHMIC axis because it spans ten decades between
 * source range and full power. A linear axis would render the entire approach to
 * criticality — the most interesting part of a startup — as a flat line on the
 * floor, and then a vertical cliff. Every real reactor console does the same.
 *
 * Drawn to a canvas rather than SVG: 900 points redrawn at 60 Hz is 54 000 node
 * updates a second in SVG, and a canvas does it in one path.
 */

/** Decades displayed, from 1e-8 of rated power up to 10x. */
const DECADE_MIN = -8
const DECADE_MAX = 1
const DECADES = DECADE_MAX - DECADE_MIN

const toY = (fraction: number, height: number) => {
  const decade = Math.log10(Math.max(fraction, 1e-12))
  const t = (decade - DECADE_MIN) / DECADES
  return height - Math.max(0, Math.min(1, t)) * height
}

export default function StripChart() {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    let frame = 0
    let width = 0
    let height = 0

    const resize = () => {
      const rect = el.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = rect.width
      height = rect.height
      el.width = Math.round(width * dpr)
      el.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const style = getComputedStyle(document.documentElement)
    const read = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback

    const paint = () => {
      if (el.getBoundingClientRect().width !== width) resize()

      const paper = read('--chart-paper', '#f3f0e4')
      const grid = read('--chart-grid', 'rgba(120,110,80,0.22)')
      const ink = read('--chart-ink', '#8a2f1c')

      ctx.fillStyle = paper
      ctx.fillRect(0, 0, width, height)

      // Decade rules. A log chart is unreadable without them, because the eye
      // cannot judge a logarithmic gap the way it judges a linear one.
      ctx.strokeStyle = grid
      ctx.lineWidth = 1
      ctx.font = '9px ui-monospace, monospace'
      ctx.fillStyle = grid
      for (let d = DECADE_MIN; d <= DECADE_MAX; d++) {
        const y = Math.round(toY(Math.pow(10, d), height)) + 0.5
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
        ctx.fillText(`1e${d}`, 3, y - 3)
      }

      // Vertical time rules, moving with the paper so the advance is visible.
      const spacing = 40
      const offset = (chart.head * (width / CHART_CAPACITY)) % spacing
      for (let x = -offset; x < width; x += spacing) {
        ctx.beginPath()
        ctx.moveTo(Math.round(x) + 0.5, 0)
        ctx.lineTo(Math.round(x) + 0.5, height)
        ctx.stroke()
      }

      // The trace. Oldest sample at the left edge, pen at the right.
      const n = chart.filled
      if (n > 1) {
        const step = width / CHART_CAPACITY
        ctx.strokeStyle = ink
        ctx.lineWidth = 1.4
        ctx.lineJoin = 'round'
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          // Walk backwards from the head so the newest sample lands at the pen.
          const idx = (chart.head - n + i + CHART_CAPACITY * 2) % CHART_CAPACITY
          const x = width - (n - i) * step
          const y = toY(chart.power[idx], height)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }

      // The pen itself, at the current value.
      const y = toY(state().powerFraction, height)
      ctx.fillStyle = ink
      ctx.beginPath()
      ctx.arc(width - 2, y, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 0.35
      ctx.fillRect(0, y - 0.5, width, 1)
      ctx.globalAlpha = 1
    }

    const loop = () => { paint(); frame = requestAnimationFrame(loop) }

    resize()
    // See Section.tsx: paint once synchronously so the chart is never a blank
    // rectangle on first paint or in a non-compositing context.
    paint()
    frame = requestAnimationFrame(loop)
    // Repaint immediately on resize. Resizing a canvas resets its drawing
    // buffer, so without this the view is blank until the next animation frame —
    // a visible flash while dragging a window edge.
    const onResize = () => { resize(); paint() }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <div className="chart">
      <div className="chart-head">
        <h2>Power — log scale</h2>
        <span className="chart-note">fraction of rated · pen at right</span>
      </div>
      <canvas ref={canvas} className="chart-canvas" />
    </div>
  )
}
