import { GENERIC_PUMP } from "../../../config/devices";
import type { Ctx, Element, NodeId, Rates, StateDecl, Tunable } from "../types";

/** Coefficients of the pressure head. */
export interface HQCoeffs { a: number; b: number; c: number }

/**
 * Everything adjustable about a rotary pump (all change between steps with `set`). Units: ω krpm, Q ml/s, pressures mmHg,
 * L mmHg·s²/ml, R mmHg·s/ml, volumes ml. See `pumpHead` and `inflowResistance`.
 */
export interface PumpParams extends HQCoeffs {
  /** Rotor speed ω, krpm (0 = stopped). */
  speed: number;
  /** Inertance of the cannula and fluid in the rotor, mmHg·s²/ml. */
  L: number;
  /** Inflow resistance with a full inflow node, mmHg·s/ml. */
  R0: number;
  /** Extra inflow resistance at full collapse, mmHg·s/ml. */
  Rmax: number;
  /** Inflow pressure (mmHg) below which suction develops (half developed at Pth), and the width of the transition (mmHg). */
  Pth: number; wP: number;
  /** Inflow node volume (ml) below which suction develops (half developed at Vc: the collapse volume), and the width (ml). */
  Vc: number; wV: number;
  /** Fraction of `Rmax` of extra resistance at which the `suction` tap goes true. */
  suctionAt: number;
}

/** Pressure head of the rotor, mmHg: H(ω, Q) = a·ω² − b·ω·Q − c·Q·|Q|, ω in krpm, Q in ml/s (negative Q: flow against the rotor). */
export const pumpHead = (k: HQCoeffs, speed: number, q: number): number => k.a * speed * speed - k.b * speed * q - k.c * q * Math.abs(q);

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * Suction level s in [0, 1]: how far the inflow node is collapsing. Two smooth logistic terms, one on the inflow pressure and one
 * on its volume, combined as a probabilistic OR so each alone can drive it and it never exceeds 1:
 *
 *     s = 1 − (1 − σ((Pth − P_in)/wP))·(1 − σ((Vc − V_in)/wV))
 */
export const suctionLevel = (p: Pick<PumpParams, "Pth" | "wP" | "Vc" | "wV">, pIn: number, vIn: number): number =>
  1 - (1 - sigmoid((p.Pth - pIn) / p.wP)) * (1 - sigmoid((p.Vc - vIn) / p.wV));

/**
 * Inflow resistance, mmHg·s/ml: R_in = R0 + Rmax·s with s = `suctionLevel` (smooth and bounded by R0 + Rmax, so the system stays
 * finite and not stiffer than Rmax/L). As the inflow node empties, R_in climbs from R0 to R0 + Rmax and the forward flow drops.
 */
export const inflowResistance = (p: Pick<PumpParams, "R0" | "Rmax" | "Pth" | "wP" | "Vc" | "wV">, pIn: number, vIn: number): number =>
  p.R0 + p.Rmax * suctionLevel(p, pIn, vIn);

export interface HQPoint { speed: number; flow: number; head: number }

/**
 * Least-squares fit of H = a·ω² − b·ω·Q − c·Q·|Q| to a table of measured points (speed krpm, flow ml/s, head mmHg). The model is
 * linear in (a, b, c), so this solves the 3x3 normal equations with the regressors (ω², −ωQ, −Q|Q|). Needs points at two or more
 * speeds and flows for a well-posed fit; throws if the system is singular.
 */
export function fitHQ(points: readonly HQPoint[]): HQCoeffs {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], y = [0, 0, 0];
  for (const { speed: w, flow: q, head: h } of points) {
    const x = [w * w, -w * q, -q * Math.abs(q)];
    for (let i = 0; i < 3; i++) { y[i] += x[i] * h; for (let j = 0; j < 3; j++) A[i][j] += x[i] * x[j]; }
  }
  // Gaussian elimination with partial pivoting
  for (let i = 0; i < 3; i++) {
    let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    if (Math.abs(A[p][i]) < 1e-12 * (1 + Math.abs(A[0][0]))) throw new Error("fitHQ: the points do not determine a, b and c");
    [A[i], A[p]] = [A[p], A[i]]; [y[i], y[p]] = [y[p], y[i]];
    for (let r = i + 1; r < 3; r++) { const f = A[r][i] / A[i][i]; for (let j = i; j < 3; j++) A[r][j] -= f * A[i][j]; y[r] -= f * y[i]; }
  }
  const s = [0, 0, 0];
  for (let i = 2; i >= 0; i--) { let v = y[i]; for (let j = i + 1; j < 3; j++) v -= A[i][j] * s[j]; s[i] = v / A[i][i]; }
  return { a: s[0], b: s[1], c: s[2] };
}

/**
 * Generic rotary blood pump from `from` (inflow node) to `to` (outflow node), with its own state, the flow Q (ml/s, positive
 * from → to):
 *
 *     L·dQ/dt = H(ω, Q) − (P_out − P_in) − R_in(P_in, V_in)·Q,    H = a·ω² − b·ω·Q − c·Q·|Q|
 *
 * Q may go negative: when H is below the pressure difference (a slowed or stopped pump) blood regurgitates through the rotor. The
 * suction resistance R_in (`inflowResistance`) only opposes forward flow; backward, the cannula resistance R0 acts alone, since
 * blood returning to the inflow node cannot collapse it. Generic and not tied to any device: coefficients default to
 * `GENERIC_PUMP` (config/devices.ts), device definitions override them. Call `set({ speed })` to change the speed live.
 *
 * Taps: `flow` (L/min), `head` (mmHg, H at the present Q), `dP` (P_out − P_in, mmHg), `speed` (krpm), `suction` (0/1: the extra
 * inflow resistance exceeds `suctionAt`·Rmax), `suctionLevel` (0-1), `power` (ΔP·Q, mmHg·ml/s, the hydraulic power proxy;
 * × 1.333e-4 for watts), `Rin` (mmHg·s/ml), `Q` (ml/s).
 */
export class RotaryPump implements Element, Tunable<PumpParams> {
  readonly params: PumpParams;
  readonly states: readonly StateDecl[];
  protected idx = -1;
  constructor(readonly name: string, readonly from: NodeId, readonly to: NodeId, params: Partial<PumpParams> = {}) {
    this.params = { ...GENERIC_PUMP, ...params };
    this.states = [{ name: `${name}.Q`, start: 0 }];
  }
  set(patch: Partial<PumpParams>) { Object.assign(this.params, patch); }
  bind(offset: number) { this.idx = offset; }
  flow(ctx: Ctx, out: Rates) {
    const p = this.params, Q = ctx.y[this.idx];
    const rIn = Q > 0 ? inflowResistance(p, ctx.P[this.from], ctx.V[this.from]) : p.R0;
    out.flow(this.from, this.to, Q);
    out.rate(this.idx, (pumpHead(p, p.speed, Q) - (ctx.P[this.to] - ctx.P[this.from]) - rIn * Q) / p.L);
  }
  taps(ctx: Ctx) {
    const p = this.params, Q = ctx.y[this.idx], pIn = ctx.P[this.from], dP = ctx.P[this.to] - pIn;
    const s = suctionLevel(p, pIn, ctx.V[this.from]);
    return {
      Q, flow: (Q * 60) / 1000, head: pumpHead(p, p.speed, Q), dP, speed: p.speed, suction: p.Rmax * s > p.suctionAt * p.Rmax ? 1 : 0,
      suctionLevel: s, power: dP * Q, Rin: p.R0 + p.Rmax * s,
    };
  }
}
