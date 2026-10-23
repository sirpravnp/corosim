// Mechanical support device constants. [lit] = literature-backed, [assumed] = teaching choice that needs a source.
// Nothing here is manufacturer or published device data; device definitions (P-levels, real HQ curves) come with task D2.

/**
 * A generic rotary blood pump (task D1): head H = a·ω² − b·ω·Q − c·Q·|Q| in mmHg, ω in krpm, Q in ml/s. With these
 * numbers the shut-off head at 30 krpm is 90 mmHg and the free-flow (H = 0) is about 100 ml/s (6 L/min). All [assumed]:
 * chosen for a plausible shape (head falling with flow, flow rising with speed), not copied from any device.
 */
export const GENERIC_PUMP = {
  speed: 30, // krpm [assumed]
  a: 0.1, // mmHg/krpm², shut-off head coefficient [assumed]
  b: 0.0225, // mmHg/(krpm·ml/s), slip with flow [assumed]
  c: 0.0015, // mmHg/(ml/s)², hydraulic loss [assumed]
  L: 0.05, // mmHg·s²/ml, cannula and rotor inertance (about 100x the 3 cm aortic column) [assumed]
  /** Inflow (suction) law, see `inflowResistance` in core/devices/pump.ts. */
  R0: 0.05, // mmHg·s/ml, cannula resistance with a full inflow [assumed]
  Rmax: 60, // mmHg·s/ml, extra resistance at full collapse [assumed]
  Pth: 2, // mmHg, inflow pressure at which the pressure term of suction is half developed [assumed]
  wP: 1, // mmHg, width of that transition [assumed]
  Vc: 5, // ml, inflow node volume at which the volume term is half developed (collapse volume) [assumed]
  wV: 2, // ml, width of that transition [assumed]
  suctionAt: 0.5, // fraction of Rmax at which the `suction` tap goes true [assumed]
};
