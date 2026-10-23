import { ACTIVATION as A } from "../../config/structural";
import type { HeartEvent, NodeModel, Tunable } from "./types";

/** Duration ta (s) of atrial activation after an atrial event that follows the previous one by `interval` s (the preceding atrial interval). */
export function atrialDuration(interval: number): number {
  return Math.min(A.taBase * Math.sqrt(interval / A.taRefT), A.taMaxFrac * interval);
}

/** The double-Hill ventricular activation (unnormalised, Stergiopulos) shaped for one RR interval; its peak is found once per RR. */
class VentCurve {
  rr = NaN; tPeak = 0; peak = 1;
  private a1 = 0; private a2 = 0;
  /** Set up the curve for preceding RR interval `rr` (s): Tmax = tMaxCoef·rr^tMaxExp, a1 = a1Frac·Tmax, a2 = a2Frac·a1. Cached per RR. */
  setRR(rr: number) {
    if (Math.abs(rr - this.rr) < 1e-9) return;
    this.rr = rr;
    const tMax = A.tMaxCoef * Math.pow(rr, A.tMaxExp);
    this.a1 = A.a1Frac * tMax; this.a2 = A.a2Frac * this.a1;
    let top = 0, at = 0;
    for (let i = 0; i <= A.peakSamples; i++) { const x = this.raw((i / A.peakSamples) * rr); if (x > top) { top = x; at = (i / A.peakSamples) * rr; } }
    this.peak = top; this.tPeak = at;
  }
  /** Unnormalised value at `tau` s after the event: [r/(1+r)]·[1/(1+(tau/a2)^n2)], r = (tau/a1)^n1. */
  raw(tau: number): number {
    const r = Math.pow(tau / this.a1, A.n1);
    return (r / (1 + r)) / (1 + Math.pow(tau / this.a2, A.n2));
  }
}

/**
 * Elastance law of a chamber: passive a·(e^{b(V−V0)}−1), active Ees·(V−V0)⁺. Volumes ml, pressures mmHg, Ees mmHg/ml.
 * `relaxScale` (ventricles, dimensionless, default 1 = the unmodified curve, normal range 0.8-2) stretches the falling limb of
 * activation (time after its peak) by that factor: > 1 is slower relaxation (impaired lusitropy), contraction is unchanged.
 */
export interface ElastanceParams { v0: number; ees: number; a: number; b: number; relaxScale?: number }
export type ChamberKind = "ventricular" | "atrial";

/**
 * Time-varying elastance chamber: P = (1−e)·a·(exp(min(b·x,30))−1) + e·Ees·max(x,0), x = V − V0, with the activation
 * e ∈ [0,1] a function of the time since this chamber's last event (scaled by the event's strength); the chamber knows no beat period:
 *  - ventricular: double-Hill curve of the time τ since the event, normalised by its peak, with its time scale set by the RR
 *    interval preceding the event (this event minus the previous ventricular one; `defaultInterval` for the first). Shorter RR
 *    gives shorter contraction (a QT-like rate rule); at a steady rate it equals the old fixed-T curve. For τ after the peak
 *    time tp, τ is replaced by tp + (τ − tp)/relaxScale;
 *  - atrial: sin(πτ/ta) for 0 ≤ τ ≤ ta, else 0, with ta from the preceding atrial interval (`atrialDuration`).
 * Before its first event the chamber is passive.
 */
export class ElastanceChamber implements NodeModel, Tunable<ElastanceParams> {
  readonly params: ElastanceParams;
  /** Absolute time of the last event, s. */
  private tEvent = -Infinity;
  private strength = 1;
  private readonly curve = new VentCurve();
  private ta: number;
  /** `defaultInterval`: the preceding interval assumed for the first event (s). */
  constructor(readonly name: string, params: ElastanceParams, readonly kind: ChamberKind, private readonly defaultInterval: number) {
    this.params = { v0: params.v0, ees: params.ees, a: params.a, b: params.b, relaxScale: params.relaxScale ?? 1 };
    this.ta = atrialDuration(defaultInterval);
    if (kind === "ventricular") this.curve.setRR(defaultInterval);
  }
  set(patch: Partial<ElastanceParams>) { Object.assign(this.params, patch); }
  /** Ventricles: time (s) after the event at which activation peaks, for the current RR (the falling limb, stretched by `relaxScale`, starts here). */
  get peakTime(): number { return this.curve.tPeak; }
  onEvent(ev: HeartEvent) {
    if (ev.kind !== this.kind) return;
    const interval = this.tEvent === -Infinity ? this.defaultInterval : ev.t - this.tEvent;
    if (this.kind === "atrial") this.ta = atrialDuration(interval); else this.curve.setRR(interval);
    this.tEvent = ev.t; this.strength = ev.strength ?? 1;
  }
  /** Activation in [0, strength] at time t. */
  activation(t: number): number {
    let tau = Math.max(0, t - this.tEvent);
    if (this.kind === "atrial") return tau <= this.ta ? this.strength * Math.sin((Math.PI * tau) / this.ta) : 0;
    if (tau === Infinity) return 0;
    const c = this.curve, rs = this.params.relaxScale!;
    if (rs !== 1 && tau > c.tPeak) tau = c.tPeak + (tau - c.tPeak) / rs;
    return (this.strength * c.raw(tau)) / c.peak;
  }
  pressure(volume: number, t: number): number {
    const { v0, ees, a, b } = this.params, e = this.activation(t), x = volume - v0;
    return (1 - e) * a * (Math.exp(Math.min(b * x, 30)) - 1) + e * ees * Math.max(x, 0);
  }
}

/** Linear compliance (vessel): P = V / C, C in ml/mmHg. */
export class Compliance implements NodeModel, Tunable<{ C: number }> {
  readonly params: { C: number };
  constructor(readonly name: string, C: number) { this.params = { C }; }
  set(patch: Partial<{ C: number }>) { Object.assign(this.params, patch); }
  pressure(volume: number): number { return volume / this.params.C; }
}
