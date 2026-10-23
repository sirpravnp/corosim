import { PERICARDIUM } from "../../config/pericardium";
import type { Ctx, Element, NodeId, Rates, StateDecl, Tunable } from "./types";

/**
 * Parameters of the sac (changed between steps via `set`).
 *  - stiffness: multiplier s on both the pressure scale A and the steepness B (a stiff sac is higher and steeper), dimensionless; 1 normal, > 1 constrictive pericarditis, < 1 a chronically stretched sac.
 *  - open: true = pericardium opened (after cardiac surgery), no constraint.
 *  - v0: unstressed sac volume, ml (blood in the four chambers + effusion at which P_peri = 0).
 *  - a: pressure scale, mmHg;  b: exponent, 1/ml.
 *  - reservePerStiffness: ml of reserve volume lost per unit of (stiffness − 1): V0_eff = V0 − k·(s − 1). A scarred sac is not only stiffer, it also fits the heart tighter.
 *  - adaptTauS: time constant (s) with which the stretch of V0 follows the sac volume (chronic effusion); Infinity = never.
 *  - effusionRateMlS: fluid accumulating in the sac, ml/s (bleeding or exudate; 0 = stable).
 */
export interface PericardiumParams { stiffness: number; open: boolean; v0: number; a: number; b: number; adaptTauS: number; effusionRateMlS: number; reservePerStiffness: number }

const E6 = Math.exp(6);

/**
 * The pericardial sac, a field element. Sac volume V_sac = sum of the volumes of every node in the "pericardial" group + effusion.
 *
 *   x = V_sac − V0 − stretch + k·(s − 1)                                     ml (k = reservePerStiffness)
 *   P_peri = max(0, s · A · (E(B·x) − 1))                                     mmHg, zero when `open`
 *   E(u) = exp(u) for u ≤ 6, e^6·(1 + u − 6) beyond (linear continuation: the slope of the pressure stays bounded, so the integration stays stable at any stiffness)
 *
 * applied with `addExternal` to every pericardial node (each chamber then sees transmural pressure + P_peri). A sac slack by a
 * few ml does not pull on the heart, so the pressure is floored at 0.
 *
 * Own states (integrated with the rest of the engine):
 *  - effusion (ml): d/dt = effusionRateMlS, less what `drain` has removed (kept as an offset, applied between steps).
 *  - stretch (ml): the sac's own growth, d/dt = (V_sac − V0 − stretch)/adaptTauS (chronic effusion stretches the sac so the same
 *    volume squeezes less); zero for adaptTauS = Infinity.
 *
 * Taps: pericardialPressure (mmHg), effusionMl (ml), sacVolumeMl (ml), stretchMl (ml).
 */
export class Pericardium implements Element, Tunable<PericardiumParams> {
  readonly name = "pericardium";
  readonly params: PericardiumParams;
  readonly states: readonly StateDecl[];
  private off = 0;
  /** Volume removed by `drain` so far, ml (effusion = state − drained). */
  private drained = 0;
  /** Effusion at the last field evaluation (the end of the last step when read between steps), ml. */
  private lastEff = 0;
  constructor(private readonly nodeIds: readonly NodeId[], effusionMl = 0, params: Partial<PericardiumParams> = {}) {
    this.params = { stiffness: 1, open: false, v0: PERICARDIUM.v0, a: PERICARDIUM.a, b: PERICARDIUM.b, adaptTauS: PERICARDIUM.adaptTauS, effusionRateMlS: 0, reservePerStiffness: PERICARDIUM.reservePerStiffness, ...params };
    this.states = [{ name: "effusion", start: effusionMl }, { name: "stretch", start: 0 }];
    this.lastEff = effusionMl;
  }
  bind(offset: number) { this.off = offset; }
  set(patch: Partial<PericardiumParams>) { Object.assign(this.params, patch); }
  /** Pericardiocentesis: remove up to `ml` of effusion; takes effect from the next derivative evaluation (call between steps). */
  drain(ml: number) { const d = Math.max(0, Math.min(ml, this.lastEff)); this.drained += d; this.lastEff -= d; }
  /** Effusion at the last evaluation, ml. */
  get effusionMl() { return this.lastEff; }

  private effusion(ctx: Ctx) { return Math.max(0, ctx.y[this.off] - this.drained); }
  private sac(ctx: Ctx, eff: number) { let v = eff; for (const i of this.nodeIds) v += ctx.V[i]; return v; }
  private pressure(ctx: Ctx, eff: number) {
    const p = this.params;
    if (p.open) return 0;
    const u = p.b * (this.sac(ctx, eff) - p.v0 - ctx.y[this.off + 1] + p.reservePerStiffness * (p.stiffness - 1));
    return Math.max(0, p.stiffness * p.a * ((u <= 6 ? Math.exp(u) : E6 * (1 + u - 6)) - 1));
  }
  field(ctx: Ctx, out: Rates) {
    const eff = (this.lastEff = this.effusion(ctx));
    const P = this.pressure(ctx, eff);
    for (const i of this.nodeIds) out.addExternal(i, P);
  }
  flow(ctx: Ctx, out: Rates) {
    const p = this.params, eff = this.effusion(ctx);
    out.rate(this.off, p.effusionRateMlS);
    out.rate(this.off + 1, Number.isFinite(p.adaptTauS) && !p.open ? (this.sac(ctx, eff) - p.v0 - ctx.y[this.off + 1]) / p.adaptTauS : 0);
  }
  taps(ctx: Ctx) {
    const eff = this.effusion(ctx);
    return { pericardialPressure: this.pressure(ctx, eff), effusionMl: eff, sacVolumeMl: this.sac(ctx, eff), stretchMl: ctx.y[this.off + 1] };
  }
}
