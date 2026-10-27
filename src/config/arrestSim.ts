// How the Simulation (core engine) wires the arrest state machine (task B4b; the machine itself: sim/arrest.ts, config/arrest.ts).
// Each constant is tagged [calibrated] (measured on the core engine), [lit] or [assumed] (a teaching choice).

export const ARREST_SIM = {
  /**
   * Chest compressions: the peak external pressure on the ventricles (mmHg) for a CPR output f (fraction of normal, `perfusion()`):
   * peak = offset + perOutput * f. Measured on the default adult in VF (seed 1): 20 mmHg gave 15 % of the beating heart's output,
   * 40 mmHg 35 %, so f = 0.3 (best CPR) asks for about 36 mmHg and gives about 30 %. [calibrated]
   */
  cprPeakOffsetMmHg: 6,
  cprPeakPerOutput: 100,
  /** Compressed share of each compression cycle (50 % duty cycle). [lit, AHA 2020] */
  cprDuty: 0.5,
  /** Native output (fraction of the patient's own at build) below which an organized rhythm has no pulse: PEA, or pulseless VT. [assumed] */
  pulselessOutput: 0.2,
  /** Ventricular rate (per min) above which a perfusing rhythm counts as a tachyarrhythmia (a target for synchronized cardioversion). [assumed] */
  tachyRate: 150,
  /** A ventricular rhythm faster than this is VT (slower: an idioventricular or paced rhythm). [lit] */
  vtRate: 100,
  /** Salt mixed into the scenario seed for the arrest machine's random draws (shock outcomes, spontaneous ROSC). */
  seedSalt: 0xa5e57,
};
