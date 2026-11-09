# Unified Cath Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One cath page (`/cath/`) with Set up, Diagnose and Treat steps on the realistic fluoroscopy images, lesion sliders for any coronary artery, a hint and an undo, realistic peripheral vascular anatomy, the full 12-lead, and the same hemodynamic model as the main simulator (death, CPR, shock, pericardiocentesis).

**Architecture:** Keep the existing split: a pure engine in `src/lab/` (procedure state, seeded, replayable) feeding the shared `Simulation`, and canvas/DOM in `src/cath/`. Add a lesion-builder module, a pure `nextHint` function, replay-based undo, a peripheral vascular dataset baked from open sources, resuscitation actions on the engine, and a new page shell that composes the old diagnostic abilities and the lab. The old angiogram renderer is retired.

**Tech Stack:** TypeScript, Vite multi-page, Canvas 2D, Vitest. No new runtime dependencies (build-time scripts may use `tsx`, `ffmpeg`).

**Spec:** `docs/superpowers/specs/2026-11-09-unified-cath-page-design.md`. Earlier plan for the engine this builds on: `docs/superpowers/plans/2026-11-07-cath-lab-simulator.md`.

## Ownership and review (read first)

**Cursor builds every task, UI included.** Claude (Sonnet 5.5) does not build; it reviews. After each task Cursor stops and reports its commit; a Sonnet 5.5 review reads the diff against the task text (superpowers:requesting-code-review) and Cursor does not start the next task while findings are open. When all tasks land, Sonnet 5.5 runs the thorough UI review in Task 12. This reverses the 2026-11-07 plan, where Claude built the UI.

Branch: `cath-unified`, created in Task 0 from `claude/focused-hypatia-8c3bfd` (commit `475d2f8`), then merged with the latest `origin/main`. Work in its own worktree, not the main checkout.

## Global Constraints

- American English in UI copy, docs, comments and commit messages.
- UI follows `CLAUDE.md` and `DESIGN.md` (read both before any UI task): square hairline frames, no `border-radius` above 2px, no `backdrop-filter`, no tinted callout boxes, no card around every region (one dominant stage: the fluoro image), tracked uppercase labels for one role only, no new fonts or accent hues, no emoji, every figure and table captioned "Figure N." / "Table N.", the ECG on pink paper in both themes. Color means physiology: red, blue and amber only for abnormal, cold and caution states. Devices on fluoroscopy are grayscale.
- Patient frame, mm: x toward the patient's left, y toward the head, z anterior.
- Same seed plus same action log must give identical results (engine determinism); randomness via `mulberry32` from `src/physics/ecg.ts`.
- Constants in `src/config/*.ts` tagged `[lit]` or `[assumed]`; `[assumed]` ones go on the clinician-review list in Task 12.
- Educational only; keep the existing educational notice.
- Verification for every task: `npx vitest run && npm run typecheck`; Task 9 and 11 also `npm run build`.
- Commits use explicit paths (`git add <paths>`), never `git add -A`. One commit per task.
- New data from outside sources carries its license in `README.md` credits and `docs/CATH_PERIPHERAL_SOURCES.md`; share-alike (CC BY-SA) sources must be labeled as such.
- `src/lab/types.ts` may gain fields; never rename or remove one.

## Review Focus

1. Treating a non-LAD artery (RCA, LCx, a branch): the wire, balloon and stent must act on that vessel and its territory ischemia, not the LAD's (today `routeTo(..., "LAD")` is hard-coded in `src/lab/engine.ts`).
2. Undo right after a perforation, a no-reflow, an arrest or a death: it returns the patient to the state before the damaging action, including `sim.dead` and the pericardial effusion, and undo at the first action is a no-op, not an error.
3. A hint requested when the wire is off the route, in the wrong branch, past the lesion, or when no guide is engaged: it gives a safe corrective step (withdraw, re-engage) rather than "advance" into harm.
4. Lesion sliders at the extremes: severity 0 (no lesion), 100 percent (occlusion), a length longer than the segment, two lesions on one segment, a lesion on a branch the guide cannot reach: clamp or refuse with a message, never a NaN or a frozen page.
5. Editing lesions in Set up after treatment: a confirmation, then a clean procedure reset; moving between Diagnose and Treat never resets anything.

---

## File structure

Create (engine, pure):
- `src/lab/lesions.ts`: slider spec to `Plaque`, presets, `Scenario` derivation.
- `src/lab/hint.ts`: `nextHint`.
- `src/lab/resus.ts`: resuscitation action handlers on the engine (CPR, shock, pressors, fluids, pericardiocentesis, restart).
- `src/lab/peripheral.ts`: peripheral segment graph from baked data.
- `src/cath/data/peripheral.json`: baked centerlines and radii.
- `scripts/cath/peripheral/bake.ts`: reproducible bake from the open sources.
- `docs/CATH_PERIPHERAL_SOURCES.md`: source table and licenses.

Create (UI): `cath/index.html` (replaced), `src/cath/unified/{page,stepbar,setup,diagnose,treat,hintUi,ecg12,resus,unified.css}.ts|css`.

Modify: `src/lab/engine.ts`, `src/lab/types.ts`, `src/lab/wire.ts`, `src/lab/access.ts`, `src/cath/lab/fluoro.ts` (renderer reused), `src/cath/lab/camera.ts`, `src/cath/pullback.ts` (reused), `vite.config.ts`, `README.md`, `src/mcp/tools.ts` (undo and hint tools).

Retire (Task 10): `src/cath/angio.ts` old renderer and the old `src/cath/page.ts`, once the new page covers every old ability.

Tests: `tests/labLesions.test.ts`, `tests/labRoute.test.ts`, `tests/labUndo.test.ts`, `tests/labHint.test.ts`, `tests/labPeripheral.test.ts`, `tests/labResus.test.ts`, `tests/cathUnified*.test.ts`.

---

## Task 0: Branch, merge and rules

**Files:** Create `.cursor/rules/cath-unified.mdc`. No product code.

**Interfaces:** Produces the `cath-unified` branch every later task builds on.

- [ ] **Step 1:** `git fetch origin`; create the worktree `../corosim-cath-unified` on branch `cath-unified` from `claude/focused-hypatia-8c3bfd`; `npm ci`.
- [ ] **Step 2:** Merge `origin/main`. Resolve conflicts keeping both sides (CoroPump rename, case-screen from main; lab and fluoro realism from this line). Also cherry-pick or merge `origin/cursor/angio-fluoro-backdrop-c2d0` only if it merges cleanly and the cine backdrop still renders; otherwise note it in the commit message and skip.
- [ ] **Step 3:** Run `npx vitest run && npm run typecheck && npm run build`. Expected: green. If a test fails after the merge, fix the merge, not the test.
- [ ] **Step 4:** Add `.cursor/rules/cath-unified.mdc` (globs `src/lab/**,src/cath/**,tests/lab*.test.ts,tests/cathUnified*.test.ts`) restating: read `CLAUDE.md` and `DESIGN.md`; test first; touch only the task's files; seeded randomness; American English; explicit `git add`; stop and report after each task.
- [ ] **Step 5:** Commit `merge: cath-unified from realism line and origin/main`.

## Task 1: Lesion builder model

**Files:** Create `src/lab/lesions.ts`, `tests/labLesions.test.ts`. Modify `src/lab/types.ts` (add `LesionSlider`).

**Interfaces:**
- Produces:
  - `interface LesionSlider { segId: string; centerMm: number; lengthMm: number; ds: number }` (`ds` is fractional diameter stenosis, 0 to 1)
  - `segmentChoices(): { segId: string; label: string; lengthMm: number; parent: string | null }[]` (LM, LAD, LCx, RCA and D1, OM1, OM2, PDA, PLB)
  - `sliderToPlaque(s: LesionSlider): Plaque` (clamps `centerMm`, `lengthMm`, `ds` to the segment; soft plaque defaults as in `src/cath/lab/cases.ts`)
  - `plaquesToScenario(p: Plaque[], exertion: boolean): Scenario`
  - `OLD_PRESETS: { id: string; title: string; blurb: string; lesions: LesionSlider[]; exertion: boolean }[]` with the seven old cases (normal, mid-LAD 50, mid-LAD 75 on exertion, proximal LAD occlusion, proximal RCA occlusion, circumflex occlusion, left main 90).

- [ ] **Step 1: Write failing tests** in `tests/labLesions.test.ts`:
  - `it("clamps a lesion longer than the segment")`: `sliderToPlaque({segId:"LAD",centerMm:5,lengthMm:999,ds:0.7})` has `lengthMm <= segment length` and `centerMm - lengthMm/2 >= 0`.
  - `it("ds 0 yields no scenario lesion")`: `plaquesToScenario([sliderToPlaque({...,ds:0})], false).lesions` is empty.
  - `it("occlusion at 100 percent sets occluded")`.
  - `it("presets reproduce the old cases")`: for each of the seven presets, `plaquesToScenario` equals the old `src/cath/cases.ts` scenario within position tolerance 1 mm (import the old case list).
  - `it("two lesions on one segment both reach the solver")`.
- [ ] **Step 2:** Run `npx vitest run tests/labLesions.test.ts`; expect FAIL (module missing).
- [ ] **Step 3:** Implement per the signatures. Segment lengths come from the unified graph (`defaultUnifiedGraph()` in `src/lab/access.ts`), position 0 to 1 in old presets times segment length.
- [ ] **Step 4:** Run the test file and `npm run typecheck`; expect PASS.
- [ ] **Step 5:** Commit `feat: lesion slider model and old presets`.

## Task 2: Treat any vessel (remove the LAD hard-code)

**Files:** Modify `src/lab/engine.ts`, `src/lab/wire.ts`, `src/lab/route.ts`, `src/lab/types.ts`. Test `tests/labRoute.test.ts`.

**Interfaces:**
- Consumes: `routeTo(g, site, target)` in `src/lab/route.ts`.
- Produces: `Action` gains `{ t: "target"; segId: string }` (the vessel the user intends to treat); `LabState.targetSeg: string | null`; the wire route ends at `targetSeg`, defaulting to the first plaque's segment.

- [ ] **Step 1: Failing tests** (`tests/labRoute.test.ts`), each driving `LabEngine` with an action log through access, sheath, guide, engage, wire:
  - `it("wire routes to the RCA when the guide engaged the RCA")`: `state().wire.route` ends in `"RCA"` or a child, never `"LAD"`.
  - `it("wire routes to an OM branch via LCx")`: target `"OM1"` gives a route containing `"LM"`, `"LCX"`, `"OM1"`.
  - `it("stent in the RCA changes RCA territory ischemia only")`: after deploying across an RCA plaque, `sim` RCA-territory ischemia falls and LAD's is unchanged.
  - `it("a target the engaged guide cannot reach is refused with an event")`: target `"LAD"` with an RCA-engaged guide returns an event of severity `"caution"`.
  - One end-to-end test per old preset artery (LAD, RCA, LCx, LM) crossing and stenting its lesion.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Replace `routeTo(this.g, this.site, "LAD")` and the `?? "LAD"` fallbacks in `engine.ts` (`territorySeg`, wire select) with `this.targetSeg`. Guide select routes to `"LM"` or `"RCA"` from the target's ancestry.
- [ ] **Step 4:** Run `npx vitest run tests/lab*.test.ts` (all lab tests must still pass) and typecheck.
- [ ] **Step 5:** Commit `feat: treat any coronary vessel`.

## Task 3: Undo

**Files:** Modify `src/lab/engine.ts`, `src/lab/types.ts`, `src/mcp/tools.ts`. Test `tests/labUndo.test.ts`.

**Interfaces:**
- Produces on `LabEngineLike`: `undo(): LabEvent[]`, `canUndo(): boolean`, `undoCount: number` (practice aid; shown to the user and in the score, not hidden).

- [ ] **Step 1: Failing tests:**
  - `it("undo of a perforating advance restores pressure, effusion and tip")`: apply a log that perforates, call `undo()`, assert `state()` equals the state before that action (tip, `sim.dead === false`, effusion 0, no `perforation` event active).
  - `it("undo then the same action reproduces the same events")` (determinism).
  - `it("undo at the start is a no-op")`: no throw, `canUndo()` false.
  - `it("undo after death restores a living patient")`.
  - `it("undoCount increments and survives reset only as zero")`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement `undo()` as `replay(log.slice(0, -1))` (the engine is seeded and deterministic by design); guard cost by capping the stored log at the current procedure and measuring a 200-action replay in the test (must finish in under 2 s). Timed actions (`inflate`, `deploy` with seconds) undo as one unit.
- [ ] **Step 4:** Run lab tests and typecheck. Expose `lab_undo` in `src/mcp/tools.ts` following `tests/labMcp.test.ts`.
- [ ] **Step 5:** Commit `feat: undo for the lab procedure`.

## Task 4: Hint

**Files:** Create `src/lab/hint.ts`. Modify `src/lab/wire.ts` only to export pure helpers it already has (`branchChoice`). Test `tests/labHint.test.ts`.

**Interfaces:**
- Produces:
  - `type Hint = { kind: "advance" | "withdraw" | "torque" | "shape" | "engage" | "inject" | "select" | "inflate" | "deflate" | "deploy" | "wait" | "none"; mm?: number; deg?: number; bendDeg?: number; atm?: number; why: string; target?: { segId: string; mm: number } }`
  - `nextHint(engine: LabEngineLike, goal: { segId: string; centerMm: number }): Hint` (pure; never mutates the engine)

- [ ] **Step 1: Failing tests:**
  - `it("with no access, the hint is to gain access")`.
  - `it("with the wire in the wrong branch, the hint is to withdraw to the bifurcation then rotate by the angle that selects the right branch")`: assert `kind` order and that applying the hints reaches the goal branch.
  - `it("following hints from a fresh patient crosses and stents each old preset lesion without a complication")`: loop `apply(nextHint→Action)` up to 80 steps for each of the seven presets and assert goal met, `undoCount === 0`, no event with severity `"bad"`.
  - `it("hint never advances into a total occlusion without a crossing strategy")`: the hint for a 99 percent occlusion is a stiffer wire or a withdrawn, careful advance with `why` naming the risk.
  - `it("hint rotation matches what the wire model needs")`: the `deg` in a torque hint, applied, changes `branchChoice` to the target.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement as a planner over the engine's public `state()` plus the pure helpers: next missing step in the order access, sheath, heparin, guide, engage, target, wire, cross, predilate, stent size and length from the plaque, deploy, postdilate if apposition is low, final FFR. For tip motion, compute the arclength to the goal and the rotation the branch model needs. Each hint carries a one-sentence `why` in American English.
- [ ] **Step 4:** Run lab tests and typecheck.
- [ ] **Step 5:** Commit `feat: next-step hint for the lab procedure`.

## Task 5: Peripheral anatomy data

**Files:** Create `scripts/cath/peripheral/bake.ts`, `src/cath/data/peripheral.json`, `docs/CATH_PERIPHERAL_SOURCES.md`. Modify `README.md` credits. Test `tests/labPeripheral.test.ts` (data checks only).

**Interfaces:**
- Produces: `peripheral.json` shaped `{ segments: { id: string; parent: string | null; points: [number, number, number][]; radiusMm: number[] }[] }` in the patient frame, covering: aorta (arch to bifurcation), common and external and internal iliac (both sides), common femoral, profunda, superficial femoral, popliteal, anterior and posterior tibial, peroneal, dorsalis pedis (both legs), and upper limb: subclavian, axillary, brachial, radial, ulnar (both arms), plus carotid and vertebral origins.

**Reference images and data (searched 2026-11-09; licenses read from the Wikimedia Commons API; the builder re-checks each on its file page and records the result in `docs/CATH_PERIPHERAL_SOURCES.md`).**

These are references for how the access route is drawn. They are **not embedded** in the site: the renderer draws vessels from baked centerlines, so no share-alike image ships. The only embedded media stays the cine backdrop (Alextogus, CC BY-SA 4.0, already credited). Download them with `scripts/cath/peripheral/fetch-refs.ts` into untracked `scripts/cath/work/refs/`, and commit only the manifest.

*Femoral route: aorta, iliacs, femoral and run-off*

| File on Commons | License | What it shows | What it fixes in our drawing |
|---|---|---|---|
| `Leriche-Syndrom-DSA.jpg` (Hellerhoff) | CC BY-SA 3.0 | DSA aortogram, both iliacs occluded, lumbar collaterals | abdominal aorta caliber and bifurcation level; the look of a catheter-injected aortogram; a "no femoral route" teaching variant |
| `AAA i AAIC.jpg`, `Catheterization selective angiography.JPG` (Milorad Dimic) | CC BY 3.0 rs / CC BY-SA 3.0 | abdominal aortic aneurysm and iliac arteries; a catheter in place | aortic and iliac tortuosity and dilatation; how a catheter lies in the aorta |
| `PSA iliaca.jpg` (Marta.burrel) | CC BY-SA 4.0 | aortoiliac angiogram, pseudoaneurysm at the right common iliac | iliac origin angles; the iliac-injury complication |
| `Neutral popliteal artery angiogram.png`, `Angiogram of a patient diagnosed with popliteal artery entrapment syndromes.png` (Minhle90) | CC BY-SA 4.0 | popliteal angiograms in neutral and provocative positions | popliteal course and caliber |
| `Multiple nearly occlusion of left superficial femoral artery and stented.jpg` (Drquochoai) | CC BY-SA 4.0 | SFA with multiple near-occlusions and a stent | SFA course, a stented segment's look on fluoro |
| `Angiography of the right foot with posterior tibial arteriosclerosis.jpg` (Cerevisae) | CC BY-SA 4.0 | foot angiogram | distal tibial and pedal branching |
| `M.Buerger 1.JPG` (Milorad Dimic), `Abdominal CT angiography.jpg` | GFDL / CC BY 3.0 | CT angiography of leg vessels and abdomen | distal runoff pattern, bifurcation level |
| `Femoral-artery-grays-illustrations.jpg` (Radiopaedia), `Femoral artery.svg` (InjuryMap) | CC BY-SA 4.0 | lower-limb arterial tree diagrams | branch names and order: CFA, profunda, SFA, popliteal, ATA, PTA, peroneal |

*Radial route: subclavian, supra-aortic trunks, arch and root*

| File on Commons | License | What it shows | What it fixes in our drawing |
|---|---|---|---|
| `Arteriografia de troncs supra-aòrtics. IMG 2507.JPG` (Amadalvarez) | CC BY-SA 4.0 | arteriogram of the supra-aortic trunks | brachiocephalic, left common carotid and left subclavian origins off the arch; the radial-route path |
| `Takayasu Arteritis.jpg` (Justin Ly, MedPix) | public domain | LAO arch angiogram | arch shape and branch origins in an oblique view |
| `Dysphagia lusoria.JPG` (Michel Royon) | CC BY-SA 3.0 | aberrant right subclavian artery | an arch-variant case where the radial route is hard (a plan-level teaching variant, not a build target now) |
| `Dissecting aneurysm 01.jpg` (Jojo) | public domain | aortography of a dissecting aortic aneurysm | the look of a catheter aortogram in the thoracic aorta; the dissection complication |
| `Gray506.png`, `Gray505.png`, `Thoracic aorta.jpg`, `Aortic arch with vessels.png` | public domain | Gray's arch and heart plates | arch and root anatomy cross-check; coronary ostia heights |
| `Radial artery catheterization.jpg`, `Introducer sheaths.jpg`, `Radial Compression Device.jpg`, `Vascular closure device.jpg` | CC BY-SA 3.0 / 4.0 | radial and femoral access hardware and sites | sheath and closure device look for the access and closing steps |
| `Ensemble des voies par lesquelleson peut pratiquer le catheterisme du coeur et des gros vaisseaux.png` (Claude Bernard) | public domain | historical diagram of catheter routes | route sanity check |

*Coronary PCI device look (for Task 7's device overlay, same approach)*

- `File:CAG+PTCA 67Yrs Male (N).jpg` (Suyash Dwivedi, about 1,560 frames, 1280 x 720, CC BY-SA 4.0, "Angioplasty case 0001"): a real PTCA cine. Reference for how guide, wire, balloon and stent look on fluoro and how contrast fills the artery.

*3D and data sources (centerlines and caliber)*

| Source | Use | License as found | Verify |
|---|---|---|---|
| BodyParts3D (DBCLS), whole-body meshes incl. arteries | centerlines and radii by skeletonizing the artery meshes | CC BY 4.0 on the current license page (older releases CC BY-SA 2.1 Japan) | which release is downloaded |
| Nevit Dilmen STL models on Commons (`3DPX-002591 CE Abdominal CTA`, `3DPX-003309`, `Aortic Aneurism 76F 3D SR`) | real CT-derived aorta, iliac and arch surfaces for centerlines | CC BY-SA 3.0 (share-alike) | each file page; derived centerline data is then CC BY-SA 3.0 and labeled so |
| Vascular Model Repository (vascularmodel.com), aortofemoral models | tortuosity, taper, branch angles | "free for research and development"; exact text not found | terms on the site; skip if not compatible |
| TotalSegmentator CT dataset (Zenodo 10.5281/zenodo.6802613) | aorta and iliac variability | CC BY 4.0 per secondary sources; femoral is not a labeled class | the Zenodo license field and label list |

I did not find a clean normal bilateral run-off DSA or a normal radial-to-arch angiogram on Commons. The builder searches once more (Commons categories "Digital subtraction angiography of peripheral vascular disease", "Aortography", "Interventional angiography"; NIH Open-i for CC BY figures in open-access PMC case reports) and, if none is usable, draws the normal anatomy from the Gray's plates, the diagram files and the pathology images above, marking those segments `"origin": "assumed"`.

**What the access route must look like (acceptance for Tasks 5 to 7).**

- Femoral: sheath in the common femoral artery, up the external then common iliac, across the aortic bifurcation (about the L4 level), up the abdominal then descending thoracic aorta, over the arch (type I, II or III as `AccessVariant.arch`), to the aortic root; with iliac tortuosity and calcification parameters visibly changing the course.
- Radial: radial, brachial, axillary, subclavian, brachiocephalic (right) or the left subclavian origin, then the arch to the root; with the radial loop and subclavian tortuosity options.
- Each camera view reads like the reference class it matches (DSA aortogram, iliac, run-off, arch), including the catheter lying in the lumen.

- [ ] **Step 1: Failing tests** (`tests/labPeripheral.test.ts`):
  - `it("every segment has monotone arclength and matching radius count")`.
  - `it("both legs and both arms are present with the expected ids")`.
  - `it("radius tapers distally: CFA > SFA > popliteal > tibials")` (tolerances from typical adult values: aorta about 20 mm, CFA about 8, SFA about 6, popliteal about 5, tibial about 3; cite `[lit]` in config).
  - `it("the bifurcation joins the iliacs within 2 mm")`.
  - `it("sources doc lists a license row for every data source used")` (parse the markdown table).
  - `it("no reference image or its pixels is committed")` (the repo has no file under `src/` or `public/` matching a manifest entry's filename or hash).
  - `it("every segment names the reference it was checked against, or is marked assumed")`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Write `scripts/cath/peripheral/fetch-refs.ts` (downloads the reference images above into untracked `scripts/cath/work/refs/` and writes a manifest with title, author, license, URL, and the feature each informs) and `bake.ts` (reproducible: downloads meshes into the same untracked folder, skeletonizes, resamples to about 2 mm spacing, writes the JSON). Where a source is not usable, hand-define the centerline from the references and mark the segment `"origin": "assumed"` in the JSON and the sources doc. Compare the baked centerlines with the reference images and record, per segment, which image it was checked against.
- [ ] **Step 4:** Run tests, typecheck.
- [ ] **Step 5:** Commit `feat: baked peripheral vascular anatomy and source licenses`.

## Task 6: Peripheral graph and access routes

**Files:** Create `src/lab/peripheral.ts`. Modify `src/lab/access.ts`, `src/lab/route.ts`. Test `tests/labAccess.test.ts` (extend).

**Interfaces:**
- Consumes: `peripheral.json` (Task 5), `buildAccess`, `unify`.
- Produces: `loadPeripheral(): VSeg[]`; `buildAccess` now uses real aorta, iliac and femoral or upper-limb segments for `femoral-R/L` and `radial-R/L`, keeping the arch variants and tortuosity parameters; `routeTo` reaches any peripheral segment.

- [ ] **Step 1: Failing tests:** femoral and radial routes still end within 15 mm of the LM and RCA ostia (existing test); `it("route from femoral-L passes the left iliac and aortic bifurcation")`; `it("radial route passes subclavian and the arch")`; `it("iliac tortuosity increases route curvature")`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement per the Interfaces; keep existing complication hooks (dissection, loop) pointing at the same segment ids.
- [ ] **Step 4:** Run all lab tests, typecheck.
- [ ] **Step 5:** Commit `feat: access routes on real peripheral anatomy`.

## Task 7: Peripheral rendering and run-off views

**Files:** Modify `src/cath/lab/fluoro.ts`, `src/cath/lab/camera.ts`, `src/cath/body.ts`. Test `tests/labFluoro.test.ts`, `tests/cathBody.test.ts` (extend).

**Interfaces:** Produces camera presets `"aortogram" | "iliac" | "runoff" | "arm"` and contrast injection sites for `Action inject where` extended to `"aorta-abd" | "iliac-R" | "iliac-L"`; vessels drawn as lumens with taper, tortuosity and calcified-wall cues, in the realistic backdrop style.

- [ ] **Step 1: Failing tests:** `it("femoral route is drawn end to end: sheath at the CFA, iliacs, aortic bifurcation, aorta, arch, root, all in one Follow-device sequence")`; `it("radial route is drawn end to end: radial, brachial, axillary, subclavian, brachiocephalic or left subclavian origin, arch, root")`; `it("a guide in the aorta is drawn as a catheter lying in the lumen with its curve")`; `it("runoff camera frames both legs with every peripheral segment inside the field")`; `it("lumen width follows baked radius within 10 percent in pixels")`; `it("distal vessels fill later than proximal (contrast transit)")`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Extend the renderer to draw the new segments; add the leg and pelvis structures to the backdrop (pelvis, femurs) so the runoff view looks like a real DSA field; add camera presets. Match each preset to its reference class in the Task 5 tables (Leriche-style DSA aortogram for `aortogram`, the iliac angiograms for `iliac`, the popliteal, SFA and foot angiograms for `runoff`, the supra-aortic arteriogram and the Takayasu LAO arch for `arm`); device look (guide, wire, balloon, stent) is checked against the `CAG+PTCA 67Yrs Male` frames. Do not embed any reference image.
- [ ] **Step 4:** Run tests, typecheck, `npm run build`. Build an untracked dev-only comparison page (`scripts/cath/work/compare.html`) that shows each preset beside its reference image, and capture one screenshot per preset for the Task 12 review.
- [ ] **Step 5:** Commit `feat: peripheral vessels and run-off views on fluoro`.

## Task 8: Resuscitation and hemodynamic parity

**Files:** Create `src/lab/resus.ts`. Modify `src/lab/engine.ts`, `src/lab/types.ts`. Test `tests/labResus.test.ts`.

**Interfaces:**
- Produces new `Action` members: `{ t: "cpr"; on: boolean }`, `{ t: "shock"; joules: number; sync?: boolean }`, `{ t: "pressor"; id: "norepi" | "epi" | "phenylephrine"; dose: number }`, `{ t: "fluid"; ml: number }`, `{ t: "pericardiocentesis"; ml: number }`, `{ t: "restart" }`; each routes to the existing `Simulation` methods (`setCpr`, shock, drug give, `restartPatient`, `src/sim/arrest.ts`) so the patient dies, arrests, is shocked and recovers exactly as in the main simulator. No second arrest or hemodynamic model.

- [ ] **Step 1: Failing tests:**
  - `it("an unsealed perforation left alone ends in tamponade, arrest and death with sim.dead true")`.
  - `it("pericardiocentesis of the effusion restores pressure and cuts the tamponade rate")`: drained volume equals `min(ml, effusion)`; BP rises; draining a non-effusion does nothing and says so.
  - `it("VF then shock then ROSC reproduces the main simulator's outcome for the same seed")` (compare against `Simulation` driven directly).
  - `it("pressor and fluid change MAP in the main model's direction")`.
  - `it("restart after death gives a living patient and clears the arrest state")`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement the handlers; move the engine's `effusion` into a drain path. Find the existing method names in `src/sim/simulation.ts` (around lines 1300 to 1410) and `src/page/arrest.ts`; do not duplicate their logic.
- [ ] **Step 4:** Run lab and simulation tests (`tests/simulation.test.ts` must stay green), typecheck.
- [ ] **Step 5:** Commit `feat: resuscitation and pericardiocentesis in the lab`.

## Task 9: Unified page shell and Set up step

**Files:** Create `src/cath/unified/{page.ts,stepbar.ts,setup.ts,unified.css}`; replace `cath/index.html`; modify `vite.config.ts`. Test `tests/cathUnifiedSetup.test.ts`.

**Interfaces:**
- Consumes: `OLD_PRESETS`, `sliderToPlaque`, `plaquesToScenario`, `segmentChoices` (Task 1).
- Produces: `interface UnifiedState { step: 1 | 2 | 3; lesions: LesionSlider[]; exertion: boolean; engine: LabEngineLike; sim: Simulation }`; `mountUnified(root: HTMLElement): UnifiedState`; `setLesions(state, lesions, exertion): void` (resets the procedure after a confirm when the engine has actions).

- [ ] **Step 1: Failing tests (DOM, via the repo's existing test host):**
  - `it("shows the three-step bar and starts on Set up")`.
  - `it("selecting a preset fills the sliders; changing a slider updates the plaque and the angiogram model")`.
  - `it("rest/exertion toggle changes the scenario; the 75 percent preset loads with exertion on")`.
  - `it("editing lesions after treatment asks first, and cancel keeps the stent")`.
  - `it("moving between steps never resets the engine")`.
  - `it("every figure and table on the page has a caption")`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Build the page: a step bar (hairline, sentence case), the fluoro stage as the dominant region (reuse `src/cath/lab/fluoro.ts` and `camera.ts`), a Set up panel with preset list, artery select, three sliders (position, severity, length) per lesion, add/remove lesion, exertion toggle, and a "Treat this vessel" target. Unboxed side panels divided by hairlines.
- [ ] **Step 4:** Run tests, typecheck, `npm run build`. Start the dev server and take a screenshot.
- [ ] **Step 5:** Commit `feat: unified cath page shell and Set up step`.

## Task 10: Diagnose and Treat steps, hint, undo, resuscitation, 12-lead

**Files:** Create `src/cath/unified/{diagnose.ts,treat.ts,hintUi.ts,ecg12.ts,resus.ts}`. Modify `src/cath/unified/page.ts`, `unified.css`. Retire `src/cath/angio.ts` and `src/cath/page.ts` (delete only after the checks in Step 5 pass). Tests `tests/cathUnifiedDiagnose.test.ts`, `tests/cathUnifiedTreat.test.ts`.

**Interfaces:**
- Consumes: Tasks 1 to 8; `src/cath/pullback.ts`; `src/ekg/paper.ts` (12-lead paper) with `Simulation.ecgInputs()`; the existing lab panels.
- Produces: Diagnose (inject LCA/RCA/LV/aorta, C-arm, vessel names, pullback, FFR, TIMI readout); Treat (access, devices, wire, balloon, stent, complications log); **Hint** button that draws the next hint as a ghost arrow on the fluoro and a one-line reason, with a "Show me" toggle that applies it; **Undo** button (disabled at start, shows `undoCount`); a resuscitation strip (CPR, shock, pressor, fluids, pericardiocentesis, restart) enabled when relevant; a collapsible full 12-lead band under the image on all three steps, driven live by the simulation.

- [ ] **Step 1: Failing tests:**
  - `it("Diagnose reproduces each old preset's TIMI flow and pullback gradient within the old page's tolerances")`.
  - `it("hint button shows a reason and, on Show me, performs the action")`.
  - `it("undo after a perforation restores the picture and the monitor")`.
  - `it("12-lead renders twelve labeled leads and ST rises in the infarct leads after a proximal LAD occlusion")`.
  - `it("death shows a clear state with a restart control, and CPR and shock appear when arrest starts")`.
  - `it("pericardiocentesis control appears with tamponade and drains the effusion")`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement the steps per the Interfaces, composing existing modules rather than copying them.
- [ ] **Step 4:** Run tests, typecheck, build; screenshot each step for Task 12.
- [ ] **Step 5:** Verify nothing still imports `src/cath/angio.ts` or `src/cath/page.ts` (`grep -r`), delete them, run everything again.
- [ ] **Step 6:** Commit `feat: diagnose, treat, hint, undo, resuscitation and 12-lead on the unified page`.

## Task 11: Routes, MCP, docs

**Files:** Modify `vite.config.ts`, `src/mcp/tools.ts`, `docs/CATH_LAB_INTEGRATION.md`, `README.md`. Test `tests/labMcp.test.ts` (extend).

- [ ] **Step 1: Failing tests:** `it("/cath/lab/ and /cath/lab/play/ redirect to /cath/")` (built output check); `it("mcp hint and undo tools return the hint and the state")`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Redirect the old lab routes; add `lab_hint` and `lab_undo` (undo from Task 3) tools; update the docs and README credits for every new data source.
- [ ] **Step 4:** Run `npx vitest run && npm run typecheck && npm run build`; expect green.
- [ ] **Step 5:** Commit `feat: routes, MCP hint and undo, docs`.

## Task 12: Sonnet 5.5 UI review (review only; no building)

Run by the reviewer (Sonnet 5.5), not Cursor. The reviewer starts the dev server, loads `/cath/`, and works through each item, reporting findings with a screenshot and file:line.

- [ ] **Step 1: Design system.** Read `DESIGN.md` and `CLAUDE.md`; check every UI rule in Global Constraints against the page (radius, glass, tinted callouts, cards, tracked labels, fonts, accents, emoji, captions, ECG paper in both themes). Run the Impeccable design hook findings and treat them as real unless a false positive is named.
- [ ] **Step 2: Flow.** Set up, Diagnose and Treat for each of the seven old presets and one custom lesion on each of LAD, LCx, RCA and a branch; confirm images are the realistic baseline everywhere (no leftover old renderer).
- [ ] **Step 3: Hint and undo.** Follow only hints to finish each preset; perforate on purpose then undo; request a hint while off route.
- [ ] **Step 4: Peripheral and access.** Walk the femoral and the radial route end to end in Follow mode and compare every camera preset with its reference image (the comparison page from Task 7; references in `docs/CATH_PERIPHERAL_SOURCES.md`) for branching, taper, bifurcation level, arch type, tortuosity and how the catheter lies in the lumen. Report where it looks wrong in plain terms ("iliacs too straight", "arch too flat"), with the reference file name.
- [ ] **Step 5: Hemodynamics.** Let a perforation run to tamponade and death; restart; repeat with pericardiocentesis; CPR and shock in VF; compare against the main simulator.
- [ ] **Step 6: Responsive and themes.** Phone width, tablet, light and dark.
- [ ] **Step 7: Review list.** Check the `[assumed]` constants list for a clinician and report a prioritized finding list with severity. Cursor fixes in a follow-up commit; the reviewer re-checks.

---

## Self-review notes

- Spec coverage: three-step page (Tasks 9, 10), realistic baseline and retiring the old renderer (10), presets and sliders (1, 9), any-vessel treatment (2), 12-lead (10), shared hemodynamics including death and pericardiocentesis (8, 10), hint (4, 10), undo (3, 10), peripheral anatomy (5 to 7), Sonnet UI review (12), cases later (out of scope, as in the spec).
- Known risk: replay-based undo cost; Task 3 sets a 2 s budget for 200 actions and says what to do if it is missed (add snapshots).
- Known risk: peripheral source licenses are unverified; Task 5 makes verification a test-backed step.
- Not changed: wire rotation feel. It is a separate follow-up after unification (hint rotation values in Task 4 must still match the wire model as it is).
