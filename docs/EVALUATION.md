# Evaluating the CoroSim solver and engine

Status: the core engine has been run (8 seeds on deterministic states, 24 on the four stochastic ones, one seed on every patient-field value). Expectation cells are still blank. The snapshot is `docs/EVAL_REPORT.md` (31 Oct 2026, 6:54 PM EDT, commit `4b7b4f7`). Nightly job: `.github/workflows/eval.yml`, not a deploy gate.

## Goal

Know, variable by variable and over time, whether the core engine does what a clinician says it should, across standard and edge cases and across seeds. The engine is DOM-free (`src/sim/Simulation`), so all of this runs headless in Node: no site, no browser.

## Approach: a specification matrix

A spec is: **specified state × variable × time → expected change.** The user writes the expectations; the runner measures the engine and reports where they disagree.

- **Variables:** 241, each with one canonical source, unit and panel (`scripts/eval/variables.ts`). The original monitor, hemodynamics, oxygen, coronary, ECG, rhythm, arrest, fluids, drugs, devices, autonomic and cath panels, plus PV-loop metrics, JVP, respiratory variation, pericardium, ECMO, Impella RP, and per-valve and shunt readings.
- **States:** `scripts/eval/states.ts`. Each starts from the same settled healthy adult, applies the insult with `Simulation.apply` (as the page does), then records every variable at checkpoints. Default checkpoints are 5, 20, 60 and 180 simulated seconds after the insult (= 10 min, 40 min, 2 h, 6 h clinical, at 2 clinical min per second). A state can set its own checkpoints and timed actions (e.g. PCI at 10 s).
- **Expectation grammar:** `scripts/eval/grammar.ts`. A cell is one of `60..80` (absolute), `d+10..+30` (change from the same seed's baseline), `x1.2..x1.5` (ratio), `up`/`down`/`same`, `true`/`false`, `~regex`, or `p0.4..0.7` (share of seeds, for stochastic outcomes). Blank, `-` or `?` means no opinion. A cell passes when at least 80% of seeds satisfy it.
- **Seeds:** every state runs on several seeds; the seed varies the baseline noise and every stochastic process.

## Commands

```bash
npx tsx scripts/eval/run.ts list                          # --suite standard,edge,valve,stochastic,sweep
npx tsx scripts/eval/run.ts template healthy --observed   # blank expectations; seen_* is the last observed mean, and check ignores it
npx tsx scripts/eval/run.ts observe --seeds 8 --jobs 4    # default suites; --suite sweep or --suite all for the field sweep; --shard i/n
npx tsx scripts/eval/run.ts check --invariants-only       # expectations, then invariants; exit 1 on either. Cross-checks are logged only
npx tsx scripts/eval/run.ts report                        # scripts/eval/out/REPORT.md
npx tsx scripts/eval/run.ts timescale                     # hemorrhage, bleed and LAD occlusion at 1x/3x/6x
```

`observe` writes `scripts/eval/out/<state>.observed.csv` (mean and min..max per cell) and raw per-seed JSON. A state with `seeds` set (the four stochastic states) ignores `--seeds`. ECMO and Impella RP are inserted with `setPatient`, because `apply` only retunes a circuit that is already in the heart.

## Plan

1. **Write expectations (owner: user).** Fill the template CSVs for the highest-value states first: healthy, LAD/RCA/LM occlusion, the three hemorrhage classes, norepinephrine, dobutamine. Fill only cells with an opinion, and put the source or reasoning in the note column.
2. **First full run.** `observe` at 8 seeds over all 24 states (about 10 minutes of compute; 24 seeds for stochastic outcomes), then `check`. Triage every failure as a model bug, a wrong expectation, or an ambiguous variable definition.
3. **Widen coverage.**
   - Registry: PV-loop metrics, JVP, and the valve, shunt and congenital readings (same core engine, driven without reflexes by `analyze()`; see "Which engine is under test").
   - Edge states: multivessel disease, invalid and extreme inputs (stenosis outside 0..1, NaN, odd seeds), all 9 anatomy variants, drug and device combinations.
   - Invariants on every state: no NaN, MAP between DBP and SBP, fractions within 0..1, volumes conserved.
   - Time-scale invariance: the same event gives the same outcome at 1×, 3× and 6×.
4. **Lock in.** Turn passing specs into a CI job modeled on `.github/workflows/tests-slow.yml`, so a model change that moves a number outside the spec fails visibly. Fixture changes need a stated reason in the PR.

## Which engine is under test

"One solver" is true for the Simulator page's hemodynamics, but the code base has more than one path (verified from the source):

| Path | What it is | Used by |
|---|---|---|
| `core` engine | `LiveHeart`: beat-by-beat chamber/vessel model (`src/physics/core/`) | Simulator page (`src/page/state.ts`), cath lab page. **This is what the harness runs.** |
| `legacy` engine | algebraic `circulation()` plus a per-beat Windkessel | `new Simulation()` defaults to it: the EKG page, a fresh MCP server (until `corosim_set_scenario` is given `engine: "core"`), regression fixtures |
| structural model, driven statically | `analyze()` / `simulate()` in `src/physics/structural.ts` | Structural tab, neonates, `structural.json` fixtures. **Not a separate solver:** since task A2 `simulate()` runs the core engine on the same chambers, vessels and valves, with a fixed rate and no reflexes, ischemia or rhythm model |

The core engine is not fully independent of the legacy one. It still calls legacy `circulation()` for the ischemic fractions, the rate the rhythm implies and the oxygen-demand factor, and the ischemia, infarct, rhythm, ECG and coronary-network modules are shared by both engines. Before the first live beat, circulation values (including EF) are the legacy estimate.

Harness guards: every run asserts `engine === "core"` and an empty `coreNote`. `coreNote` is set when the core cannot settle a patient and the page silently shows a plain adult instead, which would make a run meaningless.

## Why one variable (EF) has several values

There are three definitions of LV ejection fraction in the engine, and they are not the same quantity:

| Name in the registry | Definition | Shown by |
|---|---|---|
| `lvEf` | (EDV - ESV) / EDV of the LV **chamber volume**, over steady beats (premature beats and the beats after them excluded) in a short window | Monitor, Hemodynamics (`LiveSource.numbers`) |
| `lvEfEstimate` | **aortic-valve** stroke volume / LV EDV of **every** beat, exponentially smoothed (`sm.ef`, `ACS_CORE.smoothTau`) | ischemia panel, MCP state, explain text, cath-lab echo (`echo.ef` is the same number) |
| `hemo` EDV, ESV | means over the beats of the window | catheter numbers |

Measured side by side (`npx tsx scripts/eval/ef-audit.ts`, seed 3):

| Condition | Monitor | Estimate | Reason for any gap |
|---|---|---|---|
| healthy | 0.62 | 0.62 | none |
| LAD occlusion, 20 s | 0.38 | 0.36 | transient: different windows and smoothing |
| LAD occlusion, 60 s | 0.30 | 0.30 | none at steady state |
| LAD occlusion + Impella P6 | 0.30 | **0.13** | the pump empties the LV without the volume crossing the aortic valve, so the aortic-valve definition understates EF |
| atrial fibrillation | 0.58 | 0.59 | small |

So the differences have three causes: (1) the two definitions diverge when a pump is running, which is a real definitional split; (2) the two use different windows and smoothing, so they differ by up to 0.10 in the first minute after a change; (3) the estimate includes premature beats and the Monitor excludes them (not yet exercised: the PVC test condition produced no PVCs). The harness registers both under separate names and `check` reports where they diverge beyond tolerance (`CROSS_CHECKS` in `variables.ts`; the Impella pair is skipped there because the gap is understood).

**Proposed reduction (needs a decision, not done):** have the ischemia panel, MCP state and echo read the same chamber-volume EF as the Monitor when the core is live, and keep a separately labelled "estimated EF including infarct" if wanted. This changes numbers users see and regression fixtures, so it is not done unasked.

## Findings so far

- **Harness bug found and fixed.** A `LiveSource` only sees beats made after it exists; one created late has an empty beat ring and falls back to a single stored warm-up beat. The first version of the harness created it late, so every seed's baseline came from the same beat and looked identical (HR 72, MAP 90, CO 5.16). That is not engine behavior. The source is now created first, as the page does, and baselines vary by seed (HR 71.2–72.7, MAP 86.9–94.1 over 4 seeds). My earlier note that "panels disagree on HR 78 vs 89 and SV 34 vs 57" was partly the same artifact, and is withdrawn.
- **Panel agreement after the fix** (LAD occlusion, 4 seeds): HR and SV agree at steady state and differ by up to 6 bpm and 14 ml in the first minute (window lag); EF as in the table above.
- **First look at the LAD occlusion** is plausible in direction: V2 ST +3.5 mm, III -3 mm, EF 0.62 to 0.30, PCWP 7.6 to 21 mmHg, infarct 0 to 45% by 6 h. Healthy stays flat for 3 minutes. Not yet checked against written expectations.
- **Empty by design:** lactate (not modelled), lysis (until treated), cath fields on an occluded vessel.

## Playground page inventory (checked against the code and screenshots)

**Inputs.** The spec registry (`src/sim/registry.ts`, `FIELDS`) is the authoritative list of controls: 101 fields, 91 on the patient and 10 for the 3D display. By dock tab:

| Tab | Fields | Examples |
|---|---|---|
| Patient | 16 | autonomic (baroreflex gain, respiratory rate and depth, set-point, noise), seed, ectopy and arrhythmia tendency, potassium, magnesium, `heart.svrScale`, `pvri`, `satLung`, `volumeMl`, `rvContractility`, `tof` |
| Rhythm | 2 | `patient.rhythm` (library rhythms), `patient.bbb` |
| Coronary | 7 | dominance, left main pattern, nodal artery origin, conus ostium, LAD course, lesions, exertion |
| Valves | 24 | per-valve `open` and `reg` (AV, MV, TV, PV), prostheses, `pda`, `asd`, `vsd`, `bt` sizes, chamber sizes, `lvEes`, `rvEes`, stiffness |
| Pericardium | 6 | effusion volume and rate, stiffness, open, drain, septum |
| Support | 36 | blood loss, drugs, fluids, hemorrhage rate, capillary leak, ventilation, Impella, IABP, ECMO, pacing |

Nine of these have no page control (set from chat or a link only), not eight: `drugs.vasopressor`, `support.fluids`, `support.diltiazem`, `devices.impellaRp.level`, `devices.iabp.volumeMl` and the four `valves.*.prosthesis` fields. The sweep ran all 90 patient fields other than `seed`.

**Outputs by panel, and what the registry covers now.**

| Panel | Covered | Not yet |
|---|---|---|
| Monitor | circulation status, BP, CO, rhythm, ventricular and atrial rate, ECG summary, ischemia and infarct | PR interval is in; "myocardium at risk" is `ischemicMassFraction` |
| Hemodynamics | all rows, plus both CPP definitions and ectopic beat share | none |
| Oxygen | saturations, DO2, VO2, extraction, lactate | pleth waveform |
| Ischemia by bed | aggregates only | the 14 per-bed supply ratios and ischemia values |
| Right-heart cath | RA a and v, RV, Fick CO, Qp:Qs (Fick), TPG, DPG, PAPi, CPO, mixed venous, step-up | per-site saturations, pullback waveforms |
| Left-heart cath | LV systolic, gradients, valve areas, severities | Hakki mitral area, waveforms |
| JVP | height, mean RA, waveform class | the waveform itself |
| PV loops | stroke work, Ea, Ees, dP/dt, tau, MVO2, cardiac power | the loop trace |

## New findings from the playground check

- **Two different "CPP".** The Hemodynamics panel shows aortic diastolic minus LVEDP (about 57 mmHg in a healthy adult). The engine and MCP report `coronaryPerfusionPressure` of about 90, which is the calibrated pressure the coronary network is solved at. They are different quantities with the same label. Registered separately as `cppPanel` and `coronaryDrivingPressure`. Suggest renaming one in the UI.
- **Qp:Qs reads 1.01 from flows and 1.08 from oxygen content (Fick) in a healthy heart,** reproduced on every seed (1.07 to 1.08). Fick CO reads 4.78 against 5.14 from flows (-7%). The same bias. A normal heart has no shunt, so this is an error in the Fick path (likely the pulmonary venous saturation it assumes), small but visible in the right-heart cath panel. The cross-check reports it.
- **A valve gradient shows in the LV pressure, not the aorta.** Severe aortic stenosis (open 0.2): LV systolic 172, aorta 111, peak-to-peak 61, mean 46, peak instantaneous 78 mmHg, Gorlin area 0.71 cm2. This is why aortic pressures barely move in aortic stenosis alone, and why valve states need the left-heart-cath variables.
- **Unreproduced: LV systolic 185 with a 2 mmHg gradient** (screenshot). Healthy headless runs give 105 to 121 across 120 beats, and a severe AS rebuild gives 172 to 189 with a correct 60 to 75 mmHg gradient. A row of 185 next to a "no stenosis" gradient is internally inconsistent. It needs a browser reproduction: what was on the Valves tab, and had the patient just changed?
- **Tetralogy of Fallot button on the Patient tab (`src/panels/heartDefects.ts`, `buildBaseline`).** It toggles `heart.tof` (large VSD, right-ventricular outflow obstruction, overriding aorta). Its sizes are sliders in Valves > Defect settings, and the Valves tab's Preset menu also has Tetralogy (congenital group). The button was added with the Valves tab rework (commit `217509e`) inside "Hemodynamic baseline", a group of four circulation sliders (systemic resistance, pulmonary resistance, lung saturation, RV contractility). A structural defect switch does not belong with those, and it duplicates the Preset. Suggest removing it or moving it next to Defect settings. Not changed.

## Full run (31 Oct 2026)

No state threw. Healthy, 8 seeds, stays inside the band the plan asked for: MAP 87–95 and CO 5.06–5.21 from baseline through 180 s, and the seeds are not copies of each other (baseline HR 71.2–72.7, MAP 86.8–94.1). Fluid conservation stays at 0. Invariants on healthy: none.

`check` exits 1. The violations that remain, after measurements the source itself withholds were set aside, are engine findings. Withheld, and not counted: lactate; lysis until a lytic is given; cath fields with no lesion; TIMI frames when the dye never arrives (grade 0); Gorlin/Hakki areas under the gradient floor (10 mmHg aortic, 2 mmHg mitral); HRV, baroreflex sensitivity and respiratory variation when the window is too short; no PR interval in AF, VT, VF or complete block; no RA a wave without an atrial marker; a device or sac that is not in the patient; panels that need a beat in the instant after the heart is rebuilt.

What still fails:

- **Stressed volume reaches 0** in `bleed-100mlmin` (8/8 seeds by 180 s) and at the high hemorrhage rate. The patient is in arrest with MAP at numerical dust, including a tiny negative, and `dead` stays false through 6 h clinical. Cardiac output in established VF goes slightly negative (about −0.00003 L/min).
- **Weiss tau is not a stable number.** On a healthy heart it is bimodal, about 35 ms or about 200 ms, depending on the beat (t60 of this run happened to be 34–38; t180 was 34–239). It is null on some pulsatile ischemic beats. On VA-ECMO without a vent it is either null or absurd (one seed 1636 ms, another about 100,000 ms) and LV stroke work is 0, so Ea is undefined, while the monitor still shows a narrow pulse from the circuit.
- **`lvEfEstimate` leaves 0..1** when LV size is at its schema minimum: about 2.3–2.5, while the chamber-volume EF stays about 0.86. Same definitional split as the Impella case, now past a fraction.
- **A huge pericardial effusion** (schema maximum) drives LA volume to −23 ml at 5 s and leaves RV EF null.
- **Minimum aortic opening** (`heart.valves.av.open` = 0): EF 0, mean gradient about 340 mmHg, Gorlin and Hakki areas null because there is no forward flow. Minimum mitral opening: mitral mean gradient about 95 mmHg, area null.
- **RA a wave is null in sinus** on some seeds after a coronary occlusion (LAD seed 1 at 20 s, seed 2 at 60 s, and the same seeds in the anatomy variants), while RV systolic is present.

Edge inputs, 8 seeds, no throw. Warnings only where the normaliser says so: stenosis 1.5 clamped to 0.99, stenosis −0.2 clamped to 0, bloodLoss 0.8 clamped to 0.6, bloodLoss −1 clamped to −0.3. **NaN stenosis becomes 70% with no warning** (cath diameter stenosis 70, FFR 0.56) and the systemic numbers match the healthy seed. **NaN seed becomes the reset seed with no warning**, and `apply({ seed })` does not reseed: seed 0, −1, 2^32+5 and NaN all reproduce that seed's healthy trajectory. Potassium 2.0 and 7.5, ectopy tendency 3 and arrhythmia tendency 3 reproduce the healthy trajectory on all 8 seeds, including PVC count 0. The core's ectopy and arrhythmia dials do not move a beat over 6 h clinical in a resting adult.

Time scale, seed 1, equal clinical minutes. Infarct fraction after proximal LAD occlusion matches at 1x/3x/6x (0.45 at 6 h). Bleed at 100 ml/min stops at 29 clinical minutes at every speed. Hemorrhage of 30% does not: HR at 10 clinical minutes is 76 / 118 / 114 and MAP is 82 / 71 / 73. LAD occlusion HR at 40 clinical minutes is 110 / 82 / 75. The table is in the snapshot. This is the same class as the earlier hemorrhage bug.

Stochastic, 24 seeds, Wilson 95% interval. No expectation cell was written.

| Outcome | Rate | Interval |
|---|---|---|
| Fibrinolysis success (`lysisSucceeded` at 40 s) | 14/24, 58% | 39–76% |
| VF, 200 J, ROSC by 20 s after the shock | 22/24, 92% | 74–98% |
| VT or VF by 6 h after proximal LAD occlusion | 11/24, 46% (NSVT 9, polymorphic 3, VF 4) | 28–65% |
| At least one PVC in the 10 s before 40 s, after PCI | 6/24, 25% | 12–45% |

ROSC needs a perfusing rhythm held for 10 s (`roscSustainS`), so at 5 s after the shock the status is still `arrest` even when the rhythm is already sinus (22/24). Two seeds were still in VF.

Valves, 8 seeds, against `docs/VALVES.md` and `tests/valvesSim.test.ts`. Severe aortic stenosis: mean gradient 49 mmHg, LV peak 175, aortic systolic 110. The gradient is in the LV pressure. Aortic stenosis plus mitral regurgitation: mean gradient 48 against 49 for the stenosis alone (the structural model, with no reflexes, said 43 against 48), mitral regurgitant fraction 0.51 against 0.47 for the chronic leak, regurgitant volume 59 ml. The fraction matches the note; the gradient drop on the live engine is about 1 mmHg, not 5. The test bars hold (mean gradient above 30, mitral regurgitant volume above 30, mechanical closing leak 5.5 ml, above 1). A 23 mm bioprosthesis reads 15 mmHg mean (the note's 11–18). A 26 mm TAVR reads 13 (the cited echo range is 8–13). Valve-in-valve reads 25 against the note's "about 15". Aortic stenosis plus LAD 80% (stenosis severity 0.85): LVEDP 8.6 to 16.8 and EF 0.60 to 0.37, a larger move than the earlier note of 8 to 13 and 0.62 to 0.45. ASD 15 mm, VSD 8 mm and PDA 4 mm shunt 2.5, 5.7 and 2.7 L/min, and `murmurOf` still says "No murmur." because it grades valves only. Impella CP with a weak RV flows about 1.9 L/min. VA-ECMO set to 4 L/min delivers about 2.6, with a return saturation. Impella RP at level 9 flows about 3.8 L/min; at level 0, with the device present, flow is about −1.3 L/min. Tamponade of 270 ml reads an effusion of 270 ml, pericardial pressure about 5 mmHg, and pulsus paradoxus about 23 mmHg.

The input sweep (90 patient fields, seed 1, low/mid/high) is the table in the snapshot. A variable counts as moved past the `same` band, and readings that seed 1's healthy run moves by itself are left out. Every field moves something at a value that is not its resting default, with these exceptions:

- Coronary anatomy (dominance, left main pattern, nodal origin, LAD course) moves nothing with no lesion. With a proximal LAD occlusion, some variants shift the course and others match the default occlusion.
- Exertion on and off moves nothing with no lesion. `lad-80-exertion` does move (MAP about 75 by 6 h).
- Potassium 2.0–7.5 and magnesium 0.2–3.0 move nothing. They are not paired with an arrhythmia tendency here; tendency 3 alone also moves nothing.
- Ectopy tendency 3 and arrhythmia tendency 3 move nothing, on 8 seeds.
- Pacing on, at the default 70 bpm, does not capture a sinus rate of about 73 (`paced()` requires the sinus at or under the set rate). Pace rate 40 with pacing forced on does not either. Pace rate 80 holds HR at 80, and 120 holds it at 120.
- Passive leg raise moves nothing. `fluids.legRaise` is stored and shown on the page; nothing under `src/physics/` reads it.
- Draining the pericardium moves nothing when there is no sac.

A 70% LAD stenosis at rest does not move HR, MAP or CO off the healthy trajectory. It does fill the cath reading (diameter stenosis 70, FFR 0.56). 50% is FFR 0.86 and the same trajectory.

## Open decisions

- ~~Cover valves, shunts and prostheses?~~ Done in the registry and the valve states (task 7b). Open: also a spec family for the static Structural tab (neonates, congenital lesions, no reflexes)?
- ~~Seeds~~ Decided: 8 for deterministic states, 24 for stochastic outcomes (arrhythmia, lysis, defibrillation). At 24 seeds a rate near 55% has a 95% interval of about 35-74%, so a spec for a rate must be written wide (e.g. `p0.35..0.75`).
- Source standard for expectations: literature with PMIDs (as in `docs/ARREST.md`) or clinical judgment, marked as such?
- Unify the EF definitions across panels (proposed above), or keep two labelled definitions?
