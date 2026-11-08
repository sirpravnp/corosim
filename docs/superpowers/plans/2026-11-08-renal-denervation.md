# Renal Denervation (RDN) — standalone real-time procedure simulator

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A **separate, real-time** catheter simulator for teaching bilateral renal sympathetic denervation: access, angiography, wire and catheter manipulation, RF or ultrasound energy delivery, coverage scoring, and complications. It does **not** plug into CoroSim's `Simulation`, MCP patient state, or the coronary playground.

**Architecture:** A DOM-free procedure engine (`src/rdn/`) holds a 1D device model on an abdominal vascular graph (femoral or radial access → aorta → renal arteries and segmental branches). Wall-clock time advances contrast washout, ablation dwell, impedance/temperature feedback, spasm, and a procedure timer (fluoro minutes, dose proxy). A **local monitor model** (`src/rdn/physiology.ts`) gives optional teaching vitals (MAP/HR trends vs denervation coverage %) for debrief only — not beat-by-beat hemodynamics. A new Vite page (`rdn/index.html`) renders fluoroscopy and the monitor from engine state. Every user action is a reducible `Action` with a seeded RNG for reproducible cases.

**Tech stack:** TypeScript, Vite multi-page, Canvas 2D, Vitest. No new npm dependencies. No imports from `src/sim/simulation.ts`, `LiveHeart`, or coronary `src/lab/` coupling layers.

**Spec:** This document is the spec until `docs/superpowers/specs/2026-11-08-rdn-simulator-design.md` is confirmed.

**Relation to CoroSim:** Same repo and design system (`DESIGN.md`, `CLAUDE.md`). Home/library may link to `/rdn/` as its own experience. The main simulator tab is unchanged.

---

## Design decisions

1. **Real time is first-class.** `RdnEngine.tick(dtMs)` runs on the page's animation frame (or a fixed 50 ms step when paused). Ablation requires holding energy for `RDN.ablationDwellS` real seconds per lesion; moving the catheter mid-dwell interrupts and may warn. Contrast opacity decays with `RDN.contrastHalfLifeS`. Fluoro time accumulates whenever the X-ray is on.
2. **1D on a graph, same lesson as cath lab.** Devices are `{ routeSegs; tipMm }` on `RdnGraph`. Forces and support follow the cath-lab pattern (curvature transmission) but code lives under `src/rdn/`, not `src/lab/`, so PCI and RDN can ship independently.
3. **Denervation is spatial coverage, not a patient patch.** Each artery keeps `coverage: Float32Array` (0..1 denervation per mm along the main and branch segments). Bilateral main + branch targets set a **procedure score**; the stub MAP model reads total coverage, nothing is written to `corosim_adjust`.
4. **Modality switch.** Cases or device shelf pick **radiofrequency** (impedance drop, temperature cap) or **ultrasound** (circumferential preset sectors, no impedance). Constants in `src/config/rdn.ts`, tagged `[lit]` or `[assumed]`.
5. **Teaching arteries, not patient CT.** Centerlines are analytic or lightly templated (length, diameter taper, early branching). Optional later: import a static JSON graph; no voxel heart required for v1.
6. **Determinism.** Seeded complication draws; replay `Action[]` + seed → identical `coverage` and events (timestamps in ms for real-time replay use the same dt stream).

---

## Global constraints

- American English in copy, comments and commits.
- UI: one dominant fluoroscopy stage; hairline divisions; no card chrome per `DESIGN.md`.
- Educational notice on the page; output is not clinical advice.
- Fluoroscopy overlay is grayscale; color only for cautions (complication, cap breach).
- Verification: `npx vitest run tests/rdn*.test.ts`, `npm run typecheck`, `npm run build`.
- `git add <paths>` per commit, not `git add -A`.

---

## Review focus

1. Ablation with the tip in a branch ostium vs in the parent: coverage maps differ; overtreating a stenotic branch raises stenosis complication risk.
2. Withdrawing the catheter during active RF: dwell resets; learner sees "energy interrupted."
3. Bilateral case cannot "complete" until both sides meet minimum longitudinal overlap and branch quota.
4. Replay of a scored case reproduces the same coverage heatmap and debrief numbers.
5. No import path from `src/rdn/` into `src/sim/` (enforce with a small `tests/rdnIsolation.test.ts` that fails if `simulation.ts` or `mcp/tools.ts` references `src/rdn`).

---

## File structure

### Engine (pure)

| File | Role |
|------|------|
| `src/rdn/types.ts` | Contract: graph, devices, actions, events, state, `RdnEngineLike` |
| `src/rdn/graph.ts` | `buildRdnGraph(variant)`, renal ostia, branch angles |
| `src/rdn/route.ts` | Arc length, advance, torque into branch |
| `src/rdn/engine.ts` | Reducer + `tick(dtMs)` |
| `src/rdn/ablation.ts` | Dwell, overlap rules, modality physics |
| `src/rdn/contrast.ts` | Inject and decay along segments |
| `src/rdn/complications.ts` | Spasm, dissection, access hematoma, non-target (iliac) |
| `src/rdn/coverage.ts` | Score vs guideline pattern (SPYRAL-style spacing `[assumed]`) |
| `src/rdn/physiology.ts` | Stub MAP/HR for debrief vs coverage (decoupled from core engine) |
| `src/rdn/score.ts` | Rubric and debrief text |
| `src/rdn/stub.ts` | `StubRdnEngine` for UI-first work |
| `src/config/rdn.ts` | Dwell, spacing, complication rates, monitor gains |

### UI

| File | Role |
|------|------|
| `rdn/index.html` | Page shell |
| `src/rdn/page.ts` | Frame loop, input, bind engine |
| `src/rdn/fluoro.ts` | Project graph + devices + coverage heat |
| `src/rdn/panels.ts` | Monitor, device shelf, event feed, timers |
| `src/rdn/rdn.css` | Styles |
| `src/rdn/cases.ts` | Resistant HTN, fibromuscular dysplasia angle, etc. |

### Wiring

| File | Change |
|------|--------|
| `vite.config.ts` | Register `rdn` entry |
| `src/home.ts` or library | Optional link card to RDN lab |
| `tests/rdn*.test.ts` | Engine, ablation, real-time tick, isolation |
| `docs/RDN_SIMULATOR.md` | Clinician checklist, what is `[assumed]` |

**Explicitly out of scope for v1:** MCP tools, `Simulation` coupling, 3D mesh, hemodynamic waveforms, ECG.

---

## Real-time loop (page)

```
onFrame(ts):
  dt = min(ts - lastTs, 100)
  if (!paused && xrayOn) engine.tick(dt)
  fluoro.draw(engine.state())
  panels.sync(engine.state(), engine.eventsSinceLastFrame())
```

`tick` responsibilities:

- Advance `procedureTimeMs`, `fluoroMs` if C-arm live.
- Decay contrast per segment.
- If `energyOn`, integrate dwell at current `tipSeg`/`tipMm`; update impedance or US sector progress; merge into `coverage`.
- Resolve spasm recovery tau in real seconds.
- Emit events on thresholds (overlap gap, temperature cap, completion).

---

## Actions (initial set)

| Action | Effect |
|--------|--------|
| `access` | femoral-R/L or radial-R/L |
| `sheath` | French size |
| `select` | guide / wire / ablation catheter |
| `advance` / `torque` | mm, degrees (branch entry rules) |
| `inject` | aorta or renal side; ml → contrast field |
| `carm` | rotation, angulation (projection for fluoro) |
| `xray` | on/off |
| `energy` | on/off (modality-specific) |
| `spasmRx` | nitroglycerin dose (from shelf) |
| `close` | access closure; ends case |

---

## Phase 0 — Contract

### Task 0: Types and stub

**Files:** `src/rdn/types.ts`, `src/rdn/stub.ts`, `tests/rdnStub.test.ts`

- [ ] `RdnEngineLike`: `state()`, `graph()`, `apply(Action)`, `tick(dtMs)`, `replay`, `reset`
- [ ] Stub script: access → renal L → ablate → renal R → close
- [ ] Tests: stub advances tip; `tick` increases `procedureTimeMs`

---

## Phase 1 — Graph and devices

### Task 1: `RdnGraph`

**Files:** `src/rdn/graph.ts`, `tests/rdnGraph.test.ts`

- [ ] Segments: `CFA`, `EIA`, `AO_INFRA`, `AO_SUPRA`, `RENAL_L`, `RENAL_L_1..3`, mirror R
- [ ] Ostia positions, diameters 4–7 mm taper, branch takeoff angles
- [ ] Variant: tortuous renal, early bifurcation (case hooks)

### Task 2: Route and advance

**Files:** `src/rdn/route.ts`, `src/rdn/engine.ts` (partial), `tests/rdnRoute.test.ts`

- [ ] Wire + guide + ablation catheter lengths; support decay with curvature
- [ ] Branch selection: wire bend + torque → probability into segmental branch

---

## Phase 2 — Real-time ablation and contrast

### Task 3: Contrast

**Files:** `src/rdn/contrast.ts`, tests

- [ ] Inject raises segment opacity array; exponential decay in `tick`
- [ ] Selective renal injection requires wire past ostium

### Task 4: Ablation

**Files:** `src/rdn/ablation.ts`, `src/config/rdn.ts`, `tests/rdnAblation.test.ts`

- [ ] RF: dwell 8–12 s `[assumed]` per site; min spacing along artery; impedance curve
- [ ] US: sector buttons as actions `sector {0..3}`; circumferential coverage
- [ ] `coverage` merge with max; gaps penalized in score
- [ ] Real-time tests use fake `tick(100)` loops, not `Simulation`

### Task 5: Complications

**Files:** `src/rdn/complications.ts`, tests

- [ ] Spasm on wire manipulation; NTG relaxes over 5–15 s real time
- [ ] Dissection risk if oversized device or excessive push
- [ ] Non-target: energy with tip in aorta/iliac → event + score penalty

---

## Phase 3 — Engine completion

### Task 6: `RdnEngine` reducer

**Files:** `src/rdn/engine.ts`, `tests/rdnEngine.test.ts`

- [ ] Full action set; seeded RNG; event log
- [ ] Bilateral completion flag when L/R coverage thresholds met

### Task 7: Stub physiology and score

**Files:** `src/rdn/physiology.ts`, `src/rdn/score.ts`, `src/rdn/coverage.ts`, tests

- [ ] MAP debrief: baseline 165 → minus up to 12 mmHg at 100 % patterned coverage `[assumed]`
- [ ] Rubric: access, anticoagulation (if modeled), selective angio, spacing, bilateral symmetry, complications, fluoro time

---

## Phase 4 — UI

### Task 8: Fluoroscopy

**Files:** `src/rdn/fluoro.ts`, `tests/rdnFluoro.test.ts` (projection math only)

- [ ] AP and LAO/RAO projections; devices as lines; coverage as thin heat along centerline
- [ ] Caption: Figure 1. Renal angiography (simulated).

### Task 9: Page and panels

**Files:** `rdn/index.html`, `src/rdn/page.ts`, `src/rdn/panels.ts`, `src/rdn/rdn.css`, `vite.config.ts`

- [ ] Dominant fluoro; monitor strip (HR, MAP stub, SpO2 placeholder); fluoro timer
- [ ] Device shelf: guide, wire, RF vs US catheter
- [ ] Energy button hold-to-treat or toggle with dwell feedback bar
- [ ] Debrief modal on `close` with score + coverage maps

### Task 10: Cases

**Files:** `src/rdn/cases.ts`, one scripted test `tests/rdnCaseResistantHtn.test.ts`

- [ ] Resistant hypertension: straightforward anatomy; teach bilateral pattern
- [ ] Optional: tortuous renal — harder wire support

---

## Phase 5 — Docs and polish

### Task 11: `docs/RDN_SIMULATOR.md`

- [ ] Checklist of `[assumed]` constants
- [ ] Explicit "not connected to CoroSim hemodynamics"

### Task 12: Isolation test

**Files:** `tests/rdnIsolation.test.ts`

- [ ] Grep or static import guard: no `src/sim/simulation` from `src/rdn/*`

---

## Done when

| Criterion | |
|-----------|---|
| Learner completes bilateral RDN in real time with dwell and contrast | |
| Debrief shows coverage and stub MAP change; no CoroSim URL params | |
| `npm run build` includes `/rdn/` | |
| All `tests/rdn*.test.ts` pass | |

---

## Open decisions

| # | Question | Default |
|---|----------|---------|
| D1 | RF hold vs click-to-apply dwell | Hold-to-treat (teaches continuous contact) |
| D2 | Anticoagulation / ACT | Omit in v1; note on checklist |
| D3 | Share `src/lab/route.ts` vs duplicate | Duplicate in `src/rdn/route.ts` for isolation; refactor later if both stabilize |
| D4 | Ultrasound in v1 | RF only for MVP; US behind `modality` flag in Task 4 |

---

## Task prompt (Cursor)

Paste the task section plus: "Read `CLAUDE.md`, `DESIGN.md`, and `src/rdn/types.ts`. This is **not** the CoroSim hemodynamic simulator: do not import `Simulation` or change `src/sim/*`. Write failing tests first. Report `vitest` and `typecheck` output."
