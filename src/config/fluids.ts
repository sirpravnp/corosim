/**
 * Constants of the fluid compartments (core/fluids.ts, task C2). Volumes ml, pressures mmHg, time clinical minutes. Sizes marked
 * "per kg" scale with the patient's weight (the adult of 70 kg is the reference); flows marked "per 70 kg" likewise.
 * Tags: [lit] from the literature, [assumed] teaching values tuned to the clinical targets of the task (see the notes).
 */
export const FLUIDS = {
  // ---- body fluids -------------------------------------------------------------------------------------------------
  /** Mean corpuscular hemoglobin concentration, g Hb per dl of red cells: hematocrit = Hb / mchc. [lit, 33-34 g/dl] */
  mchc: 33.3,
  /** Interstitial fluid, ml per kg: 11 L in a 70 kg adult (extracellular water 14 L, of which plasma 3 L; Guyton and Hall). [lit] */
  interstitialMlPerKg: 160,

  // ---- Starling forces (Starling 1896, Landis and Pappenheimer 1963, Levick and Michel 2010) ------------------------
  /**
   * Hydrostatic pressure of the capillary bed from the pressures of the engine's two ends of it: Pc = Pv + f·(Pa − Pv), the
   * resistance-weighted mean of the arterial side (mean aortic pressure Pa) and the venous side (Pv, mean of SVC, IVC and the
   * splanchnic reservoir). f = Rv/(Ra + Rv), the post-capillary share of the capillary resistance: 0.13 gives Pc of 17 mmHg at rest
   * (Levick and Michel: whole-body Pc 15-20 mmHg), and passes about 87 % of a venous pressure rise to the capillaries. [lit-ish]
   */
  postcapillaryShare: 0.13,
  /** Capillary pressure of the resting adult on the core engine (Pa 90.1, Pv 6.1 mmHg), used to place the interstitial pressure so the resting patient is in balance. Measured with `fillingPressures` of the normal adult. [assumed] */
  pcRest: 17.0,
  /** Reflection coefficient of the capillary wall for plasma protein (0.9: Landis and Pappenheimer; whole-body mean 0.8-0.95). [lit] */
  sigma: 0.9,
  /** Whole-body capillary filtration coefficient, ml/min/mmHg per 70 kg (Guyton and Hall: 6.7 ml/min/mmHg in the whole body). [lit] */
  kf: 6.67,
  /** Lymph flow at rest, ml/min per 70 kg (2-4 L/day returns to the blood; Guyton and Hall). [lit] */
  lymphRest: 2.8,
  /** Lymph flow grows with the interstitial pressure: L = L0·exp(lymphSlope·(Pi − Pi0)), at most `lymphMax`·L0 (the lymphatics pump up to 10-50 times, Guyton and Hall's edema safety factor). [lit-ish] */
  lymphSlope: 0.15, lymphMax: 20,
  /**
   * Interstitial pressure from the volume above its resting value x: Pi = Pi0 + x/ciHigh + span·tanh(x/(span·ciLow)). The tissue is
   * stiff for the first ~100 ml (a gel held by the matrix: `span` mmHg over a compliance `ciLow`) and loose beyond it (`ciHigh`:
   * once the matrix is saturated fluid collects freely, the "edema safety factor" of Guyton's tissue compliance curve); the stiff
   * term acts on gain only: a drained interstitium gives its fluid up on the loose slope, which is what lets the plasma refill after a hemorrhage. Compliances are ml/mmHg per 70 kg. The shape is [assumed]; the three numbers
   * were set with the other free constants (`postcapillaryShare`, `volumeGain`) so that 1 L of crystalloid is 20-30 % intravascular
   * at 30 min (Hahn; Rehm: about a quarter of an infused litre stays) and 500 ml of 5 % albumin more than 80 %.
   */
  ciLow: 10, ciHigh: 6000, stiffSpan: 4,

  // ---- proteins and oncotic pressure -------------------------------------------------------------------------------
  /** Plasma protein concentration at rest, g/dl [lit 6.5-8], and interstitial protein concentration, g/dl (2-3, lymph protein; Levick). */
  plasmaProtein: 7.0, interstitialProtein: 2.5,
  /** Oncotic pressure of a protein solution of c g/dl (Landis and Pappenheimer 1963): π = a·c + b·c² + d·c³ mmHg (25.6 mmHg at 7 g/dl). [lit] */
  oncotic: { a: 2.1, b: 0.16, d: 0.009 },

  // ---- the fluids that can be given --------------------------------------------------------------------------------
  /** Protein-equivalent concentration (g/dl, for the oncotic pressure) of each fluid. Albumin 5 % is 5 g/dl [lit]; the synthetic colloid is a 6 % starch (HES 130/0.4) [lit]. Crystalloid and blood: see below. */
  albuminGdl: 5, colloidGdl: 6,
  /** Plasma half-life of the synthetic colloid, minutes (HES 130/0.4: 3-4 h, cleared by the kidney and by enzymes). [lit] */
  colloidHalfLifeMin: 210,
  /** Blood given is packed red cells with their additive solution: hematocrit 0.58 (AABB 0.55-0.65) and 2.5 g/dl protein in its fluid part (a unit of about 300 ml raises Hb by about 1 g/dl in the adult). [lit] */
  bloodHct: 0.58, bloodProteinGdl: 2.5,
  /** A bolus without a duration is run in over this many minutes (a litre through a pressure bag takes 5-10). [assumed] */
  bolusMin: 5,

  // ---- capillary leak (sepsis) -------------------------------------------------------------------------------------
  /** Leak factor L (0..1) raises the filtration coefficient to Kf·(1 + kfGain·L), lowers the reflection coefficient to σ·(1 − sigmaLoss·L) and raises the escape of protein to the interstitium by (1 + proteinGain·L). [assumed, direction from Levick and Michel; endothelial glycocalyx damage] */
  leak: { kfGain: 3, sigmaLoss: 0.5, proteinGain: 6 },

  // ---- kidney (diuresis) -------------------------------------------------------------------------------------------
  /** Urine flow at rest, ml/min per 70 kg (0.7 ml/kg/h). It is balanced by the water the patient takes in and makes (`maintenance`), so a resting patient keeps their volume. [lit] */
  urineRest: 0.8,
  /** Urine flow follows the blood volume, exp(volumeGain·(V/V0 − 1)) (pressure diuresis and the volume reflexes: +10 % of the volume gives 1.5 times the flow), and the renal perfusion (mean arterial pressure, linear from `mapAnuria` where the flow stops to `mapRest`, at most 2.5 times above). [assumed] */
  volumeGain: 4, mapAnuria: 40, mapRest: 90,

  // ---- coupling ----------------------------------------------------------------------------------------------------
  /** The compartments read the engine's pressures smoothed over this many clinical minutes (the swing of one beat or one breath is not the capillary's mean pressure). [assumed] */
  pressureTauMin: 1,

  // ---- lung water (task C3) ----------------------------------------------------------------------------------------
  lung: {
    /** Extravascular lung water at rest, ml per kg of body weight (PiCCO normal 3-7 ml/kg, Sakka 2000: 7 is the upper normal; above ~10 is edema). [lit] */
    evlwMlPerKg: 7,
    /** Pulmonary capillary pressure from the wedge (left atrial) and the mean pulmonary artery pressure: Pc = PCWP + share·(PAP − PCWP). The capillary sits 40 % of the way along the pressure drop of the lung's resistance (Gaar, Kuida and Brown 1967; Fung and Sobin). [lit] */
    pcShare: 0.4,
    /** Wedge and mean PA pressure of the resting adult on the core engine, mmHg: place the resting lung in balance (Jv = lymph), as `pcRest` does for the body. Measured with the normal adult of the core. [assumed] */
    pcwpRest: 8.1, papRest: 13.3,
    /** Reflection coefficient of the lung's capillary wall for plasma protein (0.5-0.8; Staub, Taylor). [lit] */
    sigma: 0.7,
    /** Lung lymph protein over plasma protein at rest (0.6-0.7 in sheep and in man; Staub 1974, Erdmann 1975): sets the interstitial oncotic pressure. It is held fixed: the washout of interstitial protein, which lowers it in prolonged edema and so makes the safety factor smaller, is not modelled. [lit] */
    proteinRatio: 0.7,
    /** Filtration coefficient of the lung, ml/min/mmHg per 70 kg (sheep: 0.3-0.5 ml/min/mmHg per kg of lung; Staub 1974). [lit-ish, tuned] */
    kf: 0.6,
    /** Lung lymph flow at rest, ml/min per 70 kg. [assumed] */
    lymphRest: 0.5,
    /** Lymph flow rises with the interstitial pressure, L = L0·exp(slope·(Pi − Pi0)), at most `lymphMax`·L0: lung lymph flow rises 5-10 fold with a rise of the filtration before edema accumulates (Erdmann, Vaughan and Staub 1975; Drake, Gabel and Hansen 1985; the lung's safety factor against edema, Guyton and Lindsey 1959). [lit-ish] */
    lymphSlope: 0.35, lymphMax: 10,
    /** Interstitial pressure from the water above rest x (ml per 70 kg; same form as the body's): a stiff first part (`ciLow`, over `stiffSpan` mmHg: the perivascular cuffs fill first) and a loose part beyond (`ciHigh`: once the interstitium is full the fluid floods the alveoli). [assumed] */
    ciLow: 25, ciHigh: 120, stiffSpan: 3,
    /** Gas exchange: the fall of the pulmonary venous saturation (a fraction) is `satDropMax`·h/(h + 1) with h = (excess/x50)^n for the lung water above rest, ml per kg. The interstitial fluid costs little; the alveolar flooding of the second stage costs a lot (shunt and V/Q mismatch; Staub 1974). [assumed, tuned to the task targets] */
    satDropMax: 0.45, dropMlPerKg50: 7.5, dropHill: 2.5,
    /** The excess of lung water (ml/kg) at which the core's `circ.congestion` is 1 (alveolar edema). [assumed] */
    congestionMlPerKg: 5,
  },

  // ---- numerics ----------------------------------------------------------------------------------------------------
  /** Largest step of the integration, clinical minutes (the slowest time scale is about 20 min). */
  maxStepMin: 0.5,
};
