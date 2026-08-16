# The Core

A nuclear reactor, from cold shutdown to criticality, simulated in real time.

**[Open it →](https://sajidalee1.github.io/the-core/)**

Not an animation of a reactor. A reactor. The neutron population on screen is the
solution to the six-group point kinetics equations, integrated every frame, and
the Cherenkov glow is proportional to it. Pull the rods too fast and the period
shortens and the thing runs away from you, exactly as it would.

---

## What it does

- **Four reactors** — TRIGA Mark II, Westinghouse PWR, GE BWR, and the 1965
  Molten-Salt Reactor Experiment. One simulation, four parameter sets: MSRE's
  neutron generation time is twenty times a PWR's, and its circulating fuel
  carries delayed-neutron precursors out of the core, cutting effective β by 30%.
- **A guided startup procedure** in eight steps. Each advances on the state of
  the *reactor*, never on a click — you cannot skip past criticality, because
  the only way past it is to actually take the reactor critical.
- **The 1/M plot** — the oldest instrument in reactor startup. A subcritical core
  multiplies its source by M = 1/(1−k); plotting the inverse turns a hyperbola
  into a line that reaches zero at criticality, so it can be predicted with a
  ruler before the next pull rather than discovered by arriving at it.
- **A live reactivity balance.** Pull rods and the rod bar rises; the core heats
  and the Doppler bar grows negative to meet it; the sum settles near zero
  without anyone asking it to. That is what "inherently stable" means, and it is
  more convincing seen than described.
- **Xenon-135**, which peaks about 8.5 hours *after* shutdown and can make a
  restart physically impossible until it decays.
- **Decay heat** — fission stops in milliseconds, the heat does not. ~6.5% of
  rated power immediately, 1% an hour later. This is why Fukushima happened.
- **A reactor protection system** with real trips, real time delays and real
  power interlocks.
- **Count-rate audio.** Gaps between counts are exponentially distributed,
  because radioactive decay is a Poisson process — evenly spaced clicks are the
  giveaway that a counter is fake.
- **The room responds to the reactor.** As power rises the palette cools toward
  Cherenkov blue. Nobody chooses it; the reactor does it to the room.

## The claim, and how it is checked

The physics is validated against the **inhour equation** — an independent
analytic solution derived from the roots of the characteristic equation rather
than from time integration:

| ρ (pcm) | Inhour period | Integrator | Error |
|---:|---:|---:|---:|
| 100 | 54.9206 s | 54.9154 s | −0.01% |
| 300 | 7.0789 s | 7.0754 s | −0.05% |
| 500 | 1.1847 s | 1.1842 s | −0.05% |
| 640 ($0.98) | 0.1184 s | 0.1183 s | −0.05% |

`src/sim/` imports nothing from React or Three.js. It is a pure numerical library
that runs in Node, which is what makes the claim testable rather than asserted.

```bash
npm test        # 102 tests
```

Full record in [`docs/validation.md`](docs/validation.md).

## Eleven bugs, none of which threw an error

The most useful thing this project produced. **Every one rendered a plausible
number**, and seven were found by a person clicking around rather than by the
test suite.

| Defect | Symptom |
|---|---|
| Prompt-critical denominator flip | 4.2e12 instead of 51 — eleven orders out, no NaN |
| β ≠ Σβᵢ | ρ = +49.7 pcm reported while power fell; "critical" had moved by exactly the inconsistency |
| Xenon peak predictor decoupled from its model | 11.29 h against an exact 8.49 h, and *plausible* |
| Thermal stepped per frame, neutronics substepped | Feedback arrived a doubling late; diverged to NaN |
| No startup neutron source | 1.19e-50 W, and a 1/M plot measuring nothing |
| Scram left the rod indicator where it was | Control disagreed with the reactor |
| Procedure could dead-end | Stuck on a gate that had closed permanently |
| `display:flex` defeated `[hidden]` | Empty trip banner, permanently on |
| Advance was level- not edge-triggered | Back button bounced forward instantly |
| Controls did not observe automatic trips | Bank read 94% with the rods at the bottom |
| `toFixed(2)` on source-range power | 0.00 W on a live reactor |

The last few are the same species: the interface confidently asserting something
the simulation disagreed with. In an instrument panel that is worse than a wrong
number — a wrong number invites doubt, a confident wrong control invites trust.

## Running it

```bash
npm install
npm run dev
```

```bash
npm test        # physics validation
npm run build   # production build
```

## Limitations, stated

Point kinetics assumes a fixed flux shape, so this cannot show spatial effects —
no xenon oscillation, no flux tilt, no hot channel. The model knows one number
for the whole core. Two thermal nodes give the feedback path with the right time
constants; they are not a temperature map. Cherenkov light is shown as visible
only for TRIGA, which is an open pool — a PWR core sits behind 200 mm of steel,
and its cutaway is labelled as a diagram convention.

The country statistics in the closing section are approximate and from memory,
not computed. That is said on the page too.

## Built with

React, React Three Fiber, Three.js, GSAP, Vite, Vitest. No CDN requests —
textures and audio are generated in code.

## Licence

Unlicensed. Personal project.
