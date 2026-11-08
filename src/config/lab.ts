// Cath lab procedure simulator knobs. [assumed] until cited or clinician-reviewed.

export const LAB = {
  /** Clinical minutes of infarct evolution per simulated second while the lab runs in real-time mode. */
  realtimeMinutesPerSecond: 1 / 60,
  /** Ischemia rise time constant (s) used only in real-time lab mode; clinical mode keeps config/ecg ISCHEMIA. */
  ischemiaTauSeconds: 20,
  /** ACT rise per heparin unit (s). [assumed] */
  actPerHeparinUnit: 0.05,
  /** ACT decay (s) per elapsed simulated second in the lab. [assumed] */
  actDecayPerSecond: 1 / 12,
  hydrophilicCrossingDiscount: 0.4,
  branchMatchRotDeg: 25,
  branchBendChoiceDeg: 45,
} as const;
