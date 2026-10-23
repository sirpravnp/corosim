import { GORLIN, INERTANCE, ORIFICE_EPS } from "../../config/structural";
import type { Ctx, Element, NodeId, Rates, StateDecl, Tunable } from "./types";

/** Gorlin orifice flow, ml/s: Q = 44.3·A·ΔP/√(|ΔP| + ε) (the smoothing ε keeps conductance finite as ΔP → 0); 0 when A is 0. A cm², ΔP mmHg. */
export const orificeFlow = (area: number, d: number): number => (area ? (GORLIN * area * d) / Math.sqrt(Math.abs(d) + ORIFICE_EPS) : 0);

/** Anything with an opening area and a regurgitant area between two nodes (the recorder reads these). */
export interface Gated { readonly from: NodeId; readonly to: NodeId; readonly params: { area: number; reg: number } }

/** Linear resistance: Q = (P_from − P_to)/R, R in mmHg·s/ml. */
export class Resistor implements Element, Tunable<{ R: number }> {
  readonly params: { R: number };
  constructor(readonly name: string, readonly from: NodeId, readonly to: NodeId, R: number) { this.params = { R }; }
  set(patch: Partial<{ R: number }>) { Object.assign(this.params, patch); }
  flow(ctx: Ctx, out: Rates) { out.flow(this.from, this.to, (ctx.P[this.from] - ctx.P[this.to]) / this.params.R); }
}

/** Two-way orifice (a defect: ASD, VSD, duct, shunt): Gorlin flow in either direction through `area`. */
export class Orifice implements Element, Tunable<{ area: number }> {
  readonly params: { area: number };
  constructor(readonly name: string, readonly from: NodeId, readonly to: NodeId, area: number) { this.params = { area }; }
  set(patch: Partial<{ area: number }>) { Object.assign(this.params, patch); }
  flow(ctx: Ctx, out: Rates) { out.flow(this.from, this.to, orificeFlow(this.params.area, ctx.P[this.from] - ctx.P[this.to])); }
}

/**
 * Flow (ml/s, signed like `d`) through an orifice of area `area` in series with a characteristic impedance `zc`, for the total
 * pressure difference `d` (from the upstream node to the downstream compliance pressure). The drop is ΔP = K·Q² + Zc·Q with
 * K = 1/(GORLIN·A)², which solves in closed form: Q = 2ΔP / (Zc + √(Zc² + 4K·ΔP)) (the stable form of (−Zc + √(Zc² + 4KΔP))/2K).
 * Zc > 0 has the finite conductance 1/Zc at ΔP → 0, so no smoothing is needed. 0 when A is 0.
 */
export const orificeZcFlow = (area: number, zc: number, d: number): number => {
  if (!area) return 0;
  const k = 1 / (GORLIN * area) ** 2, a = Math.abs(d), q = (2 * a) / (zc + Math.sqrt(zc * zc + 4 * k * a));
  return d < 0 ? -q : q;
};

/**
 * One-way valve: Gorlin flow through `area` while P_from > P_to, through the regurgitant area `reg` (0 = competent) while it is reversed.
 *
 * `Zc` (mmHg·s/ml, default 0) is the characteristic impedance of the artery downstream, in series with the valve (3-element
 * Windkessel). The valve and Zc are one element: with P_to read as the compliance pressure Pc, the flow solves
 * P_from − Pc = K·Q·|Q| + Zc·Q (`orificeZcFlow`), and in phase 2b the element adds Zc·Q to the `to` node, so that node reads as
 * the proximal pressure Pp = Pc + Zc·Q. Then P_from − Pp = K·Q·|Q| is the valve's own gradient (what `BeatRecorder` reports) and
 * every other element on the node sees Pp. With Zc = 0 nothing is added and the flow is the smoothed Gorlin law.
 */
export class OneWayValve implements Element, Gated, Tunable<{ area: number; reg: number; Zc: number }> {
  readonly params: { area: number; reg: number; Zc: number };
  private q = 0;
  constructor(readonly name: string, readonly from: NodeId, readonly to: NodeId, area: number, reg = 0, Zc = 0) { this.params = { area, reg, Zc }; }
  set(patch: Partial<{ area: number; reg: number; Zc: number }>) { Object.assign(this.params, patch); }
  series(ctx: Ctx, out: Rates) {
    const { area, reg, Zc } = this.params;
    if (!Zc) return;
    const d = ctx.P[this.from] - ctx.P[this.to];
    this.q = orificeZcFlow(d > 0 ? area : reg, Zc, d);
    out.addPressure(this.to, Zc * this.q);
  }
  flow(ctx: Ctx, out: Rates) {
    const { area, reg, Zc } = this.params;
    if (Zc) { out.flow(this.from, this.to, this.q); return; }
    const d = ctx.P[this.from] - ctx.P[this.to];
    out.flow(this.from, this.to, orificeFlow(d > 0 ? area : reg, d));
  }
}

/**
 * Inertance L (mmHg·s²/ml) of a blood column of length `lengthCm` through area `areaCm2`: L = ρ·ℓ/A with ρ = 1.06 g/cm³,
 * which is in dyn·s²/cm⁵; dividing by 1333.2 gives mmHg·s²/ml. Estimate ℓ as the length of the vessel segment (or, for a valve,
 * the blood column the valve flow accelerates) and A from its mean cross-section. Example: ℓ = 3 cm, A = 5 cm² gives
 * 1.06·3/5/1333.2 = 4.8e-4 mmHg·s²/ml.
 */
export const inertance = (lengthCm: number, areaCm2: number): number => (INERTANCE.rho * lengthCm) / areaCm2 / INERTANCE.dynPerMmHg;

/**
 * Resistive edge with inertance and its own state, the flow Q (ml/s, positive from → to):
 *
 *     L·dQ/dt = (P_from − P_to) − R·Q
 *
 * L in mmHg·s²/ml, R in mmHg·s/ml. L = ρ·ℓ/A for a segment of length ℓ and mean area A (see `inertance`): ρ = 1.06 g/cm³ gives
 * dyn·s²/cm⁵, divided by 1333.2 for mmHg·s²/ml. The flow is a state, so it lags the pressure difference by about L/R.
 */
export class InertialResistor implements Element, Tunable<{ R: number; L: number }> {
  readonly params: { R: number; L: number };
  readonly states: readonly StateDecl[];
  private idx = -1;
  constructor(readonly name: string, readonly from: NodeId, readonly to: NodeId, R: number, L: number) {
    this.params = { R, L }; this.states = [{ name: `${name}.Q`, start: 0 }];
  }
  set(patch: Partial<{ R: number; L: number }>) { Object.assign(this.params, patch); }
  bind(offset: number) { this.idx = offset; }
  flow(ctx: Ctx, out: Rates) {
    const Q = ctx.y[this.idx], { R, L } = this.params;
    out.flow(this.from, this.to, Q);
    out.rate(this.idx, (ctx.P[this.from] - ctx.P[this.to] - R * Q) / L);
  }
  taps(ctx: Ctx) { return { Q: ctx.y[this.idx] }; }
}

/**
 * One-way valve with inertance and its own state, the flow Q (ml/s, positive from → to):
 *
 *     L·dQ/dt = (P_from − P_to) − K·Q·|Q|,   K = 1/(GORLIN·A)²
 *
 * with A = `area` while Q ≥ 0 (forward) and A = `reg` while Q < 0, so at steady flow Q = GORLIN·A·√ΔP, the Gorlin law of
 * `OneWayValve`, and inertia only adds a lag. With no regurgitant area (`reg` = 0) the valve is closed whenever Q would go
 * negative: Q is held at 0 while ΔP ≤ 0, here by treating any Q < 0 as 0 (inside RK4 stages too) and by the state's lower bound
 * of 0, which the engine applies after every step. The leaky or closed choice is made at construction (the bound is fixed then);
 * `set` may change `area`, `L` and, for a valve built with `reg` > 0, `reg`. A closed or atretic orifice (A = 0) carries no flow.
 * L = ρ·ℓ/A, see `inertance`.
 *
 * `Zc` (mmHg·s/ml, default 0): characteristic impedance in series, as in `OneWayValve`. The flow is a state, so phase 2b just adds
 * Zc·Q to the `to` node (its proximal pressure Pp = Pc + Zc·Q); the equation above, written with Pc, is then
 * L·dQ/dt = (P_from − Pc) − K·Q|Q| − Zc·Q.
 */
export class InertialValve implements Element, Gated, Tunable<{ area: number; reg: number; L: number; Zc: number }> {
  readonly params: { area: number; reg: number; L: number; Zc: number };
  readonly states: readonly StateDecl[];
  private idx = -1;
  constructor(readonly name: string, readonly from: NodeId, readonly to: NodeId, area: number, reg: number, L: number, Zc = 0) {
    this.params = { area, reg, L, Zc };
    this.states = [{ name: `${name}.Q`, start: 0, min: reg > 0 ? -Infinity : 0 }];
  }
  set(patch: Partial<{ area: number; reg: number; L: number; Zc: number }>) { Object.assign(this.params, patch); }
  bind(offset: number) { this.idx = offset; }
  series(ctx: Ctx, out: Rates) {
    const { Zc, reg } = this.params;
    if (!Zc) return;
    const q = ctx.y[this.idx];
    out.addPressure(this.to, Zc * (q < 0 && reg === 0 ? 0 : q));
  }
  flow(ctx: Ctx, out: Rates) {
    const { area, reg, L } = this.params, d = ctx.P[this.from] - ctx.P[this.to];
    let q = ctx.y[this.idx];
    if (q < 0 && reg === 0) q = 0; // closed: no backward flow without a regurgitant area
    const a = q > 0 || (q === 0 && d > 0) ? area : reg;
    if (!a) { out.flow(this.from, this.to, 0); out.rate(this.idx, -1000 * q); return; } // no orifice this way: the flow dies out within ms
    const k = 1 / (GORLIN * a) ** 2;
    out.flow(this.from, this.to, q);
    out.rate(this.idx, (d - k * q * Math.abs(q)) / L);
  }
  taps(ctx: Ctx) { return { Q: ctx.y[this.idx] }; }
}
