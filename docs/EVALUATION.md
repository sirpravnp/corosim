# Evaluating the CoroSim solver and engine

Status: harness built (`scripts/eval/`), no expectations written yet, no full run yet.

## Goal

Know, variable by variable and over time, whether the core engine does what a clinician says it should, across standard and edge cases and across seeds. The engine is DOM-free (`src/sim/Simulation`), so all of this runs headless in Node: no site, no browser.

## Approach: a specification matrix

A spec is: **specified state × variable × time → expected change.** The user writes the expectations; the runner measures the engine and reports where they disagree.

- **Variables:** 147, each with one canonical source, unit and panel (`scripts/eval/variables.ts`). Panels: Monitor, Hemodynamics, Oxygen, Coronary, ECG (15 leads), Rhythm, Arrest, Treatment, Fluids, Drugs, Devices, Autonomic, Cath lab.
- **States:** `scripts/eval/states.ts`. Each starts from the same settled healthy adult, applies the insult with `Simulation.apply` (as the page does), then records every variable at checkpoints. Default checkpoints are 5, 20, 60 and 180 simulated seconds after the insult (= 10 min, 40 min, 2 h, 6 h clinical, at 2 clinical min per second). A state can set its own checkpoints and timed actions (e.g. PCI at 10 s).
- **Expectation grammar:** `scripts/eval/grammar.ts`. A cell is one of `60..80` (absolute), `d+10..+30` (change from the same seed's baseline), `x1.2..x1.5` (ratio), `up`/`down`/`same`, `true`/`false`, `~regex`, or `p0.4..0.7` (share of seeds, for stochastic outcomes). Blank, `-` or `?` means no opinion. A cell passes when at least 80% of seeds satisfy it.
- **Seeds:** every state runs on several seeds. Baselines are identical across seeds by design; seeds diverge after the insult.

## Commands

```bash
npx tsx scripts/eval/run.ts list
npx tsx scripts/eval/run.ts template lad-prox-occlusion   # blank spec CSV in scripts/eval/spec/
npx tsx scripts/eval/run.ts observe lad-prox-occlusion --seeds 8 --jobs 4
npx tsx scripts/eval/run.ts check                          # your cells vs observed; also panel-agreement checks
```

`observe` writes `scripts/eval/out/<state>.observed.csv` (mean and min..max per cell) and raw per-seed JSON. Eight runs take about 30 s on 4 cores.

## Plan

1. **Write expectations (owner: user).** Fill the template CSVs for the highest-value states first: healthy, LAD/RCA/LM occlusion, the three hemorrhage classes, norepinephrine, dobutamine. Fill only cells with an opinion, and put the source or reasoning in the note column.
2. **First full run.** `observe` at 32 seeds over all 24 states (about 1 hour of compute), then `check`. Triage every failure as a model bug, a wrong expectation, or an ambiguous variable definition.
3. **Widen coverage.**
   - Registry: PV-loop metrics, JVP, and the structural, valve and congenital solver (a separate engine path, scope to be decided).
   - Edge states: multivessel disease, invalid and extreme inputs (stenosis outside 0..1, NaN, odd seeds), all 9 anatomy variants, drug and device combinations.
   - Invariants on every state: no NaN, MAP between DBP and SBP, fractions within 0..1, volumes conserved.
   - Time-scale invariance: the same event gives the same outcome at 1×, 3× and 6×.
4. **Lock in.** Turn passing specs into a CI job modeled on `.github/workflows/tests-slow.yml`, so a model change that moves a number outside the spec fails visibly. Fixture changes need a stated reason in the PR.

## Findings so far

- **Panels can disagree.** In one seed (80% LAD lesion, Impella on): LVEF 0.33 in `state` and the echo panel vs 0.48 in `vitals`; HR 78 vs 89; SV 34 ml vs 57 ml. The EF pair is in `CROSS_CHECKS`; the HR and SV pairs are not yet. Unknown whether this is a window difference or a bug.
- **First look at the LAD occlusion** (4 seeds) is plausible in direction: V2 ST +3.5 mm, III −3 mm, EF 0.62 → 0.31, PCWP 7.6 → 21 mmHg, infarct 0 → 45% by 6 h. Healthy stays flat for 3 minutes (MAP 88–90, CO 5.1). These are not yet checked against written expectations.
- **Empty by design:** lactate (not modelled), lysis (until treated), cath fields on an occluded vessel.

## Open decisions

- Cover the structural/valve/congenital solver in this spec, or only the ACS patient?
- Seeds: 8 for the first pass, 32+ for stochastic outcomes (arrhythmia, lysis, defibrillation)?
- Source standard for expectations: literature with PMIDs (as in `docs/ARREST.md`) or clinical judgment, marked as such?
