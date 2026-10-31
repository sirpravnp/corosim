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
