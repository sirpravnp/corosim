/**
 * Constants of the JVP analysis (src/physics/jvp.ts). Tags: [lit] from a source, [assumed] chosen from textbook descriptions
 * of the jugular venous waveform and checked against the core engine's right-atrial trace (tests/jvp.test.ts).
 * Pressures mmHg, times s.
 */
export const JVP = {
  /** cm H2O per mmHg [lit]: 1 mmHg = 1.36 cm H2O. */
  cmH2OPerMmHg: 1.36,
  /** Distance from the sternal angle to the mid right atrium, cm [lit: the classic 5 cm, patient at 45 degrees]. */
  angleToAtriumCm: 5,
  /**
   * Ventricular systole (TV closed) lasts about `sysCoef * rr^sysExp` seconds after the ventricular event: 0.42 s at rr = 0.8,
   * 0.69 s at rr = 1.5. [assumed, fitted to the core engine's tricuspid closure to opening interval; the same T^0.8 scaling
   * as the elastance peak time of ACTIVATION.tMaxExp]
   */
  sysCoef: 0.5, sysExp: 0.8,
  /** Delay from the ventricular event to tricuspid closure, s. An atrial event earlier than this still empties into the ventricle. [assumed] */
  tcloseDelay: 0.03,
  /** An a wave is the pressure peak within this long after an atrial activation, s. [assumed] */
  aWindow: 0.2,
  /** The a-wave search starts this long before the activation (mechanical onset can lead the recorded activation, as in the bridge's waveform), s. [assumed] */
  aLead: 0.05,
  /** Smallest rise above the lowest pressure from `aLead` before the activation to the peak that counts as an a wave, mmHg. [assumed] */
  aMinRise: 0.5,
  /** A cannon a wave: atrial activation while the TV is closed with a rise at least this big, mmHg (usual a rise is 2 to 4). [assumed] */
  cannonMinRise: 5,
  /** After a cannon a peak the pressure takes this long to fall; the v-wave search skips it, s. [assumed] */
  aDecay: 0.1,
  /** The c wave is a bump this soon after tricuspid closure, s, at least this prominent (mmHg) against the dip after it. [assumed] */
  cWindow: 0.12, cMinProm: 0.3,
  /** The x descent must fall at least this far below the preceding peak (a or c), mmHg. [assumed] */
  xMinDrop: 0.5,
  /** The v search window extends to this multiple of the systole estimate, or to the first diastolic atrial event. [assumed] */
  vWindow: 1.25,
  /** Giant v: v peak at least `giantVRatio` times the a peak and `giantVExcess` mmHg above it (textbook normal v is a little below a). [assumed] */
  giantVRatio: 1.5, giantVExcess: 3,
  /** Giant v with no a wave to compare to: v at least this far above the lowest pressure of the beat, mmHg. [assumed] */
  giantVRange: 6,
  /** Steep y: the pressure falls at least this far (mmHg) from v to the y trough, at least this fast (mmHg/s). [assumed] */
  steepYDepth: 10, steepYSlope: 100,
  /** Blunted y: the fall from v to the y trough is smaller than this (mmHg), or absent. [assumed] */
  bluntedYDepth: 2,
  /** Raised JVP: mean right-atrial pressure above this, mmHg (normal 2 to 6). [assumed] */
  raisedMean: 8,
};
export type JvpConfig = typeof JVP;
