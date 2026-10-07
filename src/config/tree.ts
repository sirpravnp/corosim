// Coronary tree constants. Lengths in mm unless stated; flows in m3/s.
// [lit] = literature-backed, [assumed] = modeling choice that needs a source/tuning.
export const HEART = {
  radii: { a: 45, b: 65, c: 32 }, // ellipsoid semi-axes: x (left-right), y (base-apex), z (front-back) [assumed schematic]
  rotateZ: 0.55, // rad (~32°): apex rotated toward the patient's left [assumed, within normal orientation]
  rotateX: -0.6, // rad (~34°): apex tilted anteriorly, putting the posterior groove on the diaphragmatic surface [assumed]
  vesselHeight: 1.5, // mm above the epicardial surface
};

export const FLOW = {
  totalRestingFlow: 4.0e-6, // m3/s (~240 ml/min) [assumed; literature ~ 0.7–1 ml/min/g]
  maxCoronaryFlowReserve: 2.75, // [assumed, as in the single-lesion model]
  exertionDemand: 2.0, // × resting demand (moderate exertion; leaves margin below the reserve) [assumed]
  diameterExponent: 7 / 3, // Huo–Kassab: Q ∝ d^(7/3) for epicardial arteries [lit]
  lmReferenceDiameter: 4.0e-3, // m, used to calibrate K for a right-dominant system [assumed]
  lmReferenceMass: 0.64, // left-system mass fraction in the reference (right-dominant) anatomy
  minDiameter: 0.4e-3,
  branchSmoothing: 2, // mm half-width over which a branch's flow leaves the parent
};

// Myocardial mass fractions (sum = 1) [assumed; derived from typical LAD ~40–45%, LCx ~15–20%, RCA ~30–35% territories]
export const MASS = {
  lad: 0.29, d1: 0.08, d2: 0.06,
  lcxEnd: 0.07, om1: 0.08, om2: 0.06,
  pda: 0.12, plv: 0.09,
  rcaEnd: 0.07, // RV mass not otherwise assigned (conus + acute marginal + SA node + this = 0.15)
  acuteMarginal: 0.06, conus: 0.015, sanode: 0.005, avnode: 0.004, // nodal arteries: tiny mass, large electrical effect
  ramus: 0.05, ramusFromD1: 0.03, ramusFromOM1: 0.02,
  ladShortShift: 0.05, ladWrapShift: 0.03, // mass moved between LAD and PDA
};

// Variant prevalence is study- and method-dependent; these are broad ranges from angiographic/CT series
// (e.g. right dominance ~60–90%, left ~5–20%, co-dominance ~5–20%; absent left main ~0.4–0.9%).
export const PREVALENCE_NOTE =
  "Reported prevalences vary widely by population and by how a variant is defined (e.g. ramus intermedius ~11% to >60%); treat presets as teaching cases, not epidemiology.";

// Small unrendered branches (septals, small LV/RV branches) are modeled as "taps": a fraction of a segment's
// terminal mass is taken off in n evenly spaced beds between 20% and 85% of its length, so the vessel tapers realistically.
export const TAPS: Record<string, { frac: number; n: number }> = {
  LAD: { frac: 0.65, n: 5 }, D1: { frac: 0.5, n: 2 }, D2: { frac: 0.5, n: 2 },
  LCX: { frac: 0.4, n: 2 }, OM1: { frac: 0.5, n: 2 }, OM2: { frac: 0.5, n: 2 }, PLV_L: { frac: 0.5, n: 2 }, PLV_R: { frac: 0.5, n: 2 },
  PDA_L: { frac: 0.6, n: 4 }, PDA_R: { frac: 0.6, n: 4 }, RCA: { frac: 0.5, n: 3 }, AM: { frac: 0.5, n: 2 }, RAMUS: { frac: 0.5, n: 2 },
};

// Link from bed ischemia to the ECG. The gain is calibrated so that a proximal LAD occlusion gives
// roughly 3–4 mm of ST elevation in V2, matching the single-territory model. [assumed]
export const ECG_LINK = {
  gainMv: 1.4,
  burdenForFullEffect: 0.3, // ischemic mass fraction at which rate rise and ectopy are maximal
};
