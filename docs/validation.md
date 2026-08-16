# Validation

The claim this project makes is that the numbers are right. That claim is only
worth something if it is checkable, so this file records computed values against
independent references. Every figure here is reproduced by `npm test`.

Last run: 102 tests passing.

---

## 1. Point kinetics vs. the inhour equation

The integrator is checked against an independent analytic solution rather than
against remembered numbers. The inhour equation

```
ρ = Λ/T + Σᵢ βᵢ/(1 + λᵢ·T)
```

comes from the roots of the characteristic equation; the integrator comes from
time-stepping. Agreement between the two validates the *numerics*. (It does not
validate the *model* — both assume point kinetics. See §6.)

Anchor: **+100 pcm → 54.9 s** is the canonical worked example in Lamarsh and
DOE-HDBK-1019/2, and it validates the inhour solver itself.

| ρ (pcm) | Inhour T (s) | Integrator @ 10 ms | Error |
|---:|---:|---:|---:|
| 100 | 54.9206 | 54.9154 | −0.01 % |
| 300 | 7.0789 | 7.0754 | −0.05 % |
| 400 | 3.0528 | 3.0513 | −0.05 % |
| 500 | 1.1847 | 1.1842 | −0.05 % |
| 600 | 0.2893 | 0.2891 | −0.05 % |
| 640 ($0.98) | 0.1184 | 0.1183 | −0.05 % |

Backward Euler is first-order and numerically damped, so the bias is
consistently negative — conservative, which is the right direction to be wrong.

**Steady state at ρ = 0:** n = 1.0000000000000002 after 100 s.

**Prompt drop at −500 pcm:** theory β/(β−ρ) = 0.5653; integrator 0.5263 at
t = 0.5 s, the difference being the fast groups that have already decayed.

---

## 2. The prompt-critical trap

Above ρ = β the implicit denominator `1 − dt(ρ−β)/Λ − …` passes through zero and
goes negative, and the step returns a large positive number that looks exactly
like a physical runaway.

At ρ = $2.00 over 10 ms:

| maxStep | n |
|---:|---:|
| 1e-2 | 4.2380e+12 ← garbage |
| 1e-3 | 1.0138e+02 |
| 1e-4 | 5.3603e+01 |
| 1e-5 | 5.1001e+01 |
| 1e-6 | 5.0753e+01 ← converged |

**Eleven orders of magnitude, with no NaN to catch it.** `maxStableStep()` clamps
the substep to `0.02·Λ/(ρ−β)` once ρ > 0.9β. This is not academic: the TRIGA
pulse is deliberately prompt supercritical, so the signature feature of the
project sits exactly in the regime where the naive integrator is wrong and still
convincing.

---

## 3. β must equal Σβᵢ

**A bug found by tracing, not by testing.** The specs declare a β_eff per
variant — TRIGA 0.0070, MSRE 0.00448 — while the tabulated six groups sum to
0.006502. The equations use β in the prompt term and the individual βᵢ in the
precursor sources, and they only balance at steady state if the two agree.

Symptom: the reactor reported **ρ = +49.7 pcm while its power slowly fell.** No
NaN, no warning, every readout finite and plausible. The offset was exactly
`0.0070 − 0.006502 = 0.000498 = 49.8 pcm` — the model's idea of "critical" had
moved by precisely the inconsistency.

`makeConfig()` now rescales the group fractions to match the declared β_eff,
preserving their relative distribution (a fission-yield pattern, not ours to
alter). Regression test: every variant holds steady at ρ = 0 for 200 s.

---

## 4. Decay heat — Way-Wigner

`P/P₀ = 0.066·[t^(−0.2) − (t + t_op)^(−0.2)]`, one year of prior operation.

| Since shutdown | Computed | Reference |
|---|---:|---|
| 1 s | 6.391 % | ~6.5 % |
| 1 min | 2.701 % | ~4 % |
| 1 hour | 1.074 % | ~1 % |
| 1 day | 0.471 % | ~0.5 % |
| 1 month | 0.139 % | ~0.2 % |

The 1-minute figure is the known weakness of the Way-Wigner correlation, which
under-predicts in the 10–100 s band relative to ANS-5.1. Accepted for now, and
recorded here rather than quietly ignored.

---

## 5. Xenon-135

**Peak: 8.49 h after shutdown, 1.897× equilibrium** — verified against the exact
analytic solution of the coupled I/Xe decay.

The first implementation of `timeToXenonPeak()` assumed I and X each decayed on
their own exponential and solved λ_I·I = λ_X·X from the initial ratio. But X is
*fed* by I — that coupling is the entire phenomenon — so it returned **11.29 h
against an exact 8.49 h, a 33 % error**, while looking correct because it landed
inside the "9–11 hours" range every textbook quotes.

It now searches the simulation forward instead, so the prediction cannot drift
from the model it describes.

The peak time is genuinely flux-dependent: at σ_X·φ = 7.8e-5 s⁻¹ (a PWR at
~3e13 n/cm²·s) it is 8.5 h; at 1e14 it moves out to 10.3 h and grows. Quoting a
single number without stating the flux would be false precision.

---

## 6. The startup neutron source

**A bug found by a user, not by a test.** At 73.5 % rods with xenon poisoning the
core subcritical, the panel read **1.19e-50 W** — a power below one neutron in
the history of the universe.

Point kinetics with no source term lets a subcritical core decay toward zero
without limit. Real reactors cannot: an Am-Be capsule plus spontaneous fission in
the fuel keep a population alive, which is exactly why a shut-down core has a
countable count rate at all. The source is installed on purpose.

It was also silently invalidating the 1/M plot. `subcriticalMultiplication` said
the source was being amplified by M = 1/(1−k), but with no source there was
nothing to amplify — the instrument described a measurement the simulation was
not making.

With the source, a subcritical core settles at **n = S·Λ/|ρ|**, which *is*
subcritical multiplication expressed as a population. Measured:

| Rods | ρ (pcm) | M | n | n/n₀ | M/M₀ |
|---:|---:|---:|---:|---:|---:|
| 0 % | −4500 | 23 | 1.003e-8 | 1.00 | 1.00 |
| 30 % | −3757 | 28 | 1.202e-8 | 1.20 | 1.22 |
| 50 % | −2000 | 51 | 2.257e-8 | 2.25 | 2.22 |
| 65 % | −606 | 166 | 7.448e-8 | 7.43 | 7.22 |
| 72 % | −118 | 846 | 3.816e-7 | 38.0 | 36.8 |

The population tracks the multiplication to within a few percent across two
decades, which is the claim the 1/M instrument rests on.

`DEFAULT_CONFIG` keeps `source: 0`, so the inhour validation in §1 is unaffected
— the inhour equation describes a source-free reactor.

---

## 7. Bugs found, and how

Recorded because the pattern matters more than any individual fix: **not one of
these threw an error, failed a build, or produced a NaN the eye could catch.**
Every one rendered a plausible number. Seven of the eleven were found by a person
clicking around, not by the test suite.

| # | Defect | Symptom | Found by |
|---|---|---|---|
| 1 | Prompt-critical denominator flip | 4.2e12 instead of 51 | convergence check |
| 2 | β ≠ Σβᵢ | ρ = +49.7 pcm while power fell | tracing |
| 3 | Xenon peak predictor decoupled from model | 11.29 h vs exact 8.49 h | analytic check |
| 4 | Thermal stepped once per frame, neutronics substepped | NaN across the panel | **user** |
| 5 | No startup neutron source | 1.19e-50 W; 1/M plot measuring nothing | **user** |
| 6 | Scram left the rod indicator at its last position | control disagreed with reactor | **user** |
| 7 | Procedure could dead-end on a decayed xenon gate | stuck at step 7 | **user** |
| 8 | `display:flex` defeated the `[hidden]` attribute | empty trip banner, permanently on | **user** |
| 9 | Procedure advance was level- not edge-triggered | Back button bounced forward | **user** |
| 10 | Controls did not observe automatic trips | bank read 94 % with rods at bottom | **user** |
| 11 | `toFixed(2)` on source-range power | 0.00 W on a live reactor | **user** |

Three of the last four were the same species: the interface confidently
asserting something the simulation disagreed with. In an instrument panel that
is worse than a wrong number — a wrong number invites doubt, a confident wrong
control invites trust.

A twelfth was caught by a test that was itself wrong: asking where a PWR goes
critical with no boron. The answer is "with the rods fully in", because its
21 800 pcm of excess exceeds 8 000 pcm of rod worth. Not a defect — the reason
soluble boron exists.

---

## 8. Stated limitations

Per PLAN.md §9, these are on the page, not buried here:

- **Point kinetics assumes a fixed flux shape.** No spatial effects: no xenon
  oscillation, no flux tilt, no hot channel. The model knows one number for the
  whole core.
- **Two thermal nodes** give the feedback path with the right time constants
  (fuel ~4 s, coolant ~12 s). They are not a temperature map.
- **Cherenkov is shown as visible only for TRIGA**, which is an open pool. A PWR
  core is behind 200 mm of steel; its cutaway is labelled as a diagram
  convention.
- The inhour check validates the solver, **not the physical model** — both
  assume point kinetics. Independent validation of the model itself would need
  comparison against measured startup data.

---

## Reproducing

```bash
npm test
```
