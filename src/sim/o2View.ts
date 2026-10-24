/**
 * Colour logic of the Simulator's "O₂ sat" 3D mode (task P9). DOM-free; app.ts only applies the colours.
 *
 * - Coronary arteries: arterial saturation (pre-ductal, else the AO node) on the structural page's scale (`satColor`,
 *   60 % blue to 98 % red). A right-to-left shunt lowers it everywhere.
 * - Myocardium: tissue oxygenation per coronary bed (`Saturations.bed`, keyed by the ischemia site key, e.g. "LAD#0",
 *   the same keys `sim.sites` / `sim.sev` use, so no mapping is needed) on the same scale. Each ventricular vertex mixes
 *   its nearest beds by the weights the ischemia painting already uses.
 * - Before the bridge's first solve every value is NaN: grey, with a "waiting" legend note.
 */
import { SAT_RANGE, legendGradient, satColor } from "../structural/heartView";
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
}

export function o2Frame(s: Saturations): O2Frame {
  const arterial = Number.isFinite(s.preductal) ? s.preductal : s.node?.AO ?? NaN;
  return { ready: Number.isFinite(arterial), arterial: Number.isFinite(arterial) ? arterial : NaN, bed: s.bed, source: s.bedSource };
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
  satColor(t, out);
  return out.lerp(base, 1 - Math.min(1, Math.max(0, cover)));
}

export interface O2Legend { gradient: string; lo: string; mid: string; hi: string }
export function o2Legend(f: O2Frame): O2Legend {
  const lo = `${Math.round(SAT_RANGE.lo * 100)} %`, hi = `${Math.round(SAT_RANGE.hi * 100)} %`;
  const note = !f.ready ? "waiting for the first solve" : f.source === "ischemia-derived" ? "tissue O₂ estimated from ischemia" : "";
  return { gradient: legendGradient(), lo, mid: note, hi };
}
