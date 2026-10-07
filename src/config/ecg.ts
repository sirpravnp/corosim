// ECG model constants. Heart modeled as a dipole; each wave is a Gaussian with a 3D vector (mV).
// Axes: x = patient's left, y = down (feet), z = anterior. 1 mm on ECG paper = 0.1 mV, 0.04 s.
export type Vec3 = readonly [number, number, number];

// Hexaxial frontal axes (I 0°, II 60°, III 120°, aVF 90°, aVL −30°, aVR −150°) and horizontal precordial axes.
export const LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"] as const;
export type LeadName = (typeof LEADS)[number];
const d = (deg: number) => (deg * Math.PI) / 180;
export const LEAD_AXES: Record<LeadName, Vec3> = {
  I: [1, 0, 0],
  II: [Math.cos(d(60)), Math.sin(d(60)), 0],
  III: [Math.cos(d(120)), Math.sin(d(120)), 0],
  aVR: [Math.cos(d(-150)), Math.sin(d(-150)), 0],
  aVL: [Math.cos(d(-30)), Math.sin(d(-30)), 0],
  aVF: [0, 1, 0],
  V1: [-0.5, 0, 0.85],
  V2: [-0.2, 0, 0.98],
  V3: [0.2, 0, 0.98],
  V4: [0.5, 0, 0.87],
  V5: [0.8, 0, 0.6],
  V6: [0.95, 0, 0.31],
};

// Wave: center (s after R peak; P/T scale with RR below), width σ (s), vector (mV).
export const WAVES = {
  P: { t: -0.16, w: 0.025, v: [0.1, 0.12, 0.05] as Vec3 },
  Q: { t: -0.03, w: 0.01, v: [-0.12, -0.1, 0.2] as Vec3 },
  R: { t: 0.0, w: 0.011, v: [1.0, 0.9, -0.25] as Vec3 },
  S: { t: 0.028, w: 0.012, v: [-0.35, -0.1, -0.5] as Vec3 },
  T: { t: 0.0, w: 0.0, v: [0.35, 0.25, 0.25] as Vec3 }, // center/width computed from RR
};
export const T_CENTER = (rr: number) => 0.32 * Math.sqrt(rr) - 0.02;
export const T_WIDTH = (rr: number) => 0.045 * Math.sqrt(rr);

export const ST = {
  jPoint: 0.05, // s after R: start of ST segment
  edge: 0.01, // sigmoid sharpness
  fullScaleMv: 0.5, // injury vector magnitude at severity 1 (gives ~4 mm in V2 for LAD)
  tBoost: 0.5, // hyperacute T amplification at severity 1
  measureAt: 0.11, // s after R at which ST is measured (J + 60 ms)
};

// Injury vectors by culprit territory (pointing toward the injured wall).
export const TERRITORY: Record<"LAD" | "RCA" | "LCx", Vec3> = {
  LAD: [0.3, -0.5, 0.9],
  RCA: [-0.1, 0.9, 0.1],
  LCx: [0.6, 0.1, -0.5],
};

export const RHYTHM = {
  baseHr: 72,
  hrRiseAtFullIschemia: 25, // bpm
  hrv: 0.03, // ±3% beat-to-beat
  pvcCoupling: 0.6, // PVC arrives at 60% of the normal RR, then a compensatory pause
  pvcWidthScale: 2.5,
  pvcAmpScale: 1.5,
  pvcOnsetSeverity: 0.6, // PVCs begin once ischemia passes this level
  pvcMaxProbability: 0.35,
};

export const ISCHEMIA = {
  riseSeconds: 20, // doc: ~20 s to full ischemia on complete occlusion
  recoveryTau: 8, // doc: τ ≈ 8 s after reperfusion
  fullAtSupplyDemand: 0.4, // severity reaches 1 when supply/demand falls to this ratio
};
