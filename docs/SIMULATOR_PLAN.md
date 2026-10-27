# Simulator: next round (UI, rhythm and arrest engine, MCP)

Plan for the request list of 2026-10-26. Written before any of it is built. Sizes: **S** under one agent session, **M** one or two, **L** two to four, **XL** more. Each item names the files it touches so parallel work does not collide.

## 0. Status

Waves run in order; an item is done when merged to main and live. Updated as work lands.

| Item | State |
|---|---|
| A0 faster CI | done, merged (PR 27); slow checks passed on the PR in 4.5 min |
| A1 split app.ts | done, merged (PR 26) |
| C1 Share button | done, merged (PR 25), live |
| B1 hemodynamic beats | done (merged with B3a); beat-shape readouts use steady beats, flows and MAP use all beats over 30 s |
| B3a graded ischemic PVC model | done (PR 29): PVC share 3.6 % proximal LAD (0-16 % across seeds), burst after reperfusion, cited in docs/ECTOPY.md; B3b = VT/VF initiation after B2 |
| C6 coronary depiction | part a done (side branches, perforators, flare, LOD); merging. Next parts: plaque and thrombus; myocardial blush; flow cues on branches; veins |
| A2 neonate/bridge removal | done (PR pending); adult VSD/TOF/PDA lessons added under D1 (docs/CONGENITAL_ADULT.md) |
| B5 valves in the engine | done (wave 2 PR): prosthetic valves, several lesions at once, TAVR, balloon, MitraClip, replacement; docs/VALVES.md |
| B2 rhythm unification | done (wave 2 PR): `patient.rhythm` takes any D4 library id (core engine); the EKG generator drives strip and engine (physics/rhythmSource.ts, config/rhythms.ts); VF/asystole give no flow; tests rhythmSource (fast), rhythmUnification (slow). MCP schema still lists sinus/af only (D3) |
| C2 settings dock, C5 display in 3D view | done (wave 2 PR); the ischemia table is a panel but has no 3D colour mode of its own (the Ischemia heat map covers it) |
| C3 rhythm picker | done: grouped, searchable picker of every D4 rhythm in the Rhythm tab (src/page/rhythmPicker.ts); ECG-overlay options (STEMI mimics) and valve pickers not done |
| D1 spec registry | done (this PR): `src/sim/registry.ts` is the one field list; the MCP patient schema (set_scenario, adjust, compare), `corosim_show.display`, the OpenAI/Anthropic exports are generated from it; the dock tabs, every dock/overlay control id in `sim/index.html` and every control `createPlaygroundUi` builds are checked against it (`tests/specRegistry.test.ts`). Chat now has every library rhythm, valve prosthesis fields, valve interventions (`corosim_valve`), the full pericardium and the display options. To add a control: add its field in the registry. Not done: the page has no prosthesis or intervention control yet; the chat viewer applies `display.view` only (the other display options are for the page) |
| everything else | not started |

## 1. Where we start (from reading the code)

- **Two rhythm engines.** The EKG page has its own generator (`src/ekg/engine.ts`: `RhythmSpec` with sinus, AF, flutter, SVT, MAT, junctional, ventricular, torsades, VF, asystole, AV-block patterns, PVC patterns; 58 presets in 9 categories). The Simulator has a smaller one (`src/physics/rhythm.ts`: sinus or AF, AV block degree, bundle branch block, PVCs from ischemic burden). Both produce beats of the same shape (`EBeat` / `Beat`), but only the Simulator's reach the hemodynamic engine as activation events. So "all rhythms in the Simulator" means feeding the EKG generator's events into `LiveHeart`, not drawing more waveforms.
- **PVCs today.** Per sinus beat, probability 0.35 × ectopy, where ectopy rises from 0 at "global severity" 0.6 to 1 and saturates (any large infarct gives a fixed 34% of sinus beats followed by a PVC, 25% of all beats). No time course, no R-on-T, no VT or VF initiation, no reperfusion arrhythmia, no electrolytes. VT, VF and asystole exist only as EKG-page tracings; the hemodynamic engine never sees them.
- **Hot files.** `src/app.ts` is 1307 lines and holds the controls, the 3D view, the panels and the patient state; `src/sim/simulation.ts` is 1119. Two agents editing either at once conflicts. That is the main constraint on parallel work.
- **Settings are spread over 7 places** on the page: Monitor, Lesion, Management, Patient, Volume and drugs, Anatomy, Display, plus the Patient column. The ischemia table sits under the 3D view.
- **Valves.** The Simulator takes one structural lesion at a time (`structural: {id, values}`): AS, AR, MS, MR, TS, TR, PS, PR (adult) plus congenital lesions. Most congenital lesions are flagged neonate-only. The engine's valve model is per valve, so combinations are an interface limit, not an engine limit. No prosthetic valves or valve interventions exist.
- **3D coronaries.** 14 named segments in `src/anatomy/tree.ts` with unrendered `taps` (small branches by position and mass) and a tube renderer in `src/app.ts`. The tap data is already there to render side branches.
- **Neonate and the bridge.** 29 source files mention neonate. The bridge (`bridgeSource`, worker, solver) is used by neonates on the Simulator, by the MCP heart-cath/JVP/oxygen/loop tools (`src/mcp/hemo.ts`) and by the Cath page's heart tabs. It can only be deleted after those two move to `LiveSource`. The Structural page runs its own engine and can keep neonates.
- **MCP.** 16 tools; two viewers (patient, EKG). Its instructions tell the model to use the EKG tool for rhythms and never to build a patient for one; that changes once the Simulator has all rhythms. The live server is behind the website: the Fly deploy step is skipped because the repo has no `FLY_API_TOKEN` secret (**you must add it for any MCP change to go live**).
- **CI.** Deploy gates on the full suite: about 9 minutes (910 s of test files; `simulationCore` 154 s, `drugs` 88 s, `bridgeSource` 76 s, `cathHeart` 51 s). 48 of 70 files run under 10 s.

## 2. Decisions (defaults are what I will build unless you say otherwise)

| # | Question | Default |
|---|---|---|
| D1 | Congenital lesions once neonates leave the Simulator | Keep them on the Structural page (neonate, own engine). In the Simulator keep ASD and add adult versions (unrepaired VSD → Eisenmenger, repaired TOF, adult PDA). Remove the neonate presets. |
| D2 | What "death state" is | Not an instant game-over. Cardiac arrest (VF, VT without pulse, asystole, PEA) is a state with ACLS actions. After a no-flow time (configurable; default 10 min of no flow, extended by good CPR) the patient is declared dead: an overlay, the readouts freeze, a "Restart patient" button. Quiz/game mode treats death as a loss. |
| D3 | PVC burden | Lower the ceiling to about 10–15% of beats and make it time-dependent: peak in the first 30–60 min of occlusion, decaying; dobutamine and sympathetic tone raise it. A stable stenosis at rest gives none. |
| D4 | Which EKG presets go in the Simulator rhythm picker | The rhythm and conduction categories (Sinus, Atrial, Junctional and re-entry, AV block, Bundle branch, Ventricular, Electrolytes/drugs rhythms). Coronary ST/T comes from the coronary model, as now. STEMI mimics (pericarditis, Brugada, early repolarization…) become an "ECG overlay" on top of any rhythm. |
| D5 | How far the 3D coronary rework goes | Richer arterial tree and flow cues first (more branches, septal perforators, taper, plaque, thrombus, myocardial blush, TIMI-style flow). Veins and coronary sinus only if time remains. |
| D6 | CI speed | Split the suite: fast files gate the deploy (about 2 min); slow simulation files run in parallel, and failing them blocks nothing already deployed but is reported. |

## 3. Work items

### Track A: foundation
| ID | Size | Item | Depends | Files | Done when |
|---|---|---|---|---|---|
| A0 | S | CI split (D6) and shard the slow files | none | `.github/workflows/*`, `package.json` | deploy under 3 min; slow suite still runs on every push |
| A1 | M | Split `app.ts` into modules (controls, 3D view, panels, patient state), no behaviour change | none | `src/app.ts` → `src/page/*` | same pages, all tests and the smoke run pass; `app.ts` under 300 lines |
| A2 | M | Remove neonate from the Simulator and MCP (D1); move Cath-page heart tabs and MCP heart tools to `LiveSource`; delete bridge, worker, standalone mode and their tests | A1 | `src/sim/bridge*`, `src/mcp/hemo.ts`, `src/cath/*`, `src/sim/playground.ts`, `presets.ts` | no `bridge` or `standalone` left outside the Structural page; Cath page and MCP read the core engine |

### Track B: core engine
| ID | Size | Item | Depends | Files | Done when |
|---|---|---|---|---|---|
| B1 | S | **Hemodynamic beats** policy: loops, numbers, monitor, cath, JVP and trace statistics use only sinus-conducted beats that are not premature and not next to a premature one; if none exist (AF, VT, paced) every beat counts and the panel says which | none | `src/sim/liveSource.ts`, `src/sim/simulation.ts`, `src/panels/*` | in an anterior STEMI every readout is stable beat to beat; an "ectopic beats" count is shown instead |
| B2 | L | **Rhythm unification:** one rhythm source (the EKG generator's events) drives both the ECG strip and the core engine. Each beat carries origin (atrial, junctional, ventricular), conduction and effectiveness; VT, VF, torsades, flutter, SVT, AF, paced, junctional and blocks all reach the ventricles with realistic filling and output (VT rate-limited, VF none, flutter 2:1) | none (parallel to A1 only if `app.ts` is not touched) | `src/ekg/engine.ts` (export events), `src/physics/rhythm.ts`, `beatStream.ts`, `core/live.ts` | every rhythm in D4 runs live with plausible CO and MAP; VF gives zero flow; the ECG shows the same beats |
| B3 | L | **(split: B3a PVC model, pulled forward and in progress; B3b VT/VF initiation, waits for B2)** **Ischemic arrhythmia model:** hazard per clinical minute by phase (hyperacute peak, decay), burden, sympathetic tone, potassium and magnesium; R-on-T coupling against the live T wave starts VT or VF; non-sustained VT, sustained monomorphic VT, polymorphic VT, degeneration to VF by hemodynamic collapse; accelerated idioventricular rhythm on reperfusion; scar VT later; PVC burden per D3 | B2 | `src/physics/arrhythmia.ts` (new), `config/` | VF in the first hour in a minority of large anterior STEMIs (literature range), AIVR after PCI, no arrhythmia in a stable stenosis at rest; seeded and unit-tested |
| B4 | L | **Arrest, ACLS and death (D2):** arrest state machine, no-flow timer with irreversible injury, CPR (compressions as external chest force giving about 20–30% of normal output, rate and depth settings), defibrillation and cardioversion (success falls with VF duration), epinephrine, amiodarone, lidocaine; ROSC or declared death | B2, B3 | `src/sim/arrest.ts` (new), `simulation.ts` | VF → CPR → shock → ROSC and VF → untreated → death both play out; numbers cited |
| B5 | M | **Valves in the engine:** several valve lesions at once with interactions (AS + MR), prosthetic valves (gradient, regurgitation), interventions (TAVR, balloon valvuloplasty, MitraClip, replacement) | none | `src/sim/structural.ts`, `physics/structural.ts`, `core/valves.ts`, `patient.ts` | AS + MR gives both gradients and a regurgitant volume; TAVR drops the gradient; tests per valve |

### Track C: UI
| ID | Size | Item | Depends | Files | Done when |
|---|---|---|---|---|---|
| C1 | S | **Share at the top:** a Share button in the page header (copies the link, shows a confirmation); the link field leaves the Patient section | none | `src/shell/*`, `sim/index.html` | one click copies the current patient's link from any scroll position |
| C2 | M | **Settings consolidated:** one tabbed settings dock (Patient · Rhythm · Coronary · Valves · Support · Display) replaces Lesion, Management, Patient, Volume and drugs, Anatomy and Display; the ischemia table becomes a panel (and a colour mode in the 3D view); a layout that works at phone width | A1 | `sim/index.html`, `src/page/controls*`, `src/panels/playgroundControls.ts` | every existing control still works; no duplicated controls; ischemia table is a movable panel |
| C3 | M | **Rhythm picker** in the Rhythm tab: grouped, searchable, with the ECG-overlay options (D4); the live ECG and the numbers follow | B2, C2 | `src/page/rhythm*`, `src/ekg/presets.ts` | all D4 rhythms selectable; each shows its ECG and hemodynamics |
| C4 | M | **Valves tab:** per-valve severity sliders for all eight valves, several at once, prosthetic and intervention buttons, 3D valve depiction (jets, leaflet motion) reusing `structural/props.ts` | B5, C2 | `src/page/valves*`, `src/structural/props.ts` | a combined lesion can be built and is drawn and measured |
| C5 | M | **Display inside the 3D view:** overlay controls on the view (view presets, layers, heat map: ischemia, O₂, pressure, coronary scale, labels, solid/translucent); remove the Display section | A1 | `src/page/view*`, `src/app.ts` render code | all display options reachable from the view; no Display section |
| C6 | L–XL | **Coronary depiction:** render the `taps` as side branches, septal perforators, taper and tortuosity, plaque and thrombus on lesions, myocardial blush by perfusion, TIMI-style flow in the lumen; level-of-detail so the frame rate holds | A1 (render code), otherwise independent | `src/anatomy/tree.ts`, `src/page/view*` | visibly richer tree; 30+ fps on the smoke machine; lesion and flow cues readable |
| C7 | M | **30 s history:** loops panel shows the last 30 s as fading loops (time window selector), traces panel adds a 30 s window and a pause-and-scrub review; the ring already holds 30 s | B1 | `src/panels/loops.ts`, `traces.ts`, `liveSource.ts` | older loops fade by age; scrubbing works while paused |
| C8 | M | **Arrest UI:** arrest and death overlay, ACLS panel (CPR, shock energy, drugs), rhythm-check display, restart | B4, C2 | `src/page/arrest*` | the full resuscitation can be run from the page |

### Track D: MCP
| ID | Size | Item | Depends | Files | Done when |
|---|---|---|---|---|---|
| D1 | M | **One spec registry:** every simulator control, the page's tabs and the MCP schema generated from one list of fields; a parity test fails if a control has no field or a field has no schema entry | C2 (and new features as they land) | `src/sim/patient.ts`, `src/mcp/tools.ts`, `scripts/export-tools.ts` | adding a field in one place adds it everywhere |
| D2 | M | **Narration:** `corosim_describe_case` and a `narrative` field in every changing tool's result ("a 58-year-old with a proximal LAD occlusion, now in VT at 168 bpm…" updated as the case is built) so the chat reads like someone building the case on the website | D1 | `src/mcp/*`, `src/sim/explain.ts` | each tool call returns one or two plain sentences of what changed and why |
| D3 | M | **Tools for the new features:** set rhythm (all D4 rhythms), valves and interventions, arrhythmia and arrest control (shock, CPR, drugs), display and view; the EKG tools become views onto the same rhythm library; update the server instructions | B2–B5, D1 | `src/mcp/tools.ts`, `server.ts` | everything the page can do can be done and shown from chat |
| D4 | S | **Viewer parity and deploy:** the in-chat viewer shows the new Simulator (rhythm, valves, arrest); add the `FLY_API_TOKEN` secret and redeploy the server; health check | D3, your action | `src/mcp/viewer*`, repo secrets | the live MCP server answers with the new tools |

## 4. Order and parallelism

At most two or three agents at once: more than that overloaded the machine and timing tests fail, and agents on the same hot file conflict. A wave starts when the previous wave's gate passes.

| Wave | Runs in parallel | Gate |
|---|---|---|
| 0 (infrastructure and a quick win) | A0 · A1 · C1 | deploy under 3 min; `app.ts` split verified; share button live |
| 1 | A2 · B1 · C6 (3D files only) | no bridge left; readouts steady with ectopy |
| 2 | B2 · C2 · C5 · B5 | every D4 rhythm drives the engine; one settings dock |
| 3 | B3 · C3 · C4 · C7 | arrhythmia model matches the literature ranges; pickers work |
| 4 | B4 · C8 · D1 · D3 | a full resuscitation runs on the page and from chat |
| 5 | D2 · D4 · polish · full review | parity test green; live MCP server updated |

Since A0 the deploy gates on the fast tests only, so **a pull request waits for the `Slow tests` checks (about 4 minutes) before it is merged**; when an item deletes or renames a test file it must update `tests/slow.json` (a guard test fails otherwise).

Rules carried over: implementers commit work-in-progress at each step (usage limits cut agents off); never loosen a test bar (missed targets become `it.fails` with a reason); fixtures are regenerated only by script with a stated reason; one reviewer pass per item (diff, tests, a real-page check) and a gate review per wave, with an Opus reviewer for the clinical content of B3 and B4; a PR and deploy per wave (and for the quick wins C1 and A0 straight away).

## 5. Risks

- **B2 is the keystone.** Rhythm unification touches the ECG strip, the beat stream and the core engine; B3, B4, C3 and D3 wait for it. Start it in wave 2 with the least else going on in `simulation.ts`.
- **Arrhythmia realism is a calibration problem,** not a coding one. Cited incidence ranges become tests so the numbers cannot drift unnoticed.
- **3D coronary rework can eat the frame rate** (software rendering already runs at about 2 fps on the test machine). Level-of-detail from the start; a real-GPU check by you before it ships.
- **Parity (D1) is only as good as the registry:** do it as the features land, not at the end.
- **Weekly usage limit** stopped work once. Checkpoint commits and a scheduled resume are already in place.
