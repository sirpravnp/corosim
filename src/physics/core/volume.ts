import { OUTSIDE, type Ctx, type Element, type NodeId, type Rates, type Tunable } from "./types";

/** Time constant (s) of the fastest possible drain of what a loss may take (see `flow`). Far above any rate the simulation asks for while there is blood to lose. */
const LOSS_TAU_S = 0.25;

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
  /**
   * Whether a loss is held to what the `from` nodes can give (see `flow`). The simulation turns it off during its reflex warm-up, whose
   * build can start with an empty circulation (a heavy bleed at build) that the old rule settled; the running patient always has it.
   */
  capLoss = true;
  /**
   * `lossWeight(node, volume)` (ml) is each `from` node's share of a loss; the default is its volume. A bleed drains the blood that
   * is under pressure, not the unstressed volume of a vein, so the ACS simulation passes the stressed volume (A7b). A bolus always
   * divides by the volume of the `into` nodes.
   */
  constructor(readonly name: string, private readonly into: readonly NodeId[], private readonly from: readonly NodeId[], private readonly lossWeight: (node: NodeId, volume: number) => number = (_n, v) => v) {}
  set(patch: Partial<VolumeExchangeParams>) { Object.assign(this.params, patch); }
  flow(ctx: Ctx, out: Rates) {
    const q = this.params.rate;
    if (q === 0) return;
    const nodes = q > 0 ? this.into : this.from;
    let tot = 0;
    const weight = (n: NodeId) => Math.max(q > 0 ? ctx.V[n] : this.lossWeight(n, ctx.V[n]), 0);
    for (const n of nodes) tot += weight(n);
    if (q < 0 && this.capLoss) {
      // a loss can only take blood that is there to take: at most the weighted (stressed) volume per `LOSS_TAU_S`, so the nodes empty
      // towards their weight's zero (the unstressed volume) and never below it, however much the caller asks for
      const lossRate = Math.min(-q, tot / LOSS_TAU_S);
      if (!(lossRate > 0)) return;
      for (const n of nodes) { const w = weight(n) / tot; out.flow(n, OUTSIDE, lossRate * w); } // the same arithmetic as before the cap, so nothing moves while it does not bind
      return;
    }
    for (const n of nodes) {
      const w = tot > 1e-9 ? weight(n) / tot : 1 / nodes.length;
      if (q > 0) out.flow(OUTSIDE, n, q * w); else out.flow(n, OUTSIDE, -q * w);
    }
  }
}
