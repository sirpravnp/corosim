# CoroPump: design and plan

Status: draft for approval. Nothing is built. Branch from `origin/main`, not the `echo-atlas` checkout, which is stale.

## Intent

Replace "Impella" with "CoroPump" everywhere on the site, then make the device a first-class teaching object: a visible pump in the 3D heart, a simulated console pane, a control panel that exposes only what the engine models, and the purge, thrombus and hemolysis behavior that real operators act on.

## Goals

- No user-visible "Impella" anywhere (UI, docs, comments, tests, MCP text). Identifiers renamed too.
- Old saved patients, case JSON and MCP calls that use `impella` still load (parser accepts the old key).
- 3D pump drawn when the device is on, positioned by the model's position setting.
- Console pane shows only signals the engine produces.
- Control panel exposes only modeled settings.
- Purge, thrombus burden and hemolysis modeled well enough to drive cases.

## Non-goals and anti-goals

- No manufacturer data or lookalike branding. Constants stay marked [assumed] unless sourced.
- No controls or readouts without engine state behind them.
- No clinical-advice framing. Educational only.
- No tinted alarm boxes, glow, gradients or rounded cards (CLAUDE.md UI rules).

## What exists on origin/main

- `src/physics/core/devices/impella.ts`, `impellaRp.ts`: pump law, suction, motor current, placement signal, `ImpellaConsole` per-beat stats.
- `src/config/devices.ts`: models 2.5, CP, 5.5, RP; `IMPELLA_SUCTION`, `IMPELLA_CONSOLE`.
- Controls: model, P-level 0-9, position (correct, aortic, deep) in `src/panels/playgroundControls.ts`, mounted in the dock's Support tab.
- Cases: `ecpella`, `lmShock`; presets `shock-impella`, `impella-aortic`, `impella-deep`, `rv-infarct-impella`.
- Not present: purge, thrombus, hemolysis, any 3D device mesh.

## New physics (all [assumed], to be calibrated and tested)

**Purge.** Inputs: purge solution (heparin in dextrose, or bicarbonate), purge heparin concentration, line state (clear, kinked, blocked), P-level, thrombus burden. Outputs: purge flow (ml/hr) and purge pressure (mmHg). Pressure rises with blockage, thrombus burden and solution viscosity; flow falls as pressure rises. Alarms: purge pressure high, purge flow low. Rising pressure with falling flow is the early thrombosis signature.

**Thrombus burden (0-1).** Grows with stasis (low P-level or low flow), low anticoagulation (purge heparin plus systemic), and blocked purge. Raises purge pressure and motor current, lowers pump head (efficiency), raises hemolysis. Reduced by raising purge heparin or switching solution; at high burden only pump exchange fixes it.

**Plasma free hemoglobin (pfHb, mg/dL).** Production rises with shear: high rotor speed against low flow, suction events, deep position (inflow against the wall), thrombus burden. Cleared with a first-order time constant (compressed sim time, set in config). Outputs: pfHb and a urine-color tap (clear, tea, dark). Shown as a lab value, not a console alarm (a real console does not show it). Downstream effects on kidney function are out of scope unless a case needs them.

## Console pane (read-only signals)

Placement signal (inlet pressure waveform), motor current waveform, flow (L/min), P-level, purge pressure and flow, pfHb and urine color, alarms (suction, position wrong, purge). Figures captioned. Hairline frames, sentence-case labels, alarms as an inline label plus rule.

## Control panel

On/off, model, P-level, position, purge solution, purge heparin concentration, clear purge line. Lives in the pane; the dock duplicate is removed.

## 3D pump

Catheter pump mesh: pigtail tip, inlet cage, motor housing across the aortic valve, outlet, catheter down the descending aorta. Placement transform from the position setting (correct, aortic, deep). Neutral gray; amber only for suction or caution. Hidden when the device is off.

## Cases

Built: `lmShock` (LM occlusion shock), `ecpella` (VF with ECMO plus pump), presets for aortic and deep position and RV infarct.

New:

1. Protected high-risk PCI: EF 25 percent, LM or last vessel; place before the balloon, watch LVEDP and PCWP (MAP is held by the baroreflex), wean after.
2. STEMI shock, unload before reperfusion.
3. Suction alarm in hypovolemia: bleed at high P-level; fluids or lower P-level.
4. Malposition, pulled back: placement signal goes flat, position alarm.
5. Malposition, too deep: wall contact, suction, hemolysis.
6. Purge pressure rising: early thrombosis; heparin purge or solution change.
7. Hemolysis: dark urine and rising pfHb; find the cause (speed vs flow, suction, position, thrombus).
8. Weaning: step down P-level against echo and pressor needs.
9. Fulminant myocarditis: bridge to decision.
10. Hemodynamically unstable VT during ablation.

## Phases and who builds them

Superseded by the implementation plan: `docs/superpowers/plans/2026-11-08-corepump.md`. Cursor builds the engine (rename, purge, thrombus, hemolysis, wiring, eval); Claude builds and reviews the UI (3D pump, console pane, control panel, cases) and gates every Cursor PR.

## Left to the builder

Exact purge numbers and thresholds, hemolysis clearance time constant, mesh dimensions, pane layout. Mark each as a builder call in the code comments.

## Open questions

- Is there a systemic anticoagulation state (ACT) in the live patient, or only in the cath-lab stub? Purge heparin may need to stand alone.

## Case-system alignment (added 2026-11-08)

Follows PR 87 (per-case monitor, order and lab catalog, safe skip) and the unmerged `case-screen` learner gate. The console is a workspace panel a case can list or the learner can order. Free hemoglobin is an ordered lab with turnaround and urine color a bedside item. The learner may treat (level, model, purge solution and heparin, reposition, clear line, exchange) and may not create disease (position, purge line, initial thrombus or hemoglobin). Cases start at "day 3 on the pump" through an author-only `initial` field. Details and tasks: the implementation plan.

Update (case-screen): cases show no 3D heart (`heart3d` is retired), so the 3D pump is a free-play view. In a case the console carries the teaching: a malposition shows as a flat placement signal and a position alarm.

Update 2026-11-09: the RV-failure case with a left-only pump is removed (ten cases). CoroPump RP remains in the product; see the plan's Deviations.
