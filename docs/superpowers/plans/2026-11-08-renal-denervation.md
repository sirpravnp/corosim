# Renal Denervation (RDN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach catheter-based renal sympathetic denervation for resistant hypertension: how it differs from baroreceptor denervation, what it does to resting sympathetic tone and blood pressure, and (optionally) how the procedure is performed on a fluoroscopy-style view reusing the cath-lab access graph.

**Architecture:** A new **partial sympathetic efferent denervation** channel in the existing closed-loop autonomic model (`src/physics/autonomic.ts`), distinct from `autonomic.baroreflexGain` (which scales the whole baroreflex, including vagal). RDN lowers the **resting and reflex-driven renal sympathetic outflow** that contributes to vascular resistance and heart rate, with a slow **set-point drift** over simulated days (chronic hypertension reset). The playground exposes fraction denervated; MCP adds `corosim_treat` kind `rdn` and a teaching preset. An optional **Phase C** extends `src/lab/` with bilateral renal arteries and ablation points, coupled to the same `renalSnaDenervation` state.

**Tech Stack:** TypeScript, Vite, Vitest. Optional Phase C: Canvas 2D fluoroscopy (same stack as cath lab). No new dependencies.

**Spec:** This document is the spec until a copy lands in `docs/superpowers/specs/` after clinician review of `[assumed]` numbers.

## Design decisions (fixed for this plan)

1. **Not the same as `baroreflexGain = 0`.** Baroreceptor denervation removes the pressure feedback loop (afferent and both arms). RDN targets **efferent renal sympathetic nerves**; baroreflex sensing and vagal control stay intact. Teaching must show: vasopressor still slows the heart at gain 1 after RDN, but MAP rises less at the same drug dose because baseline SVR is lower.
2. **One scalar for teaching, two scalars in the engine.** User-facing: `autonomic.renalDenervation` 0..1 (0 = native kidneys, 1 = complete bilateral RDN as in trial responders). Internal: multiply **resting sympathetic tone** and the **sympathetic arm's baro-driven component** by `(1 − renalDenervEffect·fraction)`, where `renalDenervEffect` is a constant in `src/config/autonomic.ts` tagged `[assumed]`. Do **not** scale vagal gain or `baroreflexGain` itself.
3. **Slow MAP fall, not instant.** On treat or when fraction steps from 0 → 1, `setPointShift` decays toward a lower chronic target over **simulated days** (first-order τ in clinical minutes at 1× time), modeling vascular remodeling and reduced central sympathetic drive. Immediate beat-to-beat effects come from lower `restSympathetic` effective tone; the shift decay is the weeks-long trial narrative.
4. **No RAAS layer.** The model card lists hormones and renal volume control as not simulated. RDN must not promise aldosterone or sodium effects; copy and MCP narration say sympathetic-vascular mechanism only.
5. **Resistant hypertension preset.** Default teaching patient: `setPointShift` +15..+20, `betaBlocker` and vasodilator doses high, MAP ~155–165 at rest, normal coronaries. Compare RDN vs adding another drug vs `baroreflexGain 0` on the same seed.
6. **Constants tagged `[lit]` or `[assumed]`** in `src/config/autonomic.ts` (new file or extend `physics/autonomic.ts` exports). Targets (tune in Task 2): complete RDN drops MAP ~8–12 mmHg at rest after set-point decay; SBP variability falls slightly; resting HR unchanged or −2..−4 bpm; reflex bradycardia to vasopressor preserved.

## Global constraints

- American English in copy, comments and commit messages.
- UI follows `CLAUDE.md` and `DESIGN.md` (hairline frames, one dominant stage, no generic dashboard chrome).
- Educational only; page and MCP carry the existing educational notice.
- Verification: `npx vitest run tests/<file>`, `npm run typecheck`, `npm run build`.
- Registry is source of truth: new fields go through `src/sim/registry.ts` (D1 spec registry).
- Explicit `git add <paths>` per commit, not `git add -A`.

## Review focus

1. Learner sets `baroreflexGain` to 0 and `renalDenervation` to 1 on the same patient: reflex tachycardia to hemorrhage and reflex bradycardia to vasopressor must **differ** between the two (RDN keeps baroreflex, gain 0 removes it).
2. `corosim_compare` resistant HTN vs RDN vs beta blocker increase: MAP and HR deltas are plausible and explained in `corosim_explain`.
3. Stepping `renalDenervation` from 0 to 1 mid-run does not jump MAP in one beat; set-point decay visible over `corosim_run` 300–600 s.
4. Phase C (if built): bilateral treatment required for full effect; unilateral gives half the scalar; renal artery complication raises resistance locally without breaking the solver.

## Literature anchors (for notes and clinician review)

| Topic | Anchor |
|---|---|
| Mechanism | Renal efferent and afferent sympathetic ablation; ↓ central sympathetic outflow [assumed aggregate] |
| BP effect magnitude | Office SBP ~5–10 mmHg vs sham in SPYRAL HTN-ON Med (2023); teach 8–12 mmHg at full effect [lit direction, `[assumed]` exact gain] |
| Distinction from drugs | Adds to pharmacotherapy; does not replace adherence or secondary causes [teaching copy only] |
| Complications (Phase C) | Renal artery stenosis, dissection, bleeding [assumed rates] |

PMIDs for the checklist: 36944993 (SPYRAL HTN-ON Med), 23439113 (SYMPLICITY HTN-3 sham). Worker fills note column after verification.

---

## File structure

### Phase A–B (engine, UI, MCP, teaching) — required

Create:
- `src/config/renalDenervation.ts` — effect sizes, set-point decay τ, unilateral factor `[assumed]`.
- `docs/RENAL_DENERVATION.md` — clinician checklist and what the scalar does in equations.

Modify:
- `src/physics/autonomic.ts` — apply `renalDenervation` fraction to sympathetic tone paths; optional slow `setPointShift` target driven by simulation clock.
- `src/sim/simulation.ts` — wire control, persist in state, apply on `treat("rdn")` or patch.
- `src/sim/registry.ts` — `autonomic.renalDenervation` 0..1.
- `src/sim/scenario.ts`, `src/sim/narrate.ts`, `src/sim/explain.ts` — phrasing.
- `src/panels/advancedControls.ts` — slider (or Patient tab when C2 dock lands).
- `src/mcp/tools.ts` — `corosim_treat` accepts `rdn`; schema from registry.
- `src/mcp/content.ts` — `PROMPTS.rdn_demo` compare script.
- `src/library/presets.ts` — preset `resistant-htn-rdn`.
- `scripts/eval/matrixSupport.ts` — states `rdn-0`, `rdn-1`, `resistant-htn-rdn`.

Tests:
- `tests/renalDenervation.test.ts` — distinct from baroreflex gain 0; MAP/HRV deltas; set-point decay monotonic.
- Extend `tests/specRegistry.test.ts` if needed.
- `tests/mcpTreatRdn.test.ts` (slow) — treat then narrate.

### Phase C (procedure UI) — optional, after cath lab engine merges

Modify / create (only if `src/lab/` is on main):
- `src/lab/access.ts` — renal artery segments off abdominal aorta.
- `src/lab/renal.ts` — ablation actions, bilateral coverage fraction.
- `src/lab/coupling.ts` — map coverage → `autonomic.renalDenervation`.
- `src/cath/lab/cases.ts` or new `hypertension/lab/` page — one teaching case.
- Tests: `tests/labRenal.test.ts`, `tests/labRenalCoupling.test.ts`.

---

## Phase A: Autonomic physics

### Task 1: Config and types

**Files:** `src/config/renalDenervation.ts`, `src/physics/autonomic.ts` (`AutonomicControls`)

- [ ] **Step 1:** Write failing tests: at `renalDenervation: 1`, resting MAP (seed 1, 180 s) is below baseline by ≥6 mmHg; at `baroreflexGain: 0`, vasopressor 0.8 **increases** HR vs baseline+vasopressor (reflex abolished), while at `renalDenervation: 1` HR still **decreases** vs baseline+vasopressor.
- [ ] **Step 2:** Add `renalDenervation: number` to `AutonomicControls` (default 0). In `tone()` / `step()`, scale sympathetic targets: `symTarget` and vascular branch use `(1 − RDN.efferentMax · clamp(fraction,0,1))` on the **baro and noise terms**, and lower effective `restSympathetic` by `(1 − RDN.restingMax · fraction)`.
- [ ] **Step 3:** Document in `docs/RENAL_DENERVATION.md` with equations copied from comments.
- [ ] **Step 4:** `npx vitest run tests/renalDenervation.test.ts && npm run typecheck`.

### Task 2: Chronic set-point decay

**Files:** `src/sim/simulation.ts`, `src/config/renalDenervation.ts`

- [ ] **Step 1:** Failing test: patient with `setPointShift: 18`, `renalDenervation` stepped to 1 at t=0; MAP at 30 s > MAP at 600 s; `setPointShift` in exported state drifts toward `18 − RDN.setPointDrop·fraction` with τ `RDN.setPointTauMin` clinical minutes.
- [ ] **Step 2:** Implement decay in simulation clock (clinical minutes), not in `Autonomic.step` dt alone, so pause and run behave.
- [ ] **Step 3:** Commit.

### Task 3: Registry and playground

**Files:** `src/sim/registry.ts`, `src/panels/advancedControls.ts`, `tests/specRegistry.test.ts`

- [ ] Add field with description distinguishing from `baroreflexGain`.
- [ ] Slider 0..1, step 0.05.
- [ ] Regenerate or update MCP schema exports if the repo script requires it (`npm run export-tools` or documented equivalent).

---

## Phase B: Treat, teach, evaluate

### Task 4: `corosim_treat` rdn

**Files:** `src/sim/simulation.ts`, `src/mcp/tools.ts`, `tests/mcpTreatRdn.test.ts`

- [ ] **Step 1:** `treat("rdn")` sets `renalDenervation` to 1 (bilateral complete); idempotent message if already 1.
- [ ] **Step 2:** Narration: "Renal sympathetic denervation was performed; over the next days central sympathetic drive and vascular set point should fall."
- [ ] **Step 3:** MCP tool schema and slow test.

### Task 5: Presets and MCP prompt

**Files:** `src/library/presets.ts`, `src/mcp/content.ts`

- [ ] Preset `resistant-htn`: HTN drugs + shift + no coronaries.
- [ ] `PROMPTS.rdn_demo`: compare (1) resistant HTN, (2) after `corosim_treat` rdn + `corosim_run` 300 s, (3) baroreflex gain 0 for contrast; one learner question.

### Task 6: Eval matrix

**Files:** `scripts/eval/matrixSupport.ts`, optional `scripts/eval/spec/resistant-htn.csv` (owner fills expectations)

- [ ] States for observe/check pipeline; document in `docs/EVALUATION.md` one row.

---

## Phase C: Procedure lab (optional)

**Depends on:** cath lab plan Tasks 1–8 merged (`src/lab/engine.ts`, access graph).

### Task 7: Renal access graph

**Files:** `src/lab/access.ts`, `src/lab/renal.ts`, `tests/labRenal.test.ts`

- [ ] Segments: `AO_ABD`, `RENAL_L_MAIN`, `RENAL_L_BRANCH*`, `RENAL_R_*`.
- [ ] Actions: `advance`, `ablating` (dwell time), `withdraw`.
- [ ] Coverage fraction 0..1 per kidney; bilateral average → `renalDenervation`.

### Task 8: Coupling and case

**Files:** `src/lab/coupling.ts`, case JSON, UI link from Simulator Management or Library.

- [ ] One scripted case: access, treat both arteries, debrief MAP at 30 days simulated (`corosim_run`).
- [ ] Complication draw: dissection → focal `resistance` bump `[assumed]`.

---

## Done when

| Phase | Criterion |
|---|---|
| A | Tests green; learner can contrast RDN vs `baroreflexGain 0` on playground |
| B | MCP treat + preset + eval states; `docs/RENAL_DENERVATION.md` on checklist |
| C | Optional: procedure replay sets same `renalDenervation` as slider at 1.0 |

## Open decisions (confirm before Task 2 tuning)

| # | Question | Default |
|---|---|---|
| D1 | Single slider vs per-kidney 0..1 | Single bilateral scalar for Phase A–B; per-kidney only in Phase C |
| D2 | Set `renalDenervation` only via treat vs adjustable slider | Both: slider for experiments, treat for case narrative |
| D3 | Interaction with beta blocker | Multiplicative on cardiac sympathetic effect only (same as today); RDN does not add extra beta block |
| D4 | Page for Phase C | Link from Library case, not a third top-level product tab, until content justifies it |

---

## Task prompt snippet (for Cursor)

Paste for each task: the task section above, plus: "Read `CLAUDE.md`, `src/physics/autonomic.ts`, and `docs/RENAL_DENERVATION.md`. Write failing tests first. Do not edit files outside this task's file list. Run verification and report output."
