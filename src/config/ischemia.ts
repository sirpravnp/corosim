// How ischemia acts on the ventricles of the structural/core engines. Used by the ACS simulation on the core engine (src/sim/simulation.ts, engine "core"). Values were first validated against the structural engine (P2)
// and are unchanged. [assumed] = a teaching/engineering choice.

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
