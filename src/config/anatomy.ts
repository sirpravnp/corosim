// Single source of truth for physical constants. SI units unless noted (m, s, Pa, kg).
// Each value is tagged: [lit] = published/typical, [assumed] = modeling choice to tune & cite.
export const MMHG = 133.322;
export const mmHg = (v: number) => v * MMHG;

export const BLOOD = {
  viscosity: 0.0035, // Pa·s  [lit] whole blood at high shear
  density: 1060, // kg/m3 [lit]
};

export const CORONARY = {
  meanAorticPressure: mmHg(90), // [typ]
  zeroFlowPressure: mmHg(20), // [assumed] Pzf, ~15-30 mmHg in literature
  restingFlow: 0.8e-6, // m3/s (~48 ml/min LAD) [assumed]
  maxCoronaryFlowReserve: 2.75, // normal hyperemic/resting ratio [assumed]
  collateralConductanceFrac: 0.0, // collateral conductance as fraction of 1/Rmin [assumed patient param]
  collateralPressure: mmHg(55), // donor pressure feeding collaterals [assumed]
};

export const STENOSIS = {
  Kt: 1.52, // Young & Tsai turbulent coefficient [lit; should vary with area ratio / Re]
  waveformFactor: 1.0, // multiplies turbulent term; ~1.1-1.3 approximates pulsatile <Q^2> > <Q>^2 [assumed]
};

export const LESION = {
  referenceDiameter: 3.0e-3,
  length: 14e-3,
  plateau: 2e-3,
  diameterStenosis: 0.9,
};

export const GEOMETRY = {
  finetRatio: 0.678, // D_parent = 0.678 (D_dist + D_side) [lit, Finet 2008]
  finetMinDaughterRatio: 0.75, // validity range of Finet's law [lit]
  murrayExponent: 3, // generalized Murray; ~7/3 in coronary Huo-Kassab fits [lit]
  bifurcationTolerance: 0.1, // ±10% acceptance for generated trees [assumed]
};
