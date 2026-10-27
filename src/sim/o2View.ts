/**
 * Colour logic of the Simulator's "O₂ sat" 3D mode (task P9). DOM-free; app.ts only applies the colours.
 *
 * - Coronary arteries: arterial saturation (pre-ductal, else the AO node) on the structural page's scale (`satColor`,
 *   60 % blue to 98 % red). A right-to-left shunt lowers it everywhere.
 * - Myocardium: tissue oxygenation per coronary bed (`Saturations.bed`, keyed by the ischemia site key, e.g. "LAD#0",
 *   the same keys `sim.sites` / `sim.sev` use, so no mapping is needed). Tissue O2 is NOT blood saturation, so it has its
 *   own scale: relative to the patient's normal, rel = (bed - floor) / (normal - floor) clamped to 0..1, drawn with the
 *   same blue-to-red colours (rel 0 = fully ischemic floor = blue, rel 1 = normal = red). While the value is the
 *   ischemia-derived placeholder, normal = LIVE_SOURCE.bedOxygen.base and floor = base - slope (severity 1). When E2/E3
 *   supply real per-bed values, pass their own normal and floor to `o2Frame`. Each ventricular vertex mixes its nearest
 *   beds by the weights the ischemia painting already uses.
 * - Before the first beat every value is NaN: grey, with a "waiting" legend note.
 */
import { SAT_RANGE, legendGradient, satColor } from "../structural/heartView";
import { LIVE_SOURCE } from "../config/liveSource";
import type { Saturations } from "./hemoSource";
import type * as THREE from "three";

export interface O2Frame {
  /** False before the first solve (no finite arterial saturation). */
  ready: boolean;
  /** Arterial (pre-ductal) saturation 0..1; NaN until ready. */
  arterial: number;
  /** Tissue oxygenation 0..1 per bed key. */
  bed: Record<string, number>;
  source: Saturations["bedSource"];
  /** Tissue O2 of a healthy bed and of a fully ischemic one (same units as `bed`). */
  normal: number;
  floor: number;
}

/** Tissue O2 relative to normal: 0 at the ischemic floor, 1 at normal. */
export function tissueRelative(f: O2Frame, t: number): number {
  return Math.min(1, Math.max(0, (t - f.floor) / (f.normal - f.floor)));
}

export function o2Frame(s: Saturations, normal = LIVE_SOURCE.bedOxygen.base, floor = LIVE_SOURCE.bedOxygen.base - LIVE_SOURCE.bedOxygen.slope): O2Frame {
  const arterial = Number.isFinite(s.preductal) ? s.preductal : s.node?.AO ?? NaN;
  return { ready: Number.isFinite(arterial), arterial: Number.isFinite(arterial) ? arterial : NaN, bed: s.bed, source: s.bedSource, normal, floor };
}

/** Vessel colour: arterial saturation, grey while waiting. */
export function vesselO2Color(f: O2Frame, out: THREE.Color): THREE.Color {
  return satColor(f.ready ? f.arterial : NaN, out);
}

/** Weighted tissue oxygenation over beds; beds without a value (e.g. nodal sites) are skipped. NaN if none count. */
export function tissueO2(f: O2Frame, keys: ArrayLike<string>, w: ArrayLike<number>): number {
  let sum = 0, tot = 0;
  for (let i = 0; i < keys.length; i++) {
    const v = f.bed[keys[i]];
    if (Number.isFinite(v) && w[i] > 0) { sum += w[i] * v; tot += w[i]; }
  }
  return tot > 0 ? sum / tot : NaN;
}

/** Myocardium colour of a ventricular vertex: its beds' tissue O₂, faded to the plain muscle colour where no bed is near (`cover` 0..1). */
export function myocardiumO2Color(f: O2Frame, keys: ArrayLike<string>, w: ArrayLike<number>, cover: number, base: THREE.Color, out: THREE.Color): THREE.Color {
  const t = f.ready ? tissueO2(f, keys, w) : NaN;
  if (!Number.isFinite(t)) return satColor(NaN, out);
  satColor(SAT_RANGE.lo + tissueRelative(f, t) * (SAT_RANGE.hi - SAT_RANGE.lo), out); // relative scale, same colours
  return out.lerp(base, 1 - Math.min(1, Math.max(0, cover)));
}

export interface LegendRow { gradient: string; lo: string; mid: string; hi: string }
/** Two rows: blood SaO2 (vessels) and tissue O2 relative to normal (myocardium), plus one note. */
export interface O2Legend { blood: LegendRow; tissue: LegendRow; note: string }
export function o2Legend(f: O2Frame): O2Legend {
  const g = legendGradient();
  const note = !f.ready ? "waiting for the first solve" : f.source === "ischemia-derived" ? "tissue O₂ estimated from ischemia" : "";
  return {
    blood: { gradient: g, lo: `${Math.round(SAT_RANGE.lo * 100)} %`, mid: "blood SaO₂", hi: `${Math.round(SAT_RANGE.hi * 100)} %` },
    tissue: { gradient: g, lo: "ischemic", mid: "tissue O₂", hi: "normal" },
    note,
  };
}
