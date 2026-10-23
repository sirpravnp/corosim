# Hemodynamic core

The single engine the plan in `docs/HEMODYNAMICS_CORE.md` builds toward. `types.ts` holds the contracts; everything
else here is added by the tasks in `docs/HEMODYNAMICS_TASKS.md`.

## Model

- **Nodes** hold blood: chambers (time-varying elastance) and compliances (vessels, venous reservoirs). Each node has a
  pressure law (`NodeModel`) and an external-pressure group.
- **Elements** take part in up to four phases of every derivative evaluation:
  1. `field`: read volumes; write external pressures or volume shifts;
  2. pressure: the engine calls each node's `pressure(V + Vshift, t)` and adds `Pext`;
  2b. `series`: add a series pressure drop to a node (`out.addPressure`), so the node reads as the proximal pressure. All series elements read the phase 2 pressures and their additions are applied together;
  3. `flow`: move blood between nodes (or to and from `OUTSIDE`) and set the rates of the element's own states.
- **Events** (`HeartEvent`) come from the rhythm model and start activation; chambers react in `onEvent`. A chamber knows no beat
  period: ventricular activation is a function of the time since its event, with the time scale set by the RR interval preceding
  that event (QT-like rate rule; the first event uses the chamber's default interval), and the falling limb stretched by the
  `relaxScale` parameter. Atrial activation lasts `atrialDuration(preceding atrial interval)`. A ventricular event with no atrial
  event before it has no atrial contraction (junctional rhythm, AF). For steady-rate reports `periodic(hr, { pr })` schedules a
  ventricular event every beat and an atrial event `pr` seconds (atrial event to ventricular event) before each; `pr` defaults to the
  engine option `defaultPr(T)` (`fromModel` supplies it; `pr: Infinity` means no atrial events).
- **Relaxation time constant.** `BeatRecorder.beat().tauMs` gives LV and RV τ in ms: a Weiss fit P = P0·e^(−t/τ) of the pressure
  from dP/dt min to inlet-valve opening (zero asymptote). The adult at 72 bpm gives about 36 ms (normal 30-50).
- **Parameters** live in each element's `params` and change only between steps (`Tunable.set`).
- **Outputs** come from `sample()` and `onSample()`: pressures, volumes, flows per element, and each element's `taps`.
  `flowVolumes()` gives the forward and backward volume through every flow element since `resetFlowVolumes()` (per-beat shunt and regurgitation volumes).

- **Live play (A6).** `live.ts` `LiveHeart` schedules events from the rhythm model's beats and steps the engine; `BeatRecorder` built with `T = null` closes a beat at each ventricular event (`closeBeat()`, called from an element's `onEvent`) instead of every `T` seconds. Slow inputs are `Tunable.set` patches from design-point factors (`setModifiers`).

Units: mmHg, ml, ml/s, s.

## How each planned piece fits

| Piece (task) | Kind | Phase | Own states |
|---|---|---|---|
| Chamber with activation and relaxation (A1, A4) | `NodeModel` | pressure; `onEvent` | none (activation is a function of time since the event, the preceding interval and `relaxScale`) |
| Regional LV segments (E3) | `NodeModel` (the LV law sums segments) | pressure | none |
| Compliance, venous reservoir with unstressed volume (A1, A5) | `NodeModel` (`vessels.ts`: P = (V − Vu)/C, `Vu` tunable) | pressure | none |
| Resistor, Gorlin orifice, valve (A1) | `Element` | flow | none |
| Inertial edge, valve with inertance (A3) | `Element` | flow | flow Q |
| 3-element Windkessel (A5) | characteristic impedance `Zc` is a parameter of the outflow valve (`OneWayValve`, `InertialValve`): the valve and Zc solve ΔP = K·Q·|Q| + Zc·Q in closed form (or, inertial, Zc·Q joins the state equation); phase 2b adds Zc·Q to the artery node, which then reads the proximal pressure Pc + Zc·Q, so no stiff root node is needed | series, flow | none or Q |
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

## Vessels (A5)

- **Zc.** The artery node's pressure is the proximal pressure Pp = Pc + Zc·Q (Pc from its volume). Outflow elements on the node (beds, isthmus, shunts) see Pp, a Voigt-type 3-element Windkessel (Zc in series with C, in parallel with the bed), which is close to the textbook form since Zc is about 5 % of the bed resistance. The valve gradient `P_from − Pp = K·Q²` is the valve's own. A second flow into the same node (the overriding aorta, `RVAO`) carries its own Zc.
- **Unstressed volume.** `Compliance` has `Vu`; stressed volume is max(V − Vu, 0). `fillingOf` gives total, stressed volume and mean systemic filling pressure (stressed / total compliance). Venoconstriction (C1) is `Tunable.set({ Vu })` on SVC, IVC or SPL. Veins built with Vu > 0 collapse smoothly toward −1 mmHg below Vu.
- **Splanchnic reservoir** (node SPL): the lower-body bed drains DAO → BEDL → SPL → SPLV → IVC. The upper body has no split (small, little controllable volume).
- Convergence: with unstressed volume `periodic()` judges convergence on the IVC and SPL pressures instead of the IVC volume.

## Impella (D2)

`devices/impella.ts`: `Impella` is a `RotaryPump` (D1) with per-model numbers from `IMPELLA` in `config/devices.ts` (all `[assumed]`, none manufacturer data).

- **Wiring.** `fromModel(m, { impella: { model: "2.5" | "CP" | "5.5", level: 0-9, position: "correct" | "aortic" | "deep" } })` adds the element `impella` (LV to AO; AO to AO for `aortic`). In `LiveHeart` pass `extra: [(m) => Impella.forModel(m, cfg)]` (an entry of `extra` may be a function of the built `Model`, since the suction law needs the LV's own V0). `set({ level })` changes the P-level live; `position` is fixed at construction.
- **Suction and floor are relative to V0** of the inflow chamber (R-D1): collapse volume Vc = V0 + 30 ml, hard floor V0 + 2 ml. The floor is a limiter on the pump state, not an extra damper: over `Q_lim = (V - floor)/floorTau` the flow equation is replaced by `dQ/dt = -(Q - Q_lim)/limitTau` (blended in over a small band so the rate stays continuous). The volume terms are LV laws and are off for `aortic`. The limiter stops the pump drawing the LV below the floor; the heart's own ejection can still take the chamber toward V0 with or without a device.
- **Motor current** `I = i0 + i2·ω² + kI·max(H·Q, 0)/ω` (mA; H the rotor head at the present Q, mmHg; Q ml/s; ω krpm): speed-dependent loss plus hydraulic torque. Its waveform follows the LV-AO pressure difference (correlation with the placement signal 1.00 in tests).
- **Placement signal** is `P_out - P_in` (aortic minus LV pressure) over the beat: about 0 in systole and the full aortic-LV difference in diastole when correctly placed; flat at 0 in the aorta.
- **Console.** Element taps (instantaneous): `flow`, `current`, `placement`, `level`, `suction`/`suctionAlarm`, `suctionLevel`. `ImpellaConsole(engine)` turns them into per-beat numbers (`last`: flow and current statistics, `pulsatility` of the current, placement mean/min/max/amplitude, `suctionFraction`, `suctionLevel`, `suctionAlarm` = highest suction level of the beat at or above 0.2).
