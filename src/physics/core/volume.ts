import { OUTSIDE, type Ctx, type Element, type NodeId, type Rates, type Tunable } from "./types";

export interface VolumeExchangeParams {
  /** ml/s of blood given (+) or lost (−). */
  rate: number;
}

/**
 * Blood added to or removed from the circulation (fluid boluses, hemorrhage) at a rate the caller sets between steps. A bolus goes
 * into the `into` nodes (the veins), a loss comes out of the `from` nodes, each in proportion to the node's current volume, so a
 * node is never drained below zero by it. Total blood volume then changes by exactly the integral of `rate`. C2 (fluid
 * compartments) replaces this with a real model of what stays in the vessels.
 */
export class VolumeExchange implements Element, Tunable<VolumeExchangeParams> {
  readonly params: VolumeExchangeParams = { rate: 0 };
  constructor(readonly name: string, private readonly into: readonly NodeId[], private readonly from: readonly NodeId[]) {}
  set(patch: Partial<VolumeExchangeParams>) { Object.assign(this.params, patch); }
  flow(ctx: Ctx, out: Rates) {
    const q = this.params.rate;
    if (q === 0) return;
    const nodes = q > 0 ? this.into : this.from;
    let tot = 0;
    for (const n of nodes) tot += Math.max(ctx.V[n], 0);
    for (const n of nodes) {
      const w = tot > 1e-9 ? Math.max(ctx.V[n], 0) / tot : 1 / nodes.length;
      if (q > 0) out.flow(OUTSIDE, n, q * w); else out.flow(n, OUTSIDE, -q * w);
    }
  }
}
