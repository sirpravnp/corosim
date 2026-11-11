import { V3 } from "../anatomy/curve";
import { Part } from "../anatomy/heartSurface";
import { ctToHeart } from "../anatomy/ctHeart";
import { Pose, toHeart, toPatient } from "./poses";
import { ctHeart, ctGeom } from "./ctEcho";
import { EchoBeat, frameAt } from "./beat";
import { acquire, EchoWindow } from "./scan";
import { FrameSample, Tissue, classifyFrame } from "./tissue";
import { rasterize, frameFor } from "./paint";
import { aimAt } from "./doppler";

/**
 * Measurements a sonographer makes on the 2D and M-mode images, made here on the simulated anatomy:
 *
 * - M-mode: one scan line held still while the heart moves under it, drawn over time. Through the LV at the mitral chordal level in
 *   the parasternal long axis, its calipers give the septal and posterior wall thickness and the LV internal diameter at end-diastole
 *   and end-systole, fractional shortening, and volumes and EF by the Teichholz formula (V = 7 D^3 / (2.4 + D), D in cm).
 * - Simpson's biplane (the method of discs): the LV cavity traced at end-diastole and end-systole in the apical four- and two-chamber
 *   views, cut into 20 discs along its long axis; V = pi / 4 * sum(a_i b_i) * L / 20. The guideline method for LV volumes and EF.
 * Both read the classified anatomy at the moment measured, as a careful sonographer's trace would, not the engine's volumes; tests check
 * the two agree.
 */

// ---- M-mode ---------------------------------------------------------------------------------------------------------------------
export interface MMode {
  /** Display values 0..1: columns (time) by samples (depth), row-major by sample. */
  img: Float32Array; columns: number; samples: number;
  dr: number; dt: number; depth: number;
}

/** The M-mode line through the LV centre line at a fraction of the way from the apex to the base (0.72: the chordal level). */
export function mLineFor(pose: Pose, level = 0.72): { lineAngle: number; gateDepth: number } {
  const g = ctGeom()!, h = ctHeart()!;
  return aimAt(pose, toPatient(ctToHeart(h, g.point(level * g.length, 0, 0, [0, 0, 0]))));
}

/** Acquire an M-mode strip: `beats` beats at `perBeat` columns each, along the line at `lineAngle`. */
export function mmode(beat: EchoBeat, pose: Pose, lineAngle: number, depth: number, opts: { beats?: number; perBeat?: number; window?: EchoWindow } = {}): MMode {
  const beats = opts.beats ?? 2, per = opts.perBeat ?? 150, cols = beats * per, dt = beat.period / per;
  let img: Float32Array | null = null, samples = 0, dr = 0;
  for (let c = 0; c < cols; c++) {
    const p = acquire(pose, depth, { heart: beat.heart, frame: frameAt(beat, c * dt) }, { lineAngles: [lineAngle], window: opts.window ?? "parasternal", frameNo: c });
    if (!img) { samples = p.samples; dr = p.dr; img = new Float32Array(cols * samples); }
    for (let j = 0; j < samples; j++) img[j * cols + c] = p.img[j];
  }
  return { img: img!, columns: cols, samples, dr, dt, depth };
}

export interface LinearDims { ivs: number; lvid: number; lvpw: number }
export interface MModeReport {
  diastole: LinearDims; systole: LinearDims;
  /** Fractional shortening (%), and Teichholz volumes (ml) and EF (%). */
  fs: number; edv: number; esv: number; ef: number;
}
const teichholz = (dMm: number) => { const d = dMm / 10; return (7 * d ** 3) / (2.4 + d); };

/** Wall and cavity along the M-mode line at one moment, mm: septum, LV cavity, posterior wall. */
function linear(beat: EchoBeat, pose: Pose, lineAngle: number, t: number): LinearDims {
  const fr = frameAt(beat, t), ca = Math.cos(lineAngle), sa = Math.sin(lineAngle);
  const dir: V3 = [pose.beam[0] * ca + pose.lateral[0] * sa, pose.beam[1] * ca + pose.lateral[1] * sa, pose.beam[2] * ca + pose.lateral[2] * sa];
  const hit: FrameSample = { tissue: Tissue.Outside, part: null, sdf: 0, ref: [0, 0, 0] }, step = 0.25, kind: string[] = [];
  for (let d = 0; d < pose.depth; d += step) {
    classifyFrame(toHeart([pose.probe[0] + dir[0] * d, pose.probe[1] + dir[1] * d, pose.probe[2] + dir[2] * d]), beat.heart, fr, hit);
    const lvCav = hit.part === Part.LV && (hit.tissue === Tissue.Blood || hit.tissue === Tissue.Papillary || hit.tissue === Tissue.Leaflet);
    const lvWall = hit.part === Part.LV && (hit.tissue === Tissue.Myocardium || hit.tissue === Tissue.Septum || hit.tissue === Tissue.Scar);
    kind.push(lvCav ? "c" : lvWall ? "w" : "o");
  }
  // the longest LV cavity run, the LV wall just before it (septum) and just after it (posterior wall)
  let best = [0, -1], i = 0;
  while (i < kind.length) { if (kind[i] !== "c") { i++; continue; } let j = i; while (j < kind.length && kind[j] === "c") j++; if (j - i > best[1] - best[0]) best = [i, j]; i = j; }
  if (best[1] < 0) return { ivs: 0, lvid: 0, lvpw: 0 };
  let a = best[0] - 1; while (a >= 0 && kind[a] === "w") a--;
  let b = best[1]; while (b < kind.length && kind[b] === "w") b++;
  return { ivs: (best[0] - 1 - a) * step, lvid: (best[1] - best[0]) * step, lvpw: (b - best[1]) * step };
}

export function mmodeMeasures(beat: EchoBeat, pose: Pose, lineAngle: number): MModeReport {
  const d = linear(beat, pose, lineAngle, beat.frames[beat.ed].t), s = linear(beat, pose, lineAngle, beat.frames[beat.es].t);
  const edv = teichholz(d.lvid), esv = teichholz(s.lvid);
  return { diastole: d, systole: s, fs: d.lvid > 0 ? (100 * (d.lvid - s.lvid)) / d.lvid : 0, edv, esv, ef: edv > 0 ? (100 * (edv - esv)) / edv : 0 };
}

// ---- Simpson's biplane ----------------------------------------------------------------------------------------------------------
export interface Trace { discs: number[]; length: number; area: number }

/** The LV cavity in one apical view at one moment: disc diameters (mm, 20 discs apex to base), the long-axis length (mm), the area (mm^2). */
export function traceLv(beat: EchoBeat, pose: Pose, t: number, discs = 20): Trace {
  const w = 150, h = 170, frame = frameFor(pose, w / h), r = rasterize(pose, w, h, frame, { heart: beat.heart, frame: frameAt(beat, t) });
  const pts: [number, number][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (r.part[i] === Part.LV && (r.tissue[i] === Tissue.Blood || r.tissue[i] === Tissue.Papillary)) pts.push([(x - w / 2) / r.px, y / r.px]);
  }
  if (pts.length < 20) return { discs: new Array(discs).fill(0), length: 0, area: 0 };
  // the long axis: the cavity's principal axis; the apex is its end nearest the probe
  let mx = 0, my = 0; for (const [x, y] of pts) { mx += x; my += y; } mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0; for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
  const along = pts.map(([x, y]) => (x - mx) * ux + (y - my) * uy), across = pts.map(([x, y]) => -(x - mx) * uy + (y - my) * ux);
  const lo = Math.min(...along), hi = Math.max(...along), L = hi - lo, cell = 1 / (r.px * r.px);
  const widths = new Array(discs).fill(0), mins = new Array(discs).fill(Infinity), maxs = new Array(discs).fill(-Infinity);
  for (let k = 0; k < pts.length; k++) {
    const d = Math.min(discs - 1, Math.floor(((along[k] - lo) / L) * discs));
    mins[d] = Math.min(mins[d], across[k]); maxs[d] = Math.max(maxs[d], across[k]); widths[d] += cell;
  }
  // each disc's diameter: its area in the image over its thickness (robust to a ragged edge)
  const slab = L / discs;
  return { discs: widths.map((a) => a / slab), length: L, area: pts.length * cell };
}

export interface SimpsonReport { edv: number; esv: number; ef: number; ed: { a4c: Trace; a2c: Trace }; es: { a4c: Trace; a2c: Trace } }

/** Biplane volumes (ml) and EF (%) from the apical four- and two-chamber views. */
export function simpsonBiplane(beat: EchoBeat, poses: Record<string, Pose>): SimpsonReport {
  const vol = (a: Trace, b: Trace) => { const L = Math.max(a.length, b.length), n = a.discs.length; let s = 0; for (let i = 0; i < n; i++) s += a.discs[i] * b.discs[i]; return ((Math.PI / 4) * s * (L / n)) / 1000; };
  const tEd = beat.frames[beat.ed].t, tEs = beat.frames[beat.es].t;
  const ed = { a4c: traceLv(beat, poses.a4c, tEd), a2c: traceLv(beat, poses.a2c, tEd) }, es = { a4c: traceLv(beat, poses.a4c, tEs), a2c: traceLv(beat, poses.a2c, tEs) };
  const edv = vol(ed.a4c, ed.a2c), esv = vol(es.a4c, es.a2c);
  return { edv, esv, ef: edv > 0 ? (100 * (edv - esv)) / edv : 0, ed, es };
}
