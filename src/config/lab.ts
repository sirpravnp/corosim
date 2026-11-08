// Cath lab procedure simulator knobs. [assumed] until cited or clinician-reviewed.

export const LAB = {
  /** Clinical minutes of infarct evolution per simulated second while the lab runs in real-time mode. */
  realtimeMinutesPerSecond: 1 / 60,
  /** Ischemia rise time constant (s) used only in real-time lab mode; clinical mode keeps config/ecg ISCHEMIA. */
  ischemiaTauSeconds: 20,
} as const;
