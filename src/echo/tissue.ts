import { V3 } from "../anatomy/curve";
import { HeartMorph, MorphPart, Part, classifyHeart, parts, partsMorph, septalDistance, smin } from "../anatomy/heartSurface";
import { isWall, WALL_MM } from "./wall";
import {
  LV, E1, E2, LvPoint, MITRAL, TRICUSPID, LV_LENGTH, NORMAL_VALVE, ValveLook,
  lvEpiDistance, lvFrame, onAorticCusp, onAtrioventricularLeaflet, papillaryDistance,
} from "./anatomy";
import { ContractionMap, FrameMotion, STILL, WarpShape, contractionMap, schematicGeom, segmentAt, wallAt, warp } from "./motion";
import { organicWarp, patchiness, roughness } from "./organic";
import { CtSample, classifyCt, ctGeom } from "./ctEcho";



/**
 * The echo anatomy: what a point of the heart is, as an ultrasound beam would meet it. Separate from the 3D display heart
 * (`heartSdf`), which the sim, the coronary tree and the 3D pane keep using unchanged. Only slicing reads this.
 * Heart frame, mm (x left, y along the long axis toward the base, z anterior): the frame `toHeart` in poses.ts returns.
 *
 * Two entry points. `classifyEcho(p, phase)` is the resting normal heart at one valve opening. `classifyFrame(p, heart, frame)` is a
 * patient's heart (`EchoHeart`: chamber sizes from the structural engine, wall thickness, scar, valve disease, effusion, septal defect)
 * at one moment of the beat (`EchoFrame`: how far it has contracted, how open each valve is).
 */
export enum Tissue {
  Outside = 0,
  /** Blood pool of the chamber named by `part`. */
  Blood = 1,
  /** Free wall of a ventricle or atrium, and the vessel walls. */
  Myocardium = 2,
  /** Interventricular septum. */
  Septum = 3,
  /** Valve leaflet or cusp. */
  Leaflet = 4,
  /** Papillary muscle. */
  Papillary = 5,
  /** Pericardium: the bright line behind the heart. */
  Pericardium = 6,
  /** Pericardial effusion: fluid between the heart and the pericardium. */
  Fluid = 7,
  /** Calcified leaflet: very bright, and it shadows what lies behind it. */
  Calcium = 8,
  /** Infarct scar: a thin, bright wall that does not thicken. */
  Scar = 9,
}

export interface EchoSample {
  tissue: Tissue;
  /** Chamber or vessel the point belongs to (a `MorphPart`; its first five values are `Part`), null outside the heart. */
  part: Part | null;
  /** Signed distance to the display heart's outer surface, mm (negative inside). */
  sdf: number;
}

/** Everything that is not blood, fluid or empty is something the beam reflects from. */
export const isSolidTissue = (t: Tissue) => t !== Tissue.Outside && t !== Tissue.Blood && t !== Tissue.Fluid;

/**
 * Pericardium: a thin bright line this far outside the display heart's outer surface. `center` is the sdf at the middle of the line, `thick` its
 * thickness in mm. The display field's gradient is not 1 everywhere (the fillets flatten it), so the band in sdf is scaled by the local gradient
 * to keep the line the same thickness in space.
 */
export const PERICARDIUM = { center: 4.2, thick: 1.2, from: 3.5, to: 5 };
const GRAD_STEP = 1.0;

/** A patient's heart as the echo draws it. Build with `makeHeart`. */
export interface EchoHeart {
  /** The display heart reshaped by the structural engine's volumes (src/structural/morph.ts); null is the plain display heart. */
  morph: HeartMorph | null;
  /** Linear size of the LV against the normal echo LV, about `LV_SCALE_CENTER`. */
  lvScale: number;
  /** Diastolic wall thickness, mm: LV free wall, septum (thicker in asymmetric hypertrophy), RV free wall. */
  lvWall: number; septum: number; rvWall: number;
  /** Pericardial effusion: depth of the fluid layer, mm. */
  effusion: number;
  /** Secundum atrial septal defect: diameter, mm (0 = intact). */
  asdMm: number;
  valves: { mv: ValveLook; av: ValveLook; tv: ValveLook };
  /** Infarct scar per segment (17-segment model), 0..1. */
  scar: number[];
  /** Contraction share per segment (1 normal, 0.5 hypokinetic, 0 akinetic, below 0 dyskinetic). */
  wma: number[];
  /**
   * How irregular the anatomy is, 0..1 (organic.ts): 0 is the exact schematic shapes (the labeled ideal slice), 1 adds the lumpiness,
   * trabeculation and wall-thickness variation of a real heart (the echo image).
   */
  organic: number;
  /** "ct": the CT-derived heart (ctEcho.ts), used whenever it is installed; "schematic": the display heart, the fallback. */
  anatomy: "ct" | "schematic";
  /** Linear scales of the RV, RA and LA against normal (CT anatomy). */
  chamberScale: { rv: number; ra: number; la: number };
  /** Derived: the warp's shape, the diastolic LV wall and septum in LV units, the interatrial septum's center. */
  shape: WarpShape; wall: number; septumLv: number;
  ias: V3;
}

/** One moment of the beat: the motion of the walls, and how open each valve is (0 closed to 1 fully open). */
export interface EchoFrame { motion: FrameMotion; open: { mv: number; av: number; tv: number; pv?: number } }

/** The scale center for the LV and the ventricles: middle of the valve plane, as `partsMorph` uses. */
export const LV_SCALE_CENTER: V3 = [0, 54, 0];

export interface HeartOptions {
  morph?: HeartMorph | null; lvScale?: number; lvWall?: number; septum?: number; rvWall?: number; effusion?: number; asdMm?: number;
  valves?: Partial<{ mv: Partial<ValveLook>; av: Partial<ValveLook>; tv: Partial<ValveLook> }>;
  scar?: number[]; wma?: number[]; organic?: number;
  anatomy?: "ct" | "schematic";
  chamberScale?: Partial<{ rv: number; ra: number; la: number }>;
}

/** Normal wall thicknesses, mm. */
export const NORMAL_WALL = { lv: LV.wall, rv: LV.rvWall };

const ias = (morph: HeartMorph | null): V3 => {
  // the point between the two atrial centers where they meet: the fossa ovalis, where a secundum defect sits
  const a: V3 = [-27, 54, -6], b: V3 = [5, 56, -21];
  const d = (p: V3) => { const x = morph ? partsMorph(p, morph) : parts(p); return x[Part.RA] - x[Part.LA]; };
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2, p: V3 = [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m]; if (d(p) < 0) lo = m; else hi = m; }
  const m = (lo + hi) / 2;
  return [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m + 2, a[2] + (b[2] - a[2]) * m];
};

export function makeHeart(o: HeartOptions = {}): EchoHeart {
  const lvScale = o.lvScale ?? 1, lvWall = o.lvWall ?? LV.wall, septum = o.septum ?? lvWall;
  const wma = o.wma ?? new Array(17).fill(1), scar = o.scar ?? new Array(17).fill(0);
  const v = (x?: Partial<ValveLook>): ValveLook => ({ ...NORMAL_VALVE, ...(x ?? {}) });
  const anatomy = o.anatomy ?? (ctGeom() ? "ct" : "schematic");
  const geom = anatomy === "ct" ? ctGeom() : null;
  if (anatomy === "ct" && !geom) throw new Error("makeHeart: the CT heart is not installed");
  const map: ContractionMap = contractionMap(wma, geom ?? schematicGeom(lvWall / lvScale, septum / lvScale));
  const morph = o.morph ?? null;
  const cs = { rv: o.chamberScale?.rv ?? 1, ra: o.chamberScale?.ra ?? 1, la: o.chamberScale?.la ?? 1 };
  return {
    morph, lvScale, lvWall, septum, rvWall: o.rvWall ?? LV.rvWall, effusion: o.effusion ?? 0, asdMm: o.asdMm ?? 0,
    valves: { mv: v(o.valves?.mv), av: v(o.valves?.av), tv: v(o.valves?.tv) }, scar, wma, organic: o.organic ?? 1, anatomy, chamberScale: cs,
    shape: { map }, wall: lvWall / lvScale, septumLv: septum / lvScale, ias: ias(morph),
  };
}

/** The resting normal heart, as exact schematic shapes (the fallback before the CT heart loads, and the schematic tests). */
export const NORMAL_HEART: EchoHeart = makeHeart({ organic: 0, anatomy: "schematic" });
export const stillFrame = (phase = 0.35): EchoFrame => ({ motion: STILL, open: { mv: phase, av: phase, tv: phase } });

/** The normal heart the labeled slice, the framing and the scorer cut when no patient is given: the CT heart's exact shapes once it is installed. */
let ctIdeal: { heart: EchoHeart; frame: EchoFrame } | null = null;
export function idealPatient(): { heart: EchoHeart; frame: EchoFrame } | undefined {
  if (!ctGeom()) return undefined;
  return (ctIdeal ??= { heart: makeHeart({ organic: 0 }), frame: stillFrame() });
}

/** The heart's bounding box (mesh bounds of `meshHeart`). Points outside it, beyond the pericardium, are empty. */
const BOX_LO: V3 = [-64, -74, -72], BOX_HI: V3 = [64, 114, 48];
const scratch: LvPoint = { t: 0, x: 0, y: 0 };
const q: V3 = [0, 0, 0], qRef: V3 = [0, 0, 0], anat: V3 = [0, 0, 0];
/** Trabeculae, mm at full depth: the LV's are fine and gather toward the apex; the right ventricle's are coarse everywhere. */
const TRABECULA = { lv: 1.3, lvApex: 2.6, rv: 2.4 };

/** Display heart at a point: whole-heart sdf, nearest part and the gap to the second-nearest chamber (for partition walls). */
interface Display {
  sdf: number; part: number | null; gap: number; second: number;
  /** Distance to the heart alone (chambers, aortic root, pulmonary trunk): what the pericardium wraps. The descending aorta, venae cavae and pulmonary veins lie outside it. */
  core: number;
}
const disp: Display = { sdf: 0, part: null, gap: Infinity, second: -1, core: 0 };
function display(p: V3, morph: HeartMorph | null, out: Display): Display {
  if (!morph) {
    const d = parts(p), atria = smin(d[Part.RA], d[Part.LA], 6), sdf = smin(smin(d[Part.LV], atria, 3.5), d[Part.Aorta], 3);
    nearest(d, sdf, out);
    out.core = smin(smin(d[Part.LV], atria, 3.5), d[Part.Aorta] + abovePericardium(p), 3);
    if (out.part === Part.LV && septalDistance(p) < 0) out.part = Part.RV;
    return out;
  }
  const d = partsMorph(p, morph);
  const lift = abovePericardium(p);
  let core = smin(smin(d[MorphPart.LV], smin(d[MorphPart.RA], d[MorphPart.LA], 6), 3.5), d[MorphPart.Aorta] + lift, 3);
  if (d[MorphPart.PA] < Infinity) core = smin(core, d[MorphPart.PA] + lift, 2.5);
  let f = smin(smin(smin(smin(d[MorphPart.LV], smin(d[MorphPart.RA], d[MorphPart.LA], 6), 3.5), d[MorphPart.Aorta], 3), d[MorphPart.PA], 2.5), d[MorphPart.DAO], 2);
  for (let i = MorphPart.SVC; i <= MorphPart.BT; i++) if (d[i] < Infinity) f = smin(f, d[i], 2.5);
  nearest(d, f, out);
  out.core = core;
  if (out.part === MorphPart.LV) {
    const kv = morph.ventricleScale ?? 1;
    if (septalDistance([p[0] / kv, 54 + (p[1] - 54) / kv, p[2] / kv]) < 0) out.part = Part.RV;
  }
  return out;
}
/**
 * The pericardium reflects onto the great arteries a few centimeters above the valves: the ascending aorta and pulmonary trunk are inside
 * it, the arch and the pulmonary branches are not. Added to their distance, this pushes them out of the heart-only surface above that level.
 */
export const PERICARDIAL_REFLECTION_Y = 68;
const abovePericardium = (p: V3) => 2 * Math.max(0, p[1] - PERICARDIAL_REFLECTION_Y);

function nearest(d: number[], sdf: number, out: Display) {
  out.sdf = sdf;
  if (sdf >= 0) { out.part = null; out.gap = Infinity; out.second = -1; return; }
  let best = 0, second = -1;
  for (let i = 2; i < d.length; i++) if (d[i] < d[best]) best = i;
  for (let i = 0; i < d.length; i++) if (i !== best && i !== 1 && (second < 0 || d[i] < d[second])) second = i;
  out.part = best; out.second = second; out.gap = second < 0 ? Infinity : d[second] - d[best];
}

/** Signed distance to the heart's outer surface, mm: the display heart, or the LV where a dilated LV bulges past it. */
function outerSdf(p: V3, heart: EchoHeart): number {
  const d = display(p, heart.morph, { sdf: 0, part: null, gap: 0, second: -1, core: 0 }).core;
  if (heart.lvScale <= 1.02) return d;
  const s = heart.lvScale, c = LV_SCALE_CENTER, f = lvFrame([c[0] + (p[0] - c[0]) / s, c[1] + (p[1] - c[1]) / s, c[2] + (p[2] - c[2]) / s], { t: 0, x: 0, y: 0 });
  return f.t / LV_LENGTH > 0.95 ? d : Math.min(d, lvEpiDistance(f) * s);
}

/** Effusion and pericardium, for a point outside the heart at outer distance `sdf`. */
function pericardial(p: V3, sdf: number, heart: EchoHeart): Tissue {
  const e = heart.effusion, from = PERICARDIUM.from + e, to = PERICARDIUM.to + e;
  if (sdf > to + 0.5) return Tissue.Outside;
  if (e <= 0 && sdf < from - 0.5) return Tissue.Outside;
  const gx = (outerSdf([p[0] + GRAD_STEP, p[1], p[2]], heart) - sdf) / GRAD_STEP;
  const gy = (outerSdf([p[0], p[1] + GRAD_STEP, p[2]], heart) - sdf) / GRAD_STEP;
  const gz = (outerSdf([p[0], p[1], p[2] + GRAD_STEP], heart) - sdf) / GRAD_STEP;
  const g = Math.max(0.2, Math.hypot(gx, gy, gz)), half = Math.min(0.5 * PERICARDIUM.thick * g, 0.75), center = PERICARDIUM.center + e * g;
  if (Math.abs(sdf - center) <= half) return Tissue.Pericardium;
  if (e > 0 && sdf > 0 && sdf < center - half) return Tissue.Fluid;
  return Tissue.Outside;
}

/** The result of `classifyFrame`: the sample, plus the point's end-diastolic position (its material coordinate, for speckle). */
export interface FrameSample extends EchoSample { ref: V3 }

/**
 * Classify one heart-frame point of a patient's heart at one moment of the beat.
 *
 * Ventricles are re-divided from the display heart: an LV epicardial shape that is round in the short axis, an LV cavity inset by the wall,
 * the septum as the part of that shell that faces the RV, and the RV as everything else inside the display heart's inset surface, so it
 * wraps the LV as a crescent. Every point gets exactly one tissue: the branches below are exclusive.
 */
const ctOut: CtSample = { tissue: 0, part: -1, sdf: 0, ref: [0, 0, 0] };
export function classifyFrame(p: V3, heart: EchoHeart, frame: EchoFrame, out: FrameSample = { tissue: Tissue.Outside, part: null, sdf: 0, ref: [0, 0, 0] }): FrameSample {
  if (heart.anatomy === "ct") {
    ctOut.ref = out.ref;
    classifyCt(p, heart, frame, warp, ctOut);
    out.tissue = ctOut.tissue as Tissue; out.part = ctOut.part < 0 ? null : (ctOut.part as Part); out.sdf = ctOut.sdf;
    return out;
  }
  const s = heart.lvScale, c = LV_SCALE_CENTER;
  // where this point sat at end-diastole: warp in LV units, then back to mm
  q[0] = c[0] + (p[0] - c[0]) / s; q[1] = c[1] + (p[1] - c[1]) / s; q[2] = c[2] + (p[2] - c[2]) / s;
  warp(q, frame.motion, heart.shape, qRef);
  const r = out.ref;
  r[0] = c[0] + (qRef[0] - c[0]) * s; r[1] = c[1] + (qRef[1] - c[1]) * s; r[2] = c[2] + (qRef[2] - c[2]) * s;
  const k = Math.max(1, s, heart.morph?.ventricleScale ?? 1, heart.morph?.laScale ?? 1, heart.morph?.raScale ?? 1) + heart.effusion / 60;
  if (r[0] < BOX_LO[0] * k || r[0] > BOX_HI[0] * k || r[1] < BOX_LO[1] * k || r[1] > BOX_HI[1] * k + (heart.morph?.greatVessels ? 40 : 0) || r[2] < BOX_LO[2] * k - (heart.morph?.greatVessels ? 30 : 0) || r[2] > BOX_HI[2] * k) {
    const dx = Math.max(BOX_LO[0] - r[0], 0, r[0] - BOX_HI[0]), dy = Math.max(BOX_LO[1] - r[1], 0, r[1] - BOX_HI[1]), dz = Math.max(BOX_LO[2] - r[2], 0, r[2] - BOX_HI[2]);
    out.tissue = Tissue.Outside; out.part = null; out.sdf = Math.hypot(dx, dy, dz);
    return out;
  }
  // the anatomy is read at a slightly displaced point (organic.ts), so no wall is a perfect circle or a straight line; the speckle
  // keeps the undisplaced material coordinate `r`
  const g = heart.organic;
  if (g > 0) {
    organicWarp(r, g, anat);
    qRef[0] = c[0] + (anat[0] - c[0]) / s; qRef[1] = c[1] + (anat[1] - c[1]) / s; qRef[2] = c[2] + (anat[2] - c[2]) / s;
  } else { anat[0] = r[0]; anat[1] = r[1]; anat[2] = r[2]; }
  const hit = display(anat, heart.morph, disp);
  const f = lvFrame(qRef, scratch), tau = f.t / LV_LENGTH;
  const dEpiLv = lvEpiDistance(f); // LV units
  out.sdf = hit.sdf;
  // a dilated LV may bulge past the display ventricles; inside its epicardium below the valve plane it is still LV
  const inLv = dEpiLv < 0 && (hit.part === Part.LV || hit.part === Part.RV || (hit.part === null && s > 1.02 && tau < 0.92));
  if (hit.part === null && !inLv) {
    out.part = null;
    out.tissue = pericardial(anat, s > 1.02 && tau < 0.95 ? Math.min(hit.core, dEpiLv * s) : hit.core, heart);
    return out;
  }
  const sd = septalDistance(qRef);
  const part = hit.part ?? Part.LV;

  if (!inLv && part !== Part.LV && part !== Part.RV) { // atria, aorta and great vessels: thin wall, blood inside, partitions between them
    const wall = part <= Part.Aorta ? isWall(part as Part, hit.sdf, sd, anat[1]) : hit.sdf > -2;
    const partition = hit.gap < 2.6 && hit.second >= 2 && hit.second !== MorphPart.LV && !(heart.asdMm > 0 && atrialPair(part, hit.second) && dist(anat, heart.ias) < heart.asdMm / 2);
    if (wall || partition) return set(out, Tissue.Myocardium, part);
    return leafletOr(out, anat, heart, frame, Tissue.Blood, part);
  }

  if (inLv) { // inside the LV epicardial shape
    const ang = (Math.atan2(f.y, f.x) * 180) / Math.PI;
    const seg = segmentAt(tau, ang), scar = heart.scar[seg] ?? 0;
    let wall = wallAt(ang, tau, heart.wall, heart.septumLv) * (1 - 0.45 * scar);
    if (g > 0) {
      // the wall varies a little in thickness, and trabeculae roughen its inner border (more toward the apex; a scar is smooth)
      wall *= 1 + 0.12 * g * patchiness([r[0] * 0.5, r[1] * 0.5, r[2] * 0.5]);
      const trab = (tau < 0.35 ? TRABECULA.lvApex : TRABECULA.lv) * (1 - scar);
      wall += (g * trab * roughness(r)) / s;
    }
    if (dEpiLv > -wall) { // wall: septum where the shell faces the right ventricle
      const rho = Math.hypot(f.x, f.y) || 1, kk = (-dEpiLv) / rho;
      const qq: V3 = [qRef[0] + (f.x * E1[0] + f.y * E2[0]) * kk, qRef[1] + (f.x * E1[1] + f.y * E2[1]) * kk, qRef[2] + (f.x * E1[2] + f.y * E2[2]) * kk];
      const facesRv = septalDistance(qq) < LV.rvSideLimit && hit.sdf < -heart.rvWall;
      return set(out, scar > 0.4 ? Tissue.Scar : facesRv ? Tissue.Septum : Tissue.Myocardium, Part.LV);
    }
    if (papillaryDistance(f) < 0) return set(out, Tissue.Papillary, Part.LV);
    return leafletOr(out, anat, heart, frame, Tissue.Blood, Part.LV);
  }
  // outside the LV shape, inside the display heart: right ventricle if on the right side, else more LV wall
  if (sd < LV.rvSideLimit) {
    if (hit.sdf < -(heart.rvWall + g * TRABECULA.rv * roughness(r))) return leafletOr(out, anat, heart, frame, Tissue.Blood, Part.RV);
    return set(out, Tissue.Myocardium, Part.RV);
  }
  return set(out, Tissue.Myocardium, Part.LV);
}

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const atrialPair = (a: number, b: number) => (a === Part.RA && b === Part.LA) || (a === Part.LA && b === Part.RA);
function set(out: FrameSample, tissue: Tissue, part: number): FrameSample { out.tissue = tissue; out.part = part as Part; return out; }

/** A leaflet or cusp here (calcified ones are Calcium), else `fallback`. Leaflets belong to the ventricle on their ventricular side. */
function leafletOr(out: FrameSample, p: V3, heart: EchoHeart, frame: EchoFrame, fallback: Tissue, part: number): FrameSample {
  const v = heart.valves, o = frame.open;
  if (onAtrioventricularLeaflet(p, MITRAL, o.mv, v.mv)) return set(out, v.mv.calcium > 0.3 ? Tissue.Calcium : Tissue.Leaflet, Part.LV);
  if (onAorticCusp(p, o.av, v.av)) return set(out, v.av.calcium > 0.3 ? Tissue.Calcium : Tissue.Leaflet, Part.LV);
  if (onAtrioventricularLeaflet(p, TRICUSPID, o.tv, v.tv)) return set(out, v.tv.calcium > 0.3 ? Tissue.Calcium : Tissue.Leaflet, Part.RV);
  return set(out, fallback, part);
}

/**
 * The resting normal heart at one valve opening `phase` (0 closed to 1 fully open; default half open, a resting look).
 */
export function classifyEcho(p: V3, phase = 0.35): EchoSample {
  const r = classifyFrame(p, NORMAL_HEART, phase === 0.35 ? STILL_FRAME : stillFrame(phase));
  return { tissue: r.tissue, part: r.part, sdf: r.sdf };
}
const STILL_FRAME = stillFrame(0.35);

export { WALL_MM, classifyHeart };
