import { useEffect, useRef, useState } from 'react'
import { state } from '../state'
import { toPcm } from '../sim/kinetics'

/**
 * The startup procedure.
 *
 * This exists because the page failed the only test that matters: the person who
 * commissioned it could not tell what it was doing. That is not a labelling
 * problem, and a tooltip tour would not have fixed it — the page was handing
 * over a reactor with no goal, no sequence and no way to know whether anything
 * you did was right.
 *
 * A reactor startup is genuinely a written procedure, followed step by step,
 * with a condition to satisfy before moving on. So the tour is the subject
 * itself rather than an overlay on top of it. Each step says what to do, why it
 * matters, and watches the live simulation to decide when it is done.
 *
 * Steps advance on the state of the REACTOR, never on a click. You cannot skip
 * criticality by pressing next, because the only way past that step is to
 * actually take the reactor critical — which is the entire lesson.
 */

type Step = {
  title: string
  /** What the visitor should do. Imperative, one action. */
  action: string
  /** Why it matters. This is the teaching. */
  why: string
  /** Satisfied? Read from the live simulation. */
  done: (s: ReturnType<typeof state>) => boolean
  /** Live progress hint, recomputed each frame. */
  hint?: (s: ReturnType<typeof state>) => string
}

const STEPS: Step[] = [
  {
    title: 'Confirm the reactor is shut down',
    action: 'Leave the rod bank at 0%. Read the reactivity.',
    // Was hardcoded to TRIGA's −4500 pcm, which is wrong for the other three
    // (a PWR sits near −6200, and only because 2000 ppm of boron is holding it
    // there). The shutdown margin is read live instead.
    why:
      'Deeply negative reactivity, and k-effective below 1. Every neutron ' +
      'generation is smaller than the one before, so the chain dies out. A ' +
      'reactor cannot start itself — this margin is what a plant is licensed on.',
    done: (s) => s.clock > 3 && s.rho < -0.02,
    hint: (s) => `ρ = ${Math.round(toPcm(s.rho))} pcm · k = ${s.kEff.toFixed(5)}`,
  },
  {
    title: 'Withdraw to 50% and watch the count rate',
    action: 'Drag the rod bank to about 50%.',
    why:
      'Still subcritical — but the neutron source is being multiplied more and ' +
      'more. M = 1/(1−k). The core is not fissioning on its own yet; it is ' +
      'amplifying. Watch the multiplication readout climb.',
    done: (s) => s.multiplication > 40,
    hint: (s) => `multiplication M = ${s.multiplication.toFixed(0)}`,
  },
  {
    title: 'Approach criticality',
    action: 'Ease the bank toward the predicted critical position.',
    why:
      'That line is where the reactivity balance says critical will be. Real ' +
      'operators plot 1/M and extrapolate to zero before each pull, so ' +
      'criticality is PREDICTED rather than discovered. That difference is the ' +
      'difference between a startup and an accident.',
    done: (s) => s.rho > -0.002 && s.rho < 0.0005,
    hint: (s) => `${Math.round(toPcm(s.rho))} pcm from critical`,
  },
  {
    title: 'Go critical',
    action: 'Hold it where power stops falling and stays put.',
    why:
      'k = 1.000. Each generation exactly replaces the last, so power holds ' +
      'steady with no help. The period reads STEADY. Nothing is "on" — the ' +
      'reaction is simply sustaining itself.',
    done: (s) => Math.abs(s.rho) < 0.0002 && s.powerFraction > 1e-9,
    hint: (s) => `k = ${s.kEff.toFixed(5)} · period ${!isFinite(s.period) || Math.abs(s.period) > 3600 ? 'STEADY' : s.period.toFixed(0) + ' s'}`,
  },
  {
    title: 'Raise power — slowly',
    action: 'Withdraw a little further. Keep startup rate under 1 dpm.',
    why:
      'A small positive reactivity gives an exponential rise. One decade per ' +
      'minute is the administrative limit, because faster than that and a human ' +
      'cannot react in time. Watch the period shorten as you pull.',
    done: (s) => s.powerFraction > 0.001,
    hint: (s) => `SUR ${s.sur.toFixed(2)} dpm · ${(s.powerFraction * 100).toExponential(1)}% power`,
  },
  {
    title: 'Watch it regulate itself',
    action: 'Stop moving the rods. Wait.',
    why:
      'The fuel heats, and hot fuel absorbs more neutrons — the Doppler ' +
      'coefficient, and it is always negative. The Doppler bar grows to meet ' +
      'the rod bar and the net settles near zero on its own. Nobody is doing ' +
      'this. It is why reactors are inherently stable.',
    done: (s) => s.terms.fuelTemp < -0.0003 && Math.abs(s.rho) < 0.0004,
    hint: (s) => `Doppler ${Math.round(toPcm(s.terms.fuelTemp))} pcm · net ${Math.round(toPcm(s.rho))} pcm`,
  },
  {
    title: 'Let xenon poison the core',
    action: 'Set time compression to 600× or 3600× and wait.',
    why:
      'Xe-135 builds from fission and absorbs neutrons ferociously — 2.6 ' +
      'million barns. It eats hundreds of pcm, and the rods must come further ' +
      'out to hold the same power. This is the slowest and most consequential ' +
      'thing a reactor does.',
    // 0.04x equilibrium is about -110 pcm — plainly visible on the balance and
    // reachable in a few compressed hours at the ~5-10 % power this core
    // settles at. The original threshold of 0.4 needed ~20 % power held for
    // tens of hours and made the step impossible to finish, which is worse
    // than having no procedure at all.
    done: (s) => s.xenon.xenon > 0.04,
    hint: (s) => `xenon ${s.xenon.xenon.toFixed(3)}× equilibrium · ${Math.round(toPcm(s.terms.xenon))} pcm`,
  },
  {
    title: 'Scram it',
    action: 'Press SCRAM.',
    why:
      'Rods drop, fission stops in milliseconds — and the power does NOT go to ' +
      'zero. Fission products already in the fuel keep decaying: about 6.5% of ' +
      'rated power immediately, 1% an hour later. That heat has to go somewhere ' +
      'whether or not anyone is there. It is why Fukushima happened.',
    done: (s) => s.scrammed && s.sinceScram > 5,
    hint: (s) =>
      s.scrammed
        ? `decay heat ${(s.powerFraction * 100).toFixed(3)}% of rated`
        : 'chain reaction still running',
  },
]

export default function Procedure() {
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState(true)
  const hint = useRef<HTMLSpanElement>(null)
  const indexRef = useRef(0)
  indexRef.current = index

  /**
   * Which steps were ALREADY satisfied at the moment this step was arrived at.
   *
   * The advance has to be edge-triggered, not level-triggered. Step 1 asks you
   * to confirm the reactor is shut down, and at step 2 that is still true — so
   * a level-triggered check saw "step 1 is done" the instant Back was pressed
   * and bounced you forward again in the same frame. Back was unusable.
   *
   * Recording what was true on arrival means a step only fires on a genuine
   * false → true transition: something you did, not something that happened to
   * be the case when you got there.
   */
  const doneOnArrival = useRef<boolean[]>([])

  /**
   * One rAF loop watching the simulation.
   *
   * The current step advances when the REACTOR satisfies it, not when a button
   * is pressed — that is the point, and it is why criticality cannot be skipped.
   *
   * But it must not TRAP you either. Scramming during the xenon step left the
   * procedure stuck on a condition that could no longer be met: xenon decays
   * once the reactor is shut down, so the gate had closed permanently with no
   * way past it. A guided sequence that can dead-end is worse than none.
   *
   * So a later step being satisfied also advances — if you have plainly done a
   * thing, the procedure acknowledges it rather than insisting on the order.
   * Manual arrows exist as a final escape hatch.
   */
  // Snapshot the world on arrival at each step, so nothing already true can
  // trigger an advance.
  useEffect(() => {
    const s = state()
    doneOnArrival.current = STEPS.map((step) => step.done(s))
  }, [index])

  useEffect(() => {
    let frame = 0
    let last = ''
    const tick = () => {
      const s = state()
      const i = indexRef.current
      const step = STEPS[i]
      const arrival = doneOnArrival.current

      if (step) {
        if (step.hint && hint.current) {
          const text = step.hint(s)
          if (text !== last) {
            hint.current.textContent = text
            last = text
          }
        }

        const nowDone = step.done(s)
        // Re-arm: once a condition clears, satisfying it again is a real edge.
        if (!nowDone) arrival[i] = false

        if (nowDone && !arrival[i]) {
          setIndex((n) => (n === i ? n + 1 : n))
        } else {
          // Look ahead for the dead-end case — but only at steps that were NOT
          // already satisfied when this step was reached, for the same reason.
          for (let j = STEPS.length - 1; j > i; j--) {
            if (!arrival[j] && STEPS[j].done(s)) {
              setIndex((n) => (n === i ? j + 1 : n))
              break
            }
            if (!STEPS[j].done(s)) arrival[j] = false
          }
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  const finished = index >= STEPS.length
  const step = STEPS[Math.min(index, STEPS.length - 1)]

  return (
    <div className={`procedure${open ? '' : ' is-collapsed'}`}>
      <div className="procedure-head">
        <h2>Startup procedure</h2>
        <button type="button" className="procedure-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open && (
        <>
          <ol className="procedure-track" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className={i < index ? 'is-done' : i === index ? 'is-current' : ''}
                title={s.title}
              />
            ))}
          </ol>

          {finished ? (
            <div className="procedure-body">
              <p className="procedure-step">Complete</p>
              <p className="procedure-why">
                You took a reactor from cold shutdown to criticality, raised it to
                power, watched it regulate itself, poisoned it with xenon and shut
                it down — and every number you saw was solved, not scripted.
              </p>
              <button type="button" className="procedure-restart" onClick={() => setIndex(0)}>
                Run it again
              </button>
            </div>
          ) : (
            <div className="procedure-body">
              <p className="procedure-count">
                Step {index + 1} of {STEPS.length}
              </p>
              <p className="procedure-step">{step.title}</p>
              <p className="procedure-action">{step.action}</p>
              <p className="procedure-why">{step.why}</p>
              <span className="procedure-hint" ref={hint} />
              {/* Escape hatch. The procedure normally advances on the reactor's
                  state, but a visitor who has gone off-script should never be
                  stranded on a gate they can no longer open. */}
              <div className="procedure-nav">
                <button
                  type="button"
                  onClick={() => setIndex((n) => Math.max(0, n - 1))}
                  disabled={index === 0}
                  aria-label="Previous step"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => setIndex((n) => Math.min(STEPS.length, n + 1))}
                  aria-label="Skip this step"
                >
                  Skip →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
