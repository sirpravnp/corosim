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
  bloodMlPerKg: number; // total blood volume, ml/kg (the circulation holds this much including the unstressed volume of its veins)
  satLung: number; // saturation of blood leaving the lungs
  upperFlow: number; upperVo2: number; // fraction of systemic flow and of oxygen use above the duct (head, arms, coronaries)
  valveAreas: { tv: number; pv: number; mv: number; av: number }; // cm²
}

/** Normal resting adult. Anchored to the existing circulation model (72 bpm, SV 70 ml, MAP 90). */
export const ADULT: PatientBaseline = {
  name: "adult", weightKg: 70, bsa: 1.8, hr: 72, svPerKg: 1.0, map: 90, ppSys: 45, rap: 5, lap: 9, pvri: 1.5, ppPa: 14,
  lvEf: 0.58, rvEf: 0.52, vo2PerKg: 3.5, hb: 14, bloodMlPerKg: 70, satLung: 0.98, upperFlow: 0.4, upperVo2: 0.45,
  valveAreas: { tv: 7, pv: 4, mv: 5, av: 3.8 },
};

/** Term newborn, a few days old (pulmonary vascular resistance still falling). [lit, rounded] */
export const NEONATE: PatientBaseline = {
  name: "neonate", weightKg: 3.5, bsa: 0.23, hr: 140, svPerKg: 1.4, map: 48, ppSys: 28, rap: 5, lap: 6, pvri: 5, ppPa: 15,
  lvEf: 0.65, rvEf: 0.55, vo2PerKg: 7, hb: 17, bloodMlPerKg: 85, satLung: 0.98, upperFlow: 0.45, upperVo2: 0.5,
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

/**
 * Chamber activation. Ventricle: double-Hill (Stergiopulos) of the time since the ventricular event, normalised by its peak:
 * e(t) = [r/(1+r)]·[1/(1+(t/a2)^n2)], r = (t/a1)^n1, Tmax = tMaxCoef·RR^tMaxExp, a1 = a1Frac·Tmax, a2 = a2Frac·a1, with RR the
 * interval between this ventricular event and the previous one (a QT-like rate rule). [lit]
 * Atrium: half sine of duration ta over the time since the atrial event, ta = min(taBase·√(AA/taRefT), taMaxFrac·AA) with AA the
 * preceding atrial interval. [assumed]
 * Steady-rate PR (s from atrial event to ventricular event, beat period T): pr = prBase + prPerT·T, 0.16 s at 72 bpm and 0.12 s at
 * 140 bpm, inside the physiological 0.12-0.20 s. [assumed]
 * `relaxScale`: stretch of the falling limb of ventricular activation (1 = the curve above); 1.4 gives an isovolumic relaxation
 * time constant of about 36 ms in the adult at 72 bpm (normal 30-50 ms). Impaired relaxation raises it. [assumed]
 * `atrialEesScale`: `buildModel` designs each atrium for 6 mmHg of active pressure at its mean volume times this factor. At 1 that
 * is less than the passive pressure at that volume, so atrial contraction hardly moved blood (no A wave); at 3 the active
 * pressure is about 18 mmHg at mean volume (atrial a waves reach 10-15 mmHg). The Model's atrial `ees` is the value the engine
 * runs (the frozen-reference pin builds with 1). [assumed]
 */
export const ACTIVATION = {
  tMaxCoef: 0.376, tMaxExp: 0.8, a1Frac: 0.708, a2Frac: 1.677, n1: 1.32, n2: 21.9, peakSamples: 400,
  taBase: 0.12, taRefT: 0.833, taMaxFrac: 0.35, prBase: 0.08, prPerT: 0.096,
  relaxScale: 1.4, atrialEesScale: 3,
};

/**
 * Valve inertance (optional, core `InertialValve`). L = ρ·ℓ/A for a blood column of effective length ℓ through the valve's
 * area A: ρ = 1.06 g/cm³ [lit]; dyn·s²/cm⁵ → mmHg·s²/ml divides by 1333.2 [lit] (1 mmHg = 1333.2 dyn/cm²).
 * Effective lengths ℓ (cm) are the blood column accelerated with the valve flow: annulus plus the funnel-shaped region either
 * side of the orifice. [assumed], within the 1-4 cm range used by lumped-parameter heart models.
 */
export const INERTANCE = {
  rho: 1.06, dynPerMmHg: 1333.2,
  lengthCm: { tv: 2.5, pv: 2, mv: 3, av: 2.5 },
};

/**
 * Vessels (core/vessels.ts, valves with Zc). [assumed] unless marked.
 * Characteristic impedance Zc of the 3-element Windkessel, as a fraction of the total resistance it sits in front of: the
 * aorta's Zc is `zcFrac.sys` of the systemic resistance (MAP − RAP)/Q, the pulmonary artery's `zcFrac.pul` of the pulmonary
 * resistance. Adult aortic Zc is 0.03-0.06 mmHg·s/ml [lit], 5 % of the 1.0 mmHg·s/ml systemic resistance gives 0.05; the
 * pulmonary artery is wider and more compliant, so its Zc is a larger share of a much smaller resistance (about 10-20 % [lit]).
 * Because Zc/R is kept, a newborn's Zc rises with its resistance (narrow vessels), as measured.
 * `arterialC`: factor on the arterial compliance SV/PP of the design (stroke volume over the target pulse pressure): the blood that
 * runs off during ejection and Zc's drop make the lumped compartment pulse less than SV/C, so the compliance is made smaller.
 * `compliance`: venous compliances in ml/mmHg per kg: superior vena cava (upper body), inferior vena cava (the rest of the lower
 * body, legs and kidneys) and the splanchnic reservoir, which holds the controllable part (large compliance). The lower-body bed
 * drains through the splanchnic node in series, a lumped simplification of a parallel bed. Together 1.2 ml/mmHg/kg, giving a
 * systemic compliance near 2 ml/mmHg/kg (about 80-150 ml/mmHg in a normal adult).
 * `vuShare`: how the unstressed volume (total blood volume − what the design pressures hold) divides among SVC, IVC and the
 * splanchnic node; the splanchnic bed holds the most (a third to a half of the body's unstressed volume).
 * `splanchnicRise`: mean pressure of the splanchnic node above the IVC, mmHg (the hepatic gradient). `collapseMmHg`: how far
 * below zero a collapsing vein's pressure can fall.
 */
export const VESSELS = {
  zcFrac: { sys: 0.05, pul: 0.2 },
  arterialC: { sys: 0.7, pul: 0.4 },
  compliance: { svc: 0.25, ivc: 0.35, spl: 0.6 },
  vuShare: { svc: 0.15, ivc: 0.3, spl: 0.55 },
  splanchnicRise: 2,
  collapseMmHg: 1,
};

/**
 * Bronchial and Thebesian return to the left heart (D6b): a small systemic-to-left-heart flow. The bronchial arteries (from the
 * aorta) drain partly into the pulmonary veins, and the Thebesian veins empty into the left chambers, so about 1-2 % of the
 * cardiac output reaches the left heart without passing the right ventricle and the lungs [lit]; it is the normal small
 * physiological shunt. `frac`: share of the design flow carried at the baseline pressures, 1 % (the low end of the range; a larger share, 1.5 %, moves the right-ventricular-infarct fluid test of simulationCore.test.ts below its +5 mmHg bar). [assumed value]
 * `buildModel` designs the resistor AO → PV from it: R = (MAP − PV pressure)/(frac·Q).
 * Why it matters: when a failing LV cannot open its aortic valve against ECMO afterload, this flow (and the residual lung flow)
 * keeps arriving in the left heart and has nowhere to go but up in LV pressure.
 */
export const BRONCHIAL = { frac: 0.01 };
