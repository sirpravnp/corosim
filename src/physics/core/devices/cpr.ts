import type { Ctx, Element, NodeId, Rates, Tunable } from "../types";

/** Chest compressions (task B4b): peak pressure on the ventricles (mmHg), rate (per min) and the compressed share of each cycle. */
export interface CprParams { peakMmHg: number; rate: number; duty: number }

/**
 * Chest compressions as an external force on the heart (the cardiac-pump model of CPR): during the compressed part of each cycle an
 * external pressure p(t) = peak·sin²(π·phase/duty) is added on the ventricles, which pushes blood out through the semilunar valves; on
 * release the ventricles refill from the atria. The Simulation sets `peakMmHg` from the arrest model's CPR output (`perfusion()`,
 * sim/arrest.ts), calibrated in config/arrestSim.ts. With `peakMmHg` 0 the element does nothing, so a heart built with it is unchanged.
 */
export class CprCompression implements Element, Tunable<CprParams> {
  readonly params: CprParams = { peakMmHg: 0, rate: 110, duty: 0.5 };
  private now = 0;
  constructor(readonly name: string, private readonly nodes: readonly NodeId[]) {}
  set(patch: Partial<CprParams>) { Object.assign(this.params, patch); }
  /** External pressure of the compression at time t, mmHg. */
  pressureAt(t: number): number {
    const { peakMmHg: a, rate, duty } = this.params;
    if (!(a > 0) || !(rate > 0)) return 0;
    const ph = (t * rate / 60) % 1;
    if (ph >= duty) return 0;
    const s = Math.sin((Math.PI * ph) / duty);
    return a * s * s;
  }
  field(ctx: Ctx, out: Rates) {
    const p = (this.now = this.pressureAt(ctx.t));
    if (p > 0) for (const n of this.nodes) out.addExternal(n, p);
  }
  taps(): Record<string, number> { return { pressure: this.now, peak: this.params.peakMmHg }; }
}
