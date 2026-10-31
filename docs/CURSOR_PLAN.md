# Cursor plan: evaluate the CoroSim core engine

Paste this whole file into Cursor (Agent mode) as the task. It is self-contained. Work on branch `claude/great-turing-k2w6r7` of `sirpravnp/corosim`. Background and findings: `docs/EVALUATION.md`.

## Goal

Find out, variable by variable and over time, whether the **core engine** (`Simulation` with `engine: "core"`, beat-by-beat `LiveHeart`) behaves plausibly across standard and edge cases and across random seeds. A headless harness already exists in `scripts/eval/`; this plan finishes and extends it. The engine is DOM-free, so nothing here needs the browser or the site.

## Ground rules

- Test the **core** engine only. Never use the default `new Simulation()` (that is the legacy engine). Every harness run must assert `s.engine === "core"` and empty `s.coreNote` (already done in `scripts/eval/run.ts`; keep it).
- Create `new LiveSource(sim)` **right after `sim.reset(...)`**, before stepping. A late `LiveSource` has no beat history and falls back to one stored beat, which makes all seeds look identical.
- Apply an insult with `sim.apply(patch)` (what the page does), not by resetting.
- Do **not** change anything under `src/` (physics, config, sim) and do **not** hand-edit `tests/fixtures/*.json`. This plan only adds evaluation code. If you think the engine is wrong, record it as a finding in `docs/EVALUATION.md` and stop.
- Do not invent clinical expectations. Expectation cells in `scripts/eval/spec/*.csv` are written by the owner. You may add sources (PMIDs) to the note column only if you verified them.
- Check with `npx tsc --noEmit -p . 2>&1 | grep scripts/eval` (must print nothing) before each commit. Commit messages: short imperative subject plus a body saying why.

## Repo facts you need

- Run anything with `npx tsx <file>`. Install with `npm install`. About 4 cores, one seed run is about 7 s.
- `scripts/eval/variables.ts`: registry of 147 canonical variables (id, panel, unit, getter) and `CROSS_CHECKS` between panels.
- `scripts/eval/states.ts`: 24 starter states (an insult applied to a settled healthy adult, with checkpoints in simulated seconds; 1 s = 2 clinical minutes at 1x).
- `scripts/eval/grammar.ts`: expectation cell grammar (`60..80`, `d+10..+30`, `x1.2..x1.5`, `up|down|same`, `true|false`, `~regex`, `p0.4..0.7`; blank, `-` or `?` = no opinion).
- `scripts/eval/run.ts`: `list`, `template`, `observe [--seeds N --jobs N]`, `check`. Output goes to `scripts/eval/out/` (git-ignored).
- `scripts/eval/ef-audit.ts`: shows the three EF definitions side by side.
- Solver: there is one integrator, the core engine (`src/physics/core/`). The structural model (`physics/structural.ts`: chambers, vessels, valves, shunts) is what it is built from, and `analyze()`/`simulate()` run it with no reflexes. The ACS `Simulation` runs the same engine plus the coronary, ischemia, rhythm and autonomic layers.
- Engine selection: core is used by the Simulator page; legacy is the default of `new Simulation()`. The core still calls the legacy `circulation()` for ischemic fractions, rhythm rate and demand factor.
- Known definitional split (do not "fix", just keep it labelled): `lvEf` (chamber volumes, Monitor) vs `lvEfEstimate` (aortic-valve stroke volume, smoothed; ischemia panel, MCP, cath echo). They differ with an Impella running (0.30 vs 0.13) and for up to ~0.10 in the first minute after a change.
- Duplicated quantities registered under separate names (do not merge): `lvEf` vs `lvEfEstimate`; `cppPanel` (aortic diastolic minus LVEDP, about 57) vs `coronaryDrivingPressure` (about 90); `qpQs` (flows) vs `rhc.qpQsFick` (oxygen content: reads 1.08 in a healthy heart, a Fick-path bias); `co` vs `rhc.fickCo` (-7%).
- A valve gradient shows in `lhc.*` (LV minus aorta), not in aortic pressure: register and check those for every valve state.
- Empty by design: `lactate` (not modelled), `lysisSucceeded` until treated, cath fields on an occluded vessel.

## Tasks, in order

### 1. Verify the setup
- `npm install`, then `npx tsx scripts/eval/run.ts list` and `observe healthy --seeds 4`.
- Done when: `out/healthy.observed.csv` exists, baseline HR/MAP differ across seeds, and healthy stays flat for 180 s (MAP 85-95, CO 4.8-5.5).

### 2. Invariants on every state
Add an `invariants` pass to `check` (and a `--invariants-only` flag) that scans every variable of every seed at every checkpoint and reports violations:
- no `null`/NaN for a variable that is not on the "empty by design" list above;
- while a pulse exists: `dbp <= map <= sbp`, `sbp >= dbp`, no negative pressures;
- `lvEf`, `rvEf`, `lvEfEstimate`, `lvIschemia`, `rvIschemia`, `lvInfarctFraction`, `ischemicMassFraction`, `pulmonaryCongestion` within 0..1;
- volumes and `fluid.blood`, `fluid.plasma` positive; `fluid.conservation` near 0;
- `lvInfarctFraction` never decreases within a run unless the state removes tissue (it should not);
- `dead` never goes from true back to false.
Done when: `check` prints an invariants section; zero violations on `healthy`, or each violation is listed in `docs/EVALUATION.md` as a finding.

### 3. Run all states, produce a report
- `observe --seeds 8 --jobs 4` for all 24 states (about 10 minutes). Add `report` to `run.ts`: write `scripts/eval/out/REPORT.md` with, per state, a table of the 25 most informative variables (hr, sbp, dbp, map, co, sv, lvEf, pcwp, cvp, spo2, svo2, do2, ischemicMassFraction, lvInfarctFraction, key ST leads, rhythm, status, dead) as mean (min..max) per checkpoint, plus crashed seeds and warnings.
- Done when: all 24 states run on 8 seeds without a crash, and REPORT.md renders. Commit REPORT.md as `docs/EVAL_REPORT.md` (a snapshot with the date and commit hash in the header).

### 4. Edge states
Add to `states.ts`, with invariants-only checking (no expectation file needed):
- Inputs: `stenosis` 0.99, 1.5, -0.2, NaN; `bloodLoss` 0.8 and -1.0; `seed` 0, -1, 2**32+5, NaN; `electrolytes.potassium` 2.0 and 7.5; `arrhythmiaTendency` 0 and 3; `ectopyTendency` 3. Expect: no throw, warnings reported, invariants hold.
- Combinations: three vessels occluded; LM occlusion + RV infarct (RCA) + complete block; tamponade + hemorrhage; Impella with RV failure; ECMO without venting; every drug at 1.0 together.
- Anatomy: proximal LAD occlusion across all 9 variants (dominance, LM pattern, LAD course, nodal artery origin).
Done when: every edge state runs; failures are listed with the input that caused them.

### 5. Time-scale invariance
Add a state option `speed: 1 | 3 | 6` (the page's speed buttons use `minutes` per step: 2, 6, 12 clinical min per simulated second). Run hemorrhage-30, bleed-100mlmin and LAD occlusion at each speed and compare the **clinical-time** trajectory of MAP, HR, lvInfarctFraction, time to arrest.
Done when: a table shows the outcome at equal clinical minutes for 1x/3x/6x; a difference beyond 5% (or arrest at a different clinical time) is reported as a finding (the earlier hemorrhage bug was exactly this class).

### 6. Stochastic outcomes with many seeds
Run 24 seeds (the owner's choice: 8 for deterministic states, 24 for stochastic ones), short runs, for: fibrinolysis success (state `lad-occlusion-then-lysis`, `revascularize("lysis")`, expect about 55%), defibrillation of VF at 200 J (`s.shock({joules:200})` after 20 s), VT/VF onset rate on proximal LAD occlusion over 6 h, PVC burden after reperfusion. Report the observed rate with a 95% binomial interval, compared with the cell grammar's `p<lo>..<hi>`.
Done when: each rate has an interval in the report.

### 7. Extend the registry
Add variables (same pattern, one canonical source each; document any that cannot be read headless):
- PV-loop metrics from `src/physics/loopMetrics.ts` using `LiveSource.beats().loops.LV`: stroke work, Ea, Ees, dP/dt max/min, tau, MVO2, cardiac power output.
- JVP from `src/physics/jvp.ts` (`analyzeJvp`), pulsus paradoxus and PPV from `src/physics/respiratory.ts`.
- Pericardial pressure and effusion (`sim.pericardium()`), ECMO console readings, Impella RP.
Done when: `variables.ts` registers them and `observe` fills them without errors for a state that has them.

### 7b. Valve, shunt and prosthesis coverage (required)
`PatientSpec.heart` (keys in `src/sim/patient.ts` `HEART_KEYS`: `valves`, `pda`, `asd`, `vsd`, `bt`, `tof`, `lvEes`, `lvStiffness`, ...) is read by the core engine. Per-beat valve data is in `LiveSource.beats()[i].valves` (`forwardMl`, `regurgMl`, `openMs` for AV/MV/TV/PV); grading helpers are in `src/sim/valves.ts` and `src/sim/structural.ts` (`assessHeart`, `murmurOf`).
- Variables to register: per valve forward volume, regurgitant volume and regurgitant fraction, open time, peak and mean gradient, effective orifice area; Qp:Qs and shunt flow per shunt (`pda`, `asd`, `vsd`); murmur text; LV and LA size effects; plus an LV peak systolic pressure (LV minus aortic gradient is invisible in aortic pressure alone).
- States to add: aortic stenosis (mild, moderate, severe), aortic regurgitation, mitral stenosis, mitral regurgitation (chronic and acute), tricuspid and pulmonary lesions, ASD, VSD, PDA, aortic stenosis + LAD 80% (already shown to interact: LVEDP 8 to 13, EF 0.62 to 0.45), bioprosthetic and mechanical replacement, TAVR, valve-in-valve.
- Reference values to check against: `docs/VALVES.md` (for example AS plus MR gradients, regurgitant fractions) and the `tests/valvesSim.test.ts` bars; these are the engine's own claims, so list disagreements as findings.
Done when: each state runs on 8 seeds and `observe` fills the new variables.

### 7c. Input sweep from the spec registry
`FIELDS` in `src/sim/registry.ts` lists every control (101: 91 patient, 10 display) with a JSON-schema fragment (`minimum`, `maximum`, `enum`). Generate states automatically: for each patient field, one state per low, middle and high value, applied to the healthy baseline, recorded at the default checkpoints.
- Skip `display.*` and `seed`. Pair fields that need each other (a lesion needs an artery).
- Invariants (task 2) apply to all of them; expectations are optional.
- Report per field which variables moved (more than 5% or 0.01 from baseline) so the owner sees what each control actually does. A control that moves nothing, or moves a variable the owner did not expect, is a finding.
- The 8 fields with no page control (`drugs.vasopressor`, `support.fluids`, `support.diltiazem`, `devices.impellaRp.level`, `devices.iabp.volumeMl`, four `valves.*.prosthesis`) are listed separately.
Done when: a table of field x variables-moved exists for all 91 patient fields.

### 8. Owner hand-off: spec templates
- Run `template` for the priority states: healthy, lad-prox-occlusion, rca-prox-occlusion, lm-occlusion, hemorrhage-15/30/45, norepinephrine-50, dobutamine-50.
- Add a helper `template --observed` that writes the observed mean as a **comment column** (not as an expectation), so the owner can see current behavior next to each blank cell without it being treated as truth.
- Stop here. The owner fills the CSVs; then `check` is the real test.

### 9. After the owner decides the EF question (do not start before)
Option A: ischemia panel, MCP state and cath echo read the same chamber-volume EF as the Monitor when the core is live. That touches `src/` and fixtures, so it needs the owner's explicit go-ahead and a regen via `scripts/regen-fixtures.ts` with the reason in the commit.

### 10. CI
Add `.github/workflows/eval.yml` modelled on `.github/workflows/tests-slow.yml`: nightly and on demand, runs `observe` (8 seeds, sharded by state) then `check`, uploads `out/` as an artifact, fails on invariants violations or spec failures. Not part of the deploy gate.

## Open questions for the owner (ask before assuming)
1. (Answered) Valves, shunts and prostheses are inputs to the one core engine, so they are in scope, not optional (task 7b). Remaining question: also a spec family for the static Structural tab (`analyze()`: neonates, congenital lesions with no reflexes)?
2. (Answered) 8 seeds for deterministic states, 24 for stochastic outcomes. At 24 seeds a rate near 55% has a 95% interval of about 35-74%: write rate expectations wide.
3. Expectation source standard: PMID-cited literature, or clinical judgment marked as such?
4. Unify the EF definitions (task 9), or keep two labelled ones?
