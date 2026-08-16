import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

/**
 * Who actually runs these, and who worked them out.
 *
 * ── A note on confidence ───────────────────────────────────────────────────
 *
 * Everything else on this page is COMPUTED and checkable — `npm test`
 * reproduces every physics figure against an independent reference. These
 * numbers are not. They are approximate operating statistics, and reactor
 * counts change as units connect, shut down, or return from long outages.
 *
 * That difference is stated on the page rather than smoothed over. Putting
 * remembered figures beside validated ones without saying which is which would
 * quietly borrow the credibility of the physics for data that has not earned
 * it — and the honesty rules in PLAN.md §9 exist precisely to stop that.
 */

/** Approximate, ~2024–25. Grid-connected units and share of national electricity. */
const COUNTRIES = [
  { name: 'United States', units: 94, share: 19, note: 'Largest fleet; most units are 1970s–80s PWRs and BWRs' },
  { name: 'France', units: 57, share: 65, note: 'Highest nuclear share of any grid, by a wide margin' },
  { name: 'China', units: 57, share: 5, note: 'Building faster than anyone — roughly 30 units under construction' },
  { name: 'Russia', units: 36, share: 19, note: 'Also the largest exporter of reactor technology' },
  { name: 'South Korea', units: 26, share: 30, note: 'Standardised APR-1400 design, built repeatedly' },
  { name: 'India', units: 24, share: 3, note: 'Mostly domestic pressurised heavy water reactors' },
  { name: 'Canada', units: 19, share: 14, note: 'CANDU — heavy water, refuelled while running' },
  { name: 'Ukraine', units: 15, share: 55, note: 'High share maintained through wartime conditions' },
  { name: 'Japan', units: 33, share: 6, note: 'Fleet largely idle since 2011; restarting slowly' },
  { name: 'United Kingdom', units: 9, share: 13, note: 'Ageing gas-cooled fleet, retiring' },
]

/** The people who worked out the physics this page simulates. */
const PEOPLE = [
  {
    who: 'Lise Meitner & Otto Frisch',
    when: '1938–39',
    what:
      'Explained what Hahn and Strassmann had measured but could not account for: ' +
      'the uranium nucleus had split. Meitner did the calculation that named ' +
      'fission and worked out the energy released.',
  },
  {
    who: 'Enrico Fermi',
    when: '1942',
    what:
      'Built Chicago Pile-1 under a stadium grandstand and achieved the first ' +
      'self-sustaining chain reaction. It ran at half a watt. The control rod ' +
      'was pulled by hand, and a man with an axe stood ready to cut the rope.',
  },
  {
    who: 'Eugene Wigner',
    when: '1940s',
    what:
      'Worked out much of the reactor theory this page runs on, including the ' +
      'behaviour that lets delayed neutrons make a reactor controllable at all.',
  },
  {
    who: 'Alvin Weinberg',
    when: '1950s–60s',
    what:
      'Co-patented the pressurised water reactor — the design that became most ' +
      'of the world fleet — then spent decades arguing for the molten-salt ' +
      'reactor he thought was safer. MSRE is his.',
  },
]

const MAX_UNITS = Math.max(...COUNTRIES.map((c) => c.units))

export default function World() {
  const host = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctx = gsap.context(() => {
      gsap.from('.world-row', {
        opacity: 0,
        x: -14,
        duration: 0.55,
        ease: 'power2.out',
        stagger: 0.04,
        scrollTrigger: { trigger: '.world-table', start: 'top 85%', once: true },
      })
      // The bars grow from zero, so the comparison lands as motion rather than
      // as a static picture the eye has to decode.
      gsap.from('.world-bar span', {
        scaleX: 0,
        transformOrigin: 'left center',
        duration: 0.8,
        ease: 'power3.out',
        stagger: 0.04,
        scrollTrigger: { trigger: '.world-table', start: 'top 85%', once: true },
      })
    }, el)
    return () => ctx.revert()
  }, [])

  return (
    <article className="world" ref={host}>
      <section className="narrative-section">
        <p className="narrative-eyebrow">Who runs them</p>
        <h2 className="narrative-title">About 440 reactors, in 31 countries</h2>
        <p className="narrative-body">
          Together they produce roughly 9% of the world's electricity and about a
          quarter of its low-carbon electricity. The fleet is old — most units
          were built between 1970 and 1990 — and it is concentrated: three
          countries operate nearly half of it. The interesting number is not the
          count but the <em>share</em>, because that is what says whether a grid
          actually depends on this.
        </p>

        <div className="world-table">
          <div className="world-head">
            <span>Country</span>
            <span>Units</span>
            <span>Share of electricity</span>
          </div>
          {COUNTRIES.map((c) => (
            <div className="world-row" key={c.name} title={c.note}>
              <span className="world-name">
                {c.name}
                <i>{c.note}</i>
              </span>
              <span className="world-units">{c.units}</span>
              <span className="world-bar">
                <span style={{ transform: `scaleX(${c.share / 70})` }} />
                <b>{c.share}%</b>
              </span>
              <span className="world-scale" aria-hidden="true" style={{ width: `${(c.units / MAX_UNITS) * 100}%` }} />
            </div>
          ))}
        </div>

        <p className="world-caveat">
          <strong>These figures are approximate and undated.</strong> Unlike
          everything else on this page they are not computed and not verifiable
          from the source — reactor counts shift as units connect, shut down, or
          return from outage. Treat them as the right order of magnitude, not as
          a citation. Current numbers are published by the IAEA's Power Reactor
          Information System.
        </p>
      </section>

      <section className="narrative-section">
        <p className="narrative-eyebrow">Who worked it out</p>
        <h2 className="narrative-title">Four people, and one afternoon in Chicago</h2>
        <dl className="people">
          {PEOPLE.map((p) => (
            <div className="person" key={p.who}>
              <dt>
                {p.who}
                <i>{p.when}</i>
              </dt>
              <dd>{p.what}</dd>
            </div>
          ))}
        </dl>
        <p className="narrative-body">
          Chicago Pile-1 ran at half a watt — less than the reactor on this page
          produces at cold shutdown. What mattered was not the power but that the
          neutron population held steady without anyone adding anything, which is
          the same k&nbsp;=&nbsp;1 the panel above reports.
        </p>
      </section>
    </article>
  )
}
