import { SIMBOOK_CIRCUIT as C } from "../config/simbook";

export type OrganId = keyof typeof C.organs;

export interface OrganParams {
  id: OrganId;
  label: string;
  /** Vessel radius in arbitrary units (Poiseuille). */
  radius: number;
  /** Resistance at reference radius, mmHg·min/L. */
  r0: number;
}

export interface CircuitParams {
  cardiacOutputLMin: number;
  cvpMmHg: number;
  organs: OrganParams[];
}

export interface CircuitSolution {
  mapMmHg: number;
  cvpMmHg: number;
  svr: number;
  deltaPMmHg: number;
  /** Per-organ flow, L/min. */
  flows: Record<OrganId, number>;
  /** Per-organ resistance, mmHg·min/L. */
  resistances: Record<OrganId, number>;
}

/** Poiseuille: resistance scales as (refRadius / radius)⁴. */
export function resistanceFromRadius(r0: number, radius: number, refRadius = C.refRadius): number {
  const r = Math.max(radius, 0.25);
  return r0 * Math.pow(refRadius / r, 4);
}

export function defaultOrgans(): OrganParams[] {
  return (Object.keys(C.organs) as OrganId[]).map((id) => ({
    id,
    label: C.organs[id].label,
    radius: C.refRadius,
    r0: C.organs[id].r0,
  }));
}

export function defaultCircuit(): CircuitParams {
  return { cardiacOutputLMin: C.baseCoLMin, cvpMmHg: C.cvpMmHg, organs: defaultOrgans() };
}

/** Parallel systemic beds: 1/SVR = Σ(1/Rᵢ). Pump sets CO; MAP = CVP + CO × SVR. Branch flow Qᵢ = ΔP/Rᵢ. */
export function solveCircuit(p: CircuitParams): CircuitSolution {
  const resistances = {} as Record<OrganId, number>;
  let invSvr = 0;
  for (const o of p.organs) {
    const r = resistanceFromRadius(o.r0, o.radius);
    resistances[o.id] = r;
    invSvr += 1 / r;
  }
  const svr = invSvr > 0 ? 1 / invSvr : Infinity;
  const mapMmHg = p.cvpMmHg + p.cardiacOutputLMin * svr;
  const deltaPMmHg = mapMmHg - p.cvpMmHg;
  const flows = {} as Record<OrganId, number>;
  for (const o of p.organs) flows[o.id] = deltaPMmHg / resistances[o.id];
  return { mapMmHg, cvpMmHg: p.cvpMmHg, svr, deltaPMmHg, flows, resistances };
}

/** True when MAP − CVP ≈ CO × SVR within relative tolerance. */
export function ohmIdentityHolds(s: CircuitSolution, co: number, tol = 0.02): boolean {
  const lhs = s.deltaPMmHg;
  const rhs = co * s.svr;
  const scale = Math.max(Math.abs(lhs), Math.abs(rhs), 1);
  return Math.abs(lhs - rhs) / scale <= tol;
}
