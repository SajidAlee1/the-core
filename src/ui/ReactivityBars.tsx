import { useEffect, useRef } from 'react'
import { state } from '../state'
import { toPcm } from '../sim/kinetics'

/**
 * The reactivity balance, live.
 *
 * The single most educational element in the project. Everything the operator
 * does and everything the reactor does back is a term in one sum, and showing
 * them side by side lets a visitor watch the machine push back:
 *
 *   pull rods  →  the rod bar rises
 *   core heats →  the Doppler bar grows negative to meet it
 *   the sum settles near zero without anyone asking it to
 *
 * That is what "inherently stable" means, and it is far more convincing seen
 * than described.
 */

const TERMS = [
  { key: 'rods', label: 'Control rods', hint: 'Excess held down by the banks' },
  { key: 'boron', label: 'Boron', hint: 'Soluble shim — PWR only' },
  { key: 'fuelTemp', label: 'Doppler', hint: 'Fuel temperature. Prompt, always negative' },
  { key: 'modTemp', label: 'Moderator', hint: 'Coolant temperature' },
  { key: 'xenon', label: 'Xenon-135', hint: 'Fission product poison' },
  { key: 'transient', label: 'Transient rod', hint: 'Pulse only' },
] as const

/** Full-scale for the bars, pcm. Beyond this the bar pins and the number stays true. */
const SCALE = 8000

export default function ReactivityBars() {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fills = TERMS.map((t) =>
      host.current?.querySelector<HTMLElement>(`[data-term="${t.key}"] .bar-fill`),
    )
    const values = TERMS.map((t) =>
      host.current?.querySelector<HTMLElement>(`[data-term="${t.key}"] .bar-value`),
    )
    const totalFill = host.current?.querySelector<HTMLElement>('.bar--total .bar-fill')
    const totalValue = host.current?.querySelector<HTMLElement>('.bar--total .bar-value')

    let frame = 0
    const tick = () => {
      const terms = state().terms
      for (let i = 0; i < TERMS.length; i++) {
        const pcm = toPcm(terms[TERMS[i].key])
        const fill = fills[i]
        const value = values[i]
        if (fill) {
          // Bars grow from a centre line, so sign is read as direction rather
          // than needing a minus sign to be noticed.
          const frac = Math.max(-1, Math.min(1, pcm / SCALE))
          fill.style.transform = `scaleX(${Math.abs(frac)})`
          fill.style.transformOrigin = frac < 0 ? 'right center' : 'left center'
          fill.dataset.sign = frac < 0 ? 'neg' : 'pos'
        }
        if (value) value.textContent = (pcm >= 0 ? '+' : '') + pcm.toFixed(0)
      }

      const total = toPcm(state().rho)
      if (totalFill) {
        // The total is shown on a much finer scale — near criticality the
        // interesting range is tens of pcm, not thousands, and on the coarse
        // scale it would be an invisible sliver exactly when it matters most.
        const frac = Math.max(-1, Math.min(1, total / 700))
        totalFill.style.transform = `scaleX(${Math.abs(frac)})`
        totalFill.style.transformOrigin = frac < 0 ? 'right center' : 'left center'
        totalFill.dataset.sign = frac < 0 ? 'neg' : 'pos'
      }
      if (totalValue) totalValue.textContent = (total >= 0 ? '+' : '') + total.toFixed(0)

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="bars" ref={host}>
      <div className="bars-head">
        <h2>Reactivity balance</h2>
        <span className="bars-scale">± {SCALE.toLocaleString()} pcm</span>
      </div>

      {TERMS.map((t) => (
        <div className="bar" key={t.key} data-term={t.key} title={t.hint}>
          <span className="bar-label">{t.label}</span>
          <span className="bar-track">
            <span className="bar-centre" />
            <span className="bar-fill" />
          </span>
          <span className="bar-value">0</span>
        </div>
      ))}

      <div className="bar bar--total" title="The sum. Zero is critical.">
        <span className="bar-label">Net</span>
        <span className="bar-track">
          <span className="bar-centre" />
          <span className="bar-fill" />
        </span>
        <span className="bar-value">0</span>
      </div>
      <p className="bars-foot">
        Net zero is critical. The rods add; temperature and xenon take away.
        Nothing here is scripted — it is the sum the simulation is solving.
      </p>
    </div>
  )
}
