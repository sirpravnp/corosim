# Echo Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the echo atlas into a simulator: a movable probe on the 3D heart, a live labeled ideal slice, and an echo pane that is stylized from our model and crossfades to a real loop near calibrated standard views.

**Architecture:** Everything is computed from the heart's signed distance function (`heartSdf`, `partAt`). A `ProbeState` (chest position, tilt, rotation) maps to the existing `Pose`. `sampleSlice(pose)` evaluates the SDF on the scan sector into a small grid. Pane 2 draws chambers and labels from that grid. Pane 3 stylizes the same grid to look like ultrasound, and a blend weight (distance from the nearest standard-view preset) fades in the real loop.

**Tech Stack:** TypeScript, Vite, three.js (pane 1), Canvas 2D (panes 2 and 3), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-echo-simulator-design.md`

## Global Constraints

- American English in copy, comments and commit messages.
- UI follows `CLAUDE.md` and `DESIGN.md`: square hairline frames, no border-radius above 2px, no backdrop-filter, no tinted callout boxes, no cards around every region, no emoji, no new accent hues, every figure captioned "Figure N.".
- Color means physiology: do not use red, blue or amber for chrome. Chamber colors in pane 2 reuse `PART_COLOR` from `src/echo/scene.ts`.
- All geometry is in the patient frame, mm: x toward the patient's left, y up toward the head, z anterior (as in `src/echo/poses.ts`).
- Clips ship only with license, author and source in the manifest (`IMAGES` in `src/echo/views.ts`). Only CC BY or CC0 or CC BY-SA, as today.
- The heart is schematic. The page keeps the existing note that ribs, lungs and sternum are not modeled.
- Verification commands: `npx vitest run tests/<file>`, `npm run typecheck`, `npm run build`.
- The working tree has many uncommitted changes unrelated to echo. Every commit uses explicit paths with `git add <paths>`, never `git add -A`. Per project memory, branch from the latest `origin/main` first (fetch, then branch), because the checkout is stale.

## Review Focus

1. A probe placed where the sector misses the heart entirely: pane 2 and 3 show an empty sector and a hint, with no errors.
2. A probe dragged inside the heart or far off the chest shell: it stays on the shell.
3. A pose whose lateral axis is nearly parallel to the up vector (a degenerate basis): the probe orientation stays defined and does not flip.
4. Switching views quickly while a clip is loading: the old clip stops, no stale frame shows.
5. Reduced-motion and no-WebGL browsers: panes 2 and 3 still work without pane 1, and the existing "could not be drawn" message shows.

---

### Task 1: Slice sampler

**Files:**
- Create: `src/echo/slice.ts`
- Test: `tests/echoSlice.test.ts`

**Interfaces:**
- Consumes: `Pose` and `SECTOR` from `src/echo/poses.ts`; `heartSdf`, `partAt`, `Part`, `gradient` from `src/anatomy/heartSurface.ts`; `toHeart` from `src/echo/poses.ts`.
- Produces:
  - `interface Slice { w: number; h: number; part: Int8Array; sdf: Float32Array; facing: Float32Array; inSector: Uint8Array; mmPerPx: number }`. `part` holds a `Part` value or -1 outside the heart. `facing` is the absolute cosine between the beam and the surface normal, 0 away from walls. `inSector` is 1 inside the fan.
  - `sampleSlice(pose: Pose, w?: number, h?: number): Slice` with defaults 240 by 240. Pixel (x, y) maps to a point on the image plane: depth `y/h * pose.depth` along the beam, lateral offset from the fan geometry (probe at top center).

- [ ] **Step 1: Write the failing tests** in `tests/echoSlice.test.ts` (use `buildPoses()`):
  - `"marks the middle of the sector as inside the heart for every preset"`: the pixel nearest `pose.target` has `part >= 0`.
  - `"a PLAX slice holds LV, LA and the aorta; no right atrium"`: the set of `part` values over the slice includes `Part.LV`, `Part.LA`, `Part.Aorta` and excludes `Part.RA`.
  - `"is empty when the sector misses the heart"`: a pose with the probe moved 400 mm along `-lateral` gives no pixel with `part >= 0`.
  - `"keeps pixels outside the fan out of the image"`: corners have `inSector === 0`.
- [ ] **Step 2: Run** `npx vitest run tests/echoSlice.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `sampleSlice`** in `src/echo/slice.ts`. Convert each pixel to a patient-frame point, call `toHeart`, then `heartSdf` and `partAt`. Use `gradient(heartSdf, p)` normalized for `facing`, computed only where `|sdf| < 3` mm.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git add src/echo/slice.ts tests/echoSlice.test.ts && git commit -m "Echo: sample the heart on the scan plane"`.

### Task 2: Pane 2, the labeled ideal slice

**Files:**
- Create: `src/echo/sliceView.ts`
- Modify: `echo/index.html`, `src/echo/echo.css`, `src/echo/page.ts`
- Test: `tests/echoSlice.test.ts` (append)

**Interfaces:**
- Consumes: `Slice`, `sampleSlice` (Task 1); `PART_COLOR` (export it from `src/echo/scene.ts`).
- Produces:
  - `labelPoints(s: Slice): { text: string; x: number; y: number }[]`: one entry per chamber present with at least 150 px, at the centroid of its largest connected region, text from `PART_NAMES` short forms ("LV", "RV", "LA", "RA", "Ao").
  - `drawSlice(canvas: HTMLCanvasElement, s: Slice, opts: { labels: boolean }): void`.
  - `markerLabels(pose: Pose, s: Slice): { text: string; x: number; y: number }[]`: valve markers (see Task 8 for content; returns `[]` until then).

- [ ] **Step 1: Write failing tests:** `"labels each chamber once, at a point inside that chamber"` (for each label, `part[y*w+x]` equals that chamber), and `"gives no labels for an empty slice"`.
- [ ] **Step 2: Run** `npx vitest run tests/echoSlice.test.ts`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement `labelPoints` and `drawSlice`.** Chambers filled with `PART_COLOR` at 0.6 alpha on near-black, a one-pixel outline where `|sdf| < 1.2` mm, a hairline fan edge, and labels in the page's sans font when `opts.labels`. Add the pane to `echo/index.html` as a `figure` with a "Labels" toggle (a real `<button aria-pressed>`) and caption "Figure 2. Ideal slice of the simulator's heart at the probe's plane."
- [ ] **Step 4: Wire `page.ts`:** on every pose change call `sampleSlice` then `drawSlice`; keep the labels state in module scope; when the slice is empty show the hint "The beam misses the heart. Move the probe toward the sternum." in the pane.
- [ ] **Step 5: Run** the tests, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** the touched files by path.

### Task 3: Probe state and chest shell

**Files:**
- Create: `src/echo/probe.ts`
- Modify: `src/echo/poses.ts` (export `landmarks`-derived `HEART_CENTER` if needed)
- Test: `tests/echoProbe.test.ts`

**Interfaces:**
- Consumes: `Pose`, `buildPoses`, `landmarks` from `poses.ts`.
- Produces:
  - `interface ProbeState { u: number; v: number; tilt: number; rotate: number }`: `u` and `v` are chest-shell coordinates (longitude and latitude in radians, 0,0 at the sternum's left border over the heart), `tilt` and `rotate` in radians.
  - `chestPoint(u: number, v: number): V3` and `chestNormal(u: number, v: number): V3` for an ellipsoid shell fitted around the heart with `SKIN` clearance (my call; ribs are not modeled).
  - `stateToPose(s: ProbeState, depth?: number): Pose`: probe on the shell, beam toward the heart centre then tilted by `tilt`, lateral from `rotate` about the beam, `marker` along `lateral`, `target` at depth 70 mm along the beam.
  - `poseToState(p: Pose): ProbeState`: least-squares nearest state (project the probe to the shell, derive tilt and rotate).
  - `clampState(s: ProbeState): ProbeState` keeps `(u, v)` on the allowed patch (the front-left of the chest and the subcostal region) and `|tilt| <= 0.7`.
  - `PRESETS: Record<string, ProbeState>` built from `buildPoses()` through `poseToState`.

- [ ] **Step 1: Write failing tests:**
  - `"round-trips every preset pose within 8 mm and 5 degrees"`: `stateToPose(poseToState(pose))` against `pose` for probe position and beam direction.
  - `"keeps the probe outside the heart for any clamped state"`: sample a grid of states, `insideHeart(stateToPose(clampState(s)).probe)` is false.
  - `"returns an orthonormal beam and lateral for any state, including the poles"`: dot near 0, lengths near 1, no NaN.
- [ ] **Step 2: Run** `npx vitest run tests/echoProbe.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the shell as a scaled ellipsoid centered on the heart centre with semi-axes the heart's extents plus clearance; use a stable basis (choose the reference up vector that is least parallel to the beam).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** by path.

### Task 4: Draggable probe in pane 1

**Files:**
- Modify: `src/echo/scene.ts`, `src/echo/page.ts`, `echo/index.html`, `src/echo/echo.css`

**Interfaces:**
- Consumes: `ProbeState`, `stateToPose`, `clampState`, `PRESETS` (Task 3).
- Produces: `EchoScene.onProbeMove(cb: (s: ProbeState) => void): void` and `EchoScene.setState(s: ProbeState): void`. The existing `setPose(p: Pose)` stays and `setState` calls it.

- [ ] **Step 1: Add a chest shell** (wireframe ellipsoid patch, hairline, very faint) and make the probe body draggable: pointer down on the probe starts a drag, a ray from the camera intersects the shell, `(u, v)` come from the hit, `clampState` is applied, and `cb` fires. While dragging, orbit controls are disabled. Add keyboard control on a focused probe: arrow keys move `(u, v)`, `[` and `]` rotate, `-` and `+` tilt. Keep the existing camera framing but stop re-squaring the camera on every move (the camera follows only when a preset is chosen).
- [ ] **Step 2: Wire `page.ts`:** keep one `state: ProbeState`; any change recomputes the pose, redraws pane 1, resamples the slice, redraws panes 2 and 3. The view picker calls `animateTo(PRESETS[v.pose])`, a 400 ms interpolation of the state, skipped when `prefers-reduced-motion`.
- [ ] **Step 3: Verify** with `npm run dev`, open `/echo/`, and in the browser pane: drag the probe, confirm the slice changes and the probe never enters the heart; take a screenshot. Run `npm run typecheck`.
- [ ] **Step 4: Update `tests/echoPoses.test.ts`** only where it depends on UI (none expected); run `npx vitest run tests/echoPoses.test.ts tests/echoProbe.test.ts`.
- [ ] **Step 5: Commit** by path.

### Task 5: Stylized echo (pane 3, stage A)

**Files:**
- Create: `src/echo/stylize.ts`
- Modify: `echo/index.html`, `src/echo/page.ts`, `src/echo/echo.css`
- Test: `tests/echoStylize.test.ts`

**Interfaces:**
- Consumes: `Slice` (Task 1).
- Produces: `stylize(s: Slice, t: number, seed?: number): Uint8ClampedArray`, grayscale RGBA, `w*h*4`, black outside the fan. `t` is time in seconds (speckle drifts slowly so the image is alive). Same `seed` and `t` give identical output.

- [ ] **Step 1: Write failing tests:**
  - `"is deterministic for the same slice, time and seed"`.
  - `"is black outside the fan"`.
  - `"makes beam-facing walls brighter than beam-parallel walls"`: mean intensity at pixels with `facing > 0.8` exceeds those with `facing < 0.2`.
  - `"is dimmer at depth than near the probe for the same tissue"`: average blood-pool intensity in the top third exceeds the bottom third by at least 10 percent.
  - `"blood pool is darker than the wall"`.
- [ ] **Step 2: Run** `npx vitest run tests/echoStylize.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `stylize`:** base intensity by region (blood low, wall mid, outside-heart tissue low-mid), plus interface boost from `facing` where `|sdf|` is small, multiplied by a depth falloff, times seeded value-noise speckle, then a small blur. Contrast low, to read as echo but clearly stylized.
- [ ] **Step 4: Add the pane** to `echo/index.html` with caption "Figure 3. Echo image: simulated from the model, replaced by a real loop near a standard view." Draw from `page.ts` at most 20 fps and stop when the page is hidden. Badge text "Simulated echo".
- [ ] **Step 5: Run** the tests and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** by path.

### Task 6: Crossfade to the real loop (pane 3, stage B)

**Files:**
- Create: `src/echo/blend.ts`
- Modify: `src/echo/page.ts`, `src/echo/cleanVideo.ts` (return a handle with `stop()`), `src/echo/echo.css`
- Test: `tests/echoBlend.test.ts`

**Interfaces:**
- Consumes: `ProbeState`, `PRESETS`, `Pose`, `imageFor`.
- Produces:
  - `referenceWeight(s: ProbeState, preset: ProbeState): number` in 0 to 1: 1 within 6 mm and 4 degrees, falling by a smoothstep to 0 at 20 mm and 15 degrees (my starting values; tunable constants named `NEAR` and `FAR`).
  - `nearestReference(s: ProbeState, ids: string[]): { id: string; weight: number } | null`.

- [ ] **Step 1: Write failing tests:** weight is 1 at the preset, 0 far away, monotonic along a straight path away from it, symmetric in direction, and `nearestReference` returns null when every weight is 0 and picks the closer of two presets.
- [ ] **Step 2: Run** `npx vitest run tests/echoBlend.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `blend.ts`.**
- [ ] **Step 4: Composite in `page.ts`:** the real loop plays in a canvas stacked over the stylized canvas, `opacity = weight`, same sector shape. Scale the real clip so its apex and radius match the stylized sector (use the clip's `CleanSpec`). Start the loop when `weight > 0` and stop it (`stop()`) when it returns to 0 or the view changes, so a stale clip cannot show. The badge reads "Reference echo: <view short name>" when `weight > 0.5`, else "Simulated echo". The credit line from `IMAGES` shows under the pane only while the real clip is visible.
- [ ] **Step 5: Verify in the browser:** choose PLAX, check the badge and clip; drag away and watch it fade; screenshot both states. Run tests and `npm run typecheck`.
- [ ] **Step 6: Commit** by path.

### Task 7: More standard-view poses

**Files:**
- Modify: `src/echo/poses.ts`, `src/echo/views.ts`, `tests/echoPoses.test.ts`

**Interfaces:**
- Consumes: `landmarks()`, `outside`, helpers already in `poses.ts`.
- Produces: new keys in `buildPoses()`: `a4c`, `a2c`, `a3c`, `psaxMV`, `psaxAV`, `ivc`. New `ViewDef` entries with `id`, `name`, `short`, `window` (extend `Window` with `"Apical"`), `pose`, `placement`, `marker`, `shows`, `lookFor`. A `ViewDef` may now lack a clip (`imageFor` returns `undefined`).

- [ ] **Step 1: Write failing tests** in `tests/echoPoses.test.ts` (replace the old "only three views" test with one that lists all ids and no longer requires a clip):
  - `"a2c plane holds the mitral valve and apex and no tricuspid valve"` (using `offPlane`: mitral and apex within 6 mm, tricuspid more than 15 mm off).
  - `"a4c plane holds mitral, tricuspid and apex"`.
  - `"a3c plane holds the aortic valve, mitral valve and apex"`.
  - `"psaxMV and psaxAV planes are perpendicular to the long axis, with psaxAV nearer the base"`.
  - `"ivc probe is below the heart and the beam runs up toward the right atrium"`.
  - existing generic tests (unit axes, probe outside, target inside) run for every pose.
- [ ] **Step 2: Run** `npx vitest run tests/echoPoses.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the poses**, apical from the apex with the beam along `-longAxis` rotated about the long axis (A4C toward the tricuspid, A2C rotated 60 degrees, A3C 120 degrees); short-axis levels are planes perpendicular to the long axis at 0.8 (mitral) and 0.95 (aortic) of the way from apex to mitral valve (starting values, confirm by eye); IVC enters from below.
- [ ] **Step 4: Add the `ViewDef` entries** with placement, marker and lookFor text in the existing style, and group the picker by window (Parasternal, Apical, Subcostal).
- [ ] **Step 5: Run** the tests and the dev server; step through every view and screenshot pane 1 and 2 for each. Clinician (the user) signs off each pose.
- [ ] **Step 6: Commit** by path.

### Task 8: Valve markers and labels

**Files:**
- Modify: `src/echo/sliceView.ts`, `src/echo/poses.ts` (export `LANDMARKS_HEART_FRAME` mapped to patient frame as `landmarksPatient()` if not already)
- Test: `tests/echoSlice.test.ts` (append)

**Interfaces:**
- Consumes: `landmarks()` (apex, mv, av, tv), `Pose`, `Slice`.
- Produces: `markerLabels(pose, s)` returns a label ("Mitral valve", "Aortic valve", "Tricuspid valve", "Apex") for each landmark within 6 mm of the plane, positioned by projecting the landmark onto the slice grid.

- [ ] **Step 1: Write failing tests:** A4C shows mitral, tricuspid and apex labels but not aortic; PLAX shows mitral and aortic; a slice far from all landmarks returns none.
- [ ] **Step 2: Run** and confirm FAIL. **Step 3: Implement** and draw labeled points in `drawSlice` when labels are on. **Step 4:** run tests, typecheck. **Step 5:** commit by path.

### Task 9: Page layout, copy and end-to-end check

**Files:**
- Modify: `echo/index.html`, `src/echo/echo.css`, `src/echo/page.ts`, `docs/ECHO_ATLAS.md` (status line)

- [ ] **Step 1: Lay out the three panes** in one row at desktop widths (stacked on narrow), unboxed, divided by hairlines, with the view picker, title and "what to look for" text above or beside as today. Remove the cards row or keep only the text, no card chrome. Read `DESIGN.md` first.
- [ ] **Step 2: Update the page note** to say the panes are the model's ideal slice, a stylized rendering, and a real loop from another patient, aligned but not registered.
- [ ] **Step 3: Run** `npm run typecheck`, `npx vitest run`, `npm run build`. Expected: all pass.
- [ ] **Step 4: Browser check** at 1440 and 390 px wide: every view, drag, labels toggle, crossfade, empty-sector hint, no console errors; screenshot.
- [ ] **Step 5: Commit** by path.

### Task 10 (later, not in this release): Sim coupling and find-the-view

Wall motion from the simulator animating panes 2 and 3, and a "find the view" challenge scored by `referenceWeight`. Plan separately once Tasks 1 to 9 ship.
