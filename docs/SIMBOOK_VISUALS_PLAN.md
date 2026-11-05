# Claude Code plan: SimBook visuals and simulation depiction

Paste this whole file into Claude Code (or Cursor Agent) as the task. It is self-contained. Work from current `main` of `sirpravnp/corosim`. Read `DESIGN.md` and `CLAUDE.md` before any UI edit.

## What “SimBook” means here

There is no product named SimBook in the repo. Treat **SimBook** as the teaching casebook surface:

| Surface | URL / entry | Code |
|---|---|---|
| Cases library (browse / filter / group) | `/cases/` | `cases/index.html`, `src/library/page.ts`, `src/library/library.css` |
| Case builder (passcode editors) | same page, `#build` | `src/library/builder.ts`, `library.css` builder section |
| Case player (scripted sim) | `/case/?id=…` (same HTML as `/sim/`) | `src/page/cases.ts`, cases chrome in `sim/index.html` + `src/style.css` |
| Shared stage the player depends on | `/sim/` | `src/page/heart3d.ts`, `vessels3d.ts`, `scene.ts`, panels, ECG |

Do **not** invent a new brand, nav item, or route named SimBook unless the owner asks. Improve the casebook + the live simulations it shows.

## Goal

Make the casebook and the live simulations look and read like one Scan Room instrument that teaches: thermogram-first, square hairline frames, physiology-only color, captioned figures — and make coronary / ischemia / flow cues readable enough that a learner trusts what they see when a case freezes for a decision.

## Ground rules

- American English in UI copy, docs, comments, commits.
- Follow `DESIGN.md` + `CLAUDE.md` UI rules. Home thermogram is the theme for the whole site; workbench moves toward it, not toward a generic dark dashboard.
- Square hairline frames on **new** chrome. No `border-radius` above 2px on new frames, cards, or buttons. No `backdrop-filter` / glass. No tinted callout boxes (colored fill + colored border). No new fonts or accent hues. Data graphics from the thermal ramp first. ECG stays pink paper.
- Impeccable hook is on (`.impeccable/config.json`). Treat findings as real unless you can name a false positive.
- Prefer visual/CSS and depiction polish over engine rewrites. Do **not** change physics constants, fixtures, or clinical model behavior unless a depiction bug requires it — and then only with a cited reason.
- Do **not** loosen tests. Keep `npx tsc --noEmit -p .` clean for touched paths.
- Checkpoint commits often. Short imperative subjects; American spelling (color, labeled, hemodynamics).
- Hot-file rule: avoid simultaneous large edits to `src/sim/simulation.ts`. Prefer `src/library/*`, `src/page/cases.ts`, `src/style.css`, `src/page/vessels3d.ts`, `src/page/heart3d.ts`, `src/anatomy/lesionCues.ts`.

## Repo facts you need

- Design thesis and Known drift: `DESIGN.md` (8–10px radii on workbench; glass still present; uppercase overuse).
- Simulator plan leftovers that are visual: `docs/SIMULATOR_PLAN.md` status — C6a (branches/LOD) done; plaque/thrombus/blush/flow cues largely landed in `lesionCues` + `vessels3d` / `heart3d`; still open: veins (C6d), 3D valve jets/leaflets, viewer heat/flow parity, real-GPU FPS check, Echo overflow at 390px.
- Cases library already uses 2px radii and hairline facets (`library.css`). The **player** overlays still use glass: `#cgate` / `#cprompt` have `backdrop-filter: blur(10px)`; `.vc-pane` has blur; many sim figures/buttons still `border-radius: 8px`.
- Case list on `/cases` captions itself (`Table 1. …` in `page.ts`). Keep that textbook voice.
- Built-in cases live in `src/cases/*.ts`; authored cases are server JSON via `src/library/api.ts`. Visual work must not break play, preview (`&preview=1`), or publish gates.
- Dev: `npm install`, `npm run dev` → home, `/sim/`, `/cases/`. Tests: `npm test` (or the project’s fast group if documented).

## Decisions (defaults unless the owner overrides)

| # | Question | Default |
|---|---|---|
| D1 | How far to square the sim workbench | Phase 1: cases overlays + new chrome only (≤2px). Phase 2: figures, buttons, aside sections, viewport — migrate toward ≤2px in one coordinated CSS pass, not piecemeal. |
| D2 | Case gate / prompt modality | Solid room/console surfaces + hairline; dim the page with a solid translucent scrim. No blur. Keep focus trap and Escape behavior if already present; do not weaken accessibility. |
| D3 | Heat-map palettes | Prefer the home thermal ramp (cool muscle → hot vessels) for ischemia / perfusion teaching views. Keep Viridis/Magma only where they encode continuous scientific scales (pressure, velocity, WSS, O₂) and the legend already teaches them — or replace with thermal-derived ramps if contrast stays readable. |
| D4 | Simulation depiction scope this round | Polish existing plaque, thrombus, blush, TIMI particle cues; fix readability and legend copy. Do **not** start coronary veins unless Phase 1–3 are done and FPS is acceptable. |
| D5 | Builder vs player priority | Player + stage first (learners). Builder second (editors): keep builder usable; align tokens, do not redesign the form IA. |

## Work tracks

### Track A — Cases library & builder chrome (SimBook shelf)

| ID | Size | Item | Files | Done when |
|---|---|---|---|---|
| A1 | S | Visual audit of `/cases` against DESIGN.md: note any SaaS-dashboard drift, over-uppercase, missing figure/table captions, weak brand presence relative to home | notes in this file’s Progress section or a short PR description | Written list of concrete fixes |
| A2 | M | Library polish: one composition (not a dashboard of cards), hairline-only grouping, sentence-case labels, brick only for selected/primary, tier colors stay physiology-coded | `library.css`, `page.ts` | Desktop + ~390px: list, facets, empty state, passcode dialog all solid and on-token |
| A3 | M | Builder polish: sticky bar, timeline, option rows match library tokens; remove any accidental 8px radii / tinted callouts; keep form binding (`data-p` / `data-t`) untouched | `builder.ts` (markup only if needed), `library.css` | Editor can create → Test → return without layout breaks |
| A4 | S | Caption discipline: keep `Table 1.` on the list; add quiet captions where the builder shows preview tables/figures if any | `page.ts`, builder UI | Captions present; no emoji/icon bullets |

### Track B — Case player overlays (SimBook pages in motion)

| ID | Size | Item | Files | Done when |
|---|---|---|---|---|
| B1 | M | Replace glass on `#cgate` / `#cprompt` (and the `@supports` blur fallback) with solid scrim + solid `.c-box`; square hairlines; no multi-layer marketing shadow | `src/style.css`, maybe `sim/index.html` | Gated `/case/` and mid-case prompts look like console dialogs, not frosted cards |
| B2 | M | Case rail panel (`#cases`): status, log, debrief, result colors — inline labels + rules instead of tinted boxes; result states use physiology colors only | `style.css`, `cases.ts` | Debrief readable in dark and light themes |
| B3 | S | Prompt option buttons: left-aligned, sentence case, ≤2px radius, clear selected/hover without glow | `style.css` | Keyboard and click still answer through existing handlers |
| B4 | S | Hide-lesion teaching mode: confirm ischemia/heat/flow controls stay locked until reveal; after reveal, plaque/clot/blush read clearly | `cases.ts`, `vessels3d.ts` / `heart3d.ts` only if needed | Before PCI flag: lesion cues hidden; after: cues visible without popping unrelated UI |

### Track C — Shared simulator stage (bring workbench to thermogram)

| ID | Size | Item | Files | Done when |
|---|---|---|---|---|
| C1 | M | Phase-1 chrome cleanup on sim: kill `.vc-pane` backdrop-filter; solid overlay panes; reduce new/edited radii to ≤2px | `style.css` | View/Layers/Heat controls remain usable; no glass |
| C2 | L | Phase-2 coordinated radius migration for figures, aside sections, buttons, viewport (D1): one PR, visual diff against `/sim` and `/case` | `style.css`, `shell.css` only if needed | Known drift item in DESIGN.md updated or struck with what remains |
| C3 | M | Readouts: Doto for live numbers, JetBrains for units; stop tracked-uppercase abuse on ordinary labels | readout panels, `style.css` | Matches DESIGN typography rules on Monitor / ACLS tiles touched |
| C4 | M | Heat-map + legend pass (D3): ischemia/anatomic teaching views use thermal-family colors; legends captioned; color still means physiology | `vessels3d.ts`, `heart3d.ts`, legend DOM in `sim/index.html` | Side-by-side healthy vs proximal LAD: ischemia readable without decorative rainbow |
| C5 | S | Management / warn lists: replace tinted warn boxes with inline label + hairline (CLAUDE.md) | `style.css`, manage markup if needed | Warnings still obvious via color on the label word, not filled callout chrome |

### Track D — Simulation depiction fidelity

| ID | Size | Item | Files | Done when |
|---|---|---|---|---|
| D1 | M | Lesion cue readability audit: eccentric plaque, calcium flecks, mural/occlusive thrombus, lumen narrowing — tune thresholds only inside `lesionCues.ts` display helpers if cues are too subtle or too loud | `src/anatomy/lesionCues.ts`, `vessels3d.ts` | 50% vs 90% vs occlusion visually distinct in Anatomic view at default coronary scale |
| D2 | M | Myocardial blush / infarct pale scar: check contrast on dark stage; ensure case `hideIsch` path does not flash wrong colors | `heart3d.ts` | Occlusion → reperfusion story visible over ~30s clinical without UI flicker |
| D3 | M | TIMI-style flow particles: density/speed cues remain; document in figcaption if behavior changed | `vessels3d.ts`, figcaption text | Occlusion stops particles beyond lesion; tight stenosis slows/thins |
| D4 | L | 3D valve jets / leaflets (SIMULATOR_PLAN leftover) only if Tracks A–C are green and owner confirms | structural props reuse | Optional; skip by default |
| D5 | S | Perf sanity: note FPS on the smoke machine; do not ship denser geometry without LOD | `branches.ts` LOD already exists | PR describes observed FPS; no regression into unusable software-GL |

## Suggested order

1. **A1 audit** (write findings into Progress below).
2. **B1 + B2 + B3** (case player chrome — highest SimBook impact).
3. **C1 + C5** (remove remaining glass / tinted callouts on sim).
4. **D1 + D2 + D3** (depiction clarity the prompts ask about).
5. **A2 + A3 + A4** (library/builder alignment).
6. **C2 + C3 + C4** (broader thermogram migration).
7. **D4** only with owner go-ahead.

Gate each chunk: `npx tsc --noEmit -p .` clean for touched code; run relevant tests (`tests/cases*.test.ts`, lesion/branch tests if present); manually open `/cases`, start “Pressure in the chest”, hit a prompt, quit, and spot-check `/sim` heat maps.

## Out of scope (unless owner expands)

- New clinical cases or engine arrhythmia/hemodynamic changes.
- MCP tool schema / Fly redeploy / `FLY_API_TOKEN`.
- Neonate / bridge revival.
- Renaming the product to SimBook in marketing or routes.
- Self-hosting fonts (noted drift; separate task).

## Open questions for the owner

1. Confirm SimBook = `/cases` library + case player + shared stage (this plan). If you meant only the library, drop Tracks C–D depth.
2. Approve D1 Phase-2 full radius migration on the sim workbench, or keep 8px tools until a dedicated redesign?
3. Should ischemia heat maps move fully onto the home thermal ramp this round (D3 aggressive), or only new teaching views?
4. Priority of 3D valve jets (D4) vs more authored-case UX in the builder?

## Progress

_Empty at plan authoring. Implementing agents append dated bullets here._

## How to start (first session)

```bash
npm install
npm run dev
# Audit: /cases/ , /case/?id=anterior-stemi (or current anterior id), /sim/
# Read DESIGN.md Known drift, then implement B1 in style.css and verify prompts.
```

Commit after each track item. Open one PR per coherent visual chunk (player chrome, then depiction, then library), not one mega-PR.
