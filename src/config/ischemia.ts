// How ischemia acts on the ventricles of the structural/core engines. Used by the ACS simulation on the core engine (src/sim/simulation.ts, engine "core"). Values were first validated against the structural engine (P2)
// and are unchanged. [assumed] = a teaching/engineering choice.
//
// E3: on the core path the LV/RV pressure laws sum bed-mapped segments (`physics/regional.ts`, `ElastanceChamber.setRegional`);
// the active scale still uses lvEesLoss / rvEesLoss so a given mass-weighted ischemic fraction matches the A7 global cut.
// REGIONAL.bulgeMl is the extra dead volume of a fully injured ventricle (dyskinesis); 0 keeps A7 numbers.

export const ISCHEMIA = {
  /**
   * Ees lost per unit ischemic fraction of a ventricle: ees = max(eesFloor, 1 - loss x ischemia). Above the ACS model's 0.8
   * because an ischemic segment does not just stop, it bulges (dyskinesis) and wastes the work of the rest, so global
   * systolic elastance falls by more than the ischemic mass fraction (large anterior MI: EF about 0.30). [assumed]
   */
  lvEesLoss: 1.25, rvEesLoss: 0.8,
  /** Lowest Ees factor (fraction of the design value) however much muscle is ischemic. [assumed] */
  eesFloor: 0.2,
  /**
   * Passive stiffness gained per unit ischemic fraction: stiffness = 1 + gain x ischemia (3x at full ischemia at most).
   * Acute ischemia raises diastolic stiffness (impaired relaxation, then contracture); LVEDP rises at a given volume. [assumed]
   */
  lvStiffGain: 1.5, rvStiffGain: 2,
};

/**
 * Regional segment law (E3). Dead volume from a dyskinetic bulge: V0_eff = V0 + bulgeMl · Σ w·injury.
 * Kept modest so the calibrated Ees cut still owns most of the STEMI depth; raise once E3 recalibration is deliberate. [assumed]
 */
export const REGIONAL = {
  /** ml of dead volume for a fully injured left ventricle (injury-weighted). [assumed] */
  lvBulgeMl: 8,
  /** ml of dead volume for a fully injured right ventricle. [assumed] */
  rvBulgeMl: 6,
};

/** Ees and passive-stiffness factors (1 = design point) of the two ventricles for ischemic fractions `lv` and `rv` (0..1). */
export function ischemiaFactors(lv: number, rv: number): VentricleFactors {
  const K = ISCHEMIA;
  return {
    lvEes: Math.max(K.eesFloor, 1 - K.lvEesLoss * lv), rvEes: Math.max(K.eesFloor, 1 - K.rvEesLoss * rv),
    lvStiffness: 1 + K.lvStiffGain * lv, rvStiffness: 1 + K.rvStiffGain * rv,
  };
}

/** Per-ventricle factors on the design point: Ees (`ees`) and passive stiffness (the `a` of the end-diastolic curve). 1 = unchanged. */
export interface VentricleFactors { lvEes?: number; rvEes?: number; lvStiffness?: number; rvStiffness?: number }
