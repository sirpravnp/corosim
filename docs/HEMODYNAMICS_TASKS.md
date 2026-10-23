# Hemodynamics core: task breakdown

Companion to [HEMODYNAMICS_CORE.md](HEMODYNAMICS_CORE.md). The plan is split into tasks an **implementer** agent can do
one at a time, each as one branch and one PR. A **reviewer** agent passes gates (`R-…`) before dependent work starts.

## How to work a task

**Size.** One task is one PR, usually under ~500 changed lines, with its own tests. If a task grows past that, stop and
split it at review.

**Implementer brief** (paste into the session with the task row):

> Read `docs/HEMODYNAMICS_CORE.md` (section named in the task) and the files listed. Implement exactly this task; do not
> start the next one. Match the existing style: constants in `src/config/` tagged `[lit]` or `[assumed]`, doc comments
> that state the equation, no new dependencies. Write the acceptance tests first, then the code. Run `npm run typecheck`
> and `npm test`; both must pass. If an acceptance criterion cannot be met as written, stop and write down why instead
> of loosening the test. In the PR body list: what changed, what each new constant is and where it came from,
> deviations from the plan, open questions.

**Rules for every task**
- Existing tests stay green, unless the task row says a test's expected value is meant to change. Then the PR says which
  test and why.
- Use the regression fixtures (T0.1) to compare before and after; never edit a fixture just to make a test pass.
- Hold the performance budget: engine benchmark (T0.2) ≥ 20× real time in Node for the full adult model.
- Physics in `src/physics/`, constants in `src/config/`, DOM only in page files.
- Every new output gets a unit and range in its doc comment.

**Reviewer gate checklist**
1. Equations match the plan and the cited source; signs and units checked by hand on one case.
2. Numerics: halving dt changes key outputs (MAP, CO, LVEDP, device flow) by < 0.5%. No NaN under the lesion and device
   sweep tests. Stiff elements are smoothed or handled implicitly.
3. Conservation: blood (plus interstitial water once C2 lands) is conserved to < 0.1 ml per minute outside explicit inputs.
4. Teaching direction: each clinical claim in the task has a test, and the test is not tautological (it does not
   assert a constant against itself).
5. Interfaces stay stable for downstream tasks; any change is written into this file.
6. Decide: merge, merge with follow-ups (listed as new tasks here), or send back.

Implementer tasks are marked **I**. Tasks the reviewer should write itself are marked **R★**: architecture decisions where
a wrong call is expensive.

---

## Global order

All phases in one sequence. Tasks in the same wave can run in parallel. Within a wave, tasks that share files (marked ⚠)
merge one at a time. A wave starts once its gate has passed. Status is kept here.

| Wave | Tasks | Gate after | Why here |
|---|---|---|---|
| 1 | T0.1, T0.2 (I) · T0.3, P0 (R★) | R0 | Fixtures, benchmark and contracts protect everything after |
| 2 | A1 · P1 · P3 | none | A1 is the critical path; P1 and P3 do not touch the physics |
| 3 | A2 → A3 → A4 ⚠ (all in `core/`, in order) · A5 · P2 | R-A1, R-P1 | Engine complete for steady use; bridge lets panels start |
| 4 | A6 · P4, P5, P7, P8 · D1 · C1 · B1 | R-D1 | Live heart; panels that need only the bridge; first element of each physics phase |
| 5 | A7 · P6, P9, P10, P11 · D2 · C2 · B2 | R-A2, R-B (numerics of B2) | ACS on core; Impella; fluids in time; septum |
| 6 | P16 · D3 · D5 · C3, C4 · B3 · E1 · P12, P13, P14 | R-P2 | Playground goes live on the core engine; IABP; thorax |
| 7 | E2 → E3 · D4 · D6 · B4 · C5 · P15 | R-E1, R-C, R-B | Coronary supply/demand loop; ECMO; pericardial scenarios |
| 8 | E4 · E5 · E6 · D7 · D8 · F1 | R-D2, R-F1 | Receptor drugs, dynamic valves, O₂ in time; 1D prototype |
| 9 | E7 · E8 · F2 | R-E2, R-P3 | Clinician outputs and explanations; arterial network |
| 10 | F3 · F4 · F6 · F5 (human) | none | Navier–Stokes coupling and visuals |

| Task | Status |
|---|---|
| T0.1 | done |
| T0.2 | done |
| T0.3 | done |
| P0 | done |
| R0 | passed |
| P1 | done (follow-up: `corosim_adjust`, `corosim_compare` and the share-link tool still take the plain Scenario schema) |
| P3 | done (workspace + numbers panel on a stub source; monitor and ECG move in P3b) |
| P2 | done (bridge; LAD LVEDP 17.6 / PCWP 16.8 / EF 0.30; RV infarct CVP 10.7, CVP/PCWP 1.3; paced RV infarct CVP 7.6 is a known limit until C1/A7) |
| P2b | done (worker solves; on the Simulator page; LAD occlusion on the live panel: PCWP 7 → 18, LVEDP 6 → 19, LVEF 62 → 31 %) |
| R-P1 | passed (limits panels must respect: bridge EDV/ESV/SV and valve stats do not vary beat to beat with RR; numbers are NaN until the first worker solve lands) |
| P7 | done (RV infarct: PAPi 0.21, RA/PCWP 1.35; ASD atrial and VSD ventricular step-ups; PVR/SVR equal the engine) |
| P4 | done (live left/right traces; LAD occlusion: LA 10/4 → 20/11) |
| P5 | done (PV loops with ghost; LAD: SV 68 → 40 ml, EF 62 → 31 %, EDP 6 → 19) |
| P8 | done (severe AS Gorlin 0.70 vs model 0.73 cm²; mean gradients equal the engine's) |
| Follow-ups for R-P2 | (1) bridge `trace()` can return samples whose time steps backwards after a reload or a rate change (P4 lifts the pen; fix at the source); (2) left-heart Hakki area shows nonsense at tiny gradients (6.6 cm² at 1 mmHg): show – below ~10 mmHg; (3) `tests/live.test.ts` restart test times out (5 s) when the machine is saturated; passes alone in 1.3 s |
| A1 | done (max difference from `simulate()` 2e-4, from exact atrial event timing; core 164× real time vs 129×) |
| A2 | done (structural tab on the core; old RK4 loop removed; reference frozen in `tests/fixtures/core-reference.json`) |
| A3 | done (+6 mmHg pericardial pressure halves SV; mitral flow lags its gradient by 44 ms; E/A separates at 60 bpm, not yet at 72; A2 follow-ups done) |
| A4 | done (E/A 1.5 and LV τ 36 ms at 72 bpm; PVC SV 12 ml then 89 ml after the pause; new defaults reviewed; benchmark change within machine-load noise when interleaved with the pre-A4 commit) |
| A5 | done (adult MAP 90.1, PP 43.9, CVP 4.2, PCWP 8.7, CO 5.12, EF 0.62, E/A 1.37, τ 37 ms; MSFP 7.9; neonate near its baseline) |
| R-A1 | passed: inertance on by default (task A5b); neonate E/A 0.7–0.8 accepted (normal in the first days of life); `periodic()` stops ~0.5 % short on slow venous refilling, for C1 to address |
| A5b | in progress |
| P2c | done (bridge trace time strictly increasing; reload clears the bridge; valve areas only with a real gradient; gross-flow Gorlin test) |
| P6 | done (JVP: cannon a 2.6× in AV dissociation; giant v in severe TR; RV infarct raised JVP 9.9 cm on the live page; tamponade/constriction tests wait for B1) |
| B1 | done (tamponade: 300 ml equalises RA/RVEDP/LA/LVEDP within 0.2 mmHg, CO 5.1 → 0.3; draining 200 ml restores 81 %; slow effusion better tolerated; stable to stiffness 10) |
| D1 | done (rotary pump: HQ fit, smooth bounded suction, backflow when stopped) |
| R-D1 | passed (decisions below) |

**Branches.** Each task is built on a local branch `task/<ID>` in its own worktree, reviewed, then merged into the
working branch, which is the only one pushed.

## Phase 0: groundwork

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| T0.1 | I | **Regression fixtures.** Snapshot `analyze()` for every lesion in `src/sim/structural.ts` at default sliders (pressures, sats, flows, valve stats), plus 60 s traces of MAP/HR/SV for each ACS scenario at a fixed seed. Add a test that compares against them with stated tolerances. | none | `tests/fixtures/`, `tests/regression.test.ts` | Test passes on main; fixtures are JSON and regenerated by a script, never by hand |
| T0.2 | I | **Benchmark harness.** `scripts/bench-engine.ts`: simulated seconds per wall second for `simulate()` on adult and neonate. | none | `scripts/` | Prints a number; documented in this file |
| T0.3 | R★ | **Core interfaces.** Write `src/physics/core/types.ts` and `core/README.md`: state registry, `Element` interface (declares its states, adds derivatives, reads node pressures), node kinds, external-pressure hook, event input (beats), parameter-update API, output taps. No behaviour. | none | `src/physics/core/` | Typechecks; reviewed against every later phase's needs |

**Fixtures (T0.1).** Regenerate with `npx tsx scripts/regen-fixtures.ts`, never by hand; the fixture diff is part of review.

**Benchmark (T0.2).** `npx tsx scripts/bench-engine.ts [--json]`. Baseline on the machine that wrote it (Node 22, one core; yours will differ), median of 5 runs after a warm-up: structural `analyze()` runs 110x real time for the adult normal heart, 145x neonate, 134x tetralogy of Fallot (about 2.2-2.9e5 RK4 steps/s); the headless `Simulation` runs 60 s in ~0.1 s (about 600-730x real time). The adult figure includes volume-offset calibration.

**Gate R0:** T0.1–T0.3 merged.

## Phase A: core engine

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| A1 | I | **Port the graph solver into core.** Chambers, compliances, valves, orifices and resistors become `Element`s; RK4 `step(dt)`; `periodic()` runs to steady state as `simulate()` does now. | R0 | `core/engine.ts`, `core/graph.ts`, `core/chamber.ts`, `core/valves.ts` | Same structural outputs as T0.1 fixtures within 0.5% |
| A2 | I | **Structural on core.** `structural.ts` builds a core graph; `simulate()` becomes a thin adapter. Oxygen solve unchanged. | A1 | `physics/structural.ts` | All `tests/structural*.test.ts` and fixtures pass; benchmark not slower than 1.5× old |
| A3 | I | **External pressure and inertance.** Nodes take an external pressure (used later by the pericardium and thorax); inertial edge type; valve with inertance, off by default. | A1 | `core/` | With inertance off, fixtures unchanged; with it on, a test shows valve flow lagging pressure and an E/A-shaped mitral flow |
| A4 | I | **Event-driven activation and relaxation.** Activation starts from a beat event (ventricular, atrial) instead of a fixed period; separate relaxation time τ after peak; `periodic()` still works by feeding regular events. | A1 | `core/chamber.ts` | Fixed-rate events reproduce fixtures; longer τ raises early-diastolic pressure and lowers early filling; a premature event gives a smaller stroke |
| A5 | I | **Vessels.** 3-element Windkessel (Zc, R, C) for the systemic and pulmonary arteries; split systemic veins into splanchnic and peripheral with unstressed volume. Recalibrate the baseline volume offset. | A1 | `core/vessels.ts`, `config/structural.ts` | Normal adult: MAP 90 ± 2, pulse pressure 40–50, CVP 3–6, PCWP 6–10, CO 4.8–5.4; fixtures updated **only** for the expected pulse-shape change, listed in the PR |

**Decisions from A1 review** (binding on later tasks):
- `createEngine`'s `options.atrialLead` and `options.converge` stay for now. A4 moves atrial timing into the events: the rhythm
  model, or `periodic()` for steady reports, schedules the atrial event, and `periodic(hr, { pr })` replaces `atrialLead`.
  That contract change is allowed in A4.
- The ventricular chamber's beat-period parameter `T` goes away in A4: activation depends only on time since the event,
  with duration from a rate-dependent rule (QT-like shortening with the preceding RR).
- `BeatRecorder` finds beat boundaries from `T`; A6 switches it to ventricular events.
- A4 must give E > A at 72 bpm with inertance on (A3 found one merged filling wave at 72: early filling is still running when the atrium contracts). Inertance stays off by default until A5 recalibrates the baseline with it on; R-A1 decides.
- From A4 review: the atrial active-elastance factor (×3) lives in `ACTIVATION` and is applied by `fromModel`, so `Model.chambers` still holds the old design value. A5 folds it into `buildModel` so the Model says what the engine runs (the frozen-reference pinned config keeps its own legacy factor). A5 also adds neonate checks (E/A, τ) on the new defaults, which only the frozen reference covers now.
- A4 also removes `ventShape()` and `Model.ventPeak` from `structural.ts` (dead since A2).
- An element calls `flow()` once per evaluation. A device with two paths (e.g. a pump and its cannula leak) is two elements.

**Gate R-A1 (reviewer):** numerics (dt halving, stiffness), interfaces, calibration. Decide whether inertance is on by
default.

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| A6 | I | **Live adapter.** `LiveHeart` class: takes `Beat`s from `ecg.ts`, steps the engine between them, emits a per-beat record compatible with `BeatHemo` (SV, systolic, diastolic) plus full traces. Autonomic effects map to HR (via beats), Ees, arterial R, unstressed volume, τ. | A4, A5 | `core/live.ts` | PVC → small beat then potentiated beat; 3rd-degree block → lower CO; AF → beat-to-beat SV varies with RR; baroreflex loop stays stable (no runaway) over 10 min with noise |
| A7 | I | **ACS sim on core, behind a flag.** `simulation.ts` gets `engine: "legacy" \| "core"`. For now ischemic fraction scales global LV/RV Ees, and support maps to the closest engine parameters. | A6 | `sim/simulation.ts`, `tests/simulation.test.ts` | With `core`: anterior STEMI → SV down, LVEDP up; RV infarct → RAP up, PCWP not up, hypotension that responds to fluid; legacy tests unchanged |

**Gate R-A2 (reviewer):** compare legacy and core side by side on every scenario. Decide the flag default and list the
scenario recalibrations as tasks.

## Phase C: fluids

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| C1 | I | **Stressed/unstressed accounting.** Report stressed volume and mean systemic filling pressure (pressure after a simulated stop-flow). Venoconstriction parameter moves unstressed to stressed volume; wire it from sympathetic tone. | A5 | `core/vessels.ts`, `core/outputs.ts` | MSFP 7–10 mmHg in a normal adult; venoconstriction raises MSFP and CO; total volume unchanged |
| C2 | I | **Fluid compartments.** Slow ODE in **clinical minutes** (the sim's `minutesPerSecond` clock, not the beat clock): plasma ↔ interstitium by Starling (capillary pressure, oncotic pressure); give crystalloid, colloid or blood; hemorrhage rate; diuresis; capillary-leak factor. Hb dilutes and concentrates. | C1 | `core/fluids.ts`, `config/` | 1 L crystalloid: 20–30% intravascular at 30 min; 500 ml albumin: > 80% at 30 min; blood restores Hb; conservation of total water |
| C3 | I | **Lung water.** Pulmonary capillary pressure above a threshold fills lung interstitium; it lowers `satLung` and slowly clears. Replaces `congestionGain`. | C2 | `core/fluids.ts`, `physics/structural.ts` | PCWP 30 for 20 clinical min drops SpO₂ by a few points; PCWP 10 leaves it unchanged |
| C4 | I | **Fluid-responsiveness outputs.** Passive leg raise (reversible ~300 ml unstressed→stressed); mini-bolus; Starling-curve position (dSV/dEDV); data for a Guyton plot (venous return curve and cardiac function curve at the operating point). | C1 | `core/outputs.ts` | PLR raises SV in a hypovolemic patient, barely in a congested one; curves cross at the live operating point |
| C5 | I | **Guyton plot and fluid controls in the UI.** | C4, A7 | page files | Visual check; no physics in the page |

**Gate R-C (reviewer):** conservation, the two clocks (beats and clinical minutes) interacting correctly, calibration.

## Phase D: mechanical circulatory support

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| D1 | I | **Generic rotary pump element.** `L·dQ/dt = H(ω,Q) − (P_out − P_in) − R_in(P_in, V_in)·Q`, `H = aω² − bωQ − cQ\|Q\|`; inflow resistance rising steeply as inflow pressure or volume collapses (suction). Tested alone between fixed pressures, then between two compliances. | A3 | `core/devices/pump.ts` | Reproduces a supplied HQ table within 5%; flow falls as ΔP rises; suction trips as inflow volume nears V0; no chatter at dt halving |

**Gate R-D1 (reviewer):** pump formulation, suction law, how HQ coefficients are sourced and tagged.

**Decisions from R-D1 review** (bind D2 and later devices):
- The inflow must not pull a chamber below a collapse floor. Chamber passive laws do not stop volume falling, so each device's
  suction law is set relative to the inflow chamber's own unloaded volume (V0), and flow is softly limited so the inflow volume
  stays above that floor. D1's generic drain test dipped to about −1 to −2 ml on a bare compliance; that is not acceptable on a chamber.
- Motor current is defined in D2: proportional to hydraulic torque (head·Q/ω) plus a speed-dependent loss term, so its waveform
  carries the LV–aortic pressure difference (the placement signal). Constants [assumed] unless sourced.
- Reverse flow sees only R0: acceptable.
- Inertance: L = ρℓ/A of the cannula (Impella-like: ℓ ≈ 13 cm, d ≈ 4 mm gives about 0.08 mmHg·s²/ml), per device.

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| D2 | I | **Impella 2.5 / CP / 5.5.** Device definitions (P-level → speed, HQ coefficients `[assumed]` until sourced), LV→ascending-aorta placement; console outputs: flow, motor current (∝ hydraulic load), placement signal, pulsatility, suction alarm. | R-D1 | `core/devices/impella.ts`, `config/devices.ts` | In cardiogenic shock: MAP up, LVEDP and LV EDV down, PVA down, pulse pressure narrower; at high P-level the aortic valve stops opening; hypovolemia → suction alarm |
| D3 | I | **Impella in the ACS sim.** Replace `impellaFlow`/`impellaNativeSv`/`impellaRvSuction` with the device; P-level control in management; device output in MCP tools. | D2, A7 | `sim/`, `physics/support.ts`, `mcp/tools.ts` | Old Impella tests rewritten as direction tests and passing on core; legacy path untouched |
| D4 | I | **Impella malposition and RV failure scenarios.** Inflow in the aorta (recirculation, no unloading, abnormal placement signal); RV infarct starving the pump. | D3 | `sim/scenario.ts`, `core/devices/impella.ts` | Malposition: unloading lost, placement signal changes; RV failure: flow falls, alarm |
| D5 | I | **IABP.** Balloon volume as a time-varying volume in the descending aorta; inflate at the dicrotic notch, deflate before the R wave (from ECG beats); 1:1, 1:2, 1:3; adjustable timing offsets. | A6 | `core/devices/iabp.ts` | Diastolic augmentation and lower assisted end-diastolic pressure; 5–10% systolic unloading; early inflation, late deflation etc. each produce their textbook waveform (asserted on trace features); replaces `iabpStrokeVolume`/`iabpCoronaryAug` |
| D6 | I | **VA-ECMO.** Centrifugal pump RA/IVC → descending aorta; oxygenator resistance; return saturation from sweep and FiO₂ (needs E6 for oxygen in time: until then, steady O₂ solve per beat-block). | D1, A5 | `core/devices/ecmo.ts` | Without a vent: LVEDP and PCWP rise, aortic valve opening falls with flow; low RA volume → drainage chatter; poor native lungs → upper-body sat < lower-body sat |
| D7 | I | **Venting and right support.** ECPELLA, IABP on ECMO, atrial septostomy (existing ASD edge), Impella RP (IVC→PA), BiPella. | D2, D6 | `core/devices/` | Each vent lowers LVEDP on ECMO; Impella RP raises PA flow and lowers RAP in RV failure |
| D8 | I | **Device consoles and PV loops on the ACS screen.** | D3, D5 | page files | Visual check; consoles read from engine outputs only |

**Gate R-D2 (reviewer):** device behaviour against published studies (CORE §4D); clinical correctness of alarms and
waveforms; MCP schema versioning.

## Phase B: pericardium and interaction

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| B1 | I | **Pericardial sac.** P_peri = f(V_heart + V_effusion), exponential; applied as external pressure on the four chambers; effusion volume and inflow rate; pericardiocentesis removes ml. | A3 | `core/pericardium.ts` | Normal: P_peri ≈ 0; tamponade: RAP ≈ RVEDP ≈ PCWP within 5 mmHg, CO down; removing 100–200 ml restores most of CO; a slow effusion tolerates more volume than a fast one |
| B2 | I | **Septal interaction** (also owns constriction equalisation: RVEDP ≈ LVEDP within 3 mmHg at constrictive stiffness, which the sac alone reaches only at stiffness 10)**.** Septal volume solved each step so septal transmural pressure balances P_LV − P_RV (Santamore–Burkhoff / Smith–Chase style). The implementer writes it; **the reviewer checks numerics before merge.** | B1 | `core/pericardium.ts`, `core/chamber.ts` | RV pressure load → LV EDV falls at the same LV filling pressure; turning the septum off reproduces B1 results |
| B3 | I | **Intrathoracic pressure.** P_th from the breathing phase in `autonomic.ts`, applied to the pericardium, pulmonary vessels, thoracic aorta and SVC; spontaneous vs positive-pressure ventilation; PEEP. Outputs: PPV, SVV. | B1, A6 | `core/thorax.ts`, `physics/autonomic.ts` | Normal: pulsus < 10 mmHg; tamponade: pulsus > 10; PPV large in hypovolemia under positive pressure, small when euvolemic |
| B4 | I | **Scenarios.** Tamponade (with the existing ECG alternans preset tied to effusion size), constriction (stiff sac, no effusion: steep y descent, Kussmaul), RV infarct with septal shift; pericardiocentesis as an action. | B2, B3 | `sim/scenario.ts`, `ekg/presets.ts` link | Each listed sign asserted on traces |

**Gate R-B (reviewer):** stiffness and stability (B2 is the riskiest numerics in the plan), signs against textbook
criteria.

## Phase E: nuanced hemodynamics

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| E1 | I | **PVA, MVO₂ and loop metrics.** Pure functions on a beat's LV trace: stroke work, PVA, MVO₂ (Suga: a·PVA + b·Ees + basal), Ea, Ees, Ea/Ees, dP/dt max, τ, cardiac power output. | A6 | `core/outputs.ts` | Hand-computed rectangle and trapezoid loops; normal Ea/Ees 0.5–1.2 |
| E2 | I | **Coronary coupling.** Per beat, drive `hemodynamics.ts` with diastolic aortic pressure, diastolic time fraction, LVEDP (back-pressure) and intramyocardial pressure, instead of fixed `meanAorticPressure`. | E1, A7 | `physics/hemodynamics.ts`, `core/coronary.ts` | Tachycardia and high LVEDP lower subendocardial supply; IABP raises it; FFR results at default patient unchanged within 0.01 |
| E3 | I | **Regional segments and the supply/demand loop.** LV split into segments mapped to beds (`ecgLink.ts` sites); ischemia from supply/demand per bed sets segment active elastance; an ischemic segment bulges (dead volume). Replaces global Ees scaling from A7 and `demandFactor()`. | E2 | `core/chamber.ts`, `sim/simulation.ts` | A shock spiral emerges in a large anterior MI without support and is interrupted by an Impella; no oscillation or divergence at default settings |

**Gate R-E1 (reviewer):** loop stability, calibration of the spiral against the scenarios' teaching timeline.

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| E4 | I | **Receptor-level drugs.** `drugs.ts`: norepinephrine, epinephrine, dobutamine, milrinone, vasopressin, nitroglycerin, nitroprusside, β-blocker, furosemide → α₁/β₁/β₂/V₁/NO effects on R, unstressed volume, Ees, HR, τ; first-order onset and offset. Map today's `Support` doses onto it; remove the `SUPPORT` multipliers. | A7, C1 | `core/drugs.ts`, `config/management.ts`, `physics/support.ts` | Norepi raises MSFP and MAP; nitro lowers preload before afterload; milrinone shortens τ; `tests/management.test.ts` direction tests pass on core |
| E5 | I | **Dynamic valves.** Functional MR from LV dilation (annulus scales with EDV); ischemic MR from inferoposterior segment dysfunction. | E3 | `core/valves.ts` | Dilated LV → regurgitant volume rises; inferior MI → new MR; normal heart unchanged |
| E6 | I | **Oxygen in time.** Generalise the structural O₂ solve to a time-stepped transport; DO₂, VO₂, SvO₂, lactate when DO₂ falls below critical; SCAI stage from the state. | A6, C2 | `core/oxygen.ts` | Steady results match the old solve within 1%; low CO raises lactate over clinical minutes; ECMO return sat flows through |
| E7 | I | **Clinician outputs.** PA-catheter waveforms (CVP a/v, wedge v waves), thermodilution CO, PAPi, SvO₂ and E1 metrics exposed to the cath tab and MCP tools. | E1, E6 | `sim/cath.ts`, `mcp/tools.ts` | Large v wave in MR; PAPi low in RV infarct |
| E8 | I | **Explanations.** `advice.ts` and `explain.ts` read engine quantities (PVA, filling pressures, pump flow, MSFP) instead of removed multipliers. | E4 | `physics/advice.ts`, `sim/explain.ts` | Each explanation references a value that exists; existing explain tests updated with reasons |

**Gate R-E2 (reviewer):** end-to-end clinical review of every scenario; retire the legacy engine or keep it as a fast mode.

## Phase F: Navier–Stokes

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| F1 | I | **1D solver prototype, standalone.** Area/flow equations with tube law and friction on a single tube; explicit scheme (MacCormack to start); reflecting and Windkessel outlets. | none (after R0) | `src/physics/oneD/` | Wave speed matches the analytical c within 2%; a reflected wave returns at 2L/c; mass conserved; benchmark ≥ 20× real time for 50 segments |

**Gate R-F1 (reviewer):** scheme choice (MacCormack vs DG), stability limits, coupling interface.

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| F2 | I | **Arterial network.** Aorta and major branches from a published network (parameters tagged `[lit]`), junction conditions, Windkessel outlets. | R-F1 | `oneD/network.ts`, `config/` | Pressure amplification aorta→radial; waveforms qualitatively match the source paper's figures |
| F3 | I | **Couple to core.** Optional replacement of the AO/DAO compartments by the 1D aorta; IABP as displacement in a 1D segment; ECMO return at the femoral end; saturation advected along the aorta so the mixing point moves. | F2, D5, D6 | `oneD/`, `core/` | With 1D on, MAP/CO within 3% of 0D; the ECMO mixing point moves toward the arch as native output falls |
| F4 | I | **1D coronaries** on `src/anatomy/tree.ts` with intramyocardial pressure. | F2, E2 | `oneD/coronary.ts` | Diastolic-dominant LAD flow, more systolic RCA flow; FFR consistent with `hemodynamics.ts` |
| F5 | human | **Offline CFD calibration** (SimVascular svSolver / svOneDSolver): validate F2 against svOneDSolver on the same network; fit stenosis and device loss coefficients from 3D runs. Needs desktop or HPC tooling, not an agent session. | F2 | `docs/`, `config/` | Tables committed with provenance |
| F6 | I | **WebGPU lattice-Boltzmann visual spike** (optional): 2D stenosis jet with inflow from the engine. | A6 | `spikes/` | Runs at interactive rate; clearly marked as a visual |

## Phase P: the simulator as a full playground

See CORE §4G. Panels read only from `HemoSource`, so they survive the engine swap.

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| P0 | R★ | **`PatientSpec` and `HemoSource` contracts.** One spec merging `Scenario`, `StructuralSpec`, support, fluids and pericardium. A source interface with taps: node traces, chamber volumes, loops, saturations, beat events, cath readings, device consoles. A panel contract: mount, subscribe to taps, resize, dispose. | none | `src/sim/patient.ts`, `src/sim/hemoSource.ts` | Typechecks; covers every panel below and the core engine's outputs |
| P1 | I | **Unified encoding.** `PatientSpec` ↔ URL hash and MCP; old `#s=` simulator links and `#lesion=` structural links still decode. | P0 | `sim/llm.ts`, `sim/scenario.ts`, `mcp/tools.ts` | Round-trip tests; every old link fixture decodes to the same patient |
| P2 | I | **Bridge `HemoSource` over today's engines.** Structural engine solved with the ACS state applied (ischemic fraction scales LV/RV Ees, HR from the rhythm), re-solved every few seconds or on change; waveform replayed per beat, aligned to ECG beats. | P0, T0.1 | `sim/bridgeSource.ts` | Anterior STEMI raises LVEDP and lowers SV on the traces; MAP within 5 mmHg of the monitor's; no visible jump at a re-solve |
| P2b | I | **Bridge in a worker, on the page.** Move the bridge's solves (`analyze` + calibration) into a Web Worker so the main thread never blocks; the page swaps the stub source for the bridge. | P2, P3 | `src/sim/bridgeSource.ts`, new worker module, `src/app.ts` | No main-thread task over 50 ms from the bridge (measured in Chromium); numbers panel shows the simulator's patient and follows an occlusion; game page unchanged; existing bridge tests pass headless |
| P3 | I | **Panel workspace on the Simulator page.** Grid on desktop, tabs on phones, a panel picker, layout remembered per browser (in try/catch). Existing monitor and ECG become panels. | P0 | `src/app.ts`, `sim/index.html`, new `src/panels/` | Visual check at desktop and 375 px width; no physics in panels |
| P3b | I | **Monitor and ECG as panels.** Move the Simulator page's existing monitor and ECG strip into the workspace without changing what they show. Split out of P3 to keep `src/app.ts` changes small. | P3 | `src/app.ts`, `src/panels/` | Same readings and ECG as before; game page unchanged |

**Split for parallel work (R-P1):** P7 and P8 put their pure functions in new files (`src/sim/rightHeartCath.ts`,
`src/sim/leftHeartCath.ts`) rather than `src/sim/cath.ts`, and add only the Simulator-page panels. The cath-page tabs for
both become **P7c**, done after both merge.

**Gate R-P1 (reviewer):** contracts, bridge fidelity and the panel framework before panel work fans out.

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| P4 | I | **Hemodynamic traces panel.** Left and right sides, scrolling live; reuse `structural/traces.ts` drawing. | R-P1 | `src/panels/traces.ts` | Shows the same values as the structural tab for the same lesion (bridge) |
| P5 | I | **PV loops panel.** LV, RV, LA, RA; end-systolic and end-diastolic lines; save a loop as a ghost for comparison. | R-P1 | `src/panels/loops.ts` | Loop area and EDV/ESV match the source's numbers |
| P6 | I | **JVP panel.** Pure module: from the RA trace and beat events, find a, c, x, v, y; height in cm H₂O above the sternal angle (RAP × 1.36 − 5); neck illustration pulsing with the waveform. | R-P1 | `src/physics/jvp.ts`, `src/panels/jvp.ts` | Tests on synthetic and engine traces: no a wave in AF; giant v in severe TR; raised flat trace in tamponade (after B1); cannon a in complete heart block (after A4; marked pending until then) |
| P7 | I | **Right-heart cath.** Pure functions: pullback waveforms, oximetry run with step-up (≥ 7% atrial, ≥ 5% ventricular/PA), Fick and thermodilution CO, PVR, SVR, Qp:Qs, PAPi, CPO. Panel in the simulator; same report on the cath page as a new tab. | R-P1 | `sim/cath.ts`, `src/panels/rhc.ts`, `cath/` | ASD shows an atrial step-up and Qp:Qs ≈ the engine's; RV infarct gives low PAPi; numbers equal the structural report's |
| P8 | I | **Left-heart cath.** LV → aorta pullback, LVEDP, peak-to-peak, mean and peak instantaneous gradients, Gorlin and Hakki areas, simultaneous LV–wedge for MS. Panel and cath-page tab. | R-P1 | `sim/cath.ts`, `src/panels/lhc.ts`, `cath/` | Severe AS: Gorlin area within 10% of the model's valve area; mean gradient matches `ValveStat` |
| P7c | I | **Heart-cath tabs on the cath page.** Right- and left-heart cath reports (P7, P8) as tabs on `cath/` beside angio and wire, for the cath page's patient. | P7, P8 | `src/cath/`, `cath/index.html` | Same numbers as the simulator panels for the same patient |
| P9 | I | **O₂ sat mode in the 3D view.** New mode beside Anatomic / Territory / Pressure / Velocity / Wall shear: vessels by arterial sat, myocardium by per-bed tissue oxygenation (v1: derived from ischemia severity and labelled as such), chambers with the structural colour scale; legend. | R-P1 | `src/app.ts` (mode switch around `shapeVessels`), `structural/heartView.ts` (`satColor`) | Occluded LAD territory turns blue; a right-to-left shunt lowers vessel colour everywhere; legend matches the mesh |
| P10 | I | **O₂ panel.** SpO₂ pleth, SaO₂ pre/post-ductal, SvO₂, DO₂, VO₂, Qp:Qs; lactate after E6; ECMO return sat after D6. | R-P1 | `src/panels/oxygen.ts` | Values equal the source's |
| P11 | I | **Structural props in the simulator's heart.** Valves, septal defects and jets from `structural/props.ts`, toggled. | R-P1 | `src/app.ts`, `structural/props.ts` | A VSD in playground mode shows the defect and jet |

**Gate R-P2 (reviewer):** clinical review of JVP, right- and left-heart cath numbers and the O₂ view against textbook
criteria.

| ID | Who | Task | Depends | Files | Acceptance |
|---|---|---|---|---|---|
| P12 | I | **Playground mode.** Unlocks every control on one patient: coronary and structural lesions, rhythm, drugs, fluids, devices, pericardium, patient kind (neonates without the coronary view). Preset library mixing them. | P1, R-P2 | `src/app.ts`, `sim/presets.ts` | Every preset loads, converges and round-trips through a share link |
| P13 | I | **Time controls, snapshots, export.** Pause, slow motion, step one beat; save a snapshot and overlay it on traces and loops; CSV export of traces. | P4, P5 | `src/panels/` | Stepping one beat advances exactly one ventricular beat; the CSV matches the drawn data |
| P14 | I | **Cross-page links.** "Open in cath lab / echo / structural / EKG" carries the `PatientSpec`. | P1 | `shell/`, page files | Each page opens the same patient |
| P15 | I | **MCP tools.** Expose JVP, right- and left-heart cath and O₂ readings. | P6–P10 | `mcp/tools.ts` | Tool tests on two scenarios |
| P16 | I | **Switch to the core engine.** `HemoSource` from `LiveHeart` (A6/A7); delete the bridge; cannon a waves and other beat-level signs go live. | A7, P2 | `sim/` | All P tests pass on core; pending JVP tests enabled |

**Gate R-P3 (reviewer):** UX and performance: 60 fps with every panel open; phone layout; nothing a page shows is
computed in the page.

## Order at a glance

```
T0.1 T0.2 T0.3 → R0 → A1 → A2, A3, A4, A5 → R-A1 → A6 → A7 → R-A2
                                   A3 → D1 → R-D1 → D2 → D3 → D4
                                   A5 → C1 → C2 → C3 ; C1 → C4 → C5 → R-C
                                   A6 → D5 ; D1+A5 → D6 → D7 ; D3+D5 → D8 → R-D2
                                   A3 → B1 → B2 ; B1+A6 → B3 ; → B4 → R-B
                                   A6 → E1 → E2 → E3 → R-E1 → E4, E5, E6 → E7 → E8 → R-E2
                      R0 → F1 → R-F1 → F2 → F3, F4 ; F2 → F5
P0 → P1, P2, P3 → R-P1 → P4 … P11 → R-P2 → P12, P13, P14, P15 ; A7 + P2 → P16 → R-P3
```

Phase P needs only T0.1 from the engine work (for P2), so it can run alongside Phase A from the start.

After R-A1, phases B, C and D can run in parallel on separate branches. They touch different files, apart from
`core/outputs.ts`, which should be merged in small pieces.
