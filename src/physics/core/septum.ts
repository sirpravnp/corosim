import { SEPTUM } from "../../config/septum";
import type { ElastanceChamber } from "./chamber";
import type { Ctx, Element, NodeId, Rates, Tunable } from "./types";

/**
 * Parameters of the septum (changed between steps via `set`).
 *  - eesRatio: systolic septal elastance as a multiple of the LV Ees (dimensionless);
 *  - diaStiffness: passive septal stiffness E_d, mmHg/ml;
 *  - off: true = septum disabled (no shift).
 */
export interface SeptumParams { eesRatio: number; diaStiffness: number; off: boolean }

/** Solver statistics since the last `resetStats()`. `failed` counts solves that hit the iteration cap without meeting the tolerance. */
export interface SeptumStats { solves: number; iterations: number; maxIterations: number; failed: number }

/**
 * Ventricular interdependence through the septum, a field element (Santamore & Burkhoff / Smith & Chase line).
 *
 * The free walls are the chamber laws (`fromModel` scales the lumped laws by the free-wall fractions of config/septum.ts), evaluated
 * at the cavity volume shifted by the septal displacement V_spt (ml). The septum is a spring with its own
 * time-varying elastance (the same blend of passive and active as the chambers, e = e_LV the LV activation, the septum being LV muscle)
 *
 *   P_spt(V_spt, t) = E_s(t)·V_spt,     E_s(t) = (1 − e)·E_d + e·E_sys,     E_sys = eesRatio·Ees_LV   (mmHg/ml)
 *
 * that carries the transseptal pressure:
 *
 *   P_LV(V_LV − V_spt) − P_RV(V_RV + V_spt) = P_spt(V_spt, t)
 *
 * Sign: V_spt > 0 bows the septum into the RV (normal: P_LV > P_RV). The LV free wall sees V_LV − V_spt and the RV free wall
 * V_RV + V_spt: `shiftVolume(LV, −V_spt)`, `shiftVolume(RV, +V_spt)`. V_spt < 0 is a leftward bow (RV overload: LV pressure at a
 * given blood volume rises, LV fills less).
 *
 * Solve: g(v) = P_LV(V_LV−v) − P_RV(V_RV+v) − P_spt(v, t) = 0. Each chamber law is non-decreasing in volume and P_spt is strictly
 * increasing (slope E_s ≥ min(E_d, E_sys) > 0), so g is strictly decreasing: a unique root, bracketed in [−uMax, uMax]. Safeguarded Newton from the previous V_spt (warm start;
 * it only speeds the solve, the root is the same), with bisection when a step leaves the bracket. Stops when |step| < tolMl or
 * |g| < tolMmHg (1e-7) or the bracket is that narrow. Bounded at `maxIter` iterations; if that is hit, the bracket midpoint is
 * used (counted in `stats.failed`); a non-finite input gives V_spt = 0. V_spt is always finite and within ±uMax. No allocation;
 * the activations are computed once per evaluation.
 *
 * Only the cavity volumes enter: an external pressure common to both ventricles (the pericardium) cancels in P_LV − P_RV.
 *
 * Taps: septalVolumeMl (V_spt, ml, + toward the RV), transseptalPressure (P_LV − P_RV with the shift, mmHg),
 * septalIterations (iterations of the last solve).
 */
export class Septum implements Element, Tunable<SeptumParams> {
  readonly name = "septum";
  readonly params: SeptumParams;
  private u = 0;
  private lastIter = 0;
  readonly stats: SeptumStats = { solves: 0, iterations: 0, maxIterations: 0, failed: 0 };
  /** Transseptal pressure of the last solve (for taps). */
  private dpLast = 0;
  constructor(private readonly lv: ElastanceChamber, private readonly rv: ElastanceChamber, private readonly lvId: NodeId, private readonly rvId: NodeId, params: Partial<SeptumParams> = {}) {
    this.params = { eesRatio: SEPTUM.eesRatio, diaStiffness: SEPTUM.diaStiffness, off: false, ...params };
  }
  set(patch: Partial<SeptumParams>) { Object.assign(this.params, patch); }
  /** Septal displacement V_spt (ml, + toward the RV) of the last evaluation (the end of the last step when read between steps). */
  get volumeMl() { return this.u; }
  resetStats() { const s = this.stats; s.solves = 0; s.iterations = 0; s.maxIterations = 0; s.failed = 0; }

  /** Septal displacement V_spt (ml) that balances the septum at volumes `vl`, `vr` (ml; including any other shifts) and time t. */
  solve(vl: number, vr: number, t: number): number {
    const p = this.params, { uMax, tolMl, tolMmHg, maxIter } = SEPTUM;
    if (p.off || !(Number.isFinite(vl) && Number.isFinite(vr))) { this.u = 0; this.dpLast = 0; this.lastIter = 0; return 0; }
    const eL = this.lv.activation(t), eR = this.rv.activation(t);
    const es = (1 - eL) * p.diaStiffness + eL * Math.max(0, p.eesRatio * this.lv.params.ees);
    let lo = -uMax, hi = uMax, u = Math.min(hi, Math.max(lo, Number.isFinite(this.u) ? this.u : 0)), it = 0, ok = false;
    for (; it < maxIter; it++) {
      const g = this.lv.pressureAt(vl - u, eL) - this.rv.pressureAt(vr + u, eR) - es * u;
      if (!Number.isFinite(g)) { u = 0; ok = true; break; }
      if (g > 0) lo = u; else hi = u; // g decreasing: the root is above u when g > 0
      if (Math.abs(g) < tolMmHg) { ok = true; break; }
      const dg = -(this.lv.slopeAt(vl - u, eL) + this.rv.slopeAt(vr + u, eR) + es);
      let un = u - g / dg;
      if (!(dg < -1e-12) || !(un > lo && un < hi)) un = 0.5 * (lo + hi);
      if (Math.abs(un - u) < tolMl || hi - lo < tolMl) { u = un; ok = true; break; }
      u = un;
    }
    if (!ok) { u = 0.5 * (lo + hi); this.stats.failed++; }
    if (!Number.isFinite(u)) u = 0;
    this.u = u = Math.min(uMax, Math.max(-uMax, u));
    this.lastIter = it;
    const s = this.stats; s.solves++; s.iterations += it; if (it > s.maxIterations) s.maxIterations = it;
    this.dpLast = this.lv.pressureAt(vl - u, eL) - this.rv.pressureAt(vr + u, eR);
    return u;
  }

  field(ctx: Ctx, out: Rates) {
    const u = this.solve(ctx.V[this.lvId] + ctx.Vshift[this.lvId], ctx.V[this.rvId] + ctx.Vshift[this.rvId], ctx.t);
    out.shiftVolume(this.lvId, -u);
    out.shiftVolume(this.rvId, u);
  }
  taps() {
    return { septalVolumeMl: this.u, transseptalPressure: this.dpLast, septalIterations: this.lastIter };
  }
}
