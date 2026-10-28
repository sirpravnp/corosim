# Cardiac arrest model: what is checked against the literature

Constants live in `src/config/arrest.ts` (state machine) and `src/config/arrestSim.ts` (CPR calibration). This note records what was checked
against PubMed (PMIDs given) and what is still a teaching assumption. It is a partial check: items marked **not checked** have not been
looked up and must not be presented as verified.

| Constant | Value in the model | Evidence found | Status |
|---|---|---|---|
| Survival fall with delay, no CPR/shock/ACLS | not used directly | Larsen 1993, PMID 8214853: 67 % if all immediate, minus 2.3 %/min to CPR, 1.1 %/min to defibrillation, 2.1 %/min to ACLS; 5.5 %/min with no treatment (King County, witnessed VF) | verified |
| Fall in shock success per minute of untreated VF | 8.5 %/min (`shock.declinePerMin`) | the 7-10 %/min figure often quoted is for survival and is not in Larsen 1993 (which gives 5.5 %/min with no treatment, 1.1 %/min for delay to shock) | **assumed**; consider lowering toward 5-6 %/min; no test bar changed |
| Epinephrine 1 mg | raises ROSC odds, small CPR-output boost | review PMID 36864469 (Perkins, Couper 2023): adrenaline 1 mg is highly effective for ROSC (number needed to treat 4) but much less for 30-day survival (NNT 111), neurological benefit uncertain | direction verified |
| Amiodarone / lidocaine in shock-refractory VF | small increase in shock response | ALPS trial analyses: PMID 31941354 (survival to discharge 23 %; IV route amiodarone adjusted RR 1.26, lidocaine 1.21 vs placebo; no benefit by IO route); PMID 35243875 (ROSC odds fall with time to drug: OR 0.92 per minute amiodarone, 0.95 lidocaine and placebo; amiodarone benefit only with early dosing); PMID 35236764 (Bayesian reanalysis: survival gain about 2.9 % amiodarone, 1.7 % lidocaine) | direction verified; sizes in the model are assumed and probably generous |
| CPR cardiac output about 25-30 % of normal | `perfusion()` max 0.30 | PubMed search for closed-chest CPR output did not return usable results; the figure comes from the Weisfeldt and Becker review cited in the config header | **not checked** |
| Irreversible injury from about 4 min, death at 10 min of no flow | 240 s / 600 s | not looked up | **not checked** (teaching defaults; `deathAfterNoFlowS` is configurable) |
| Biphasic 200 J first-shock success 90 % | `shock.baseSuccess` 0.9 | not looked up | **not checked** |
| CPR rate 100-120/min, depth 5-6 cm | best technique window | not looked up here | **not checked** |

Next step: look up the unchecked rows, and decide with a clinician whether to lower `declinePerMin` and the drug effect sizes.

## Time base: the clinical clock while the patient is critical

**Review needed: this is a design choice (death-hardening, 2026-10).** The simulation has two clocks. The heart runs on simulated seconds
(the beats, the reflexes, the arrest machine). The clinical clock (`Simulation.clinicalMinutes`: necrosis, the fluid compartments,
drug kinetics, the arrhythmia hazards, procedure delays) runs `minutesPerSecond` = 2 clinical minutes per simulated second at 1x, and
6 or 12 at the 3x and 6x buttons. Every death clock counts **simulated seconds** (`ARREST.deathAfterNoFlowS` 600 s of no flow,
`ARREST.shockDeath` 240 s with MAP < 40), so before this change 240 s of profound shock lasted 8 clinical hours at 1x and 48 h at 6x, and
a bleeding patient could be shown alive for a clinical day. (The report that started this: an anterior STEMI with a 100 ml/min
hemorrhage "in this rhythm for 28+ hours". That run also hung the engine; see below.)

The rule now (`Simulation.step`, so the page, the MCP tools and the tests all get it; constants `ARREST_SIM.critical`):

- While the patient is **critical** the clinical clock runs in **real time**: at most one clinical second per simulated second, whatever
  the speed button or the `minutes` a caller passes. Critical = in arrest (machine status `arrest`), or pulseless by the pressure check
  below, or in a sustained VT or VF episode of the arrhythmia model, or MAP < 40 mmHg (the refractory-shock line), and it ends once
  none of these holds and MAP is back at 45 or more.
- The clock is also held to real time while the engine's blood volume lags the fluid compartments by more than 150 ml. The heart is
  given or drained blood at no more than `ACS_CORE.maxVolumeRate` (120 ml per simulated second); at a fast clock a bleed would
  otherwise run far ahead of the pressure it causes, and the same bleed would crash the patient later the faster the clock (it did: the
  STEMI + 100 ml/min bleed arrested at 32 clinical minutes at 1x, 102 at 3x and 203 at 6x; now 25 at every speed).
- An accumulating pericardial effusion never fills the sac faster than 20 ml per simulated second (`PERICARDIUM.maxFillMlPerS`; the
  clock is slowed to keep it there), and it stops at 2 L (`PERICARDIUM.maxEffusionMl`). At 6x a 30 ml/min effusion used to pour in
  360 ml per simulated second and fill the sac to 14 L.
- So all death clocks count clinical seconds: 10 minutes of no flow is 600 simulated seconds and 10 clinical minutes, and the arrest
  panel's timers match the clinical clock (to the warm-up, which counts arrest time but no clinical time).
- A dead patient's clock stops. `step()` returns the clinical minutes that actually passed; the page hands those to its order clock
  (`manageStep`), and `revascularize()` waits the procedure's delay in clinical minutes (real time while critical, at most 1800
  simulated seconds), so a PCI ordered for a patient in arrest does not land 30 seconds later.
- `state().criticalTime` is true while it applies; the page shows "Clock slowed to real time: patient critical" in the 3D view.
- `Simulation.realTimeWhenCritical = false` turns it off. The page does that while a **Case** runs (src/cases): a case keeps its own
  compressed clock (its timer is simulated seconds, its PCI lands after 60 clinical minutes = 30 s), and its patients die on the
  same rules (`deathCause` "shock" or "noFlow") on that clock, as before.

## What kills, and what does not

| Rule | Threshold | Where |
|---|---|---|
| No flow | 600 clinical s of no-flow (CPR earns credit by its output and the coronary perfusion pressure) | `ARREST.deathAfterNoFlowS`, sim/arrest.ts |
| Refractory shock (with a pulse) | MAP < 40 mmHg for 240 clinical s (the count runs back down above it) | `ARREST.shockDeath`, `shockDeathStep` |
| Pulseless, by flow | native output (less CPR) < 20 % of the patient's own | `ARREST_SIM.pulselessOutput` |
| Pulseless, by pressure (new) | MAP < 25, or systolic < 45, or pulse pressure < 5 mmHg, for 3 s; a pulse again at MAP >= 30, systolic >= 55 and pulse pressure >= 10 for 3 s. The pulse-pressure rule is skipped while a device carries more than 0.5 L/min (VA-ECMO, Impella) | `ARREST_SIM.pulsePressure` |

The pressure check is new. An emptied circulation can keep a stroke volume moving at no pressure (the bled-out patient showed MAP
-0.4, systolic 0 and an output of 2 L/min, 53 % of normal, and was called "perfusing" for ever). Now an organized rhythm without the
pressure to feel a pulse is PEA (pulseless VT above 100/min) and the arrest clock runs. A heart that has stopped ejecting can also
leave a static circulation at a high pressure (a tamponade sat at MAP 40-140 mmHg, the pericardial pressure, with a 1 mmHg pulse), so a
pulse pressure under 5 mmHg is no pulse either. A sinus tachycardia of 180 with 48/42 mmHg (output 1.6 L/min) is called PEA by this
rule: pseudo-PEA, which ACLS treats as PEA. The lines sit below the shock line, so a patient
in deep shock with a pulse still dies on the shock clock and only a circulation that has really failed is PEA. They are assumed
(a carotid pulse is usually lost somewhere around a systolic of 50-60 mmHg; pseudo-PEA is a measurable pressure without a palpable
pulse), not taken from a study: **not checked**.

What is guarded so a lethal run cannot hang or run past empty:

- **Hemorrhage stops at exsanguination.** The bleeding rate tapers to nothing between 30 % and 20 % of the resting blood volume
  (`FLUIDS.hemorrhage`), `bleed(ml)` stops at the same floor, compartment volumes and protein masses cannot go negative and a fluid
  step that comes out non-finite is undone. The floor is a numerical guard, not a survival rule: the pulse check and the arrest
  clock end the patient long before (PEA at about half the blood volume). Before, the plasma volume ran through zero, the compartments
  went NaN, the NaN reached the baroreflex and then the conduction model, whose beat loop never advanced (an infinite loop that
  allocated beats until the tab or the process ran out of memory, at about simulated second 33.5 of the reported case).
- **The engine is not drained below empty.** `VolumeExchange` takes a loss only from stressed volume, at most all of it per 0.25 s, so
  the vessels empty towards their unstressed volume and engine pressures stay at or just above zero. (Off during `warmup()`, whose
  build can start empty, see below, so that settles exactly as before.)
- **Beat generators never loop on a broken rate.** Intervals are finite and at least 0.15 s, clocks poisoned upstream restart, one
  `advance()` call returns at most 10 000 events; the library rhythm's rate scale is finite; the baroreflex ignores a non-finite beat.
- **No spurious arrest at the start.** A heavy bleed at build (bloodLoss of 0.2 or more) settles to an empty circulation (MAP 0: the
  build has no reflex venous tone), which the warm-up then fills over seconds. That used to be taken for PEA and left every such patient
  in `rosc` after `warmup()`. During `warmup()` a new PEA, the pressure check and the shock clock now wait; a rhythm that is itself an
  arrest (VF, asystole, pulseless VT preset) is still recognised.

What the trials show (tests/deathTrials.test.ts asserts the first rows at 1x, 3x and 6x; numbers are clinical minutes, seed 3):

| Scenario | Arrest | Death | Notes |
|---|---|---|---|
| Healthy heart, hemorrhage 200 ml/min | about 11 (PEA) | about 21 (no flow) | same at 1x, 3x, 6x |
| Anterior STEMI + hemorrhage 100 ml/min (the reported case) | about 25 (PEA) | about 35 (no flow) | was: engine hang, or alive for a clinical day |
| Untreated VF | at once | 9.8 (no flow) | |
| VF with good CPR only | at once | about 15 | CPR buys time |
| Asystole | at once | 9.8 | |
| Treated: STEMI + bleed, bleed stopped + 2 L blood at MAP < 55 | none | alive | |
| Treated: VF, CPR + 200 J shocks | ROSC | alive | |

What does **not** kill in the model, and should be reviewed (reported, not changed):

- **Left main occlusion, untreated**: EF 0.16, cardiac output 2.7-3 L/min (index about 1.5), wedge 40-45 mmHg with alveolar edema, but
  MAP held at 70 by the reflexes, so it never meets either death rule (normotensive cardiogenic shock). No VF either on seed 3: the
  ischemic VT/VF hazard is about 0.5 per hour in the first hour and falls off. Real untreated left main occlusion is mostly fatal. The
  model has no death from hypoperfusion at a held pressure (no lactate / end-organ clock) and no respiratory death from pulmonary edema.
- **Anterior STEMI alone**: EF 0.30, half the LV infarcted by 24 h, wedge about 20, MAP 80-87 for 48 clinical hours. Most STEMIs do
  not go into shock (5-10 %), so surviving is plausible, but losing 50 % of the LV is the size that typically does (40 % or more in
  shock autopsy series), so this is on the optimistic side.
- **Complete heart block with a 32/min wide escape**: MAP about 72 for 24 h in an otherwise normal heart; tolerable for hours is
  plausible, but the escape's unreliability (pauses, asystole) is not modelled.
- **Sustained VT presets** (vt-mono 172/min: MAP about 83 for 24 h; vt-poly 225/min: MAP about 64 for hours): the preset is a fixed
  rhythm that neither degenerates to VF nor terminates, and polymorphic VT sustained for hours with a pulse is not realistic.
  An induced ischemic VT episode follows the arrhythmia model instead.
- **Tamponade of 800 ml accumulating 50 ml/min**: PEA at once (acute 800 ml is a lot), death 10 min later.
