import { useEffect, useRef, useState } from 'react'
import { doResetScram, doScram, firePulse, inputs, state } from '../state'
import { criticalWithdrawal } from '../sim/reactivity'

/**
 * The operator's controls.
 *
 * Rod position lives in React state as well as in the sim, because it is a
 * genuine UI value the visitor sets — unlike everything in Panel.tsx it changes
 * only on interaction, not every frame, so React is the right owner.
 */
export default function Controls() {
  const [withdrawal, setWithdrawal] = useState(0)
  const [scrammed, setScrammed] = useState(false)
  const [timeScale, setTimeScale] = useState(1)
  const [spec] = useState(() => state().spec)
  const canPulse = spec.canPulse
  const critical = useRef<HTMLSpanElement>(null)
  // Mirrors the sim's scram flag so the rAF loop can spot an automatic trip
  // without re-registering on every state change.
  const scrammedRef = useRef(false)

  useEffect(() => { inputs().rodWithdrawal = withdrawal }, [withdrawal])
  useEffect(() => { inputs().timeScale = timeScale }, [timeScale])

  // The predicted critical rod position, live. During a real startup this is
  // what the 1/M plot estimates before each pull — criticality is PREDICTED
  // rather than discovered, which is the whole difference between a startup and
  // an accident.
  useEffect(() => {
    let frame = 0
    let last = ''
    const tick = () => {
      const s = state()
      const other = s.terms.boron + s.terms.fuelTemp + s.terms.modTemp + s.terms.xenon
      const text = `${(criticalWithdrawal(s.spec, other) * 100).toFixed(1)}%`
      if (text !== last && critical.current) {
        critical.current.textContent = text
        last = text
      }

      /*
       * The controls must OBSERVE the reactor, not just command it.
       *
       * The protection system can scram the plant on its own — that is the
       * whole point of having one — and when it did, this panel had no idea.
       * The bank indicator went on claiming 94 % withdrawn while the rods sat
       * at the bottom, and the button still offered SCRAM on an already
       * scrammed reactor, so there was no way to reset.
       *
       * Any control that can be actuated by something other than the operator
       * has to read back the actual state rather than assume its own last
       * command is still in force.
       */
      const live = inputs().scrammed
      if (live !== scrammedRef.current) {
        scrammedRef.current = live
        setScrammed(live)
        if (live) setWithdrawal(0)
      }

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="controls">
      <div className="control">
        <label htmlFor="rods">
          Control rod bank
          <b>
            {scrammed ? 'SCRAMMED — 0.0%' : `${(withdrawal * 100).toFixed(1)}% withdrawn`}
          </b>
        </label>
        <input
          id="rods"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={withdrawal}
          disabled={scrammed}
          onChange={(e) => setWithdrawal(Number(e.target.value))}
        />
        <p className="control-hint">
          Predicted critical position <span ref={critical}>—</span>. Worth is
          S-shaped: the first and last inches do almost nothing, and the middle
          of the bank is where the reactor comes alive.
        </p>
      </div>

      <div className="control-buttons">
        <button
          type="button"
          className="btn btn--pulse"
          disabled={!canPulse || scrammed}
          onClick={firePulse}
        >
          {canPulse ? 'Fire transient rod' : 'No transient rod'}
          <i>{canPulse ? 'prompt supercritical, on purpose' : `${spec.kind.toUpperCase()} has no pulse rod`}</i>
        </button>

        <button
          type="button"
          className={`btn btn--scram${scrammed ? ' is-active' : ''}`}
          onClick={() => {
            if (scrammed) {
              doResetScram()
              scrammedRef.current = false
              setWithdrawal(0)
              setScrammed(false)
            } else {
              doScram()
              scrammedRef.current = true
              setScrammed(true)
              // The rods physically fall to the bottom, so the bank indicator
              // must read 0 %. Leaving it at its last position made the control
              // disagree with the reactor — the slider claimed 85 % withdrawn
              // while the balance correctly showed the fully-inserted worth.
              setWithdrawal(0)
            }
          }}
        >
          {scrammed ? 'Reset' : 'SCRAM'}
          <i>{scrammed ? 'clear the trip and re-arm' : 'drop the rods'}</i>
        </button>
      </div>

      <div className="control">
        <label htmlFor="time">
          Time compression
          <b>{timeScale}×</b>
        </label>
        <div className="segmented" id="time">
          {[1, 10, 60, 600, 3600].map((v) => (
            <button
              key={v}
              type="button"
              className={timeScale === v ? 'is-active' : ''}
              onClick={() => setTimeScale(v)}
            >
              {v}×
            </button>
          ))}
        </div>
        <p className="control-hint">
          Xenon peaks about 8.5 hours after shutdown, and decay heat runs for
          days. Neither is watchable at 1×, and both are real.
        </p>
      </div>
    </div>
  )
}
