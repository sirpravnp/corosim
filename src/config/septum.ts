// Septal interaction constants (core/septum.ts). [lit] = from the literature or a textbook value; [assumed] = a teaching choice.

/**
 * Septum between the ventricles, Santamore & Burkhoff 1991 / Smith & Chase form: the septum is a spring with its own
 * time-varying elastance; its displacement V_spt balances the transseptal pressure P_LV − P_RV; each free wall sees its
 * cavity volume shifted by the displacement. [lit, form]
 *
 * The structural chambers are lumped (free wall + septum). With the septum on, each lumped law is split: the free wall keeps
 * a fraction of the lumped active elastance (Ees) and of the passive pressure scale (a); the rest is carried by the septum,
 * which acts through its displacement (it pushes volume into the RV, so it adds to RV pressure and takes volume from the LV).
 * The fractions are calibrated so that the normal adult heart is reproduced within a few percent (MAP, CO, CVP, PCWP, EDVs
 * within 3 %). They multiply the lumped chambers after any lesion or infarct factor (`rvEes`, `rvStiffness`) is applied, so a
 * weak RV free wall keeps its septal support, which is driven by the LV. [assumed, tuned]
 */
export const SEPTUM = {
  /** Systolic septal elastance as a multiple of the LV end-systolic elastance (the septum is LV muscle, about a third of its mass). [assumed, tuned] */
  eesRatio: 4,
  /** Diastolic (passive) septal stiffness E_d, mmHg/ml: a soft wall that bows easily at low pressure. [assumed, tuned] */
  diaStiffness: 0.4,
  /** Free-wall fraction of the lumped chamber law (active Ees and passive a): LV, RV. The LV factor exceeds 1 because the LV free wall sees a cavity the septum has already bowed into. [assumed, tuned] */
  freeWall: { lvEes: 1.157, lvA: 1.259, rvEes: 0.893, rvA: 0.824 },
  /** Largest septal displacement either way, ml. The solve is bracketed in ±uMax. [assumed] */
  uMax: 60,
  /** Newton convergence: stop when |step| < tolMl (ml) or |residual| < tolMmHg (mmHg). */
  tolMl: 1e-7,
  tolMmHg: 1e-7,
  /** Iteration cap per solve (Newton with bisection fallback). */
  maxIter: 40,
};
