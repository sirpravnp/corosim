import { IABP } from "../../../config/devices";
import { NODES } from "../../structuralGraph";
import type { Model } from "../../structural";
import type { Ctx, Element, Engine, HeartEvent, NodeId, Rates, StateDecl, Tunable } from "../types";

export interface IabpParams {
  /** Assist every `ratio`-th ventricular beat (1, 2 or 3). */
  ratio: number;
  /** Timing offsets from correct, ms: negative is early. `inflateMs` moves the start of inflation, `deflateMs` the start of deflation. */
  inflateMs: number;
  deflateMs: number;
  /** Balloon volume when full, ml (0-50; default `IABP.volumeMl`). */
  volumeMl: number;
}

/** Balloon phase codes of the `phase` tap. */
export const IABP_PHASE = { deflated: 0, inflating: 1, inflated: 2, deflating: 3 } as const;

/** Smoothstep from 0 (x ≤ −1) to 1 (x ≥ 1); continuous with a continuous first derivative. */
const smooth = (x: number): number => (x <= -1 ? 0 : x >= 1 ? 1 : 0.5 + 0.75 * x - 0.25 * x * x * x);

/**
 * Intra-aortic balloon pump. The balloon is a volume Vb (own state, 0..volumeMl, ml) that occupies the descending aorta without adding
 * blood: `field` does `shiftVolume(DAO, Vb)`, so the DAO pressure law sees V + Vb while the blood volume is unchanged (the helium comes
 * from outside the circulation). The aortic compliance then takes the displaced volume as a pressure rise Vb/C, which is the diastolic
 * augmentation when the balloon is full, and gives the volume back when it empties (pressure falls: lower end-diastolic pressure).
 *
 * Gas shuttle. dVb/dt = (target(t) − Vb)/τ with τ = `tauInflateS` (45 ms) when filling and `tauDeflateS` (60 ms) when emptying;
 * target(t) = volumeMl · w(t), w a smoothed (smoothstep, half-width `edgeS`) 0/1 window per assisted beat. [assumed]
 *
 * Triggering (the ECG R wave is the ventricular event):
 *  - Assisted beats: the k-th ventricular event starts a cycle when (k − 1) mod ratio = 0 (1:1 every beat, 1:2 every second, 1:3 every third).
 *  - Inflation (correct timing = aortic valve closure, the dicrotic notch): start = event + closure delay + inflateMs. The closure delay is
 *    MEASURED from the AV flow of previous beats (see `attach`): from the R wave to the first time the AV flow, after having exceeded
 *    `openFlow`, falls below `closedFlow`. The newest delay is blended into a running estimate (weight `smooth`), stored with its RR; the
 *    estimate for the new beat is scaled by sqrt(RR/RR_ref), as the ventricle's own systolic time scale follows the preceding RR. Before any
 *    measurement, or if there is no engine (`attach` not called): delay = closeBase + closePerRr·RR. A beat on which the balloon was
 *    already inflating when the valve closed does not update the estimate, so early inflation does not drag the notch estimate with it.
 *  - Deflation (correct timing = just before the next R wave): start = event + RR_pred − deflateLeadS + deflateMs, with RR_pred the last
 *    interval. A premature beat cuts a window short at its R wave (plus any late offset): the balloon deflates on the trigger.
 *
 * Taps: `vb` (ml), `target` (ml), `fill` (Vb/volumeMl), `phase` (IABP_PHASE), `assisted` (1 while the current beat is an assisted
 * cycle), `augmentation` (static pressure the balloon adds to the DAO, mmHg = Vb/C), `closure` (current delay estimate, s), `beat`
 * (ventricular events seen). `balloonDelta` of a console = pressure change, which is read off the aortic trace instead.
 */
export class Iabp implements Element, Tunable<IabpParams> {
  readonly name: string;
  readonly states: readonly StateDecl[] = [{ name: "Vb", start: 0, min: 0 }];
  readonly params: IabpParams;
  private idx = -1;
  private beats = 0;
  private tEvent = -Infinity;
  private rr: number;
  private assisted = false;
  /** Inflation start of this beat's own cycle (Infinity if the beat is not assisted). */
  private curOn = Infinity;
  /** Gating windows [on, off] (s, engine time) of the recent assisted cycles. */
  private windows: { on: number; off: number }[] = [];
  private delay = NaN; private delayRr = NaN;
  private watching = false; private opened = false;
  private off: (() => void) | null = null;

  /**
   * @param dao  node the balloon sits in (the descending aorta).
   * @param compliance  compliance of that node, ml/mmHg, for the `augmentation` tap only (0: tap reads 0).
   */
  constructor(name: string, private readonly dao: NodeId, private readonly compliance = 0, cfg: Partial<IabpParams> = {}) {
    this.name = name;
    this.params = { ratio: 1, inflateMs: 0, deflateMs: 0, volumeMl: IABP.volumeMl, ...cfg };
    this.rr = IABP.defaultRrS;
    this.clamp();
  }
  /** `fromModel`'s way in: the DAO node and its compliance come from the model. */
  static forModel(m: Model, cfg: Partial<IabpParams> = {}, name = "iabp"): Iabp {
    const dao = NODES.indexOf("DAO");
    return new Iabp(name, dao, m.comp[dao], cfg);
  }

  bind(offset: number) { this.idx = offset; }
  private clamp() {
    const p = this.params;
    p.ratio = Math.min(3, Math.max(1, Math.round(Number.isFinite(p.ratio) ? p.ratio : 1)));
    p.volumeMl = Math.min(50, Math.max(0, Number.isFinite(p.volumeMl) ? p.volumeMl : IABP.volumeMl));
    p.inflateMs = Number.isFinite(p.inflateMs) ? Math.min(150, Math.max(-150, p.inflateMs)) : 0;
    p.deflateMs = Number.isFinite(p.deflateMs) ? Math.min(150, Math.max(-150, p.deflateMs)) : 0;
  }
  set(patch: Partial<IabpParams>) { Object.assign(this.params, patch); this.clamp(); }

  /** Watch the AV flow to measure the closure delay (see class comment). The engine calls this when it is built. */
  attach(engine: Engine) {
    this.off?.();
    this.off = engine.onSample((s) => {
      if (!this.watching) return;
      const age = s.t - this.tEvent;
      if (age > 0.8 * this.rr + 0.2) { this.watching = false; return; }
      const q = s.q.AV;
      if (q === undefined) { this.watching = false; return; }
      if (q > IABP.openFlow) this.opened = true;
      else if (this.opened && q < IABP.closedFlow) {
        this.watching = false;
        if (this.curOn > s.t) this.learn(age);
      }
    });
  }
  private learn(delay: number) {
    this.delay = Number.isFinite(this.delay) ? this.estimate(this.rr) * (1 - IABP.smooth) + delay * IABP.smooth : delay;
    this.delayRr = this.rr;
  }
  /** Predicted R wave to valve closure delay, s, for a beat preceded by `rr`. */
  private estimate(rr: number): number {
    return Number.isFinite(this.delay) ? this.delay * Math.sqrt(rr / this.delayRr) : IABP.closeBase + IABP.closePerRr * rr;
  }
  /** The estimate of the R wave to aortic valve closure delay now, s (what correct timing inflates at). */
  get closureDelay(): number { return this.estimate(this.rr); }

  onEvent(ev: HeartEvent) {
    if (ev.kind !== "ventricular") return;
    const p = this.params;
    if (Number.isFinite(this.tEvent) && ev.t > this.tEvent) this.rr = ev.t - this.tEvent;
    // a window still open at this R wave: deflate on the trigger (plus a late offset, if one is set)
    for (const w of this.windows) w.off = Math.min(w.off, ev.t + Math.max(0, p.deflateMs) / 1000);
    this.tEvent = ev.t; this.beats++;
    this.watching = this.off !== null; this.opened = false;
    this.assisted = (this.beats - 1) % p.ratio === 0;
    this.windows = this.windows.filter((w) => w.off > ev.t - 0.5);
    this.curOn = Infinity;
    if (this.assisted) {
      const on = ev.t + this.estimate(this.rr) + p.inflateMs / 1000;
      const off = ev.t + this.rr - IABP.deflateLeadS + p.deflateMs / 1000;
      if (off > on) { this.windows.push({ on, off }); this.curOn = on; }
    }
  }

  private w(t: number): number {
    let m = 0;
    for (const x of this.windows) { const v = smooth((t - x.on) / IABP.edgeS) - smooth((t - x.off) / IABP.edgeS); if (v > m) m = v; }
    return Math.min(1, Math.max(0, m));
  }
  private target(t: number): number { return this.params.volumeMl * this.w(t); }

  field(ctx: Ctx, out: Rates) { out.shiftVolume(this.dao, ctx.y[this.idx]); }
  flow(ctx: Ctx, out: Rates) {
    const vb = ctx.y[this.idx], tg = this.target(ctx.t);
    out.rate(this.idx, (tg - vb) / (tg >= vb ? IABP.tauInflateS : IABP.tauDeflateS));
  }
  taps(ctx: Ctx): Record<string, number> {
    const vb = ctx.y[this.idx], tg = this.target(ctx.t), full = this.params.volumeMl, tol = 0.03 * Math.max(full, 1e-9);
    const phase = Math.abs(tg - vb) <= tol ? (tg > 0.5 * full ? IABP_PHASE.inflated : IABP_PHASE.deflated) : tg > vb ? IABP_PHASE.inflating : IABP_PHASE.deflating;
    return { vb, target: tg, fill: full > 0 ? vb / full : 0, phase, assisted: this.assisted ? 1 : 0, augmentation: this.compliance > 0 ? vb / this.compliance : 0, closure: this.estimate(this.rr), beat: this.beats };
  }
  dispose() { this.off?.(); this.off = null; }
}
