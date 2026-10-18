// Structural-heart constants: patient baselines, orifice law, lesion defaults.
// [lit] = taken from the literature or a standard textbook value; [assumed] = a teaching choice. Nothing here is fitted
// to patient data.

/** Gorlin: Q (ml/s) = 44.3 · A (cm²) · √ΔP (mmHg). [lit] */
export const GORLIN = 44.3;
/** Smoothing added under the square root so a valve's conductance stays finite as ΔP → 0 (mmHg). [assumed] */
export const ORIFICE_EPS = 0.25;
/** Oxygen carried per g of hemoglobin, ml. [lit] */
export const O2_PER_G_HB = 1.34;
/** 1 Wood unit = 1 mmHg per L/min; the engine works in mmHg per ml/s. */
export const WU_TO_MMHG_S_ML = 0.06;

export interface PatientBaseline {
  name: string;
  weightKg: number; bsa: number; // kg, m²
  hr: number; svPerKg: number; // bpm, ml/kg (left-ventricular stroke volume)
  map: number; ppSys: number; // mmHg
  rap: number; lap: number; // mmHg, mean atrial pressures
  pvri: number; // Wood units · m²
  ppPa: number; // pulmonary arterial pulse pressure, mmHg
  lvEf: number; rvEf: number;
  vo2PerKg: number; // ml O₂ / min / kg
  hb: number; // g/dl
  satLung: number; // saturation of blood leaving the lungs
  upperFlow: number; upperVo2: number; // fraction of systemic flow and of oxygen use above the duct (head, arms, coronaries)
  valveAreas: { tv: number; pv: number; mv: number; av: number }; // cm²
}

/** Normal resting adult. Anchored to the existing circulation model (72 bpm, SV 70 ml, MAP 90). */
export const ADULT: PatientBaseline = {
  name: "adult", weightKg: 70, bsa: 1.8, hr: 72, svPerKg: 1.0, map: 90, ppSys: 45, rap: 4, lap: 8, pvri: 1.5, ppPa: 14,
  lvEf: 0.58, rvEf: 0.52, vo2PerKg: 3.5, hb: 14, satLung: 0.98, upperFlow: 0.4, upperVo2: 0.45,
  valveAreas: { tv: 7, pv: 4, mv: 5, av: 3.8 },
};

/** Term newborn, a few days old (pulmonary vascular resistance still falling). [lit, rounded] */
export const NEONATE: PatientBaseline = {
  name: "neonate", weightKg: 3.5, bsa: 0.23, hr: 140, svPerKg: 1.4, map: 48, ppSys: 28, rap: 5, lap: 6, pvri: 5, ppPa: 15,
  lvEf: 0.65, rvEf: 0.55, vo2PerKg: 7, hb: 17, satLung: 0.98, upperFlow: 0.45, upperVo2: 0.5,
  valveAreas: { tv: 0.95, pv: 0.6, mv: 0.7, av: 0.5 },
};

export const PATIENTS = { adult: ADULT, neonate: NEONATE } as const;
export type PatientKind = keyof typeof PATIENTS;

/** Where the engine stops: periodic steady state, or this many beats. */
export const SOLVER = { dt: 0.0005, maxBeats: 120, minBeats: 8, tol: 4e-4 };

/**
 * Grading bins. [lit, rounded] from ACC/AHA 2020 and ASE 2017 valve guidance (adult cut-offs), expressed as a fraction of a
 * normal valve of the same patient so a newborn's valve is judged by how much of its own area is open. Pediatric z-scores are not modelled.
 */
export const GRADE = {
  asMeanGradient: { moderate: 20, severe: 40 }, // mmHg
  // Gorlin area as a fraction of normal: aortic 2.0 / 1.5 / 1.0 cm² of 3.8; mitral 2.5 / 1.5 cm² of 5; tricuspid and pulmonary [assumed]
  areaFraction: {
    av: { mild: 0.53, moderate: 0.39, severe: 0.26 }, mv: { mild: 0.7, moderate: 0.5, severe: 0.3 },
    tv: { mild: 0.6, moderate: 0.4, severe: 0.2 }, pv: { mild: 0.6, moderate: 0.4, severe: 0.25 },
  },
  regFraction: { moderate: 0.3, severe: 0.5 }, // regurgitant volume / total volume through the valve
  // Regurgitant orifice area as a fraction of the valve's normal area: aortic 0.1 / 0.3 cm² of 3.8; mitral 0.2 / 0.4 of 5; tricuspid 0.2 / 0.4 of 7; pulmonary [assumed]
  eroaFraction: {
    av: { moderate: 0.026, severe: 0.079 }, mv: { moderate: 0.04, severe: 0.08 },
    tv: { moderate: 0.029, severe: 0.057 }, pv: { moderate: 0.04, severe: 0.08 },
  },
};
