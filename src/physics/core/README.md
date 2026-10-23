# Hemodynamic core

The single engine the plan in `docs/HEMODYNAMICS_CORE.md` builds toward. `types.ts` holds the contracts; everything
else here is added by the tasks in `docs/HEMODYNAMICS_TASKS.md`.

## Model

- **Nodes** hold blood: chambers (time-varying elastance) and compliances (vessels, venous reservoirs). Each node has a
  pressure law (`NodeModel`) and an external-pressure group.
- **Elements** take part in up to three phases of every derivative evaluation:
  1. `field`: read volumes; write external pressures or volume shifts;
  2. pressure: the engine calls each node's `pressure(V + Vshift, t)` and adds `Pext`;
  3. `flow`: move blood between nodes (or to and from `OUTSIDE`) and set the rates of the element's own states.
- **Events** (`HeartEvent`) come from the rhythm model and start activation; chambers react in `onEvent`.
- **Parameters** live in each element's `params` and change only between steps (`Tunable.set`).
- **Outputs** come from `sample()` and `onSample()`: pressures, volumes, flows per element, and each element's `taps`.
  `flowVolumes()` gives the forward and backward volume through every flow element since `resetFlowVolumes()` (per-beat shunt and regurgitation volumes).

Units: mmHg, ml, ml/s, s.

## How each planned piece fits

| Piece (task) | Kind | Phase | Own states |
|---|---|---|---|
| Chamber with activation and relaxation (A1, A4) | `NodeModel` | pressure; `onEvent` | none (activation is a function of time since the event) |
| Regional LV segments (E3) | `NodeModel` (the LV law sums segments) | pressure | none |
| Compliance, venous reservoir with unstressed volume (A1, A5) | `NodeModel` | pressure | none |
| Resistor, Gorlin orifice, valve (A1) | `Element` | flow | none |
| Inertial edge, valve with inertance (A3) | `Element` | flow | flow Q |
| 3-element Windkessel (A5) | characteristic impedance as an inertial/resistive edge into a compliance node | flow | none or Q |
| Pericardium (B1) | `Element` | field: `addExternal` on the "pericardial" group from total heart volume + effusion | effusion volume |
| Septum (B2) | `Element` | field: `shiftVolume` LV ↔ RV from the septal balance | none (quasi-static solve) or septal volume |
| Intrathoracic pressure (B3) | `Element` | field: `addExternal` on "thoracic" (and "pericardial") nodes | none |
| Rotary pump: Impella, ECMO, Impella RP (D1, D2, D6, D7) | `Element` | flow; taps for the console | pump flow Q |
| IABP (D5) | `Element` | field: `shiftVolume` on the descending aorta; `onEvent` for triggering | balloon volume |
| Fluid compartments, infusions, bleeding, urine (C2) | `Element` | flow to and from `OUTSIDE` | interstitial volume, lung water |
| Venoconstriction (C1) | parameter of the venous `NodeModel` (unstressed volume) | pressure | none |
| Drugs (E4) | outside the engine: map doses to parameter patches each step | none | effect-site levels (kept by the drug model) |
| Oxygen transport (E6) | separate pass over `Sample.q` per step or per beat | none | content per node (kept by the O₂ model) |
| 1D arterial segment (F3) | an element whose ends are nodes; its interior is its own states | flow | A and Q per grid point |

If a later task needs something this table cannot express, change `types.ts` in that task's PR and update this table.
- An element calls `flow()` at most once per evaluation; two paths means two elements (`Sample.q` and `flowVolumes()` are per element).
