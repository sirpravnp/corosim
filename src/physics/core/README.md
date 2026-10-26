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

- **Beat strength (A7).** An event's `strength` below 1 scales the activation (a weak PVC); above 1 (post-extrasystolic potentiation) it scales Ees (`ElastanceChamber.eesGain`), so activation stays within 0..1 and the passive term never goes negative.
- **Ventricle factors (A7).** `LiveHeart.setVentricleFactors({ lvEes, rvEes, lvStiffness, rvStiffness })` sets per-ventricle factors on the design Ees and passive stiffness (`a`), separate from the autonomic `contractility` modifier (they multiply). Ischemia and scar act here (`config/ischemia.ts`). `LiveBeat.atrialKick` is true when an atrial event actually came 0.04-0.35 s before the ventricular one (`LIVE.kickMinLead/kickMaxLead`), whatever the beat's labels.
- **ACS simulation (A7).** `Simulation({}, { engine: "core" })` runs the ACS patient on `LiveHeart` (mapping in the "Core engine" comment of `sim/simulation.ts`). The real Impella and IABP since D3 (section "Devices in the ACS simulation" below); `volume.ts` (`VolumeExchange`: fluids and hemorrhage) stays until C2.

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
| Septum (B2) | `Element` (`septum.ts`, `fromModel(m, { septum: true })`) | field: `shiftVolume` LV −V_spt, RV +V_spt; V_spt solved each evaluation from P_LV(V_LV−V_spt) − P_RV(V_RV+V_spt) = E_s(t)·V_spt (safeguarded Newton, bisection fallback, no allocation; never NaN). The ventricles keep a free-wall fraction of the lumped laws (`config/septum.ts`) | none (quasi-static solve); `stats` count solves and iterations |
| Intrathoracic pressure (B3) | `Element` (`thorax.ts`, `fromModel(m, { thorax: { mode, rate, depth, peep, tidalMlKg } })`) | field: `addExternal` of P_pl − P_ref on "thoracic" and "pericardial" nodes (the sac's pressure adds on top), a smaller abdominal pressure on "abdominal" nodes; a stiff sac passes only 1/(1 + k(s−1)) of it to the chambers and SVC (Kussmaul). The phase is a function of t; `setPhase(φ, t)` follows the autonomic respiratory phase; the `thoracic` modifier of `LiveHeart` is a constant offset. P_ref = −7 mmHg, the mean of quiet breathing, so the calibrated normal numbers are unchanged. Outputs (pulsus paradoxus, PPV, SVV) are pure functions of beat records in `physics/respiratory.ts` | none |
| Rotary pump: Impella, ECMO, Impella RP (D1, D2, D6, D7) | `Element` | flow; taps for the console | pump flow Q |
| IABP (D5) | `Element` (`devices/iabp.ts`, `fromModel(m, { iabp })`) | field: `shiftVolume` on the descending aorta; `onEvent` for triggering; `attach` (new optional `Element` hook, called once by the engine) watches the AV flow | balloon volume Vb |
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
- **Stressed volume and MSFP (C1).** `stressedVolumes(nodes, V, systemic)` reports total, stressed and unstressed volume per node and in total, and `msfp`: the one pressure all nodes settle to after a stop-flow, the root of Σ `restVolume_i(P)` = total blood volume (`NodeModel.restVolume` inverts the passive law of a vessel or a relaxed chamber). It depends on the total volume and the compliances only, so it does not ripple with the beat, and a real stop-flow run (heart stopped, flow ceased) lands on it within 0.05 mmHg. `systemic` is the older estimate from the five systemic vessels alone (stressed / compliance), which does ripple. `LiveHeart.filling()` and `Simulation.filling()` / `hemo().filling` expose them. Venous tone (`LiveHeart.setModifiers({ venousTone })`, `VENOUS_TONE`) lowers `Vu` of SPL, IVC and SVC: blood moves from unstressed to stressed, total unchanged. Normal adult: 4.6 L, 0.93 L stressed (of which about 0.6 L in the systemic vessels), `msfp` 6.55, systemic estimate 7.1.
- **Splanchnic reservoir** (node SPL): the lower-body bed drains DAO → BEDL → SPL → SPLV → IVC. The upper body has no split (small, little controllable volume).
- Convergence: with unstressed volume `periodic()` judges convergence on the IVC and SPL pressures instead of the IVC volume.

## Impella (D2)

`devices/impella.ts`: `Impella` is a `RotaryPump` (D1) with per-model numbers from `IMPELLA` in `config/devices.ts` (all `[assumed]`, none manufacturer data).

- **Wiring.** `fromModel(m, { impella: { model: "2.5" | "CP" | "5.5", level: 0-9, position: "correct" | "aortic" | "deep" } })` adds the element `impella` (LV to AO; AO to AO for `aortic`). In `LiveHeart` pass `extra: [(m) => Impella.forModel(m, cfg)]` (an entry of `extra` may be a function of the built `Model`, since the suction law needs the LV's own V0). `set({ level })` changes the P-level live; `position` is fixed at construction.
- **Suction and floor are relative to V0** of the inflow chamber (R-D1): collapse volume Vc = V0 + 15 ml (D3; was 30, which alarmed a normal heart at P6), hard floor V0 + 2 ml. The floor is a limiter on the pump state, not an extra damper: over `Q_lim = (V - floor)/floorTau` the flow equation is replaced by `dQ/dt = -(Q - Q_lim)/limitTau` (blended in over a small band so the rate stays continuous). The volume terms are LV laws and are off for `aortic`. The limiter stops the pump drawing the LV below the floor; the heart's own ejection can still take the chamber toward V0 with or without a device.
- **Motor current** `I = i0 + i2·ω² + kI·max(H·Q, 0)/ω` (mA; H the rotor head at the present Q, mmHg; Q ml/s; ω krpm): speed-dependent loss plus hydraulic torque. Its waveform follows the LV-AO pressure difference (correlation with the placement signal 1.00 in tests).
- **Placement signal** is `P_out - P_in` (aortic minus LV pressure) over the beat: about 0 in systole and the full aortic-LV difference in diastole when correctly placed; flat at 0 in the aorta.
- **Console.** Element taps (instantaneous): `flow`, `current`, `placement`, `level`, `suction`/`suctionAlarm`, `suctionLevel`. `ImpellaConsole(engine)` turns them into per-beat numbers (`last`: flow and current statistics, `pulsatility` of the current, placement mean/min/max/amplitude, `suctionFraction`, `suctionLevel`, `suctionAlarm` = highest suction level of the beat at or above 0.2).

## VA-ECMO (D6)

`devices/ecmo.ts`: `Ecmo` (element `ecmo`) is a `RotaryPump` from RA (or IVC, `drain: "IVC"`) to DAO with the oxygenator folded into the circuit resistance. Constants `ECMO_PUMP`, `ECMO_SUCTION`, `ECMO_OXYGENATOR` in `config/devices.ts` [assumed].

- **Wiring.** `fromModel(m, { ecmo: { flowLpm, sweepLpm, fio2, drain } })`, or in `LiveHeart` `extra: [(m) => Ecmo.forModel(m, cfg)]`; `set({ flowLpm, sweepLpm, fio2 })` live.
- **States.** Flow Q, rotor speed ω and the filtered drainage volume Vf. ω relaxes (0.5 s) to the closed-form inverse of the HQ curve at the present pressures and suction resistance, clamped to 0-5 krpm. Suction and the soft floor act on Vf (the RA empties to V0 at each atrial systole, so the instantaneous volume cannot be used), relative to the node's V0.
- **Oxygen.** `solveOxygen(m, h, { from, to, flow, oxygenate })` (exported from `structural.ts`) takes the ECMO stream as an extra source into DAO; `Ecmo.returnSat(sIn)` is the oxygenator (`oxygenatorSat`). Without the argument the solve is unchanged.
- **Taps.** `flow`, `speed`, `rpm`, `targetLpm`, `suctionAlarm`, `suctionLevel`, `membraneDp`.
- **LV distension (D6b).** `buildModel` adds a resistor `BRON` AO → PV (bronchial and Thebesian return, `BRONCHIAL.frac` = 1 % of the design flow [assumed, within the 1-2 % lit range]; `BuildOptions.bronchial: false` leaves it out, as in `LEGACY_BUILD`). It is the only inflow left to the left heart when a weak LV cannot open the aortic valve against ECMO afterload, and then LV volume rises until its contraction meets the aortic pressure. In the normal baseline it moves PCWP by about +0.1 mmHg (the volume calibration absorbs the rest). Whether a poor LV distends with flow mainly depends on volume: at the calibrated blood volume a stiff weak LV (`SHOCK`) rises only ~0.8 mmHg (less filling and higher end-systolic volume cancel); volume-loaded (+300 ml) it rises 3.6 mmHg at 4 L/min and with every flow step.

## IABP (D5)

`devices/iabp.ts`: `Iabp` (element `iabp`), `fromModel(m, { iabp: true | { ratio, inflateMs, deflateMs, volumeMl } })`, or in `LiveHeart` `extra: [(m) => Iabp.forModel(m, cfg)]`. Constants `IABP` in `config/devices.ts` [assumed].

- **Balloon.** State Vb (0..`volumeMl`, 40 ml); `shiftVolume(DAO, Vb)`, so it displaces volume in the descending aorta and adds no blood. First-order gas shuttle (inflate 40 ms, deflate 50 ms) towards a smoothed 0/1 window.
- **Trigger.** The k-th ventricular event starts a cycle when (k-1) mod ratio = 0. Inflation = event + closure delay + `inflateMs`; the closure delay is MEASURED from the AV flow of previous beats (R wave to the AV flow falling below 1 ml/s after exceeding 5 ml/s; a beat whose balloon was already inflating does not update it), scaled by sqrt(RR/RR_ref); fallback 0.12 + 0.2·RR. Deflation starts at event + RR_previous - 0.13 s + `deflateMs`; a premature beat cuts the window at its R wave (plus any late offset).
- **Taps.** `vb`, `target`, `fill`, `phase` (0 deflated, 1 inflating, 2 inflated, 3 deflating), `assisted` (current beat starts a cycle), `augmentation` (Vb/C of the DAO, mmHg), `closure` (delay estimate, s), `beat`.
- **Per-beat outputs.** `physics/iabpWaveform.ts` (pure): `iabpBeat(s)` (systolic, notch, peak diastolic, EDP, late minimum, augmentation onset, DPTI), `avClosureTime`, `augmentationSpan`, `summarizeIabp` (assisted vs unassisted).

## Venting and right support (D7)

`devices/impellaRp.ts`: `ImpellaRp` (element `impellaRp`) is a `RotaryPump` IVC → PA with `IMPELLA_RP` (`config/devices.ts`, all `[assumed]`: P1-P9 15-33 krpm, about 4 L/min at P9 against 20 mmHg). Suction and floor are relative to the IVC's unstressed volume (R-D1: half developed at V0 + 25 ml or IVC pressure below -0.5 mmHg). `fromModel(m, { impellaRp: { level } })`, or in `LiveHeart` `extra: [(m) => ImpellaRp.forModel(m, cfg)]`; `set({ level })` live. Same taps as `Impella`, so `new ImpellaConsole(engine, "impellaRp")` is its console. Inflow is the IVC only (no RA option).

- **Combinations.** All devices coexist: ECPELLA `{ ecmo, impella }`, `{ ecmo, iabp }`, BiPella `{ impella, impellaRp }`, septostomy = the existing `ASD` edge (`spec.asd.diameterMm`, 5-15 mm; no new element). Tests in `tests/venting.test.ts`.
- **Findings (volume-loaded shock 4 L/min and severe dysfunction 5 L/min on ECMO).** Ranking by LVEDP: septostomy 12 mm < 8 mm < Impella CP P8 < P5 < IABP 1:1 (loaded: IABP < P2); the septostomy shunts 4-8 L/min through the orifice law with the RA held low by the drainage, so it beats the CP in this model. Impella P2 leaks back in diastole against a high aortic pressure (reverse flow sees only R0) and does not vent the loaded case.

## Devices in the ACS simulation (D3)

`Simulation` with `engine: "core"` builds an `Impella` (`sim/coreDevices.ts`: `SwitchableImpella`, the D2 element plus an on/off gate) and an `Iabp` into every `LiveHeart`, always present; the support toggles gate them. `devices/placeholder.ts` is removed.

- **Settings.** `effectiveDevices(spec)`: the legacy booleans are Impella CP, P6, correct position / IABP 1:1, correct timing, 40 ml; `PatientSpec.devices.impella` / `.iabp` set model, level, position, ratio, offsets, volume, and switch the device on. `Simulation.setImpellaLevel(n)`, `setIabp({ ratio, inflateMs, deflateMs, volumeMl })` and `apply({ devices })` change them live; model and position are fixed at `reset()`. P0 means not inserted. The balloon is off during the warm-up (so the unassisted state is the reference); its volume is `volumeMl` when on, 0 when off.
- **Off.** A stopped Impella left in the LV would regurgitate through the rotor; the gate removes it instead (flow state decays in 20 ms, blood conserved).
- **Suction margin (D3).** `IMPELLA_SUCTION.vcMarginMl` 30 to 15: a normal LV at P6 ends systole near V0 + 25 ml. Checked: no alarm in a normal heart for 2.5, CP and 5.5 at P4, P6, P9; alarm in a 15 % bleed at P6 and a 40 % bleed at P8.
- **Coronary pressure.** Measured from the aortic samples: D = time-mean aortic pressure with the aortic valve closed. rho = D / mean aortic pressure is learned in the warm-up and on unassisted beats; on an assisted beat the augmentation is D - rho * mean, smoothed (2 s), and zero on unassisted beats. `circ.coronaryPressure` = MAP + augmentation; without a balloon it is MAP. The legacy engine keeps its fixed +10 mmHg.
- **Consoles.** `sim.devices()` returns `{ impella, iabp }` (keys documented on `ImpellaReadout` / `IabpReadout` in `sim/coreDevices.ts`); null with the legacy engine.

## PV-loop metrics and MVO2 (E1)

`src/physics/loopMetrics.ts` (pure, no engine state, not yet wired into panels or the simulation; E7 and E2 consume it). Input: one beat of LV (or RV) pressure and volume samples in time order, plus the chamber's `v0` and optionally its `ees`. Collect them with `engine.onSample`, as `tests/impella.test.ts` and `tests/loopMetrics.test.ts` do. Constants in `config/energetics.ts`.

- `loopMetrics(P, V, { v0, hr, ees?, t?, massG?, tauMs? })` returns EDV, ESV, SV, EF, the end-systolic point (`pes`, `ves`), stroke work (mmHg·ml and J), PE, PVA (mmHg·ml and J), efficiency SW/PVA, Ea, Ees, Ea/Ees, dP/dt max and min (mmHg/s, needs `t`: sample times or a step in s), `tauMs` (passthrough of `BeatRecord.tauMs.LV`) and `mvo2`.
- Pieces: `strokeWork` (|∮P dV|, loop closed), `esPoint`, `potentialEnergy`, `pressureVolumeArea`, `mvo2(pva, ees, { hr, massG })`, `cardiacPowerOutput(MAP, CO)` (= MAP·CO/451 W; CO in L/min), `dPdt`, `toJoules`. The loop area, cleaning and EF helpers are shared with `physics/loopMath.ts`.
- **End-systolic point** = the sample of maximum P/(V − V0), not valve closure. PE = ½·Pes·(Ves − V0). Ea = Pes/SV with SV = max V − min V of the loop (with an Impella this is the LV volume change, which includes what the pump removes). Ees = the model's value when given, else Pes/(Ves − V0); in the adult model the two agree to 3 digits.
- **MVO2** (Suga) = a·PVA100 + b·Ees100 + c per 100 g, scaled by M/100, with PVA100 = PVA/(M/100) and Ees100 = Ees·(M/100). a = 1.8e-5 ml O2 per mmHg·ml per 100 g [lit, Suga 1979/1981 canine; about 37 % efficiency]; b = 3e-3 and c = 0.01 ml O2/beat/100 g [assumed]. Masses [assumed]: LV 170 g, RV 55 g (`massG` option). Returns ml O2 per beat, per minute, and per minute per 100 g.
- Typical output of the adult model at 72/min (LV 170 g): SW 0.98 J, PVA 1.22 J, SW/PVA 0.80, Ea 1.47, Ees 3.03, Ea/Ees 0.49, CPO 1.03 W, MVO2 8.8 ml/min/100 g. Shock (lvEes 0.35, lvStiffness 1.6): Ea/Ees 1.44, CPO 0.50 W, PVA 0.74 J. Impella CP P8 in shock: PVA 0.67 J, MVO2 -7 % per beat.
