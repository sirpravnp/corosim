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
