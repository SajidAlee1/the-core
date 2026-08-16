import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { state } from '../state'
import { toPcm } from '../sim/kinetics'

gsap.registerPlugin(ScrollTrigger)

/**
 * The second axis.
 *
 * The console is one axis: an independent clock the visitor drives. This is the
 * other — a scroll narrative that explains what the machine is doing. PLAN.md §6
 * asks for both, and the whole point is that they do not interfere: scrolling
 * moves the argument, and the reactor keeps integrating regardless. Scroll back
 * up and the core is exactly where the physics left it.
 *
 * Numbers marked `live` are pulled from the running simulation rather than
 * written into the copy, so the essay describes the reactor the visitor actually
 * has rather than a hypothetical one.
 */

type Live = (s: ReturnType<typeof state>) => string

type Section = {
  eyebrow: string
  title: string
  body: string
  live?: { label: string; read: Live }[]
}

const SECTIONS: Section[] = [
  {
    eyebrow: 'Why it does not run away',
    title: 'Delayed neutrons buy the time',
    body:
      'Prompt neutrons appear about 20 microseconds after a fission. If that ' +
      'were the whole story, a 0.1 % error in reactivity would double the power ' +
      'in milliseconds and no mechanism could respond. But 0.65 % of neutrons ' +
      'arrive late — seconds to a minute late — from fission products decaying ' +
      'afterwards. That fraction is β, and it stretches the effective response ' +
      'time to around a tenth of a second. A reactor is controllable because of ' +
      'six numbers in a table.',
    live: [
      { label: 'β for this core', read: (s) => `${(s.spec.betaEff * 100).toFixed(3)} %` },
      { label: 'generation time Λ', read: (s) => `${(s.spec.lambdaGen * 1e6).toFixed(0)} µs` },
      { label: 'currently', read: (s) => `${s.dollars.toFixed(3)} dollars` },
    ],
  },
  {
    eyebrow: 'Why it steadies itself',
    title: 'Hot fuel absorbs its own neutrons',
    body:
      'As uranium-238 heats, its absorption resonances broaden and swallow more ' +
      'neutrons. This is the Doppler coefficient and it is always negative. It ' +
      'is also prompt — it depends on fuel temperature, not on heat having ' +
      'travelled anywhere — so it acts before any control system could. Raise ' +
      'the rods and watch the Doppler bar grow downward to meet them. Nobody is ' +
      'doing that. It is the reason a reactor is stable rather than merely ' +
      'controlled.',
    live: [
      { label: 'Doppler now', read: (s) => `${Math.round(toPcm(s.terms.fuelTemp))} pcm` },
      { label: 'per degree', read: (s) => `${(s.spec.alphaFuel * 1e5).toFixed(1)} pcm/°C` },
      { label: 'fuel temperature', read: (s) => `${s.thermal.tFuel.toFixed(1)} °C` },
    ],
  },
  {
    eyebrow: 'Why you cannot just restart it',
    title: 'Xenon arrives after you leave',
    body:
      'Xenon-135 absorbs neutrons at 2.6 million barns — among the largest ' +
      'cross-sections in nature. While the reactor runs, the flux burns it out ' +
      'as fast as it appears. Shut down, and that burnout stops while the ' +
      'iodine-135 reservoir keeps decaying into xenon for hours. It peaks about ' +
      'eight and a half hours after shutdown. If the core lacks the rod worth to ' +
      'overcome that peak, restarting is not difficult — it is impossible, until ' +
      'the xenon decays on its own schedule.',
    live: [
      { label: 'xenon now', read: (s) => `${s.xenon.xenon.toFixed(3)} × equilibrium` },
      { label: 'costing', read: (s) => `${Math.round(toPcm(s.terms.xenon))} pcm` },
      { label: 'iodine reservoir', read: (s) => s.xenon.iodine.toFixed(3) },
    ],
  },
  {
    eyebrow: 'Why "off" is not off',
    title: 'The heat does not stop with the fission',
    body:
      'Drop the rods and the chain reaction ends in milliseconds. The heat does ' +
      'not. Fission products already in the fuel keep decaying, producing about ' +
      '6.5 % of rated power immediately, 1 % an hour later, 0.4 % a day later. ' +
      'For a large reactor that is still tens of megawatts a day after ' +
      'shutdown, and it has to go somewhere whether or not anyone is there to ' +
      'move it. Fukushima scrammed correctly. It then lost the power to remove ' +
      'this heat.',
    live: [
      { label: 'power now', read: (s) => `${(s.powerFraction * 100).toPrecision(3)} % of rated` },
      { label: 'since scram', read: (s) => (s.scrammed ? `${(s.sinceScram / 60).toFixed(1)} min` : '—') },
    ],
  },
  {
    eyebrow: 'What this model can and cannot do',
    title: 'Point kinetics knows one number',
    body:
      'Everything here solves the six-group point kinetics equations, which ' +
      'assume the shape of the neutron flux never changes — only its magnitude. ' +
      'That makes the whole reactor a single number, and it is why this model ' +
      'cannot show a xenon oscillation, a flux tilt, or a hot channel. Two ' +
      'thermal nodes give the feedback path with the right time constants; they ' +
      'are not a temperature map. The neutronics are validated against the ' +
      'inhour equation to within 0.05 %. The limitations above are not a ' +
      'disclaimer — they are the boundary of what the numbers mean.',
  },
]

export default function Narrative() {
  const host = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // gsap.context so every trigger created here is killed together, and any
    // inline styles GSAP set are reverted on unmount.
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('.narrative-section').forEach((section) => {
        gsap.from(section.children, {
          y: 26,
          opacity: 0,
          duration: 0.8,
          ease: 'power3.out',
          stagger: 0.07,
          scrollTrigger: { trigger: section, start: 'top 82%', once: true },
        })
      })
    }, el)
    return () => ctx.revert()
  }, [])

  // One rAF loop for every live figure in the essay. Same discipline as the
  // panel: written straight to text nodes, never through React state.
  useLayoutEffect(() => {
    const nodes = Array.from(
      host.current?.querySelectorAll<HTMLElement>('[data-live]') ?? [],
    )
    const reads: Live[] = nodes.map((n) => {
      const [si, li] = (n.dataset.live ?? '0:0').split(':').map(Number)
      return SECTIONS[si].live![li].read
    })
    let frame = 0
    const lastText = new Array(nodes.length).fill('')
    const tick = () => {
      const s = state()
      for (let i = 0; i < nodes.length; i++) {
        const text = reads[i](s)
        if (text !== lastText[i]) {
          nodes[i].textContent = text
          lastText[i] = text
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <article className="narrative" ref={host}>
      <p className="narrative-lede">
        The console above never stops. Scroll — the reactor keeps integrating
        while you read, and the figures below are its own.
      </p>

      {SECTIONS.map((s, si) => (
        <section className="narrative-section" key={s.title}>
          <p className="narrative-eyebrow">{s.eyebrow}</p>
          <h2 className="narrative-title">{s.title}</h2>
          <p className="narrative-body">{s.body}</p>
          {s.live && (
            <dl className="narrative-live">
              {s.live.map((l, li) => (
                <div key={l.label}>
                  <dt>{l.label}</dt>
                  <dd data-live={`${si}:${li}`}>—</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      ))}
    </article>
  )
}
