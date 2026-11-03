/**
 * Simbook teaching constants. Values match the resting adult lumped model in `physics/circulation.ts` unless noted.
 */
export const SIMBOOK_CIRCUIT = {
  /** Assumed central venous pressure, mmHg. */
  cvpMmHg: 5,
  /** Nominal cardiac output, L/min (72 bpm × 70 ml). */
  baseCoLMin: 5.04,
  /** Nominal mean arterial pressure, mmHg. */
  baseMapMmHg: 90,
  /** Reference vessel radius (arbitrary units); Poiseuille R ∝ 1/r⁴ relative to this. */
  refRadius: 1,
  /** Organ branch resistances at `refRadius`, mmHg·min/L — chosen so parallel sum matches BASE_SVR at nominal ΔP. */
  organs: {
    brain: { label: "Brain", r0: 113 },
    kidney: { label: "Kidney", r0: 85 },
    gut: { label: "Gut", r0: 68 },
    muscle: { label: "Muscle & skin", r0: 42.5 },
  } as const,
};

/** Autoregulation plateaus for the MAP-driven lesson (assumed teaching ranges, mmHg). */
export const SIMBOOK_AUTOREG = {
  /** MAP at or below which autoregulation fails and flow falls linearly toward CVP. Gut is least protected (highest floor). */
  mapLow: { brain: 55, kidney: 58, gut: 72, muscle: 0 } as const,
  /** Upper MAP of the autoregulatory plateau (flow tracks demand below this). */
  mapHigh: { brain: 110, kidney: 110, gut: 100, muscle: 0 } as const,
  /** Organs that actively dilate/constrict to hold flow on the plateau. */
  autoreg: { brain: true, kidney: true, gut: true, muscle: false } as const,
};

/** Tissue O₂ slab (Chapter 1). D in µm²/s, distances in µm; concentrations arbitrary but consistent. [assumed] */
export const SIMBOOK_DIFFUSION = {
  dUm2PerS: 1.4e3,
  capConcBase: 1,
  /** Capillary O₂ when flow is off (diffusion-limited delivery). */
  flowOffFactor: 0.35,
  consumptionBase: 1,
  thicknessBaseUm: 120,
  densityBase: 1,
};

/** Fick membrane (Chapter 2A). Teaching units: D·µm/s, A cm², ΔC arbitrary, x µm → flux in relative units. [assumed] */
export const SIMBOOK_FICK = {
  dDefault: 1,
  areaDefault: 100,
  deltaCDefault: 1,
  thicknessDefault: 1,
};

/** Single capillary Starling profile (Chapter 2B). Pressures mmHg; Kf ml/min/mmHg for this teaching bed. [assumed] */
export const SIMBOOK_STARLING = {
  pcArterial: 32,
  pcVenous: 12,
  piInterstitial: -2,
  albuminRestGdl: 7,
  interstitialProteinGdl: 2.5,
  kfBase: 0.85,
  sigma: 0.9,
  /** Fixed lymphatic return for this bed (ml/min); not a learner lever. */
  lymphReturnMlMin: 0.12,
  pvRest: 6,
};
