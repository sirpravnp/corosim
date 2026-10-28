// How the Simulation (core engine) wires the arrest state machine (task B4b; the machine itself: sim/arrest.ts, config/arrest.ts).
// Each constant is tagged [calibrated] (measured on the core engine), [lit] or [assumed] (a teaching choice).

export const ARREST_SIM = {
  /**
   * Chest compressions: the peak external pressure on the ventricles (mmHg) for a CPR output f (fraction of normal, `perfusion()`):
   * peak = offset + perOutput * f. Measured on the default adult in VF (seed 1): 20 mmHg gave 15 % of the beating heart's output,
   * 40 mmHg 35 % (38 % on seed 3 two minutes in, with the reflexes' vasoconstriction), so f = 0.3 (best CPR) asks for 30 mmHg and gives
   * about a quarter to a third of normal output. [calibrated]
   */
  cprPeakOffsetMmHg: 6,
  cprPeakPerOutput: 80,
  /** Compressed share of each compression cycle (50 % duty cycle). [lit, AHA 2020] */
  cprDuty: 0.5,
  /** Native output (fraction of the patient's own at build) below which an organized rhythm has no pulse: PEA, or pulseless VT. [assumed] */
  pulselessOutput: 0.2,
  /**
   * The pulse check also reads the pressure: an organized rhythm whose arterial pressure is too low to feel a pulse is PEA (pulseless VT
   * above `vtRate`) even if the engine still shows flow (an empty circulation can keep a stroke volume moving at no pressure). Pulseless
   * once MAP < `mapBelow` OR systolic < `sbpBelow` has held for `holdS`; a pulse again only once MAP >= `mapAbove` AND systolic >= `sbpAbove`
   * has held for `holdS` (hysteresis, so a pressure hovering at the line does not flicker in and out of arrest). A carotid pulse is
   * usually lost at a systolic of about 50-60 mmHg; pseudo-PEA (pressure on an arterial line, no palpable pulse) is typically a systolic
   * under 50-60. The lines here are set a little lower so a patient in deep shock is still "perfusing" (and dies on the shock clock) and
   * only a circulation that has really failed is called PEA. [assumed; direction: AHA 2020 ACLS, pseudo-PEA literature]
   */
  pulsePressure: { mapBelow: 25, sbpBelow: 45, mapAbove: 30, sbpAbove: 55, holdS: 3 },
  /**
   * The clinical clock while the patient is critical (in arrest, pulseless, or with MAP below `enterMap`, the refractory-shock line):
   * it runs in real time, one clinical second per simulated second, whatever the speed setting, so the death clocks (which count
   * simulated seconds) count clinical seconds and a speed button cannot turn 4 minutes of profound shock into 8 hours. Critical ends
   * once the arrest is over and MAP is back at or above `exitMap` (hysteresis). `maxWaitS` caps the simulated seconds a timed wait
   * (a procedure's delay) may take while the clock runs in real time. The clock is also held to real time while the engine's blood
   * volume lags the fluid compartments by more than `volumeLagMl` (the heart is given or drained blood at no more than
   * ACS_CORE.maxVolumeRate ml per simulated second, so at a fast clock a bleed would otherwise run far ahead of the pressure it causes,
   * and the same bleed would crash the patient at a later clinical time the faster the clock). [assumed: a teaching choice, see docs/ARREST.md]
   */
  critical: { enterMap: 40, exitMap: 45, maxWaitS: 1800, volumeLagMl: 150 },
  /** Floor (L/min) for the reference output that "fraction of normal" is measured against: a patient settled at a tiny output (a heavy bleed at build) must not make any flow read as many times normal. [assumed] */
  minReferenceCoLpm: 2,
  /** Ventricular rate (per min) above which a perfusing rhythm counts as a tachyarrhythmia (a target for synchronized cardioversion). [assumed] */
  tachyRate: 150,
  /** A ventricular rhythm faster than this is VT (slower: an idioventricular or paced rhythm). [lit] */
  vtRate: 100,
  /** Salt mixed into the scenario seed for the arrest machine's random draws (shock outcomes, spontaneous ROSC). */
  seedSalt: 0xa5e57,
};
