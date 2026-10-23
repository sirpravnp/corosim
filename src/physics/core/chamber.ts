import { ACTIVATION as A } from "../../config/structural";
import type { HeartEvent, NodeModel, Tunable } from "./types";

/** Atrial activation timing for beat period T (s): duration ta and the PR-like lead pr; the atrial event leads the ventricular one by ta + pr. */
export function atrialTiming(T: number): { ta: number; pr: number } {
  return { ta: Math.min(A.taBase * Math.sqrt(T / A.taRefT), A.taMaxFrac * T), pr: A.prBase + A.prPerT * T };
}

// One-entry memo: both ventricles ask for the same (T, tau) back to back in every derivative evaluation.
let memoT = NaN, memoTau = NaN, memoVal = 0;
/** Double-Hill ventricular activation (unnormalised) at time `tau` (s) after the event, for beat period T: rises over about Tmax, falls by about 1.2 Tmax. */
export function ventShape(T: number, tau: number): number {
  if (T === memoT && tau === memoTau) return memoVal;
  const tMax = A.tMaxCoef * Math.pow(T, A.tMaxExp), a1 = A.a1Frac * tMax, a2 = A.a2Frac * a1;
  const r = Math.pow(tau / a1, A.n1);
  memoVal = (r / (1 + r)) / (1 + Math.pow(tau / a2, A.n2)); memoT = T; memoTau = tau;
  return memoVal;
}

/** Elastance law of a chamber: passive a·(e^{b(V−V0)}−1), active Ees·(V−V0)⁺. Volumes ml, pressures mmHg, Ees mmHg/ml. */
export interface ElastanceParams { v0: number; ees: number; a: number; b: number }
export type ChamberKind = "ventricular" | "atrial";

/**
 * Time-varying elastance chamber: P = (1−e)·a·(exp(min(b·x,30))−1) + e·Ees·max(x,0), x = V − V0, with the activation
 * e ∈ [0,1] a function of the time since this chamber's last event (scaled by the event's strength):
 *  - ventricular: ventShape(T, τ)/peak, T the beat period (a parameter until A4 makes it event-driven);
 *  - atrial: sin(πτ/ta) for 0 ≤ τ ≤ ta, else 0.
 * Before its first event the chamber is passive.
 */
export class ElastanceChamber implements NodeModel, Tunable<ElastanceParams> {
  readonly params: ElastanceParams;
  /** Absolute time of the last event, s. */
  private tEvent = -Infinity;
  private strength = 1;
  private readonly peak: number;
  constructor(readonly name: string, params: ElastanceParams, readonly kind: ChamberKind, private readonly T: number, private readonly ta: number = 0) {
    this.params = { v0: params.v0, ees: params.ees, a: params.a, b: params.b };
    let top = 0;
    if (kind === "ventricular") for (let i = 0; i <= A.peakSamples; i++) top = Math.max(top, ventShape(T, (i / A.peakSamples) * T));
    this.peak = top;
  }
  set(patch: Partial<ElastanceParams>) { Object.assign(this.params, patch); }
  onEvent(ev: HeartEvent) { if (ev.kind === this.kind) { this.tEvent = ev.t; this.strength = ev.strength ?? 1; } }
  /** Activation in [0, strength] at time t. */
  activation(t: number): number {
    const tau = Math.max(0, t - this.tEvent);
    if (this.kind === "atrial") return tau <= this.ta ? this.strength * Math.sin((Math.PI * tau) / this.ta) : 0;
    return tau === Infinity ? 0 : (this.strength * ventShape(this.T, tau)) / this.peak;
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
