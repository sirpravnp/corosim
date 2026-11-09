# Unified cath page: design

Date: 2026-11-09. Status: draft for approval.

## Intent

CoroSim has two cath pages that should be one. The old diagnostic page (`/cath/`) has seven preset cases, a pressure pullback and FFR, but poor angiogram images. The newer PCI lab (`/cath/lab/`) has the realistic fluoroscopy images and a procedure engine (access, guide, wire, balloon, stent, complications) but only treats the LAD and has no preset cases or lesion builder. The user wants one page where a learner sets up a patient, diagnoses with angiography and physiology, and treats, all on one realistic image and one shared patient.

This is a playground first, in the spirit of the hemodynamic playground: explore freely, no required goals or scoring. Scripted cases come later and reuse the same page in sequence.

## Goals

1. One page at the existing cath URL with a three-step bar: **1 Set up, 2 Diagnose, 3 Treat**. The user can move back and forth at any time.
2. The realistic fluoroscopy rendering (cine backdrop, ribs, diaphragm, lumen vessels, radiopaque devices) is the baseline image in every step. The old angiogram renderer is retired.
3. **Set up** offers two paths to the same patient:
   - the seven old preset cases (normal coronaries, mid-LAD 50%, mid-LAD 75% on exertion, proximal LAD occlusion, proximal RCA occlusion, circumflex occlusion, left main 90%);
   - a lesion builder with sliders: choose the artery, then position along it, severity (percent diameter stenosis) and lesion length. More than one lesion can be placed.
4. **Diagnose** keeps the old diagnostic abilities: inject contrast, C-arm rotation (LAO/RAO, cranial/caudal), pressure pullback, FFR, TIMI-style flow readout.
5. **Treat** keeps the PCI abilities (access, guide, wire, balloon, stent, complications) and works on whichever artery the user blocked, not only the LAD.
6. One shared patient: lesions set in step 1 drive steps 2 and 3, and treatment in step 3 changes what step 2 shows when the user goes back.
7. **Full EKG** on the page: the complete 12-lead tracing, on the project's pink ECG paper, driven by the same patient (ischemia, ST changes, rhythm, arrest). It updates live as lesions are set, balloons inflate, stents deploy and complications occur. (My interpretation of "full EKG" as 12-lead; today the lab shows only leads II and V3.)
8. Every figure and table is captioned, per the project UI rules.
9. **Hint.** A hint button that, at any point in the procedure, shows the correct next step: the rotation and advance (or withdrawal) needed to reach the lesion, then the device and inflation steps, with a one-line reason. It is safe: off route or past the lesion it says to withdraw or re-engage, never to push on.
10. **Undo.** An undo for when the user perforates or does something damaging. It returns the patient (vessel, pressures, effusion, alive or dead) to before the last action. It is a practice aid: the count of undos is shown and enters the score.
11. **Realistic peripheral anatomy.** Aorta, iliacs, femoral and leg run-off, and the upper-limb access path (subclavian to radial), built from open-source reference data and images, with licenses recorded. Aortogram, iliac, run-off and arm views on the realistic fluoro look.
    The access route is drawn end to end for both access sites: femoral (sheath, iliacs, aortic bifurcation, aorta, arch, root) and radial (radial, brachial, subclavian, brachiocephalic or left subclavian, arch, root). Reference images are real peripheral and aortic angiograms from Wikimedia Commons (licenses recorded in `docs/CATH_PERIPHERAL_SOURCES.md`); they guide the drawing and are not embedded.
12. **Same hemodynamic model as the main simulator.** The patient can arrest, be shocked, receive CPR, pressors and fluids, tamponade and die, and recover, and pericardiocentesis drains an effusion. No second hemodynamic model.
13. **Ownership and review.** Claude owns all UI (page, rendering, controls, CSS); Cursor does everything else (engine, data, simulation, MCP, docs). Claude reviews Cursor's commits, and a fresh Sonnet 5.5 reviewer runs a thorough UI review at the end (plan Task 12).

## Non-goals

- No scripted cases, goals or scoring in this phase. Cases are a later phase that supplies step 1 and walks the user through.
- No IVUS/OCT, rotational atherectomy, or right-heart/structural access (unchanged from the original lab spec).
- No new physics model; use the existing core engine and lab engine.

## Anti-goals (failure even if it technically works)

- Two angiogram looks on one page, or a regression to the old poor images.
- Treat still silently routing to the LAD when another artery is blocked.
- A 12-lead that does not respond to what the user does to the vessels.
- A generic dark-dashboard look. The page follows `DESIGN.md` and the project UI rules (square hairline frames, solid surfaces, no tinted callouts, color means physiology).

## Constraints

- Baseline code: the `claude/focused-hypatia-8c3bfd` worktree (commit `475d2f8`), which has the realism work and the lab engine. It predates the newest `origin/main` (CoroPump rename, case-screen), so the first step is a new branch that merges `origin/main` into it. Also consider `origin/cursor/angio-fluoro-backdrop-c2d0` (baked real cine backdrop for the old page) during that merge.
- American English everywhere.
- Lesion model bridge: the old presets use `Scenario.lesions` (`artery`, `stenosis`, `position` 0 to 1, `occluded`); the lab uses `Plaque` (`segId`, `centerMm`, `lengthMm`, `ds`, composition) via `plaqueToLesions()`. The sliders produce a Plaque, and the Scenario the simulator uses is derived from it, so the two never disagree.
- Existing tests (`tests/lab*.test.ts`, `tests/cath*.test.ts`) must keep passing; new behavior gets tests.

## Decisions made with the user

- Layout is the guided three-step flow (option B of the layout mockups), not modes or an all-visible screen.
- Playground first; cases later, sequentially, on the same page.
- Realistic fluoro images are the baseline.

## My calls (please check)

- Lesion builder covers LM, LAD, LCx, RCA and their main branches (D1, OM1, OM2, PDA, PLB) as selectable arteries; position and length are in millimeters along the chosen segment, with the slider's range set by that segment's length.
- Presets load into the same builder, so a preset is just starting slider values the user can then change.
- The 12-lead is shown on the Set up, Diagnose and Treat steps (a collapsible band under the image), because ischemia is meaningful in all three.
- The Treat engine's route target is derived from the guide's engaged coronary (LM or RCA) and the selected target vessel, replacing the hard-coded `routeTo(..., "LAD")` in `src/lab/engine.ts`.

## Answers from the project (added after the builder check)

- **12-lead already exists.** `src/ekg/paper.ts` draws a 3 x 4 12-lead plus rhythm strip on pink paper, and `Simulation.ecgInputs()` returns the injury vector, T-wave boost, and potassium derived from the ischemic sites. The lab page already drives a two-lead `EcgStrip` from the same simulation, so the work is wiring the 12-lead paper to the same inputs, not building an ECG generator. Balloon inflation and complications already reach ischemia through the shared simulation.
- **One patient already shared.** The lab engine steps the same `Simulation` instance the monitor and ECG read (`src/lab/coupling.ts`). The unified page keeps that single simulation as the source of truth; a deployed stent or perforation updates the plaque and the simulation, and Diagnose reads from them.
- **Vessel geometry.** The lab's vascular graph and camera already name LM, LAD, LCx, OM1, OM2, RCA, PDA and PLB, and the fluoro view has C-arm angles. Drawing every artery at every angle in the realistic style, and verifying it, is in scope; the builder must check coverage early and flag gaps.
- **Existing tests.** `tests/cath.test.ts` and `tests/cathBody.test.ts` touch the old angiogram code. Tests of retired rendering are rewritten for the new renderer; engine and scenario tests stay as they are.
- **Exertion.** The old "Mid-LAD 75%, on exertion" preset sets `exertion: true`. Step 1 gets a rest/exertion toggle, and that preset loads with it on.

## More calls of mine (please check)

- The routes `/cath/lab/` and `/cath/lab/play/` keep working until the unified page replaces them, then redirect to `/cath/`.
- Going back to Set up and changing lesions resets the procedure (access, devices, stents, complications), after a one-line confirmation, because a treated vessel no longer matches the edited one. Moving between Diagnose and Treat never resets anything.

## Left to the builder

- Exact component structure, CSS, and file layout under `src/cath/`.
- How the step bar preserves state when moving back (store, URL, or in-memory).
- Smoothing the wire rotation and steering feel in Treat. The user finds it shaky; investigate in `src/lab/wire.ts` (currently a single bend angle plus rotation), as a separate task after the page unification.

## Open for later phases

- Cases layer that sequences set-up, diagnosis and treatment steps and supplies scenarios (reusing `src/cath/lab/cases.ts`).
- Whether old URLs (`/cath/lab/`, `/cath/lab/play/`) redirect to the unified page.
