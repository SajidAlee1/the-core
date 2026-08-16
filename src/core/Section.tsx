import { useEffect, useRef } from 'react'
import { inputs, state } from '../state'
import { criticalWithdrawal } from '../sim/reactivity'

/**
 * The core in section — a labelled cutaway.
 *
 * This is the DEFAULT view, not a fallback, because the project's job is to be
 * understood. A vertical section is how reactors are drawn in every textbook:
 * it is the view that shows the relationship the machine is built around — fuel
 * in a lattice, rods entering from above, water everywhere — and it can be
 * annotated, which a moody 3D render cannot.
 *
 * It also carries the honesty rule (PLAN.md §9) more comfortably. A cutaway is
 * unambiguously a diagram, so the Cherenkov glow here reads as a depiction of a
 * quantity rather than a claim about what a camera would see.
 *
 * Everything is live: the rods move with the slider, the glow tracks power, and
 * the critical-position marker tracks the reactivity balance.
 */

const FUEL_COLUMNS = 9
const ROD_COLUMNS = [-3, 0, 3]

type Label = { text: string; sub?: string; x: number; y: number; side: 'left' | 'right'; tx: number; ty: number }

export default function Section() {
  const canvas = useRef<HTMLCanvasElement>(null)

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

    /** Leader line plus two-line label. Kept in one place so every callout matches. */
    const callout = (l: Label) => {
      ctx.strokeStyle = 'rgba(150, 195, 225, 0.5)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(l.x, l.y)
      ctx.lineTo(l.tx, l.ty)
      ctx.stroke()

      // A dot at the part end, so it is clear which end points at what.
      ctx.fillStyle = 'rgba(150, 195, 225, 0.9)'
      ctx.beginPath()
      ctx.arc(l.x, l.y, 2, 0, Math.PI * 2)
      ctx.fill()

      ctx.textAlign = l.side === 'left' ? 'right' : 'left'
      const pad = l.side === 'left' ? -7 : 7
      ctx.font = '600 10px ui-monospace, monospace'
      ctx.fillStyle = '#dcefff'
      ctx.fillText(l.text, l.tx + pad, l.ty + 3)
      if (l.sub) {
        ctx.font = '9px ui-monospace, monospace'
        ctx.fillStyle = 'rgba(157, 189, 212, 0.85)'
        ctx.fillText(l.sub, l.tx + pad, l.ty + 15)
      }
    }

    const paint = () => {
      if (el.getBoundingClientRect().width !== w) resize()

      const s = state()
      const withdrawal = inputs().scrammed ? 0 : inputs().rodWithdrawal

      // Layout. The diagram sits in the middle third so callouts have room.
      const cx = w * 0.5
      const surface = h * 0.1
      const floor = h * 0.9
      const coreTop = h * 0.42
      const coreBottom = h * 0.72
      const coreH = coreBottom - coreTop
      const coreHalf = Math.min(w * 0.15, 110)

      // ── Water ──
      //
      // Lighter than a photograph would be. This is a diagram meant to be read,
      // and a near-black ground makes thin structure and small type disappear.
      const water = ctx.createLinearGradient(0, surface, 0, floor)
      water.addColorStop(0, '#1d4f6d')
      water.addColorStop(0.6, '#143b53')
      water.addColorStop(1, '#0f2c3f')
      ctx.fillStyle = water
      ctx.fillRect(0, 0, w, h)

      // Air above the surface.
      ctx.fillStyle = '#27607f'
      ctx.fillRect(0, 0, w, surface)
      ctx.strokeStyle = 'rgba(190, 230, 255, 0.6)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(0, surface + 0.5)
      ctx.lineTo(w, surface + 0.5)
      ctx.stroke()

      // ── Cherenkov ──
      //
      // power^0.4, not power. The eye is logarithmic, so a linear mapping makes
      // the whole approach to criticality invisible and then blows out in one
      // step — backwards, since the climb is the story.
      const p = Math.max(s.powerFraction, 1e-12)
      const glow = Math.min(1, Math.pow(p, 0.4) * 1.3)

      if (glow > 0.001) {
        const gy = (coreTop + coreBottom) / 2
        const g = ctx.createRadialGradient(cx, gy, coreHalf * 0.1, cx, gy, coreHalf * (3 + glow * 2))
        g.addColorStop(0, `rgba(222, 244, 255, ${0.95 * glow})`)
        g.addColorStop(0.2, `rgba(125, 205, 255, ${0.7 * glow})`)
        g.addColorStop(0.5, `rgba(50, 135, 230, ${0.34 * glow})`)
        g.addColorStop(1, 'rgba(20, 70, 160, 0)')
        ctx.globalCompositeOperation = 'lighter'
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'source-over'
      }

      // ── Graphite reflector, in section either side of the lattice ──
      const refW = coreHalf * 0.3
      ctx.fillStyle = '#3c434c'
      ctx.fillRect(cx - coreHalf - refW, coreTop, refW, coreH)
      ctx.fillRect(cx + coreHalf, coreTop, refW, coreH)
      /*
       * Hatching, the drafting convention for a sectioned solid.
       *
       * Confined with a clip path, NOT by erasing the overspill afterwards.
       * `destination-out` removes whatever is already on the canvas rather than
       * only the hatch lines, so the first version wiped the water gradient out
       * of those bands and left them pure black — which read exactly like a
       * failed render.
       */
      const hatch = (x0: number) => {
        ctx.save()
        ctx.beginPath()
        ctx.rect(x0, coreTop, refW, coreH)
        ctx.clip()
        ctx.strokeStyle = 'rgba(200, 214, 228, 0.20)'
        ctx.lineWidth = 1
        for (let i = -coreH; i < refW + coreH; i += 7) {
          ctx.beginPath()
          ctx.moveTo(x0 + i, coreTop + coreH)
          ctx.lineTo(x0 + i + coreH, coreTop)
          ctx.stroke()
        }
        ctx.restore()
      }
      hatch(cx - coreHalf - refW)
      hatch(cx + coreHalf)

      // ── Grid plates ──
      ctx.fillStyle = '#7d8794'
      ctx.fillRect(cx - coreHalf - refW, coreBottom, (coreHalf + refW) * 2, 7)
      ctx.fillRect(cx - coreHalf - refW, coreTop - 7, (coreHalf + refW) * 2, 7)

      // ── Fuel elements ──
      const pitch = (coreHalf * 2) / FUEL_COLUMNS
      const rodW = pitch * 0.5
      for (let i = 0; i < FUEL_COLUMNS; i++) {
        const x = cx - coreHalf + pitch * (i + 0.5)
        const body = ctx.createLinearGradient(x - rodW / 2, 0, x + rodW / 2, 0)
        body.addColorStop(0, '#6e7986')
        body.addColorStop(0.4, '#a3aeba')
        body.addColorStop(1, '#5c6672')
        ctx.fillStyle = body
        ctx.fillRect(x - rodW / 2, coreTop, rodW, coreH)
      }

      // ── Control rods ──
      //
      // They enter from above in a TRIGA and lift clear as they withdraw. Travel
      // is drawn from the same number the simulation uses, so the picture and the
      // physics cannot disagree.
      const travel = coreH + 16
      for (const col of ROD_COLUMNS) {
        const x = cx + col * pitch
        const top = coreTop - 5 - withdrawal * travel
        const bottom = coreBottom - withdrawal * travel

        ctx.strokeStyle = 'rgba(150, 162, 176, 0.7)'
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.moveTo(x, surface - 8)
        ctx.lineTo(x, top)
        ctx.stroke()

        const rod = ctx.createLinearGradient(x - rodW * 0.7, 0, x + rodW * 0.7, 0)
        rod.addColorStop(0, '#15181d')
        rod.addColorStop(0.45, '#3f4650')
        rod.addColorStop(1, '#11141a')
        ctx.fillStyle = rod
        ctx.fillRect(x - rodW * 0.7, top, rodW * 1.4, bottom - top)
        ctx.fillStyle = '#8d97a3'
        ctx.fillRect(x - rodW * 0.8, top - 5, rodW * 1.6, 5)
      }

      // ── Critical-position marker ──
      //
      // Where the rods WOULD be critical, given everything else in the balance.
      // Seeing the target while you move toward it is the difference between
      // predicting criticality and discovering it.
      const other = s.terms.boron + s.terms.fuelTemp + s.terms.modTemp + s.terms.xenon
      const xc = criticalWithdrawal(s.spec, other)
      const markY = coreTop - 5 - xc * travel
      ctx.strokeStyle = 'rgba(255, 196, 90, 0.85)'
      ctx.setLineDash([5, 4])
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(cx - coreHalf - refW - 26, markY)
      ctx.lineTo(cx + coreHalf + refW + 26, markY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = '600 9px ui-monospace, monospace'
      ctx.fillStyle = 'rgba(255, 196, 90, 0.95)'
      ctx.textAlign = 'center'
      ctx.fillText(`CRITICAL AT ${(xc * 100).toFixed(0)}%`, cx, markY - 6)

      // ── Callouts ──
      const rodTop = coreTop - 5 - withdrawal * travel
      callout({
        text: 'CONTROL RODS', sub: `${(withdrawal * 100).toFixed(0)}% withdrawn`,
        x: cx + 3 * pitch, y: rodTop + 12, side: 'right',
        tx: cx + coreHalf + refW + 46, ty: Math.max(surface + 22, rodTop + 4),
      })
      callout({
        text: 'FUEL ELEMENTS', sub: '91 rods, U-ZrH',
        x: cx - coreHalf + pitch * 1.5, y: coreTop + coreH * 0.55, side: 'left',
        tx: cx - coreHalf - refW - 46, ty: coreTop + coreH * 0.42,
      })
      callout({
        text: 'GRAPHITE REFLECTOR', sub: 'keeps neutrons in',
        x: cx + coreHalf + refW * 0.5, y: coreTop + coreH * 0.8, side: 'right',
        tx: cx + coreHalf + refW + 46, ty: coreBottom + 16,
      })
      callout({
        text: 'WATER', sub: 'moderator and shield',
        x: cx - coreHalf * 2.2, y: surface + (coreTop - surface) * 0.55, side: 'left',
        tx: cx - coreHalf - refW - 46, ty: surface + 34,
      })
      callout({
        text: 'GRID PLATE', sub: 'holds the lattice',
        x: cx - coreHalf * 0.4, y: coreBottom + 4, side: 'left',
        tx: cx - coreHalf - refW - 46, ty: floor - 26,
      })

      // Scale note, bottom right.
      ctx.textAlign = 'right'
      ctx.font = '9px ui-monospace, monospace'
      ctx.fillStyle = 'rgba(157, 189, 212, 0.65)'
      ctx.fillText('VERTICAL SECTION · NOT TO SCALE', w - 12, h - 12)
    }

    const loop = () => { paint(); frame = requestAnimationFrame(loop) }

    resize()
    // Paint once synchronously. requestAnimationFrame does not fire in a page
    // that is not compositing — a background tab, a hidden pane, a headless
    // check — and without this the very first frame is a blank rectangle that
    // looks identical to a rendering failure.
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

  return <canvas ref={canvas} className="section-canvas" />
}
