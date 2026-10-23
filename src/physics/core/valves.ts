import { GORLIN, ORIFICE_EPS } from "../../config/structural";
import type { Ctx, Element, NodeId, Rates, Tunable } from "./types";

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

/** One-way valve: Gorlin flow through `area` while P_from > P_to, through the regurgitant area `reg` (0 = competent) while it is reversed. */
export class OneWayValve implements Element, Gated, Tunable<{ area: number; reg: number }> {
  readonly params: { area: number; reg: number };
  constructor(readonly name: string, readonly from: NodeId, readonly to: NodeId, area: number, reg = 0) { this.params = { area, reg }; }
  set(patch: Partial<{ area: number; reg: number }>) { Object.assign(this.params, patch); }
  flow(ctx: Ctx, out: Rates) {
    const d = ctx.P[this.from] - ctx.P[this.to];
    out.flow(this.from, this.to, orificeFlow(d > 0 ? this.params.area : this.params.reg, d));
  }
}
