/**
 * Myocardial energetics constants (E1). Suga's relation, normalised per 100 g of ventricle:
 *   MVO2 [ml O2/beat/100 g] = a·PVA100 + b·Ees100 + c,  PVA100 = PVA/(M/100) [mmHg·ml/beat/100 g], Ees100 = Ees·(M/100) [mmHg/ml/100 g].
 */
export const ENERGETICS = {
  /** O2 cost of PVA, ml O2 per (mmHg·ml) per 100 g. [lit] Suga H. et al., Am J Physiol 236:H498 (1979) and 240:H1 (1981), canine, about 1.8e-5; with 20.2 J per ml O2 and 1.333e-4 J per mmHg·ml it gives a PVA-to-O2 efficiency near 37 %. Recalled from the papers, not re-checked against them. */
  a: 1.8e-5,
  /** O2 cost of contractility (excitation-contraction coupling, Ca2+ cycling), ml O2/beat/100 g per (mmHg/ml/100 g). [assumed] order of Suga's Ees-dependent intercept; set so the intercept at a normal Ees100 (about 4) is about 0.012. */
  b: 3e-3,
  /** Basal metabolism, ml O2/beat/100 g (the arrested heart is about 1-1.5 ml O2/min/100 g, 0.015-0.02 per beat at 72/min; the rest of that is in b). [assumed] */
  c: 0.01,
  /** Energy equivalent of 1 ml O2, J. [lit] about 20.2 J (RQ 0.82). */
  jPerMlO2: 20.2,
  /** J per mmHg·ml. [lit] 133.322 Pa × 1e-6 m3. */
  jPerMmHgMl: 1.33322e-4,
  /** Default LV mass, g. [assumed] adult, within the usual 150-200 g. */
  lvMassG: 170,
  /** Default RV mass, g. [assumed] about a third of the LV's. */
  rvMassG: 55,
  /** CPO = MAP·CO/451 (W, mmHg, L/min). [lit] the exact factor is 60000/133.322 = 450; 451 is the conventional value (Fincke et al., JACC 2004, SHOCK trial). */
  cpoDivisor: 451,
} as const;
