import { useEffect, useState } from 'react'
import Pool from './core/Pool'
import Panel from './ui/Panel'
import ReactivityBars from './ui/ReactivityBars'
import StripChart from './ui/StripChart'
import Controls from './ui/Controls'
import Procedure from './ui/Procedure'
import Narrative from './ui/Narrative'
import World from './ui/World'
import OneOverM from './ui/OneOverM'
import { selectReactor, startSim, stopSim } from './state'
import { armAudio, setAudioEnabled } from './audio'
import { startGlow, stopGlow } from './glow'
import { REACTORS, REACTOR_ORDER, type ReactorKind } from './sim/reactors'

/**
 * THE CORE — vertical slice: the TRIGA room.
 *
 * Art direction per PLAN.md §2.5: you are at the console, not looking at a
 * product shot. The instruments are the page furniture and the reactor is seen
 * THROUGH a window, which for a TRIGA is honest — it is an open pool in a bright
 * room, and the blue glow is what you would actually see standing at the rail.
 */
export default function App() {
  useEffect(() => {
    startSim()
    armAudio()
    startGlow()
    return () => { stopSim(); stopGlow() }
  }, [])

  const [view, setView] = useState<'section' | 'pool'>('section')
  const [kind, setKind] = useState<ReactorKind>('triga')
  const [sound, setSound] = useState(false)
  const spec = REACTORS[kind]

  // Switching variant replaces the reactor object entirely, so every component
  // holding local state about it (rod position, procedure step) must remount.
  // `key` does that in one line — see the console element below.
  const changeReactor = (next: ReactorKind) => {
    selectReactor(next)
    setKind(next)
  }

  // Each variant gets its own room. Every reactor programme built its own
  // industrial design language, and a control room is not a narrow palette the
  // way a reactor is — this is where the visual range comes from (PLAN.md 2.5).
  useEffect(() => {
    document.documentElement.dataset.reactor = kind
  }, [kind])

  return (
    <div className="room">
      <header className="masthead">
        <div className="masthead-title">
          <h1>THE CORE</h1>
          <p>Cold shutdown to criticality, simulated in real time</p>
        </div>
        <div className="masthead-controls">
          <div className="reactor-picker" role="group" aria-label="Reactor type">
            {REACTOR_ORDER.map((k) => (
              <button
                key={k}
                type="button"
                className={kind === k ? 'is-active' : ''}
                onClick={() => changeReactor(k)}
              >
                {REACTORS[k].kind.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`sound-toggle${sound ? ' is-active' : ''}`}
            onClick={() => { setSound(!sound); setAudioEnabled(!sound) }}
            aria-pressed={sound}
          >
            {sound ? 'Sound on' : 'Sound off'}
            <i>count-rate clicks</i>
          </button>
        </div>

        <div className="masthead-plate">
          <span className="plate-name">{spec.name}</span>
          <span className="plate-meta">
            {spec.place} · {spec.year}
          </span>
          <span className="plate-sig">{spec.signature}</span>
        </div>
      </header>

      <main className="console" key={kind}>
        <section className="console-window">
          <div className="view-switch" role="group" aria-label="Core view">
            <button
              type="button"
              className={view === 'section' ? 'is-active' : ''}
              onClick={() => setView('section')}
            >
              Section
              <i>labelled cutaway</i>
            </button>
            <button
              type="button"
              className={view === 'pool' ? 'is-active' : ''}
              onClick={() => setView('pool')}
            >
              Pool
              <i>3D, as seen from the rail</i>
            </button>
          </div>

          <div className="window-frame">
            <Pool view={view} />
          </div>

          <p className="view-caption">
            {view === 'section'
              ? 'A TRIGA in vertical section. Pull the rod bank and the blue is Cherenkov light — real, and visible in a TRIGA because the core sits open in a water pool rather than inside a steel vessel.'
              : 'The same core in three dimensions, sectioned so the lattice is visible. Everything is driven by the simulation, not by a script.'}
          </p>

          <div className="charts">
            <StripChart />
            <OneOverM />
          </div>
        </section>

        <aside className="console-side">
          <Procedure />
          <Panel />
          <ReactivityBars />
          <Controls />
        </aside>
      </main>

      <Narrative />
      <World />

      <footer className="colophon">
        <p>
          <strong>Everything on this page is computed.</strong> The neutron
          population is the solution to the six-group point kinetics equations,
          integrated every frame; the glow is proportional to it. Validated
          against the inhour equation to within 0.05% from 50 to 640&nbsp;pcm.
        </p>
        <p className="colophon-caveat">
          Point kinetics assumes a fixed flux shape, so this model cannot show
          spatial effects — xenon oscillation, flux tilt, or a hot channel. Two
          thermal nodes give the feedback path, not a temperature map.
        </p>
      </footer>
    </div>
  )
}
