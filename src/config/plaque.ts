// Plaque biomechanics for the cath lab procedure engine. [assumed] unless noted.

export const PLAQUE = {
  /** Fraction of balloon expansion lost when calcium is 1 with a plain balloon. */
  calciumResistance: 0.8,
  /** Share of calcium resistance removed by a cutting or scoring balloon. */
  cuttingRelief: 0.65,
  /** Elastic recoil after balloon deflation ([lit] typical range). */
  recoilBalloon: 0.08,
  /** Elastic recoil after stent deployment ([lit]). */
  recoilStent: 0.03,
  /** Baseline dissection probability scale before device and calcium factors. */
  dissectionBase: 0.08,
  /** Device-to-reference diameter ratio above which edge injury rises ([lit]). */
  overexpandLimit: 1.2,
  noReflowThrombusWeight: 0.6,
  noReflowLipidWeight: 0.3,
  /** Plaque ds below this is treated as angiographically insignificant. */
  cleanDs: 0.05,
} as const;
