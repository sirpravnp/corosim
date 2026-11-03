/**
 * The derivations behind the Oxygen panel (task P10), DOM-free so tests can check them. Inputs are the source's
 * `Saturations`, `HemoNumbers` and `devices()`; the source's values are shown as given, only the ratios and cues are derived.
 * Saturations 0..1, DO2 and VO2 ml O2/min, lactate mmol/L, extraction unitless.
 */
import { OXYGEN_PANEL as CFG } from "../config/oxygenPanel";
import type { DeviceConsole, HemoNumbers, Saturations } from "./hemoSource";

/** O2 extraction ratio VO2 / DO2 (0..1); NaN when either is unavailable or DO2 is not positive. */
export function extractionRatio(vo2: number, do2: number): number {
  return Number.isFinite(vo2) && Number.isFinite(do2) && do2 > 0 ? vo2 / do2 : NaN;
}

export interface DuctalDifference {
  /** Pre minus post, percentage points; NaN if either is missing. */
  points: number;
  /** True when pre exceeds post by more than the configured threshold (differential hypoxemia: the lower body is the more desaturated). */
  significant: boolean;
  /** Short explanation when significant, else "". */
  explanation: string;
}

/**
 * Pre-ductal (right hand) against post-ductal (foot) saturation. Only a pre > post gap is called: post > pre (reverse
 * differential) is shown as a number but not explained as ductal shunting.
 */
export function ductalDifference(pre: number, post: number): DuctalDifference {
  if (!Number.isFinite(pre) || !Number.isFinite(post)) return { points: NaN, significant: false, explanation: "" };
  const points = (pre - post) * 100;
  const significant = points > CFG.ductalDiffPoints;
  return {
    points, significant,
    explanation: significant
      ? "The lower body is less saturated than the right hand. Causes: ductal right-to-left shunting (high pulmonary resistance), or VA-ECMO differential hypoxemia (the native heart perfuses the upper body with poorly oxygenated lung blood)."
      : "",
  };
}

/** Teaching cues as plain words, in a fixed order. Missing (NaN) inputs raise no cue. */
export function teachingCues(s: Pick<Saturations, "spo2" | "svo2" | "do2" | "vo2">): string[] {
  const out: string[] = [];
  if (s.svo2 < CFG.svo2Low) out.push("Low mixed venous saturation: delivery not meeting demand.");
  if (extractionRatio(s.vo2, s.do2) > CFG.extractionHigh) out.push("High oxygen extraction: the tissues are taking more of the delivered oxygen than usual.");
  if (s.spo2 < CFG.spo2Low) out.push("Low SpO₂: hypoxemia.");
  return out;
}

/** Scale a pressure trace to 0..1 by its own min and max (a pleth shows shape, not mmHg). A flat or empty trace gives 0.5 (flat line); NaN samples stay NaN. */
export function plethFromPressure(v: ArrayLike<number>): Float32Array {
  const out = new Float32Array(v.length);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) { lo = Math.min(lo, v[i]); hi = Math.max(hi, v[i]); }
  const span = hi - lo;
  for (let i = 0; i < v.length; i++) out[i] = !Number.isFinite(v[i]) ? NaN : span > 1e-6 ? (v[i] - lo) / span : 0.5;
  return out;
}

/** An ECMO console's return (post-oxygenator) saturation 0..1, or NaN with no ECMO console or no such reading (`returnSat`). */
export function ecmoReturnSat(devices: readonly DeviceConsole[]): number {
  const d = devices.find(x => x.id === "ecmo");
  if (!d) return NaN;
  const v = d.readings.returnSat ?? d.readings.returnSaturation;
  return typeof v === "number" ? v : NaN;
}

export interface OxygenReadout {
  /** False before the first solve (no finite SpO2). */
  ready: boolean;
  spo2: number; pre: number; post: number; svo2: number;
  diff: DuctalDifference;
  do2: number; vo2: number; extraction: number; qpQs: number;
  /** NaN until oxygen-in-time (E6). */
  lactate: number;
  /** NaN when there is no ECMO console. */
  ecmoReturn: number; hasEcmo: boolean;
  cues: string[];
}

export function oxygenReadout(s: Saturations, n: Pick<HemoNumbers, "qpQs">, devices: readonly DeviceConsole[]): OxygenReadout {
  const hasEcmo = devices.some(d => d.id === "ecmo");
  const ready = Number.isFinite(s.spo2) || Number.isFinite(s.preductal);
  return {
    ready, spo2: s.spo2, pre: s.preductal, post: s.postductal, svo2: s.svo2,
    diff: ductalDifference(s.preductal, s.postductal),
    do2: s.do2, vo2: s.vo2, extraction: extractionRatio(s.vo2, s.do2), qpQs: n.qpQs, lactate: s.lactate,
    ecmoReturn: ecmoReturnSat(devices), hasEcmo,
    cues: ready ? teachingCues(s) : [],
  };
}
