# THE CORE — build plan

A reactor from cold shutdown to criticality, simulated in real time.

Not an animation of a reactor. **A reactor.** The neutron population on screen is
the solution to the point kinetics equations, integrated every frame, and the
Cherenkov glow is proportional to that number. Pull the rods too fast and the
period shortens and the thing runs away from you exactly as it would.

---

## 0. Why this project exists

Predecessors, and what each one is missing:

| | CALIBRE (ours) | Towers (MengTo) | THE CORE |
|---|---|---|---|
| Clock | none — scroll only | 4.40 s, plays once | **unbounded, real-time, stateful** |
| Cut plane | none | rises through a building | **cutaway through a pressure vessel** |
| Labels | 16, screen-space solved | stage captions | **live instrument readouts + part labels** |
| Variants | 3 finishes × 4 moods | 6 towers × 4 times × 4 weather | **4 reactor types from one parametric core** |
| Agency | scroll only | orbit / scrub / pause | **you operate it — rods, boron, scram** |
| Truth | plausible | plausible | **physically correct, and checkable** |

The differentiator is the last row. Everything in this genre is *plausible*. This
one is *right*, and the numbers on screen can be checked against a textbook.

---

## 1. Physics — the part that must be correct

### 1.1 Point kinetics

The core model. Six delayed-neutron precursor groups.

```
dn/dt  = ((ρ − β)/Λ)·n + Σᵢ λᵢ·Cᵢ
dCᵢ/dt = (βᵢ/Λ)·n − λᵢ·Cᵢ
```

- `n` — neutron population (∝ thermal power)
- `ρ` — reactivity, dimensionless. Report in **pcm** (1 pcm = 1e-5) and **dollars** ($1 = β)
- `β` — total delayed neutron fraction
- `Λ` — mean neutron generation time

**U-235 delayed groups (Keepin):**

| i | βᵢ | λᵢ (s⁻¹) | T½ (s) |
|---|---|---|---|
| 1 | 0.000215 | 0.0124 | 55.9 |
| 2 | 0.001424 | 0.0305 | 22.7 |
| 3 | 0.001274 | 0.1110 | 6.24 |
| 4 | 0.002568 | 0.3010 | 2.30 |
| 5 | 0.000748 | 1.1400 | 0.61 |
| 6 | 0.000273 | 3.0100 | 0.23 |

`β = 0.006502`. Use `β_eff = 0.0065` for a fresh core; note in the UI that it
falls toward ~0.005 at end of cycle as Pu-239 builds in — that is *why* an old
core is twitchier, and it is a real thing operators feel.

`Λ ≈ 2e-5 s` (PWR, light water). TRIGA `Λ ≈ 4e-5 s`.

### 1.2 Integration — this WILL blow up if done naively

`Λ` is 2e-5 s and the frame step is ~16e-3 s. That is a stiffness ratio near
1000:1. **Explicit Euler diverges immediately.** Do not attempt it.

Use **backward Euler**, solved in closed form by substitution. Unconditionally
stable, no matrix library needed:

```
Cᵢ_next = (Cᵢ + dt·(βᵢ/Λ)·n_next) / (1 + dt·λᵢ)
```

Substituting into the n equation and solving for `n_next`:

```
          n + dt·Σ[ λᵢ·Cᵢ / (1 + dt·λᵢ) ]
n_next = ───────────────────────────────────────────────────────
         1 − dt·(ρ−β)/Λ − (dt²/Λ)·Σ[ λᵢ·βᵢ / (1 + dt·λᵢ) ]
```

Substep the frame: `dt_sim = min(frameDelta, 0.01)`, loop until consumed. This
keeps accuracy during fast transients without coupling the sim to framerate.

**Validation targets** — all computed, not remembered. Measured values below are
from the converged reference run; see `docs/validation.md`.

| Input | Inhour prediction | Integrator @ 10 ms | Error |
|---|---|---|---|
| ρ = 0 | steady | 1.0000000000000002 after 100 s | — |
| +100 pcm | T = **54.921 s** | 54.915 s | −0.01 % |
| +300 pcm | T = **7.079 s** | 7.075 s | −0.05 % |
| +500 pcm | T = **1.185 s** | 1.184 s | −0.05 % |
| +640 pcm ($0.98) | T = **0.118 s** | 0.118 s | −0.05 % |
| −500 pcm | prompt drop to β/(β−ρ) = **0.565** | 0.526 at t=0.5 s | fast groups decayed |
| $2.00 | prompt excursion | **see below** | — |

> **Corrected 2026-08-16.** An earlier draft of this file claimed +500 pcm gives a
> ~5 s period. It gives **1.185 s**. The error was caught by computing the inhour
> equation rather than trusting the figure — which is the entire argument for
> `docs/validation.md` existing.

**The prompt-critical trap.** Above ρ = β the implicit denominator
`1 − dt(ρ−β)/Λ − …` passes through zero and goes negative, and the step returns a
large positive number that looks exactly like a physical runaway. At $2.00 with a
10 ms step it returns **4.2e12 instead of 51** — eleven orders of magnitude out,
with no NaN to catch it. Convergence under refinement:

| maxStep | n after 10 ms at $2.00 |
|---|---|
| 1e-2 | 4.2380e+12 ← garbage |
| 1e-3 | 1.0138e+2 |
| 1e-4 | 5.3603e+1 |
| 1e-5 | 5.1001e+1 |
| 1e-6 | 5.0753e+1 ← converged |

`maxStableStep(ρ)` clamps the substep to `0.02·Λ/(ρ−β)` once ρ > 0.9β. This
matters because the **TRIGA pulse is deliberately prompt supercritical** — the
signature moment of the project is precisely the regime where the naive
integrator is wrong by twelve orders of magnitude and still looks convincing.

### 1.3 Reactivity balance

`ρ_total` is a sum of contributions, each of which the UI shows as its own bar.
This is the single most educational element on the page.

```
ρ = ρ_rods + ρ_boron + ρ_doppler + ρ_moderator + ρ_xenon + ρ_source
```

- **Rods** — integral worth curve is S-shaped, not linear. Differential worth
  (pcm per step) peaks near the core midplane where flux is highest. Model as
  `ρ_rod(x) = W·(x − sin(2πx)/(2π))` for withdrawal fraction `x∈[0,1]`,
  total worth `W ≈ 8000 pcm` for all banks. Withdraw in real bank sequence:
  shutdown banks A/B, then control banks A→B→C→D with overlap.
- **Boron** (PWR only) — chemical shim. `≈ −10 pcm/ppm`. Cold shutdown ≈ 2000 ppm,
  hot zero power ≈ 1200 ppm. Dilution is slow (minutes), which is the point:
  boron is coarse, rods are fine.
- **Doppler / fuel temperature** — `α_F ≈ −2.5 pcm/°C` (PWR). **Always negative,
  acts instantly**, because it is resonance broadening in U-238, not a thermal
  transport effect. This is the inherent safety mechanism and deserves to be
  said plainly on the page.
- **Moderator temperature** — `α_M ≈ −35 pcm/°C` at operating boron. Goes
  *positive* at high boron concentration, which is why beginning-of-cycle
  startups are handled carefully.
- **Xenon-135** — see 1.5.
- **Source** — startup neutron source keeps count rate measurable when subcritical.
  Without it `1/M` has nothing to plot.

### 1.4 Thermal-hydraulics (two lumped nodes, sufficient and honest)

```
C_F·dT_F/dt = P − h·(T_F − T_C)
C_C·dT_C/dt = h·(T_F − T_C) − ṁ·cp·(T_C − T_in)
```

PWR reference points to hit: `T_avg ≈ 292 °C (557 °F)`, `2250 psia`,
`T_hot ≈ 324 °C`, `T_cold ≈ 288 °C`. Saturation at 2250 psia is 373 °C — the
margin to boiling (DNBR) is a number the panel should show, because "how close
are we to boiling" is the real question in a PWR.

### 1.5 Xenon — the slow villain

```
dI/dt = γ_I·Σf·φ − λ_I·I
dX/dt = γ_X·Σf·φ + λ_I·I − λ_X·X − σ_X·X·φ
```

`λ_I = 2.87e-5 s⁻¹` (T½ 6.57 h), `λ_X = 2.09e-5 s⁻¹` (T½ 9.17 h),
`σ_X = 2.6e6 barns` — one of the largest absorption cross-sections in nature.
`γ_I ≈ 0.0639`, `γ_X ≈ 0.00237` (most Xe-135 arrives via I-135 decay, not directly).

Consequence to dramatise: **shut down from full power and xenon peaks ~9-11 h
later**, adding several thousand pcm of negative reactivity. If the core lacks
the rod worth to overcome it you physically cannot restart until it decays.
That window is called **xenon dead time**, and a time-compression control
(1× / 60× / 3600×) exists specifically so the visitor can watch it happen.

Xenon is also what caught Chernobyl — a xenon-poisoned core, rods pulled far
beyond limits to compensate. That is the honest way to tell that story: not as
spectacle, but as the consequence of the exact numbers on screen.

### 1.6 Decay heat

After scram, fission stops but decay heat does not:

```
P_decay/P₀ ≈ 0.066·[ t^(−0.2) − (t + t_op)^(−0.2) ]     (Way-Wigner)
```

≈ 6.5% immediately, ~1% at 1 h, ~0.4% at 1 day. **This is why cooling must
continue after shutdown, and why Fukushima happened.** Non-negotiable content.

---

## 2. Cherenkov — get this right or the whole premise is fake

Cherenkov light is emitted when a charged particle exceeds the phase velocity of
light *in that medium* (water, n = 1.33, so 0.75c). The source is beta particles
from fission products and Compton electrons from gammas. Spectral intensity goes
as **1/λ²**, so it rises into the UV and the visible tail reads blue.

**The honesty problem:** in a PWR you cannot see it. The core sits inside a
200 mm steel pressure vessel. The famous blue glow is seen in **open pool
reactors** and **spent fuel pools**.

**How this is handled:**
- **TRIGA is one of the four variants** and it is a genuine open-pool reactor —
  there, the glow is what you would actually see, and TRIGA's pulse mode (see 3)
  is the most spectacular honest thing in the whole project.
- For PWR/BWR the cutaway is presented as **a diagram convention**, labelled as
  such. A cutaway is not a lie; a cutaway pretending to be a photograph is.

Render approach: emissive volume in the water region, intensity `∝ n^0.8`
(sub-linear because the eye is), colour temperature shifting slightly bluer with
flux. `toneMapped: false` on the emissive so ACES cannot clip the hue —
saturated colour past 1.0 survives the tone map where brightness does not.
Bloom via post-processing, threshold above the vessel steel.

---

## 2.5 Art direction — you are at the console

*Added after review. The first draft of this plan was almost entirely physics,
which is the wrong emphasis: CALIBRE and Towers are good because they are
art-directed, not because they are clever. A correct reactor that looks like a
grey cylinder with a blue light in it loses to both.*

**The controlling idea: don't render a reactor floating in a void. Render the
control room, and see the core through it.**

This solves the project's real visual problem. A reactor is grey steel and blue
light — that is a narrow palette against Towers' six cultures × four times of day
× four weathers. A *control room* is not narrow at all, because every reactor
programme built its own industrial design language:

| Variant | Room | Palette | Type |
|---|---|---|---|
| **PWR** Westinghouse, 1975 | cream panels, chrome bezels, red pistol-grip scram handle | warm cream, chrome, amber/red/green indicator lamps | engraved lamacoid, condensed gothic |
| **BWR** GE, 1980 | benchboard, mimic diagram inlaid in the desk | cool grey-blue, white mimic lines | Helvetica-era plant signage |
| **TRIGA** university, 1968 | one desk, one console, **a window onto the pool** | pale institutional green, oak trim, daylight | typewriter labels, hand-lettered |
| **MSRE** Oak Ridge, 1965 | mid-century lab, strip-chart recorders wall-mounted | warm grey-green, bakelite, brushed steel | Bakelite engraving, Apollo-era numerals |

That is the same trick Towers plays with six cultures, and it costs nothing extra
because the console is 2D — it is DOM and SVG, not geometry.

**TRIGA is the emotional centre and should be built first.** It is the one room
with a *window*, so the Cherenkov glow is honestly visible rather than a cutaway
convention; it is small and human rather than industrial; and daylight through
water onto a blue core is simply the most beautiful frame available here.

### The signature object: the strip-chart recorder

A pen on paper, drawing the power trace, paper advancing at a real chart speed.
It earns its place four times over:

- It is live data visualisation that is *also a physical object with materials* —
  the thing dataviz on the web almost never gets to be
- **The scroll metaphor becomes literal.** The page scrolls because the chart
  paper advances. The visitor's scroll and the reactor's history are the same
  motion, which is the two-axis idea from §6 made visible rather than explained
- Historically exact — this is genuinely how reactor power was recorded
- Scrolling back is reading the trace you already wrote, so the past is legible
  rather than merely remembered

### Rules

1. **The instruments are the page furniture.** Editorial type sits *on* panel
   surfaces, not floating over a canvas. Both predecessors put an object centre
   frame with type around it; this inverts that.
2. **Tabular numerals everywhere**, `font-variant-numeric: tabular-nums`. A
   readout that reflows as digits change reads as a web page, not an instrument.
3. **Lamps are lit surfaces, not coloured rectangles** — bezel, glass, filament
   falloff. This is the detail that decides whether the panel reads as a machine.
4. **The core is seen, not presented.** Through a window (TRIGA), through a
   cutaway explicitly labelled as a diagram (PWR/BWR), through the drain line
   (MSRE). Never as a hero product shot on a gradient.
5. **Light comes from the room**, so the palette shifts with reactor state: at
   cold shutdown the panel is lit only by its own lamps; at power the Cherenkov
   throws blue up onto the underside of everything near the pool.
6. **One accent per room, taken from its own hardware** — the Westinghouse scram
   red, the TRIGA pool blue. Same discipline as CALIBRE taking its accent off the
   dial.

### Revised sequencing consequence

Build order in §7 is wrong as written — it stacks all the physics, then all the
geometry, then styles it at the end, which is how projects end up accurate and
ugly. Reorder so **one complete beautiful thing** exists early: the TRIGA room,
approach to criticality, count-rate clicks accelerating, 1/M plot filling in, pen
tracing the chart. That vertical slice exercises sim, render, panel, dataviz and
audio at once, and it is the moment the whole project is selling.

---

## 3. The four variants — one parametric core

Same lattice builder, four parameter sets. This is Towers' six-towers structure.

| | PWR | BWR | TRIGA | MSRE |
|---|---|---|---|---|
| Fuel | UO₂ pellets, Zr clad | UO₂, Zr clad | U-ZrH rods | fuel dissolved in salt |
| Moderator | light water | light water | ZrH + water | graphite |
| Rods enter | **top** | **bottom** (steam above) | top | control rods + drain plug |
| Control | rods + **boron shim** | rods + **recirc flow** | rods + transient rod | temperature + drain tank |
| Pressure | 2250 psia | 1000 psia | atmospheric | atmospheric |
| Cherenkov visible | no (cutaway) | no (cutaway) | **yes, genuinely** | no |
| Signature | boron dilution | flow control | **pulse mode** | **freeze plug** |

Two signature behaviours worth building fully:

- **TRIGA pulse** — the transient rod is fired pneumatically, taking the core
  *prompt supercritical* on purpose. It is self-limiting because U-ZrH has a huge
  prompt negative temperature coefficient (~−1¢/°C): the fuel heats in
  milliseconds and shuts itself down. Power spikes to ~GW for ~10 ms. The blue
  flash is real and it is the single best moment available to this project.
- **MSRE freeze plug** — a plug of frozen salt kept solid by a cooling fan. Lose
  power, the fan stops, the plug melts, and the fuel drains by gravity into
  subcritical tanks. Walk-away safe with no operator and no electricity. They
  demonstrated it by going home for the weekend.

---

## 4. Structure

```
the-core/
├─ PLAN.md                  ← this file
├─ docs/
│   ├─ physics.md           derivations + textbook citations
│   └─ validation.md        expected vs computed, per test
├─ src/
│   ├─ sim/                 NO rendering, NO React. Pure, testable.
│   │   ├─ constants.ts     delayed groups, cross-sections, coefficients
│   │   ├─ kinetics.ts      backward-Euler point kinetics
│   │   ├─ reactivity.ts    rod worth curves, boron, feedback
│   │   ├─ thermal.ts       two-node
│   │   ├─ xenon.ts         I-135 / Xe-135
│   │   ├─ decayHeat.ts     Way-Wigner
│   │   ├─ reactor.ts       orchestrator; owns the mutable state object
│   │   └─ *.test.ts        validation against known answers
│   ├─ core/                R3F scene
│   │   ├─ Vessel.tsx       pressure vessel + cutaway clip plane
│   │   ├─ Lattice.tsx      instanced fuel assemblies (parametric)
│   │   ├─ Rods.tsx         control rod banks, driven by sim
│   │   ├─ Cherenkov.tsx    emissive volume, intensity from n
│   │   ├─ Coolant.tsx      flow, thermal gradient
│   │   └─ Stage.tsx        camera rig, lighting, post
│   ├─ ui/
│   │   ├─ Panel.tsx        instrument readouts
│   │   ├─ ReactivityBars.tsx   live ρ contribution breakdown
│   │   ├─ StartupChart.tsx     1/M plot + period meter
│   │   ├─ Labels.tsx       screen-space solver (port from CALIBRE)
│   │   └─ Controls.tsx     rods, boron, scram, time compression
│   ├─ gen/                 procedural textures (zero network)
│   └─ state.ts             mutable module object — the ONE bridge
└─ scripts/capture.mjs      scroll/state checkpoints (port from CALIBRE)
```

**Hard rule, inherited from CALIBRE and non-negotiable:** `src/sim/` imports
nothing from React or Three. It is a pure numerical library that could run in
Node. That is what makes it testable, and testability is what makes the accuracy
claim real rather than asserted.

---

## 5. State bridge

One mutable module object. GSAP/DOM writes intent, the sim integrates, `useFrame`
reads. Zero React state in the loop. (See the `r3f-gsap-bridge` skill.)

```ts
export const reactor = {
  n: 1e-8, power: 0, rho: 0, period: Infinity, sur: 0,
  rods: 0, boron: 2000, tFuel: 20, tCool: 20,
  xenon: 0, iodine: 0, scrammed: false, timeScale: 1,
}
```

React renders the *chrome*. It never renders the *numbers* — those are written to
DOM nodes directly from the frame loop, because a 7-digit readout updating at
60 Hz through React is exactly the mistake CALIBRE was built to avoid.

---

## 6. Two axes

Neither repo has both. This is the structural improvement.

- **Scroll** — the narrative. Cold shutdown → heatup → rod withdrawal → approach
  to critical (1/M) → criticality → power ascension → xenon → scram → decay heat.
- **Simulation clock** — independent, always running, never resets. Scroll moves
  the *camera and the argument*; the reactor keeps integrating regardless. Scroll
  back up and the core is still where the physics left it.

Plus **time compression** (1× / 60× / 3600×) so xenon and decay heat are
observable inside a visit.

---

## 7. Build order

| # | Milestone | Gate |
|---|---|---|
| 1 | Scaffold: Vite + React + R3F + GSAP, self-hosted fonts, zero CDN | `npm run dev` clean |
| 2 | `sim/` complete + tests | **all validation targets in 1.2 pass** |
| 3 | Headless console readout — no 3D yet | startup transient matches textbook |
| 4 | Vessel + lattice + cutaway clip plane | geometry reads at 60 fps |
| 5 | Cherenkov + bloom, intensity from `n` | glow tracks power |
| 6 | Instrument panel + reactivity bars + 1/M | numbers legible, updating |
| 7 | Controls: rods, boron, scram | you can take it critical by hand |
| 8 | Scroll narrative + camera rig | both axes coexist |
| 9 | Four variants from one builder | switching costs no reload |
| 10 | Audio (`web-audio-scenes`) | count-rate clicks, alarms, pump hum |
| 11 | Reduced motion, a11y, mobile | audit passes |
| 12 | Procedural textures, inline assets | **zero subresource requests** |

**Gate 2 is the project.** If the sim isn't provably right, the rest is decoration.

---

## 8. Sound

Driven by the same state object.

- **Count rate clicks** — Poisson-distributed, rate ∝ `n`. During approach to
  critical this is the sound of the whole project: sparse ticks accelerating into
  a texture as `1/M → 0`. It is also historically exactly right.
- **Pump hum** — pitch tracks flow
- **Alarms** — short period, high startup rate, prompt critical. Distinct, and
  the prompt-critical one should be genuinely unpleasant.
- **Scram** — rod drop, then the room going quiet

Muted by default with a visible control; the count-rate ticks are the hook, so
the unmute prompt should appear right before the approach-to-critical section.

---

## 9. Honesty rules

Non-negotiable, because the whole pitch is accuracy:

1. Every constant carries a source comment in `constants.ts`.
2. Every simplification is **stated on the page**, not buried — point kinetics
   assumes a fixed flux shape and cannot show spatial effects (xenon oscillation,
   flux tilt). Say so.
3. The cutaway is labelled as a diagram convention.
4. Cherenkov is shown as genuinely visible only for TRIGA.
5. No operational detail that isn't already in an undergraduate textbook or an
   NRC public document. This is a physics explainer — the interesting content is
   *why reactors are stable*, which is inherently the safety story.
6. `docs/validation.md` publishes computed vs. expected for every test, so the
   accuracy claim is checkable rather than asserted.

---

## 10. Skills to load per milestone

- `r3f-gsap-bridge` — 4, 8 (state bridge, camera, scroll)
- `threejs-geometry` — 4 (instanced lattice)
- `threejs-shaders` / `threejs-postprocessing` — 5 (Cherenkov, bloom)
- `procedural-textures` — 12
- `web-audio-scenes` — 10
- `gsap-scrolltrigger` / `gsap-timeline` — 8
- `dataviz` — 6 (1/M plot, reactivity bars)
- `design:accessibility-review` — 11

---

## Next action

Milestone 1 (scaffold), then Milestone 2 (`sim/` + tests) — and do not proceed
past gate 2 until the validation numbers match.
