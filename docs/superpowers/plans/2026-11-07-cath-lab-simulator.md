# Cath Lab (PCI) Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the read-only cath tab into a procedural simulator: femoral or radial access, guide and wire handling, balloon and stent deployment, lesion biomechanics and complications, all feeding back into the existing closed-loop hemodynamics (FFR, ischemia, ECG, pressure).

**Architecture:** A pure, DOM-free procedure engine (`src/lab/`) holds a 1D device model that rides on centerlines (access vessels plus the existing coronary tree) and mutates a `Plaque` model. A coupling layer pushes the result into `Simulation` as live lesions, bed-resistance multipliers, bleeding and rhythm triggers, so the existing solver, ischemia dynamics and ECG respond. A new page renders fluoroscopy and the monitor from engine state. Every user action is a reducible `Action` with a seeded RNG, so any procedure replays exactly.

**Tech Stack:** TypeScript, Vite (multi-page), Canvas 2D, Vitest. No new dependencies.

**Spec:** None separate. The "Design decisions" and "Open decisions" sections below are the spec; `docs/superpowers/specs/` gets a copy after you confirm them.

## Design decisions (fixed for this plan)

1. **1D, not finite-element.** A device is `{ routeSegs: string[]; tipMm: number }` on a shared vascular graph. The body is the centerline up to the tip. Force transmission decays with cumulative curvature. This teaches decisions (support, wire choice, sizing, complications), not haptic device feel.
2. **One vascular graph.** Access vessels (femoral or radial, iliac, aorta, arch) are new segments in the same patient frame (mm) as the coronary tree, so `AngioView.project()` draws both.
3. **Plaque replaces the single `ds` lesion.** `Plaque` has length, eccentricity, calcium, lipid, thrombus and CTO features. `plaqueToLesions()` derives the `Lesion[]` the solver already understands.
4. **The solver stays steady-state.** A procedure step re-solves after each state change. Time-varying effects (ischemia during a 60 s inflation) come from stepping `Simulation` in real-time mode.
5. **Determinism.** `LabEngine` takes a seed. Same seed plus same action log gives identical events and identical sim state.
6. **Complications are risk functions with seeded draws**, and a case can force one at a named trigger so teaching cases are reproducible.
7. **Constants live in `src/config/*.ts` tagged `[lit]` or `[assumed]`**, matching `src/config/cath.ts`. Anything `[assumed]` goes on the clinician-review checklist in Task 16.

## Global Constraints

- American English in copy, comments and commit messages.
- UI follows `CLAUDE.md` and `DESIGN.md`: square hairline frames, no border-radius above 2px, no backdrop-filter, no tinted callout boxes, no card around every region (one dominant stage: the fluoroscopy view), tracked uppercase labels for one role only, no emoji, no new accent hues, every figure and table captioned "Figure N." / "Table N.". Read `DESIGN.md` before Task 11.
- Color means physiology: red, blue and amber only for abnormal, cold and caution states. Device overlays on fluoroscopy are grayscale (radiopaque), as on a real monitor.
- Patient frame, mm: x toward the patient's left, y toward the head, z anterior (as in `src/echo/poses.ts` and `src/anatomy/curve.ts`).
- Educational only. Every page carries the existing educational notice and never presents output as clinical advice.
- Verification commands: `npx vitest run tests/<file>`, `npm run typecheck`, `npm run build`.
- The working tree has many uncommitted changes unrelated to this work, including edits to `src/cath/*` and `src/sim/cath.ts`. Commits use explicit paths with `git add <paths>`, never `git add -A`. Per project memory, work in a new worktree branched from the latest `origin/main`, because the current checkout is stale.

## Review Focus

1. A wire pushed hard into a total occlusion: it must perforate or track subintimally by risk, never silently stop (today `WireModel.at().stopped` just clamps).
2. A balloon inflated past rated burst pressure, or a stent sized more than 1.2x the reference diameter: rupture, edge dissection or perforation, not a clean result.
3. A stent deployed across a side-branch origin: the branch is jailed (ostial narrowing on the child), and its TIMI and territory ischemia change.
4. Balloon inflation held on the left main or a proximal vessel: sustained ischemia must reach arrhythmia and arrest through the existing `corosim_arrest` path, not freeze or run forever.
5. A device withdrawn while inflated, a second stent over a stent, or the user abandoning mid-procedure: the engine refuses or applies injury, and `reset` returns a clean patient; replay of the action log reproduces the same end state.

---

## File structure

Create (pure engine, no DOM):
- `src/lab/plaque.ts`: `Plaque`, `plaqueToLesions`, `dilate`, `deployStent`.
- `src/lab/access.ts`: access graph builder `buildAccess(variant)` and ostium lookup.
- `src/lab/route.ts`: route over the unified graph: arclength to position, curvature, transmission.
- `src/lab/engine.ts`: `LabEngine` reducer, `Action`, `LabEvent`, procedure state.
- `src/lab/wire.ts`: wire advance, torque, branch choice, lesion crossing.
- `src/lab/balloonStent.ts`: inflate, deflate, deploy, jailing.
- `src/lab/complications.ts`: risk functions and seeded draws.
- `src/lab/coupling.ts`: `applyToSim`, `guideTrace`, contrast and heparin effects.
- `src/lab/score.ts`: scoring and debrief.
- `src/config/labDevices.ts` (PCI catalog; Impella/ECMO stay in `devices.ts`), `src/config/plaque.ts`, `src/config/lab.ts`: constants and catalog.

Create (UI):
- `cath/lab/index.html`, `src/cath/lab/page.ts`, `src/cath/lab/fluoro.ts`, `src/cath/lab/panels.ts`, `src/cath/lab/lab.css`, `src/cath/lab/cases.ts`.

Modify:
- `src/physics/network.ts`: lesion length, several lesions per segment, bed-resistance multipliers.
- `src/sim/simulation.ts`: live lesion overlay, real-time mode.
- `src/mcp/tools.ts`: lab tools. `vite.config.ts`: register the new page. `src/cath/page.ts`: link to the lab.

Tests: `tests/network.lesions.test.ts`, `tests/labSim.test.ts`, `tests/labPlaque.test.ts`, `tests/labAccess.test.ts`, `tests/labWire.test.ts`, `tests/labDevices.test.ts`, `tests/labComplications.test.ts`, `tests/labCoupling.test.ts`, `tests/labCases.test.ts`, `tests/labScore.test.ts`, `tests/labMcp.test.ts`, `tests/labEndToEnd.test.ts`.

---

## Ownership and handoff

Cursor builds everything that is numbers, physics, tests and data. Claude builds everything the user looks at, plus the contract between the two. Each side works in its own worktree and branch from the latest `origin/main`, so the file sets never overlap.

| Owner | Tasks | Branch | Files touched |
|---|---|---|---|
| Claude | 0 (contract and stub), 11 (fluoroscopy), 12 (page and controls), visual check in 16 | `cath-lab-ui` | `src/lab/types.ts`, `src/lab/stub.ts`, `src/cath/angio.ts`, `src/cath/lab/{fluoro,page,panels}.ts`, `src/cath/lab/lab.css`, `cath/lab/index.html`, `vite.config.ts`, `src/cath/page.ts`, `tests/labFluoro.test.ts`, `tests/labPage.test.ts` |
| Cursor | 1 to 10, 13 to 16 (all but the visual check) | `cath-lab-engine` | everything else in the plan: `src/physics/network.ts`, `src/sim/simulation.ts`, `src/lab/*` except `types.ts` and `stub.ts`, `src/config/*`, `src/cath/lab/cases.ts`, `src/mcp/*`, remaining tests and docs |

**Rules for both sides**
- `src/lab/types.ts` (Task 0) is the contract. Cursor may add fields but never rename or remove one. If a task needs a breaking change, stop and ask Claude to change `types.ts` first.
- Claude's UI runs against `StubLabEngine` (Task 0) until Cursor's `LabEngine` lands, then swaps one import. Both classes implement the `LabEngineLike` interface in `types.ts`.
- Cursor keeps the order inside each phase: 1 → 2, then 3, 4 and 5 in any order, then 6 → 7 → 8 → 9 → 10, then 13, 14, 15, 16.
- Each Cursor task ends with its own commit and a green `npx vitest run && npm run typecheck`. Claude reviews each commit against the task text before the next one starts (superpowers:requesting-code-review). Cursor does not start a task while the previous one has open review findings.
- Cursor does no UI work: no CSS, no canvas drawing, no HTML. Claude does no physics or tuning of `[assumed]` constants beyond reading them.
- American English, explicit `git add <paths>`, and the Global Constraints below apply to both.

**What to paste into Cursor for each task.** The task's section from this plan, plus: "Read `CLAUDE.md` and `src/lab/types.ts` first. Write the failing tests in the task before any code. Do not edit files outside this task's Files list. Run the verification commands and report their output."

---

## Phase 0: Contract

### Task 0: Shared types and a stub engine [Claude]

**Files:**
- Create: `src/lab/types.ts`, `src/lab/stub.ts`
- Test: `tests/labStub.test.ts`

**Interfaces:**
- Produces in `types.ts`: every type named in Tasks 3 to 8 (`Plaque`, `DeployedStent`, `Dissection`, `AccessSite`, `AccessVariant`, `VSeg`, `VGraph`, `Action`, `LabEvent`, `LabState`, plus `Device` and its subtypes from Task 4), and
```ts
export interface LabEngineLike {
  state(): Readonly<LabState>;
  graph(): VGraph;                          // access vessels plus coronary tree, for drawing
  plaques(): readonly Plaque[];
  apply(a: Action): LabEvent[];
  replay(actions: Action[]): LabEvent[];
  reset(): void;
}
```
  Task 6 declares `class LabEngine implements LabEngineLike`; Tasks 3 to 8 import their types from `types.ts` instead of defining them.
- Produces in `stub.ts`: `class StubLabEngine implements LabEngineLike` that follows a scripted demo (access, guide to LM, wire down the LAD, balloon, stent) on a built-in simple graph, with no physics. Used only for UI development and UI tests.

- [x] **Step 1: Write failing tests:** `the stub advances a wire along the LAD and reports tipMm increasing`; `the stub emits an inflate event and flags occludesFlow`; `reset returns an empty log`; `the stub satisfies LabEngineLike (type-level)`.
- [x] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/labStub.test.ts`. Expected: FAIL.
- [x] **Step 3: Implement** `types.ts` by moving the interfaces from Tasks 3 to 8 into it verbatim, and the stub.
- [x] **Step 4: Run to verify they pass, then commit and merge this branch's `types.ts` to `main` first** so Cursor's branch starts from it.
```bash
git add src/lab/types.ts src/lab/stub.ts tests/labStub.test.ts
git commit -m "Lab: shared types and a stub engine for UI work"
```

---

## Phase A: Physics foundations

### Task 1: Generalize the lesion solver [Cursor]

Today `denseProfile` takes one lesion per segment and a fixed 14 mm window (`HALF = 7`, `defaultLesion()`), and scenarios drop a second lesion on an artery. PCI needs tandem lesions, longer lesions, stent edges and a stented segment that is not a lesion at all.

**Files:**
- Modify: `src/physics/network.ts` (`Lesion`, `denseProfile`, `solveNetwork`, `lesionFFR`, `analyze`), `src/physics/geometry.ts` (window helper)
- Test: `tests/network.lesions.test.ts`

**Interfaces:**
- Consumes: existing `solveNetwork(tree, lesions, demandMult, aorticPressure, grafts)` and `analyze(...)`.
- Produces:
  - `interface Lesion { segId: string; pos: number; ds: number; occluded?: boolean; lengthMm?: number }` (`lengthMm` defaults to the current 14).
  - `solveNetwork(..., grafts: Graft[] = [], bedResistance: Record<string, number> = {})` where the record maps terminal key (`"LAD#end"`) to a multiplier on that bed's `Rmin` (1 = normal).
  - `analyze(..., demandScale = 1, bedResistance = {})`, returning `ffr` with one entry per entry of `lesions`, in order.

- [ ] **Step 1: Capture golden numbers before touching the solver.** In a scratch script run `analyze` for LAD 50 %, 75 % and LM 90 % (the `src/cath/cases.ts` lesions, seed 7, warmup 60) and paste the FFR, `hyper.pa` and TIMI-driving velocities (to 6 decimals) into the test as constants.
- [ ] **Step 2: Write failing tests** in `tests/network.lesions.test.ts`:
  - `single lesion results are unchanged`: the three golden cases match to `1e-9`.
  - `longer lesion costs more pressure`: LAD 70 %, `lengthMm` 30 gives a lower hyperemic distal ratio than `lengthMm` 14.
  - `two lesions in series are worse than either alone`: two 60 % lesions at pos 0.3 and 0.6 on LAD give FFR below each alone and `analyze(...).ffr.length === 2`.
  - `bed resistance multiplier starves one bed`: `bedResistance: { "LAD#end": 4 }` lowers that terminal's `ratio` and raises its `severity`, other beds change by under 0.02.
  - `occlusion position uses the lesion's own pos`: with a stenosis and an occlusion on one segment, `blockedFrom` equals the occlusion position.
- [ ] **Step 3: Run to verify they fail.** Run: `npx vitest run tests/network.lesions.test.ts`. Expected: FAIL on the new tests, golden test passes.
- [ ] **Step 4: Implement.** `denseProfile(tree, seg, lesions: Lesion[])` applies every non-occluded lesion on the segment, each with half-window `lengthMm / 2` (entrance and exit shoulders scale with length, plateau fixed at the current ratio). Min over overlapping windows. `mkTerm` multiplies `Rmin` by `bedResistance[key] ?? 1`.
- [ ] **Step 5: Run the new test and the whole suite.** Run: `npx vitest run`. Expected: all pass, including `tests/cath.test.ts`.
- [ ] **Step 6: Commit.**
```bash
git add src/physics/network.ts src/physics/geometry.ts tests/network.lesions.test.ts
git commit -m "Network: lesion length, tandem lesions and per-bed resistance"
```

### Task 2: Live lesion overlay and real-time mode on `Simulation` [Cursor]

The procedure must change lesions and bed resistance without rewriting the scenario, and ischemia must evolve over seconds, not clinical minutes.

**Files:**
- Modify: `src/sim/simulation.ts` (`resolveCoronaries`, new methods), `src/config/lab.ts` (create)
- Test: `tests/labSim.test.ts`

**Interfaces:**
- Consumes: Task 1 `Lesion`, `bedResistance`.
- Produces on `Simulation`:
  - `setLive(lesions: Lesion[] | null, bedResistance?: Record<string, number>): void` (null returns to the scenario's lesions).
  - `liveOn(): boolean`.
  - `setRealtime(on: boolean): void`, which sets `minutesPerSecond` to `LAB.realtimeMinutesPerSecond` (1/60) and back.
  - `ischemiaTau` for real-time is `LAB.ischemiaTauSeconds` (see Step 4).

- [ ] **Step 1: Write failing tests** in `tests/labSim.test.ts`:
  - `live lesions override and release`: `setLive` with an LAD occlusion at 0.5 makes `wireModel(sim,"LAD").occluded` true; `setLive(null)` restores the scenario.
  - `scenario is not mutated`: `sim.scenario().lesions` equals the original after `setLive`.
  - `60 s balloon occlusion of the mid-LAD is visible`: realtime on, warmed normal patient, occlude mid-LAD, `sim.step(60)`: `sim.state().ecg` anterior ST elevation `>= 0.1` mV (reuse the field `tests/cath.test.ts` reads for STEMI) and MAP falls by `>= 5` mmHg or LV ejection fraction falls by `>= 0.03`.
  - `released balloon recovers`: after 60 s more with `setLive(null)`, ST elevation is back under half its peak.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/labSim.test.ts`. Expected: FAIL, `setLive` not defined.
- [ ] **Step 3: Implement** the overlay: `resolveCoronaries` uses `this.live ?? this.n.lesions` and passes `this.liveBed`.
- [ ] **Step 4: Calibrate.** If the 60 s test is too weak because ischemia dynamics (`src/physics/ischemia.ts`, the `sev` update in `Simulation.step`) are minutes-scale, add `LAB.ischemiaTauSeconds = 20 [assumed]` and apply it only while real-time mode is on (clinical mode unchanged: `tests/simulation.test.ts` and `tests/management.test.ts` stay green).
- [ ] **Step 5: Run the full suite.** Run: `npx vitest run`. Expected: PASS.
- [ ] **Step 6: Commit.**
```bash
git add src/sim/simulation.ts src/config/lab.ts tests/labSim.test.ts
git commit -m "Simulation: live lesion overlay and real-time mode for the lab"
```

---

## Phase B: Lesion biomechanics

### Task 3: Plaque model and dilation response [Cursor]

**Files:**
- Create: `src/lab/plaque.ts`, `src/config/plaque.ts`
- Test: `tests/labPlaque.test.ts`

**Interfaces:**
- Consumes: Task 1 `Lesion`.
- Produces:
```ts
export interface Plaque {
  segId: string; centerMm: number; lengthMm: number;
  ds: number;                 // 0..1 diameter stenosis at the narrowest point
  referenceMm: number;        // normal lumen diameter there
  eccentric: number;          // 0 concentric .. 1 one-sided
  eccentricAngleDeg: number;  // direction of the thickest wall, patient frame
  calcium: number; lipid: number; thrombus: number;   // 0..1 composition fractions
  remodel: "positive" | "negative" | "none";
  cto?: { ageMonths: number; capHardness: number; microchannels: boolean };
  stents: DeployedStent[];    // segments already stented
}
export interface DeployedStent { fromMm: number; toMm: number; diameterMm: number; expansionPct: number; apposition: number; strutUm: number }
export function plaqueToLesions(p: Plaque): Lesion[];
export type Dissection = null | "A" | "B" | "C" | "D" | "E" | "F"; // NHLBI grades
export interface DilationResult { plaque: Plaque; recoilPct: number; dissection: Dissection; perforationRisk: number; noReflowRisk: number; lumenGainMm: number }
export function dilate(p: Plaque, b: { type: "semi" | "noncompliant" | "cutting" | "scoring"; diameterMm: number; atXMm: number; lengthMm: number; pressureAtm: number }, rand: () => number): DilationResult;
export function deployStent(p: Plaque, s: { diameterMm: number; lengthMm: number; atXMm: number; strutUm: number; pressureAtm: number }, rand: () => number): DilationResult;
export function apparentStenosis(p: Plaque, viewAngleDeg: number): number; // what angiography reads in one projection
```
Constants in `src/config/plaque.ts` (all `[assumed]` unless noted): `calciumResistance 0.8` (fraction of expansion lost at calcium 1 with a plain balloon), `cuttingRelief 0.5` (share of that resistance a cutting or scoring balloon removes), `recoilBalloon 0.08`, `recoilStent 0.03` (`[lit]`, typical elastic recoil), `dissectionBase 0.08`, `overexpandLimit 1.2` (device to reference ratio above which edge injury rises `[lit]`), `noReflowThrombusWeight 0.6`, `noReflowLipidWeight 0.3`.

- [ ] **Step 1: Write failing tests** in `tests/labPlaque.test.ts`:
  - `plaqueToLesions of a clean plaque is empty`; of a 70 % plaque gives one lesion with `lengthMm` equal to the plaque's and `ds` 0.7; of a plaque with an old stent leaves the stent segment at its `expansionPct`-implied residual `ds` (a 100 % expanded stent contributes none).
  - `dilation lowers ds monotonically with pressure` for a soft plaque (calcium 0.1), 6 to 14 atm.
  - `calcium resists`: same balloon, calcium 0.9 leaves residual `ds >= 0.35` while calcium 0.1 leaves `<= 0.2`; a cutting balloon on calcium 0.9 leaves `<= 0.3`.
  - `recoil`: result lumen is smaller than the pre-deflation expanded lumen by the recoil fraction (balloon 8 %, stent 3 %).
  - `stent expansion`: a 3.0 mm stent at nominal pressure in a 3.0 mm reference vessel with calcium 0.1 reaches `expansionPct >= 90`; with calcium 0.9, `<= 75` (underexpansion).
  - `oversizing`: a stent 1.3x the reference gives `perforationRisk` and dissection probability at least double those at 1.0x.
  - `thrombus and lipid raise no-reflow risk`: `noReflowRisk` rises with each.
  - `eccentric lesions read differently by view`: eccentric 0.9, ds 0.7: `apparentStenosis` at the thick-wall angle and at +90 degrees differ by `>= 0.2`; concentric plaques read within 0.02 of each other.
  - `seeded draws repeat`: the same `rand` stream gives the same `dissection`.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/labPlaque.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** the signatures above. Approach: expanded diameter = `minD + (min(deviceD, 1.1 * referenceMm) - minD) * (1 - resistance)` where `resistance = calciumResistance * calcium * (1 - cuttingRelief if cutting or scoring)`; recoil then removes `recoil * expandedD`. Dissection and perforation risks are smooth logistic functions of overexpansion ratio, calcium and pressure over rated pressure; the draw compares `rand()` to the risk. `apparentStenosis` projects the eccentric wall thickness onto the view angle.
- [ ] **Step 4: Run to verify they pass.** Run: `npx vitest run tests/labPlaque.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.**
```bash
git add src/lab/plaque.ts src/config/plaque.ts tests/labPlaque.test.ts
git commit -m "Lab: plaque model with dilation, stent and projection response"
```

---

## Phase C: Access, route and devices

### Task 4: Device catalog [Cursor]

**Files:**
- Create: `src/config/labDevices.ts`
- Test: `tests/labDevices.test.ts`

**Interfaces:**
- Produces: discriminated union `Device = Sheath | GuideCatheter | Guidewire | Microcatheter | Balloon | Stent` each with `{ id, kind, name }` plus:
  - `Guidewire`: `diameterIn 0.014`, `tipLoadGf`, `stiffness: "floppy"|"intermediate"|"stiff"`, `coating`, `torque 0..1`, `tipTaperMm`, `support 0..1`.
  - `GuideCatheter`: `french 5|6|7`, `curve: "JL3.5"|"JL4"|"JL5"|"JR4"|"EBU3.5"|"XB3.5"|"AL1"|"AL2"`, `support 0..1`, `tipStiffness`.
  - `Balloon`: `nominalMm`, `lengthMm`, `type`, `nominalAtm`, `ratedBurstAtm`, `slopeMmPerAtm` (0.04 semi, 0.015 noncompliant `[assumed]`).
  - `Stent`: `nominalMm`, `lengthMm`, `strutUm`, `material: "DES"|"BMS"`, `nominalAtm`.
  - `export const CATALOG: Device[]`, `export const byId: Record<string, Device>`, `export function balloonDiameter(b: Balloon, atm: number): number`.
- Catalog contents: wires `floppy` (soft, hydrophilic), `workhorse` (intermediate), `stiff-cto` (high tip load, hydrophilic polymer), `rotawire-like` omitted (YAGNI); guides JL3.5, JL4, JL5, JR4, EBU3.5, XB3.5, AL1; balloons semi and noncompliant at 2.0 to 4.0 mm by 0.25 and lengths 12 and 20, plus one cutting and one scoring; stents 2.25 to 4.0 mm by 0.25 and lengths 8, 12, 18, 24, 28, 38. Nominal 8 atm, burst 16 (semi), 20 (noncompliant) `[assumed, typical IFU range]`.

- [ ] **Step 1: Write failing tests:** `ids are unique`; `every balloon diameter grows monotonically with pressure and equals nominalMm at nominalAtm`; `no stent is longer than 38 mm or thinner than 2.25 mm`; `byId resolves every catalog entry`; `a stiff CTO wire has a higher tipLoadGf than a floppy one`.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/labDevices.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the catalog as typed data and `balloonDiameter` as `nominalMm + slopeMmPerAtm * (atm - nominalAtm)`.
- [ ] **Step 4: Run to verify they pass,** then commit.
```bash
git add src/config/labDevices.ts tests/labDevices.test.ts
git commit -m "Lab: device catalog"
```

### Task 5: Access graph and routes [Cursor]

**Files:**
- Create: `src/lab/access.ts`, `src/lab/route.ts`
- Test: `tests/labAccess.test.ts`

**Interfaces:**
- Consumes: `buildTree()` and `Segment` from `src/anatomy/tree.ts`, `Curve`/`V3` from `src/anatomy/curve.ts`.
- Produces:
```ts
export type AccessSite = "femoral-R" | "femoral-L" | "radial-R" | "radial-L";
export interface AccessVariant { arch: "I" | "II" | "III"; iliacTortuosity: number; /*0..1*/ radialLoop: boolean; aorticRootMm: number; calcifiedIliac: boolean }
export interface VSeg { id: string; name: string; parent: string | null; attach: number; length: number; samples: V3[]; diameterMm: number[]; tortuosity: number; calcification: number }
export interface VGraph { segs: VSeg[]; byId: Record<string, VSeg>; ostium: Record<"LM" | "RCA", { segId: string; mm: number }> }
export function buildAccess(v: AccessVariant, coronaryRoot: V3[]): VGraph;       // aorta ends at the sinuses where the coronary ostia sit
export function unify(access: VGraph, tree: Tree): VGraph;                       // access graph plus coronary segments, same ids as the tree
export function routeTo(g: VGraph, site: AccessSite, target: string): string[];  // segment ids from the puncture to the target segment
export function curvatureAlong(g: VGraph, route: string[], fromMm: number, toMm: number): number; // radians turned
export function transmission(g: VGraph, route: string[], tipMm: number, supportScore: number): number; // 0..1, share of a push that reaches the tip
```
Segment ids: `FEM_R, FEM_L, ILIAC_R, ILIAC_L, AORTA_ABD, AORTA_THOR, ARCH, AORTA_ASC, RADIAL_R, SUBCLAV_R, BRACH_R, INNOM`. Reference lengths: femoral to bifurcation about 480 mm, abdominal aorta about 200 mm, arch about 150 mm `[assumed anatomy sketch]`; transmission is `exp(-0.35 * curvatureRad / (0.5 + supportScore))` `[assumed]`, with calcified iliac multiplying by 0.85.

- [ ] **Step 1: Write failing tests:**
  - `every access segment is connected`: parents exist, `attach` in [0,1], sample counts match, no NaN.
  - `routeTo reaches LM and RCA from all four sites` and the route is contiguous (child's parent is the previous id).
  - `the aorta ends at the coronary ostia`: distance from the last `AORTA_ASC` sample to the `LM` first sample is under 15 mm; same for `RCA`.
  - `arch III is more tortuous than arch I`: `curvatureAlong` over the arch is larger, and `transmission` to the LM is lower, for the same guide support.
  - `support helps`: a higher `supportScore` gives higher `transmission`.
  - `radial loop lowers radial transmission` below the same route without the loop; femoral routes are unaffected.
  - `transmission falls with distance`: tip further along gives a value that never increases.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/labAccess.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `Curve` splines through hand-set control points in the patient frame, ostia matched to the tree's `LM` and `RCA` first samples.
- [ ] **Step 4: Run to verify they pass,** then commit.
```bash
git add src/lab/access.ts src/lab/route.ts tests/labAccess.test.ts
git commit -m "Lab: access vessels, routes and force transmission"
```

---

## Phase D: Engine

### Task 6: Engine core, access, sheath and guide engagement [Cursor]

**Files:**
- Create: `src/lab/engine.ts`, `src/lab/complications.ts` (risk helpers stubbed to return 0 only if a later task owns them; Task 9 fills them)
- Test: `tests/labWire.test.ts` (first block)

**Interfaces:**
- Consumes: Tasks 3, 4, 5; `Simulation`.
- Produces:
```ts
export type Action =
  | { t: "access"; site: AccessSite; ultrasound?: boolean }
  | { t: "sheath"; french: 5 | 6 | 7 }
  | { t: "drug"; id: "heparin" | "nitro" | "adenosine" | "protamine" | "atropine"; dose: number }
  | { t: "select"; slot: "guide" | "wire" | "balloon" | "stent"; id: string }
  | { t: "advance"; mm: number }          // moves the active (most distal selected) device
  | { t: "torque"; deg: number }
  | { t: "shape"; tipBendDeg: number }
  | { t: "inject"; where: "LCA" | "RCA" | "LV" | "aorta"; ml: number }
  | { t: "inflate"; atm: number; seconds: number }
  | { t: "deflate" }
  | { t: "deploy"; atm: number; seconds: number }
  | { t: "carm"; rot: number; tilt: number }
  | { t: "close"; method: "manual" | "closure-device" };
export type LabEvent = { at: number; kind: string; text: string; severity: "info" | "caution" | "bad"; data?: Record<string, unknown> };
export interface LabState { access: AccessSite | null; sheathFr: number | null; act: number; guide: { id: string; engaged: "LM" | "RCA" | null; quality: number } | null; wire: { id: string; tipSeg: string; tipMm: number; bendDeg: number; rotDeg: number; route: string[] } | null; /* balloon, stent below */ contrastMl: number; fluoroSeconds: number; doseMGy: number; elapsedS: number; log: Action[] }
export class LabEngine {
  constructor(sim: Simulation, opts: { seed: number; access: AccessVariant; plaques: Plaque[] });
  state(): Readonly<LabState>;
  apply(a: Action): LabEvent[];     // pure of time except for sim.step on timed actions
  replay(actions: Action[]): LabEvent[];
  reset(): void;
}
```
Rules: `select guide` before `access`, or any device before `access`, returns an event with `severity: "bad"` and no state change. `access` ultrasound-guided halves access-bleed risk; radial plus `nitro` lowers spasm risk. Heparin raises `act` by `dose * 0.05` s per unit (up to 300) and ACT decays 1 s per 12 s `[assumed]`. Guide engagement quality = overlap of the guide curve's preferred ostium direction with the actual ostium given `aorticRootMm` and arch type (JL4 good at 35 mm root, JL3.5 and JL5 better at smaller and larger).

- [ ] **Step 1: Write failing tests:**
  - `no device before access`: `select guide` before `access` returns one "bad" event and leaves `state().guide` null.
  - `femoral access then guide to the LM`: access, sheath 6, select JL4, advance until engaged: `state().guide.engaged === "LM"` and `quality >= 0.7` at a 35 mm root.
  - `wrong curve engages worse`: JL3.5 at a 45 mm root gives `quality` lower than JL4 by `>= 0.15`; JR4 cannot engage the LM (`engaged !== "LM"`).
  - `heparin raises ACT and unheparinized wire work flags thrombus risk`: ACT 0 → after 5000 u `>= 250`; advancing a wire with ACT under 250 emits a "caution" event.
  - `replay is exact`: running the same action list on two fresh engines with the same seed gives deep-equal `state()` and event lists.
  - `reset restores a clean patient`: after any actions, `reset()` returns `state().log` empty and `sim` lesions back to the scenario.
- [ ] **Step 2: Run to verify they fail.** Run: `npx vitest run tests/labWire.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the reducer, seeded RNG (`mulberry32` from `src/physics/ecg.ts`), ACT decay on `elapsedS`, and engagement scoring.
- [ ] **Step 4: Run to verify they pass,** then commit.
```bash
git add src/lab/engine.ts src/lab/complications.ts tests/labWire.test.ts
git commit -m "Lab: engine core with access, sheath, heparin and guide engagement"
```

### Task 7: Wire mechanics [Cursor]

**Files:**
- Create: `src/lab/wire.ts`
- Modify: `src/lab/engine.ts` (route `advance`/`torque`/`shape` to the wire), `src/lab/complications.ts`
- Test: `tests/labWire.test.ts` (second block)

**Interfaces:**
- Consumes: Task 5 `transmission`, Task 3 `Plaque`, Task 4 `Guidewire`.
- Produces:
```ts
export interface AdvanceResult { tipSeg: string; tipMm: number; moved: number; event?: LabEvent; prolapse?: { seg: string; atMm: number } }
export function advanceWire(g: VGraph, st: LabState, w: Guidewire, plaques: Plaque[], guideSupport: number, mm: number, rand: () => number): AdvanceResult;
export function branchChoice(w: Guidewire, bendDeg: number, rotDeg: number, branchAngles: { id: string; angleDeg: number; diameterMm: number }[], rand: () => number): string;
export function crossingResistance(w: Guidewire, p: Plaque, tipLoadGf: number): number;  // 0..1, compared with push * transmission
```
Rules `[assumed]`: push available at the tip is `mm_force * transmission`; a plaque is crossed when available push exceeds `crossingResistance` (grows with `ds`, `calcium`, and for a CTO with `capHardness` and `1 - microchannels`); if not, the wire buckles and prolapses in the proximal segment (guide support and a second wire raise the push). A hydrophilic wire lowers resistance by 40 % but raises perforation and subintimal risk. A bend of 0 degrees stays in the larger branch; a 45 degree bend plus rotation toward a branch (`|rot - branchAngle| < 25`) enters that branch with probability 0.9, otherwise the main branch.

- [ ] **Step 1: Write failing tests:**
  - `a floppy wire crosses a 70 % soft lesion in the LAD`; `the same wire fails on a 95 % calcified lesion and prolapses` (event kind `"prolapse"`); `a stiff CTO wire crosses the 95 % lesion`.
  - `guide support matters`: the prolapsing case crosses with an `EBU3.5` guide (higher support) at the same push.
  - `branch selection`: with no bend the wire stays in the LAD past D1's origin; with a 45 degree bend and rotation matched to D1, over 200 seeded trials D1 is chosen in `>= 85 %` and the LAD otherwise; with a mismatched rotation `<= 25 %`.
  - `CTO behavior`: a stiff hydrophilic wire pushed on an occlusion with `microchannels: false` produces either `"subintimal"` or `"perforation"` within the first 20 mm at least 20 % of seeds, and never silently stops; a soft wire with `microchannels: true` crosses in at least 60 % of seeds.
  - `tip pressure is readable`: with a pressure wire selected, the engine returns `Pd/Pa` from `wireModel(sim, tipSeg).at({mm: tipMm})`, equal to the existing value to 1e-9.
- [ ] **Step 2: Run to verify they fail,** then **Step 3: implement** `advanceWire`, `branchChoice`, `crossingResistance`, wiring `perforation` and `subintimal` draws through `complications.ts` risk functions.
- [ ] **Step 4: Run to verify they pass,** then commit.
```bash
git add src/lab/wire.ts src/lab/engine.ts src/lab/complications.ts tests/labWire.test.ts
git commit -m "Lab: wire advance, torque, branch selection and lesion crossing"
```

### Task 8: Balloon and stent mechanics [Cursor]

**Files:**
- Create: `src/lab/balloonStent.ts`
- Modify: `src/lab/engine.ts` (`inflate`, `deflate`, `deploy`)
- Test: `tests/labDevices.test.ts` (second block)

**Interfaces:**
- Consumes: Task 3 `dilate`, `deployStent`; Task 2 `setLive`.
- Produces:
```ts
export function inflateBalloon(st: LabState, b: Balloon, atm: number, seconds: number, plaques: Plaque[], rand: () => number): { plaques: Plaque[]; events: LabEvent[]; occludesFlow: boolean };
export function deployStentAt(st: LabState, s: Stent, atm: number, seconds: number, plaques: Plaque[], g: VGraph, rand: () => number): { plaques: Plaque[]; events: LabEvent[]; jailed: { branchSeg: string; ostialDs: number }[] };
export function planSizing(refMm: number, lesionLenMm: number): { stentMm: number; lengthMm: number }; // helper the debrief uses
```
Rules: while inflated the vessel is occluded (flow stops; sim runs `seconds` with an occlusion at the balloon), and on deflation the new lumen is applied; inflation above `ratedBurstAtm` ruptures the balloon (event, forced dissection risk x3); a stent over a branch origin jails it with ostial `ds = 0.3 + 0.4 * (1 - branchDiameter / stentDiameter)` clipped to 0.8 `[assumed]`; stent landing zone shorter than the lesion plus 2 mm each side leaves edge disease (geographic miss: `ds` residual 0.3 at the uncovered end); a stent over a stent counts overlap.

- [ ] **Step 1: Write failing tests:**
  - `balloon then stent clears a 75 % soft LAD lesion`: residual `ds <= 0.15`, and `wireModel(sim,"LAD").ffr` goes from `<= 0.7` to `>= 0.9` after `applyToSim` (Task 10 completes this; here assert on the derived `plaqueToLesions` instead).
  - `inflation occludes flow for its duration`: `occludesFlow` is true while inflated and false after deflate.
  - `over-pressure ruptures`: 20 atm on a semi-compliant balloon rated 16 emits `"balloon-rupture"` and raises dissection frequency across 200 seeds from the 14 atm baseline by `>= 2x`.
  - `oversizing and under-sizing`: a 4.0 mm stent in a 2.5 mm vessel emits a "bad" `"oversized"` event; a 2.5 mm stent in a 3.5 mm vessel emits `"malapposed"` with `apposition < 0.8`.
  - `jailing`: a stent across D1's origin returns a `jailed` entry for `D1` with ostial `ds >= 0.3`; a stent placed distal to D1 does not.
  - `geographic miss`: a 12 mm stent on an 18 mm lesion leaves residual disease at the uncovered end and emits `"edge-disease"`.
  - `cannot withdraw inflated`: `advance` while a balloon is inflated returns a "bad" event and does not move the device.
- [ ] **Step 2: Run to verify they fail,** **Step 3: implement,** **Step 4: run to verify they pass,** then commit.
```bash
git add src/lab/balloonStent.ts src/lab/engine.ts tests/labDevices.test.ts
git commit -m "Lab: balloon inflation, stent deployment, jailing and sizing"
```

### Task 9: Complications [Cursor]

**Files:**
- Modify: `src/lab/complications.ts`, `src/lab/engine.ts`
- Test: `tests/labComplications.test.ts`

**Interfaces:**
- Produces: `export type Complication = "dissection" | "perforation" | "tamponade" | "no-reflow" | "spasm" | "access-bleed" | "retroperitoneal-bleed" | "ostial-dissection" | "air-embolism" | "arrhythmia-vf"`.
  - `export interface Effect { lesions?: Lesion[]; bedResistance?: Record<string, number>; bloodLoss?: number; tamponade?: number; rhythm?: "vf" | "vt" | "brady"; coronaryBlock?: { segId: string; posMm: number } }`
  - `export function risk(c: Complication, ctx: RiskContext): number` (0..1) and `export function draw(c: Complication, ctx: RiskContext, rand: () => number): Effect | null`.
  - `export function scriptedComplication(c: Complication, trigger: string): ForcedEvent` for cases (Task 13).
- Rules `[assumed]`, tied to hemodynamics:
  - Perforation: `tamponade` rises 0.05 per second until sealed (covered stent, protamine, or prolonged balloon inflation proximal to the leak seals it); tamponade is applied through a new `Simulation` preload factor.
  - No-reflow: `bedResistance` multiplier for the distal bed 3 to 6, resolving over 10 minutes unless treated with `nitro` or `adenosine`; epicardial TIMI stays 3 but the bed `ratio` stays low.
  - Spasm: radial or coronary lumen reduced 30 %, relieved by `nitro`.
  - Access bleed: `bloodLoss` rises 0.01 per minute for femoral without closure; radial manual hold stops it.
  - VF: draws from ischemia severity above 0.8 for more than 20 s, and from deep guide engagement in a critical LM stenosis.

- [ ] **Step 1: Write failing tests:**
  - `risk is monotonic` in its main drivers: perforation in tip load, calcium and oversize; no-reflow in thrombus; dissection in pressure.
  - `perforation → tamponade → hypotension`: after a forced perforation and 120 s with no seal, MAP is `>= 20 %` lower and pulsus (pulse pressure) narrows; a covered stent or protamine plus balloon seal ends the rise.
  - `no-reflow keeps TIMI 3 but leaves the bed starved`: `timi(...).grade === 3` and the territory terminal `ratio < 0.5`; `adenosine` or `nitro` restores it over time.
  - `femoral bleed lowers volume`: unclosed femoral access for 20 minutes raises `bloodLoss` by `>= 0.1`; `closure-device` stops it; radial does not bleed after a manual hold.
  - `VF triggers arrest`: a 60 s LM occlusion calls the existing arrest path; the engine emits `"arrest"` with `severity: "bad"`.
  - `forced complications are reproducible`: `scriptedComplication("no-reflow","post-stent")` fires exactly once, at the trigger, regardless of seed.
- [ ] **Step 2: Run to verify they fail,** **Step 3: implement** including the new `Simulation` hooks (tamponade factor into `circulation()` volume; arrest via the existing method used by `corosim_arrest`), **Step 4: run to verify they pass,** then commit.
```bash
git add src/lab/complications.ts src/lab/engine.ts src/sim/simulation.ts src/physics/circulation.ts tests/labComplications.test.ts
git commit -m "Lab: complications with hemodynamic consequences"
```

---

## Phase E: Hemodynamic coupling

### Task 10: Coupling layer [Cursor]

**Files:**
- Create: `src/lab/coupling.ts`
- Modify: `src/lab/engine.ts` (call `applyToSim` after every state change)
- Test: `tests/labCoupling.test.ts`

**Interfaces:**
- Produces:
  - `applyToSim(sim: Simulation, plaques: Plaque[], extra: { occlusions: Lesion[]; bedResistance: Record<string, number> }): void`, calling `plaqueToLesions`, `sim.setLive`.
  - `guideTrace(pa: number[], engagement: { quality: number; engaged: "LM" | "RCA" | null; ostialDs: number }): number[]`: damped aortic waveform (guide-tip pressure).
  - `contrastEffect(ml: number, egfr: number): { transientMapDrop: number; hrDelta: number; nephropathyRisk: number }`.
  - `wireReading(sim: Simulation, segId: string, mm: number): { pa: number; pd: number; ratioRest: number; ratioHyper: number }`.
- Rules `[assumed]`: `guideTrace` reduces pulse pressure by `0.5 * (1 - quality)`; if `ostialDs >= 0.7` and engaged in that ostium, diastolic pressure falls by up to 40 % (ventricularization) and the notch flattens. Contrast: 10 mL gives MAP down 3 mmHg for 15 s; nephropathy risk rises when `ml / egfr > 3.7` `[lit, contrast volume to eGFR ratio]`.

- [ ] **Step 1: Write failing tests:**
  - `FFR rises when the plaque is dilated`: for LAD 75 %, FFR (via `wireModel`) goes from `<= 0.7` to `>= 0.9` after a good balloon and stent, and `echoModel` anterior wall motion improves for a chronic ischemic patient.
  - `STEMI case restores flow`: LAD occlusion case; crossing the wire then deploying a stent returns `timi(...).grade === 3` and LV ST elevation falls under half its peak within 60 s of real-time stepping.
  - `jailed branch changes the territory`: after jailing D1, the D1 bed `ratio` is lower than before and `scenario().lesions` is unchanged.
  - `damped trace`: engagement quality 0.4 shrinks pulse pressure by `>= 20 %` versus 1.0; ostial `ds` 0.9 lowers diastolic by `>= 25 %`.
  - `contrast`: 180 mL at eGFR 40 (ratio 4.5, above 3.7) flags `nephropathyRisk` high; 60 mL at eGFR 90 (ratio 0.7) does not.
  - `reset releases the overlay`: `sim.liveOn()` is false after `engine.reset()`.
- [ ] **Step 2: Run to verify they fail,** **Step 3: implement,** **Step 4: run to verify they pass,** then commit.
```bash
git add src/lab/coupling.ts src/lab/engine.ts tests/labCoupling.test.ts
git commit -m "Lab: couple procedure state to the hemodynamic simulation"
```

---

## Phase F: Fluoroscopy and UI

### Task 11: Fluoroscopy renderer [Claude]

Runs against `LabEngineLike` and `StubLabEngine` (Task 0); switch to Cursor's `LabEngine` once Task 8 lands.

**Files:**
- Create: `src/cath/lab/fluoro.ts`
- Modify: `src/cath/angio.ts` (export `project`, accept an optional extra-segments model)
- Test: `tests/labFluoro.test.ts` (pure geometry only; canvas drawing is verified in the browser in Step 6)

**Interfaces:**
- Produces:
  - `deviceGeometry(st: LabState, g: VGraph): { guide: V3[]; wire: V3[]; wireTip: V3 | null; balloon?: { from: V3; to: V3; diameterMm: number }; stent?: { from: V3; to: V3; diameterMm: number }; markers: V3[] }` (patient-frame polylines, pure).
  - `class FluoroView { constructor(canvas: HTMLCanvasElement); setGraph(g: VGraph): void; setState(st: LabState, geom: ReturnType<typeof deviceGeometry>): void; draw(now: number): void }`.
- Rules: devices are drawn grayscale and radiopaque (wire thin dark line, balloon markers two small bars, stent a faint mesh with a denser outline), the C-arm uses the page's `rot` and `tilt`, cardiac motion scales with heart rate as in `AngioView`, contrast fills the access vessels only for aortic injection and the coronaries per the existing arrival model. Dose and fluoro time are on-screen counters.

- [ ] **Step 1: Write failing tests:** `deviceGeometry polyline starts at the puncture and ends at the tip`; `wire length equals tipMm along its route within 1 mm`; `balloon markers straddle the balloon length`; `no geometry when no device`; `projection of the wire tip is inside the canvas for default C-arm angles`.
- [ ] **Step 2: Run to verify they fail,** **Step 3: implement,** **Step 4: run to verify they pass.**
- [ ] **Step 5: Read `DESIGN.md`** and apply the visual rules (hairline frame, grayscale stage, caption "Figure 1." under the stage).
- [ ] **Step 6: Verify visually.** Start the dev server with `preview_start`, load the lab page (Task 12), screenshot a wire in the LAD at RAO caudal and LAO cranial, confirm foreshortening differs and the wire follows the vessel.
- [ ] **Step 7: Commit.**
```bash
git add src/cath/lab/fluoro.ts src/cath/angio.ts tests/labFluoro.test.ts
git commit -m "Lab: fluoroscopy renderer for access vessels and devices"
```

### Task 12: Lab page and controls [Claude]

**Files:**
- Create: `cath/lab/index.html`, `src/cath/lab/page.ts`, `src/cath/lab/panels.ts`, `src/cath/lab/lab.css`
- Modify: `vite.config.ts` (register the page the same way `cath/index.html` is registered; grep `cath` first), `src/cath/page.ts` (link "Open the lab"), `src/shell/shell.ts` only if the nav needs an entry
- Test: `tests/labPage.test.ts` (panel view-models only)

**Interfaces:**
- Produces: `panels.ts` exports pure view-model builders: `monitorModel(sim, engine)` (HR, Pa trace after `guideTrace`, Pd/Pa, ST, SpO2, ACT), `deviceShelf(engine)` (what can be selected now), `eventFeed(events)`, `procedureSummary(engine)`.
- UI: one dominant fluoroscopy stage; right rail unboxed with hairline dividers: device shelf (guide, wire, balloon, stent), a tip-shape control, pressure/inflation device (atm, hold seconds), contrast injection, drug list, ECG strip on pink paper (reuse `src/ecgStrip.ts`) and the pressure trace; a footer log of events. Keyboard: `W/S` advance and retract 2 mm (Shift: 10 mm), `A/D` torque 15 degrees, `[ ]` C-arm rotation, `Space` contrast, `I/O` inflate and deflate. All also have buttons and labels for accessibility. Prefers-reduced-motion respected.

- [ ] **Step 1: Write failing tests:** `deviceShelf offers only guides before access`; `after access and a guide it offers wires`; `the shelf disables stent selection with no wire across the lesion`; `monitorModel shows a damped trace when engaged in a critical ostium`; `eventFeed orders by time and caps at 200`.
- [ ] **Step 2: Run to verify they fail,** **Step 3: implement** page, panels, CSS following `CLAUDE.md`, **Step 4: run to verify they pass.**
- [ ] **Step 5: Run `npm run typecheck && npm run build`.** Expected: no errors.
- [ ] **Step 6: Verify in the browser** with `preview_start`: perform a scripted LAD PCI by keyboard, confirm the feed, FFR and ECG change, check console for errors, and screenshot desktop and a 375 px width.
- [ ] **Step 7: Commit.**
```bash
git add cath/lab/index.html src/cath/lab vite.config.ts src/cath/page.ts tests/labPage.test.ts
git commit -m "Lab: procedure page, device shelf, monitor and controls"
```

---

## Phase G: Cases, scoring, tools

### Task 13: Case library [Cursor]

**Files:**
- Create: `src/cath/lab/cases.ts`
- Test: `tests/labCases.test.ts`

**Interfaces:**
- Produces: `interface LabCase { id; title; blurb; scenario: Scenario; access: AccessVariant; plaques: Plaque[]; egfr: number; goals: string[]; forced?: ForcedEvent[]; recommended: { guide: string; wire: string; balloon?: string; stent?: string } }` and `LAB_CASES: LabCase[]`.
- Cases: (1) stable angina, mid-LAD 80 % soft; (2) inferior STEMI, RCA thrombotic occlusion, forced no-reflow after stent; (3) calcified mid-RCA, needs a cutting or noncompliant balloon; (4) LAD/D1 bifurcation (jailing decision); (5) RCA CTO, microchannels present; (6) tortuous iliac plus arch III radial-loop (access choice matters); (7) left main 90 % in a patient with eGFR 35 (contrast budget).

- [ ] **Step 1: Write failing tests:** `every case loads into a Simulation and a LabEngine`; `every recommended device id exists in CATALOG`; `a scripted recommended action list completes each case with final FFR >= 0.9 or TIMI 3 and no unplanned complication`; `forced events fire once at their trigger`; `plaque segIds all exist in the tree`.
- [ ] **Step 2: Run to verify they fail,** **Step 3: implement,** **Step 4: run to verify they pass,** then commit.
```bash
git add src/cath/lab/cases.ts tests/labCases.test.ts
git commit -m "Lab: case library with scripted complications"
```

### Task 14: Scoring and debrief [Cursor]

**Files:**
- Create: `src/lab/score.ts`
- Test: `tests/labScore.test.ts`

**Interfaces:**
- Produces: `export function scoreProcedure(engine: LabEngine, c: LabCase): { total: number; items: { id: string; label: string; points: number; max: number; note: string }[]; debrief: string[] }`.
- Rubric (`[assumed]`, 100 points): access choice and closure 10; anticoagulation (ACT 250 to 300 before wire, 5) 5; guide selection and engagement quality 10; wire handling without perforation or prolapse 10; device sizing (stent/ref 1.0 to 1.1, lesion coverage plus 2 mm) 20; deployment pressure and post-dilation of calcified stent 10; result (residual `ds <= 0.1`, final FFR or TIMI 3, no-reflow addressed) 20; complications recognized and treated 10; stewardship (contrast volume/eGFR below 3.7, fluoro time, air kerma) 5. Door-to-balloon (STEMI) replaces 5 of the stewardship points when applicable.

- [ ] **Step 1: Write failing tests:** `the recommended action list scores >= 90`; `a no-heparin run loses the anticoagulation points and says so`; `oversized stent loses sizing points`; `contrast over the eGFR ratio loses the stewardship points`; `debrief lines are sentence case with no emoji`; `scores are deterministic for the same log`.
- [ ] **Step 2: Run to verify they fail,** **Step 3: implement,** **Step 4: run to verify they pass,** then commit.
```bash
git add src/lab/score.ts tests/labScore.test.ts
git commit -m "Lab: scoring and debrief"
```

### Task 15: MCP tools [Cursor]

**Files:**
- Modify: `src/mcp/tools.ts`, `src/mcp/server.ts` as needed; add a link line to `src/shell/ai.ts` only if the AI shell lists tools
- Test: `tests/labMcp.test.ts` (follow the pattern in `tests/mcp.test.ts`)

**Interfaces:**
- Produces tools: `corosim_lab_start({ caseId?: string, seed?: number })`, `corosim_lab_act({ actions: Action[] })` (returns events plus a state summary), `corosim_lab_state()` (devices, plaques, hemodynamics, ACT, contrast, dose), `corosim_lab_score()`, `corosim_lab_hint({ level: 1 | 2 | 3 })` (graded hints from the recommended plan, no spoilers at level 1).

- [ ] **Step 1: Write failing tests:** `lab_start returns a case`; `lab_act runs a list and returns events`; `invalid action is rejected with a readable message`; `lab_score matches scoreProcedure`; `hint level 1 never names a device id`; `the same actions on the same seed give the same output`.
- [ ] **Step 2: Run to verify they fail,** **Step 3: implement,** **Step 4: run to verify they pass.**
- [ ] **Step 5: Run `npm run export:tools`** and check that the exported tool list contains the five new tools.
- [ ] **Step 6: Commit.**
```bash
git add src/mcp tests/labMcp.test.ts
git commit -m "MCP: drive and coach a cath-lab procedure"
```

### Task 16: End-to-end verification and review checklist [Cursor]

**Files:**
- Create: `tests/labEndToEnd.test.ts`, `docs/superpowers/specs/2026-11-07-cath-lab-simulator-design.md` (copy of the Design and Open decisions sections), `docs/cath-lab-clinician-review.md`

- [ ] **Step 1: Write the end-to-end tests:**
  - `full LAD PCI`: femoral access, heparin 5000 u, JL4 guide, workhorse wire across, predilate 2.5 mm at 10 atm, 3.0 x 24 stent at 14 atm, postdilate 3.25 NC at 16 atm, FFR before `<= 0.7` and after `>= 0.9`, TIMI 3, residual `ds <= 0.1`, score `>= 90`.
  - `STEMI`: RCA occlusion case, door to flow in under the case's clinical minutes budget, ST elevation resolves, forced no-reflow handled with adenosine.
  - `replay`: an action log from the first test replayed on a fresh engine matches state and events.
  - `performance`: one `apply` of an advance step including a re-solve takes under 50 ms median over 100 calls on the dev machine (`performance.now`).
  - `abandonment`: `reset()` mid-inflation leaves the sim identical to a fresh one (`scenario()` and `analysis.ffr` equal).
- [ ] **Step 2: Run the whole suite.** Run: `npx vitest run && npm run typecheck && npm run build`. Expected: all green.
- [ ] **Step 3: Write `docs/cath-lab-clinician-review.md`:** a table of every `[assumed]` constant in `src/config/{plaque,devices,lab}.ts` and `src/lab/access.ts`, with its value, meaning, and a blank "Reviewer" column; "Table 1." caption. Interventional-cardiologist review of wire crossing, sizing rules, complication rates and no-reflow recovery is required before the lab is described as realistic.
- [ ] **Step 4: Browser check of the full flow** (desktop and 375 px), screenshot proof in the PR. Claude does this step on the merged branch; Cursor does the rest of the task.
- [ ] **Step 5: Commit.**
```bash
git add tests/labEndToEnd.test.ts docs/superpowers/specs/2026-11-07-cath-lab-simulator-design.md docs/cath-lab-clinician-review.md
git commit -m "Lab: end-to-end tests, spec and clinician review checklist"
```

---

## Open decisions (defaults chosen; tell me if any is wrong)

1. **Femoral first, radial second.** Both routes exist from Task 5, but case 6 is where access choice matters.
2. **No IVUS/OCT or rotational atherectomy** in this plan. Both fit the same `Action` pattern later, and calcium is where they would earn their keep.
3. **No right-heart or structural access** (that belongs to the Structural tab).
4. **Wire shape is a single bend angle**, not a free-form shaping tool.
5. **Keyboard and button control, no haptics.**
6. **Roughly 200 to 300 lines per task of new code**, about 5,000 lines in total plus tests; Phases A and B are low-risk and unlock everything else.

## Self-review notes

- Spec coverage: insertion (T5, T6), guidewires (T7), devices (T4, T8), lesion biomechanics (T3), complications (T9), hemodynamic coupling with existing FFR, ECG and ischemia (T1, T2, T10), fluoroscopy and UI (T11, T12), cases, scoring and LLM driving (T13 to T15), verification (T16).
- Known risk: Task 2 Step 4 may need to retune ischemia time constants for seconds-scale inflation. If `LAB.ischemiaTauSeconds` is not enough to show an ST change in 60 s, escalate before Task 8 relies on it.
- Known risk: Task 1 changes the shared solver. The golden test must be captured first and stay green.
