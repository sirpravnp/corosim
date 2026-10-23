import type { Ctx, Element, NodeId, Rates, Tunable } from "../types";

/**
 * PLACEHOLDER devices for the ACS simulation on the core engine (A7), until the real elements arrive (Impella D2/D3, IABP D5).
 * Nothing here is a model of a device; it only keeps the old teaching behaviour alive on the new engine.
 */

export interface PlaceholderImpellaParams {
  /** Flow the pump delivers with a full left ventricle, ml/s (0 = off). */
  flow: number;
  /** Unloaded volume V0 of the left ventricle, ml: the pump cannot draw it below this. */
  v0: number;
  /** The flow is half developed this far above V0 (ml), and rises from nearly zero to nearly full over about 4x `width`. */
  margin: number; width: number;
}

/**
 * Impella placeholder: a one-way flow element from the left ventricle to the aorta that delivers `flow` ml/s whatever the
 * pressures, softly limited so the LV cannot be drawn below its unloaded volume (R-D1 decision):
 *
 *     Q = flow · σ((V_LV − V0 − margin) / width),   σ(x) = 1 / (1 + e^−x)
 *
 * It has no inertance, suction law or pressure-flow curve; D2/D3 replace it. Taps: `flow` (L/min), `limit` (0..1, the factor on
 * the flow: how close the LV is to its floor).
 */
export class PlaceholderImpella implements Element, Tunable<PlaceholderImpellaParams> {
  readonly name = "impellaPlaceholder";
  readonly params: PlaceholderImpellaParams;
  constructor(private readonly from: NodeId, private readonly to: NodeId, params: Partial<PlaceholderImpellaParams> = {}) {
    this.params = { flow: 0, v0: 0, margin: 6, width: 2, ...params };
  }
  set(patch: Partial<PlaceholderImpellaParams>) { Object.assign(this.params, patch); }
  private limit(ctx: Ctx): number {
    const p = this.params;
    return 1 / (1 + Math.exp(-(ctx.V[this.from] - p.v0 - p.margin) / p.width));
  }
  flow(ctx: Ctx, out: Rates) { if (this.params.flow > 0) out.flow(this.from, this.to, this.params.flow * this.limit(ctx)); }
  taps(ctx: Ctx) { const l = this.limit(ctx); return { flow: (this.params.flow * l * 60) / 1000, limit: l }; }
}
