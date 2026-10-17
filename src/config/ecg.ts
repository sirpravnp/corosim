// ECG model constants. Heart modeled as a dipole; each wave is a Gaussian with a 3D vector (mV).
// Axes: x = patient's left, y = down (feet), z = anterior. 1 mm on ECG paper = 0.1 mV, 0.04 s.
export type Vec3 = readonly [number, number, number];

// Hexaxial frontal axes (I 0°, II 60°, III 120°, aVF 90°, aVL −30°, aVR −150°) and horizontal precordial axes.
export const LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"] as const;
// Posterior leads continue the precordial arc around the left chest to the back: V7 posterior axillary line,
// V8 tip of the scapula, V9 left paraspinal. They look at the wall the standard twelve face away from, from farther
// away, so their axes are scaled by POSTERIOR_GAIN: smaller voltages, which is why 0.5 mm counts there. [assumed]
export const POSTERIOR_GAIN = 0.6;
export const POSTERIOR_LEADS = ["V7", "V8", "V9"] as const;
export const ALL_LEADS = [...LEADS, ...POSTERIOR_LEADS] as const;
export type LeadName = (typeof ALL_LEADS)[number];
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
  V7: [0.866 * 0.6, 0, -0.5 * 0.6],
  V8: [0.5 * 0.6, 0, -0.866 * 0.6],
  V9: [0.174 * 0.6, 0, -0.985 * 0.6],
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

// Bundle branch block: the ventricle beyond the blocked bundle depolarizes late, through muscle, so the terminal
// QRS points toward it and repolarization runs the other way (discordant ST and T). Vectors in mV. [assumed]
export const BBB = {
  rbbb: {
    rPrime: { t: 0.056, w: 0.018, v: [-0.55, 0.05, 0.5] as Vec3 }, // late rightward-anterior forces: RSR' in V1, broad S in I and V6
    t: [0.15, 0, -0.18] as Vec3, // secondary T, opposite the terminal forces: inverted in V1–V2
    st: [0.04, 0, -0.05] as Vec3, // slight discordant ST
  },
  lbbb: {
    r: { t: 0.015, w: 0.028, v: [1.1, 0.55, -0.55] as Vec3 }, // one broad leftward-posterior wave: QS in V1–V3, tall wide R in I, aVL, V5–V6
    s: { t: 0.075, w: 0.015, v: [-0.3, -0.1, -0.2] as Vec3 },
    t: [-0.3, -0.12, 0.3] as Vec3, // discordant T: inverted laterally, upright in V1–V3
    st: [-0.1, -0.04, 0.12] as Vec3, // discordant ST at baseline (~1.5 mm up in V1, ~1 mm down in I): the Sgarbossa background
  },
};
export type Bbb = "none" | "rbbb" | "lbbb";

// Atrial fibrillation as an existing rhythm: no P waves, an irregular ventricular response through the AV node,
// and a fine fibrillatory baseline. [assumed]
export const AF = {
  baseRate: 96, // bpm ventricular response at rest, before autonomic and AV-node effects
  irregularity: 0.42, // RR = mean × (1 ± this), uniform
  fWaveMv: 0.035, // fibrillatory baseline amplitude
  fWaveHz: 6.5, // ~390/min
  slowedBy: [1, 0.78, 0.58, 0] as const, // ventricular response × this at AV-node ischemia degree 0..2; degree 3 is a regular escape
};
export type Rhythm = "sinus" | "af";

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
