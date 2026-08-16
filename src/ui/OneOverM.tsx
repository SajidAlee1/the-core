import { useEffect, useRef } from 'react'
import { inputs, state } from '../state'
import { criticalWithdrawal } from '../sim/reactivity'

/**
 * The 1/M plot — the oldest instrument in reactor startup, and still the one
 * that matters most.
 *
 * A shut-down core is not neutron-free: a startup source keeps a population
 * alive, and a subcritical core multiplies it by M = 1/(1−k). As k approaches 1
 * the count rate climbs hyperbolically, which is hard to read — you cannot tell
 * from a rising curve how much further you have to go.
 *
 * Plot the INVERSE instead and the hyperbola becomes a line that hits zero
 * exactly at criticality. Operators take a reading, plot it, extrapolate, and
 * only then decide how far to pull next. That is the whole point: criticality is
 * PREDICTED, never discovered.
 *
 * Points are recorded as the rods move, so the plot fills in as the visitor
 * works — the same way a real startup log does.
 */

type Point = { withdrawal: number; inverseM: number }

const MAX_POINTS = 60

export default function OneOverM() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const points = useRef<Point[]>([])
  const reference = useRef(0)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    let frame = 0
    let w = 0
    let h = 0

    const resize = () => {
      const r = el.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = r.width
      h = r.height
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const record = () => {
      const s = state()
      const withdrawal = inputs().scrammed ? 0 : inputs().rodWithdrawal
      const m = s.multiplication
      if (!isFinite(m) || m <= 0) return

      // The reference count is the multiplication with rods fully in. Everything
      // is measured against it, which is what makes the axis dimensionless and
      // lets the line reach exactly 1.0 at the start.
      if (reference.current === 0 && withdrawal < 0.02) reference.current = m
      if (reference.current === 0) return

      const inverseM = reference.current / m
      const last = points.current[points.current.length - 1]
      // One point per meaningful rod movement, as a real log would be kept —
      // not one per frame.
      if (last && Math.abs(last.withdrawal - withdrawal) < 0.012) return
      points.current.push({ withdrawal, inverseM })
      if (points.current.length > MAX_POINTS) points.current.shift()
      points.current.sort((a, b) => a.withdrawal - b.withdrawal)
    }

    const paint = () => {
      if (el.getBoundingClientRect().width !== w) resize()
      record()

      const s = state()
      const pad = { l: 30, r: 10, t: 10, b: 20 }
      const plotW = w - pad.l - pad.r
      const plotH = h - pad.t - pad.b

      const style = getComputedStyle(document.documentElement)
      const read = (n: string, f: string) => style.getPropertyValue(n).trim() || f
      const paper = read('--chart-paper', '#f3f0e4')
      const grid = read('--chart-grid', 'rgba(120,110,80,0.22)')
      const ink = read('--chart-ink', '#8a2f1c')
      const accent = read('--accent', '#0f6ea8')

      ctx.fillStyle = paper
      ctx.fillRect(0, 0, w, h)

      const X = (v: number) => pad.l + v * plotW
      const Y = (v: number) => pad.t + (1 - v) * plotH

      // Grid and axes.
      ctx.strokeStyle = grid
      ctx.lineWidth = 1
      ctx.font = '9px ui-monospace, monospace'
      ctx.fillStyle = grid
      for (let i = 0; i <= 4; i++) {
        const y = Math.round(Y(i / 4)) + 0.5
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke()
        ctx.textAlign = 'right'
        ctx.fillText((i / 4).toFixed(2), pad.l - 4, y + 3)
      }
      for (let i = 0; i <= 4; i++) {
        const x = Math.round(X(i / 4)) + 0.5
        ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke()
        ctx.textAlign = 'center'
        ctx.fillText(`${i * 25}%`, x, h - pad.b + 12)
      }

      // Predicted critical position, from the reactivity balance. The plot is
      // the operator's ESTIMATE; this amber line is the truth it converges on.
      const other = s.terms.boron + s.terms.fuelTemp + s.terms.modTemp + s.terms.xenon
      const xc = criticalWithdrawal(s.spec, other)
      ctx.strokeStyle = 'rgba(196, 132, 20, 0.85)'
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(X(xc), pad.t)
      ctx.lineTo(X(xc), h - pad.b)
      ctx.stroke()
      ctx.setLineDash([])

      // The plotted points, and the line through them.
      const pts = points.current
      if (pts.length > 1) {
        ctx.strokeStyle = accent
        ctx.lineWidth = 1.5
        ctx.beginPath()
        pts.forEach((p, i) => {
          const x = X(p.withdrawal)
          const y = Y(Math.min(1, p.inverseM))
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()

        // Extrapolation from the last two points to 1/M = 0 — literally what an
        // operator draws with a ruler before deciding the next pull.
        const a = pts[pts.length - 2]
        const b = pts[pts.length - 1]
        const slope = (b.inverseM - a.inverseM) / (b.withdrawal - a.withdrawal || 1e-6)
        if (slope < -1e-6) {
          const predicted = b.withdrawal - b.inverseM / slope
          if (predicted > b.withdrawal && predicted < 1.4) {
            ctx.strokeStyle = ink
            ctx.setLineDash([3, 3])
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(X(b.withdrawal), Y(b.inverseM))
            ctx.lineTo(X(Math.min(1, predicted)), Y(0))
            ctx.stroke()
            ctx.setLineDash([])
            ctx.fillStyle = ink
            ctx.textAlign = 'left'
            ctx.font = '600 9px ui-monospace, monospace'
            ctx.fillText(`predicts ${(predicted * 100).toFixed(0)}%`, X(Math.min(0.72, predicted)) + 4, Y(0) - 5)
          }
        }
      }

      for (const p of pts) {
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.arc(X(p.withdrawal), Y(Math.min(1, p.inverseM)), 2.2, 0, Math.PI * 2)
        ctx.fill()
      }

      if (pts.length < 2) {
        ctx.fillStyle = 'rgba(93, 101, 85, 0.75)'
        ctx.textAlign = 'center'
        ctx.font = '10px ui-monospace, monospace'
        ctx.fillText('move the rod bank to plot', w / 2, h / 2)
      }
    }

    const loop = () => { paint(); frame = requestAnimationFrame(loop) }

    resize()
    paint()
    frame = requestAnimationFrame(loop)
    const onResize = () => { resize(); paint() }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <div className="chart chart--onem">
      <div className="chart-head">
        <h2>1/M — approach to critical</h2>
        <span className="chart-note">extrapolate to zero</span>
      </div>
      <canvas ref={canvas} className="onem-canvas" />
      <p className="chart-foot">
        A subcritical core multiplies its startup source by M = 1/(1−k). Plotting
        the inverse turns a hyperbola into a straight line that reaches zero at
        criticality — so it can be predicted with a ruler before the next pull,
        rather than discovered by arriving at it.
      </p>
    </div>
  )
}
