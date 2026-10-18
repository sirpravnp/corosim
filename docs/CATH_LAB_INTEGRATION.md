# Cath lab: from the spike into the app

Status: plan, no app code yet. The prototype is `spikes/cathlab/` (open `index.html`; `README.md` there says how it is built).

## What we are building

A **cath lab page** at `/cath/`, beside the simulator, the game and the EKG page, plus a small set of MCP tools so an AI can run the same lab on the user's patient. It has three panels, all driven by the patient's own simulation state:

| Panel | What it shows | Where its numbers come from |
|---|---|---|
| **Angiogram** | the coronary tree from a C-arm angle, contrast filling at each vessel's solved velocity, TIMI flow, vessel labels | `sim.analysis.cond` (per-segment diameter, flow, velocity), lesions, `sim.state()` |
| **Pressure wire** | pullback curve of Pd/Pa at rest and at adenosine hyperemia, FFR, a stent/defer readout | `sim.analysis.hyper` (`lesionFFR`, `pressureAlong`) |
| **TEE** | 23 standard transesophageal views cut from a real CT-derived heart, omniplane slider, anatomical labels, territory overlay | `sim.state()` bed severity → LV segments, EF, heart rate, beat phase |

It is educational and uses synthetic patients only, like the rest of CoroSim.

Not in scope here: TTE views, 3D echo, Doppler, patient-specific anatomy, any real patient data.

## Where it fits in the code

The existing rule holds: **physics and findings in the DOM-free core, drawing in the page.** The EKG page is the precedent (own page, own entry, also built as a single-file MCP App).

```
src/sim/cath.ts           NEW  DOM-free. What the lab reads off a Simulation. Unit-tested.
src/cath/                 NEW  the page
  index.html (at cath/)        page shell, masthead as the other pages
  page.ts                      wiring, controls, patient loading, embedded (MCP App) mode
  angio.ts                     C-arm projection, contrast fill, labels (canvas 2D)
  pullback.ts                  wire trace and FFR readout
  echo/volume.ts               decode and index the heart volume
  echo/slice.ts                pure: view + omniplane -> region-id map (no canvas)
  echo/views.ts                the 23 view definitions built from the landmarks
  echo/render.ts               ids -> pixels (speckle, edge enhancement, labels, territories)
  echo/motion.ts               ischemia -> wall motion (reference-position sampling)
  data/heart.bin.gz, heart.json   the baked anatomy (see "Anatomy data")
scripts/cath/             NEW  the Python that bakes the anatomy from the open mesh (numpy, scipy)
src/mcp/tools.ts          corosim_cath_* tools (below)
src/mcp/server.ts         third in-chat viewer: ui://corosim/cath.html
vite.config.ts            add cath/index.html to the page inputs
vite.cath-viewer.config.ts  NEW, single-file build like vite.ekg-viewer.config.ts
```

### `src/sim/cath.ts` (the part worth testing hardest)

Ports the prototype's `export.ts` and the page's fill/TIMI logic into typed, pure functions of a `Simulation`:

- `angioModel(sim)`: per-segment centreline samples, diameter and velocity profiles, `blockedFrom`, parent attachment, and per-sample **front arrival time** (the prototype's `buildFill`). Also `timi(sim, artery)` (grade and frame count at 30 fps).
- `wireModel(sim, artery)`: `Pd(s)` at rest and at hyperemia, `FFR`, local diameter, and a function `at(position)` for a wire dragged along the vessel.
- `echoModel(sim)`: severity per AHA segment (17), wall-motion score (normal / hypokinetic / akinetic / dyskinetic, thresholds tagged as teaching assumptions), EF, heart rate. Replaces the prototype's `segSeverity` and `prepSev`.
- `cathReport(sim)`: the structured findings an AI or the page prints (see tools).

The LV segment mapping is the AHA 17-segment scheme; the vessel-to-segment table (LAD, circumflex, RCA with the usual overlaps) lives in `src/config/` with each constant tagged literature-backed or assumed, as elsewhere.

## Anatomy data

**Source (CC BY 4.0):** Rodero et al. 2021, PLoS Comput Biol, average four-chamber heart of a statistical shape model of healthy adult CT hearts, Zenodo 10.5281/zenodo.4593739 (`average.tar.gz`, 58 MB). The open TotalSegmentator dataset was checked first and does not have separate chambers (its chamber labels belong to a licensed model).

**Baked once, committed small.** `scripts/cath/` turns the 179 MB tetrahedral mesh into a 1 mm label volume in the heart frame (x lateral, y anterior, z toward the base, origin at the LV base). It fills the cavities, labels the chambers, valve planes, aorta and PA lumens, the interatrial septum and the 17 LV segments (from the mesh's own apico-basal and rotational coordinates), and exports landmarks (valve centres and axes, vessel openings). Output: `heart.bin.gz` (411 KB) and `heart.json`. The raw mesh and intermediates stay out of git (a `.gitignore` is in the spike); `npm run build:heart` documents the download and rebuild.

**Loading.**
- Site page: `fetch("heart.bin.gz")` from the site's own assets, `DecompressionStream`, cache with the service worker if one is added later.
- In-chat viewer: inlined as base64 (Vite `?inline`), because MCP Apps run sandboxed with no network. About 0.55 MB added to a viewer that carries no 3D library, so well under the EKG viewer.
- Attribution on the page footer, in `docs/`, in the README and in the viewer; state that it is the average shape, not a patient.

**Beyond the mesh.** The mesh stops at short stubs of the aorta and PA. The great veins, pulmonary veins, appendage, ascending aorta, arch and descending aorta are procedural tubes built from the landmarks. They are labelled as schematic in the notes and need an anatomist's look before teaching use.

## The page

- **Patient.** Opens with `#s=` (the existing share-link encoding), else a small library (normal, mid-LAD 75% on exertion, proximal LAD occlusion, proximal RCA occlusion, left main). The simulator page gets an "Open in cath lab" link built the way `appLink()` already builds its share link. Treatment from here (PCI, fibrinolysis, CABG) calls the same `Simulation.revascularize`, so the lab can show the before and after.
- **Live line (phase 4).** Reuse `Account` and `LiveLink` from `src/live.ts` so the page is another front end on the account's patient, and its `run` handles `corosim_cath_*` so the AI can steer the page (projection, view, wire position). The room today holds one open page per account (the server replies `replaced` to a second tab), so the cath page and the simulator page cannot both be live at once. Decide in phase 4: either one combined room page, or let the room hold a page per kind.
- **Beat sync.** The prototype drives valves and wall motion from its own clock. In the app, take beat phase and rate from the sim's beat stream so a PVC, AF or heart block shows up in the echo the way it does in the ECG strip.
- **Angiogram renderer.** Canvas 2D is enough (the prototype runs it). Keep it behind a small interface so a WebGL version can replace it if the vessel count or resolution grows.
- **Echo renderer.** The slicer is about 28 ms a frame on a laptop. Split `slice.ts` (pure, testable) from `render.ts`. If it needs to go faster, move the slicer to a worker or a fragment shader over a 3D texture of the ids; neither changes the data format.
- **Layout.** Same masthead, home-page card ("Cath lab") and link from the simulator. Phone width: stack the panels; the two canvases are square.

## MCP tools

Same pattern as `corosim_show` and `corosim_ekg_show`: defined once in `tools.ts`, exported to the OpenAPI and function-calling files by `scripts/export-tools.ts`.

| Tool | Does | Returns |
|---|---|---|
| `corosim_cath_show` (viewer `"cath"`) | Displays the lab in the chat for the user's patient. Optional: `panel` (angio, echo, both), `projection` (named, e.g. "RAO caudal", or degrees), `echoView`, `omniplane`, `labels`, `territories`, `inject`, `wire: {artery, position}`, `quiz` (hide the findings until the learner commits) | the findings below, the scenario the viewer replays, a link |
| `corosim_cath_report` | No display. The angiographic and echo report on the current patient | per lesion: artery, position, QCA diameter stenosis, TIMI flow and frame count, FFR; coronary dominance; EF, wall-motion table by AHA segment and score index, RV and valves (normal, since the model has no valve disease yet); the guideline next step from the existing assessment |
| `corosim_cath_measure` | A wire or a QCA measurement at a place | `{artery, position}` → local diameter, Pd/Pa at rest and at hyperemia, gradient across the lesion if between two positions |
| `corosim_cath_views` (stateless) | Lists the angiographic projections and the 23 TEE views with what each is for | names, teaching purpose, the AHA segments each shows |

Treatment stays in `corosim_treat`; after it, `corosim_cath_show` shows the result.

Prompts: `cath_rounds` (learner picks projections and interprets the pullback before the AI reveals anything) and `echo_rounds` (learner names the view and the territory), written like the existing `rounds` and `ekg_quiz` prompts. Add the three viewer facts to the server instructions so the AI knows to call `corosim_cath_show` once per turn.

`docs/LLM_AND_MCP.md` gets a section; `README.md` gets the page and its credit line.

## Build and deploy changes

- `vite.config.ts`: add `cath: "cath/index.html"` to the inputs; relative asset paths already hold one level down.
- `package.json`: `build:cath-viewer`, add it to `build:mcp` (copy to `dist-mcp/cath-viewer.html`); `build:heart`.
- `Dockerfile`: copy `vite.cath-viewer.config.ts`, run its build, copy `cath-viewer.html` next to the server (as `ekg-viewer.html` is today).
- `server.ts`: `CATH_VIEWER_URI = "ui://corosim/cath.html"`, loader like `ekgViewerHtml()`, `uiFor` gets a third case, resource list gets a third entry.
- `scripts/prepare-publish.mjs` publishes the simulator page only; leave as is.
- Check the Artifact/MCP host's size limits for the new viewer (about 1 MB).

## Tests

Following `tests/ekg.test.ts` and the viewer test host:

- `tests/cath.test.ts`: normal patient has TIMI 3 and FFR above 0.9; an occluded vessel gives TIMI 0 and no distal fill; fill arrival times increase along a vessel and with a tighter stenosis; FFR from `wireModel` equals `sim.state().ffr`; LAD occlusion makes the anterior, anteroseptal and apical segments akinetic and the inferior ones normal, RCA occlusion the reverse, circumflex the lateral ones; EF from the model matches the echo header.
- Volume tests (Node, `zlib.gunzipSync`): shape and byte count match `heart.json`; each expected id is present; landmarks lie inside the volume; LV cavity volume and wall mass are in a human range.
- Slicer tests on `slice.ts`: the four-chamber view contains LV, RV, LA, RA, MV and TV and the septum on the image-left; the long-axis view contains the aortic valve and LVOT; the short-axis TG view is a ring of 6 basal or mid segments; every one of the 23 views produces at least its expected structures. These catch pose regressions without comparing pixels.
- Page test host: an MCP Apps handshake test beside `src/viewer/testhost.ts`, as for the EKG viewer.
- A build check that `heart.bin.gz` is what `scripts/cath` produces (hash), so the committed file cannot drift from the script.

## Phases

| Phase | Work | Effort (rough) |
|---|---|---|
| 0. Pipeline | Move `tools/*.py` into `scripts/cath/`, `npm run build:heart`, commit `heart.*`, attribution and docs, hash test | 0.5–1 day |
| 1. Angio and wire | `src/sim/cath.ts` with tests; `/cath/` page with angiogram, pullback, patient library, `#s=` loading, home card, link from the simulator | 3–4 days |
| 2. TEE | Volume loader, slicer, views, motion, renderer, labels and territories in TS; beat sync; slicer tests | 4–5 days |
| 3. MCP | Four tools, cath viewer build and resource, prompts, docs, export files, test host | 2–3 days |
| 4. Live line | Account and live link on the cath page; decide the one-page-per-room question | 2 days |
| 5. Game | Orders for the redesigned game: angiography (reveals the culprit at a time cost), echo (wall-motion region), FFR for the ischemia-only days; see `docs/GAME_REDESIGN.md` | 2–3 days, after that redesign lands |
| 6. Review | A cardiologist reviews orientations, view definitions, labels, wall-motion wording and the vessel stubs; fix the findings | their time, then 1–2 days |

Phases 1 and 2 are independent and can go in parallel in separate worktrees; phase 3 needs the model functions from both. Work on a branch, not `main`; the working tree was clean at the time of writing.

## Things to settle or fix first

1. **FFR calibration.** In the prototype a 75% mid-LAD stenosis gives an FFR of 0.44 at hyperemia, which is low for that degree of narrowing (the literature spread is wide, but it is typically nearer 0.6–0.75). The cath lab puts FFR on screen, so check the stenosis-loss coefficients, the hyperemic resistance floor and the stenosis length, with a clinician's expected range for 50, 70 and 90% lesions. This is the first thing a cardiologist will notice.
2. **Orientation conventions.** Image-left and image-right and the omniplane direction for each view were set from the ASE/SCA conventions as recalled, not checked against a reference. The page shows the model's own angle, not a probe readout, and the notes say so. Needs the cardiology review in phase 6.
3. **Anatomy limits.** One average healthy heart: no dilated LV, hypertrophy, valve disease, RV failure or effusion. The shape-model record also holds ±1–3 SD variants of its first nine modes (about 60 MB each); a few of those would give size and shape variety. Valve disease needs new jets and leaflet models, not new anatomy.
4. **Papillary muscles and chordae** are placeholders; there is no chordal apparatus.
5. **Vessel stubs** (great veins, pulmonary veins, appendage, ascending aorta, arch, descending aorta) are procedural.
6. **Angiogram vessels** are the procedural coronary tree, thinner and smoother than real. Say so on the page. Real centreline libraries (ImageCAS, ASOCA, SimVascular models) are the later fix.
7. **The data model of "in the chat".** The in-chat viewer rebuilds the patient from the scenario it is sent, like `corosim_show`, so both viewers agree; keep the cath viewer on that path rather than giving it its own state.
8. **Credit and licensing.** CC BY 4.0 needs the credit shown wherever the heart is shown; check the Zenodo record's wording again at build time.
9. **Where to put it.** A separate `/cath/` page keeps `src/app.ts` (1,100+ lines) from growing and follows the EKG page. The cost is the one-page-per-room limit in phase 4.

## Definition of done for the first release (phases 0 to 3)

`/cath/` opens with a patient, shows the angiogram with contrast, the pullback and FFR, and the TEE views with labels; `corosim_cath_show` renders the same in Claude; `npm test` and `npm run build` pass; credits are on the page; the notes say which parts are schematic and not yet clinically reviewed.
