import { V3 } from "../anatomy/curve";
import { MorphPart, Part, meshSdf } from "../anatomy/heartSurface";
import { CT, CtHeart, ahaSegment, ctDirToHeart, ctLandmarks, ctToHeart, heartToCt, labelAt, nearestLabel, place, sampleField } from "../anatomy/ctHeart";
import { Annulus, LEAFLET_MM, LvPoint, ValveLook, onAtrioventricularLeaflet } from "./anatomy";
import { LvGeom, NA, NT } from "./motion";
import { organicWarp, roughness } from "./organic";

/**
 * The echo's view of the CT heart (src/anatomy/ctHeart.ts): what an ultrasound beam meets at a point, at one moment of the beat, in a
 * patient whose disease the case describes. The CT gives the shapes (chambers, walls, the LV's 17 segments, valve rings, vessel stubs);
 * this file adds what an average end-diastolic CT shape lacks and an echo shows: leaflets that open and close, papillary muscles,
 * trabeculae, the great vessels beyond their stubs, and the pathology (hypertrophy, scar, defects, fluid, enlarged chambers).
 *
 * All geometry here is in the CT frame, mm (z from the LV apex to the base centre at 0, x septum to free wall, y anterior), except where
 * a function says otherwise. Install the heart once with `useCtHeart`; everything else reads it from there.
 */

let H: CtHeart | null = null;
let G: (LvGeom & { apexZ: number }) | null = null;
let VALVES: { mv: Annulus; tv: Annulus; av: Cusps; pv: Cusps } | null = null;
let VESSELS: Tube[] = [];
let PAPILLARY: Capsule[] = [];
let IAS_CENTER: V3 = [0, 0, 0];
let CHAMBER_CENTER: Record<"LV" | "RV" | "RA" | "LA", V3> = { LV: [0, 0, 0], RV: [0, 0, 0], RA: [0, 0, 0], LA: [0, 0, 0] };
/** Native diastolic wall thickness of the CT heart, mm: LV mean and RV free wall, against which a case's thickness is set. */
export const NATIVE = { lv: 9, rv: 3.5 };

export const ctHeart = () => H;
export const ctGeom = () => G;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const perpTo = (v: V3, a: V3): V3 => unit(sub(v, scl(a, dot(v, a))));
const cm = (v: V3): V3 => [v[0] * 10, v[1] * 10, v[2] * 10];
const isChamber = (l: number) => l === CT.LV || l === CT.RV || l === CT.RA || l === CT.LA || l === CT.AORTA || l === CT.PA;
const isWallLabel = (l: number) => (l >= 40 && l <= 56) || l === CT.RV_WALL || l === CT.LA_WALL || l === CT.RA_WALL || l === CT.AO_WALL || l === CT.PA_WALL || l === CT.IAS;
const PART_OF: Record<number, number> = { [CT.LV]: Part.LV, [CT.RV]: Part.RV, [CT.RA]: Part.RA, [CT.LA]: Part.LA, [CT.AORTA]: Part.Aorta, [CT.PA]: MorphPart.PA };

// ---- installation ---------------------------------------------------------------------------------
/**
 * Install the CT heart for the echo: place it in the heart frame against `landmarks` (the schematic heart's, so the probe's chest and
 * the camera keep their meaning), then measure the LV, rebuild the valves on the CT's valve rings and lay out the great vessels.
 * `patientUp` etc. convert the patient frame (x left, y up, z anterior) to the heart frame for the vessel paths.
 */
export function useCtHeart(h: CtHeart, landmarks: Record<string, V3>, fromPatient: (v: V3) => V3): void {
  place(h, landmarks);
  H = h;
  G = measureLv(h);
  VALVES = buildValves(h);
  const toCtP = (pPatient: V3): V3 => heartToCt(h, fromPatient(pPatient));
  const toCtDir = (dPatient: V3): V3 => unit(sub(toCtP(dPatient), toCtP([0, 0, 0])));
  VESSELS = buildVessels(h, toCtP, toCtDir);
  PAPILLARY = buildPapillary();
  const c = h.meta.centroids;
  CHAMBER_CENTER = { LV: cm(c.LV), RV: cm(c.RV), RA: cm(c.RA), LA: cm(c.LA) };
  // the fossa ovalis: the middle of the interatrial septum's voxels
  let n = 0; const s: V3 = [0, 0, 0];
  for (let i = 0; i < h.labels.length; i++) if (h.labels[i] === CT.IAS) {
    const k = i % h.nz, j = Math.floor(i / h.nz) % h.ny, ii = Math.floor(i / (h.ny * h.nz));
    s[0] += ii + h.origin[0]; s[1] += j + h.origin[1]; s[2] += k + h.origin[2]; n++;
  }
  IAS_CENTER = n ? [s[0] / n, s[1] / n, s[2] / n] : [0, 0, 0];
}

/** CT landmarks in the heart frame (for poses): LV apex, valve centres, and the four chamber centres. */
export function ctLandmarksHeart(): { apex: V3; mv: V3; av: V3; tv: V3; pv: V3; lv: V3; rv: V3; ra: V3; la: V3; laa: V3; lvAxis: V3; aoAxis: V3 } {
  if (!H) throw new Error("CT heart not installed");
  const l = ctLandmarks(H), c = H.meta.centroids, T = (p: V3) => ctToHeart(H!, p);
  return { apex: T(l.apex), mv: T(l.mv), av: T(l.av), tv: T(l.tv), pv: T(l.pv), lv: T(cm(c.LV)), rv: T(cm(c.RV)), ra: T(cm(c.RA)), la: T(cm(c.LA)),
    laa: T(cm(H.meta.ostia.LAA.c)), lvAxis: ctDirToHeart(H, [0, 0, 1]), aoAxis: ctDirToHeart(H, unit(H.meta.tubes.ao.u)) };
}

/** Outside (positive) or inside (negative) the CT heart's outer surface, mm, for a heart-frame point. */
export function ctBodyDistance(pHeart: V3): number {
  if (!H) throw new Error("CT heart not installed");
  return sampleField(H, H.body, heartToCt(H, pHeart));
}

// ---- the LV, measured ---------------------------------------------------------------------------------
/**
 * The CT LV as an `LvGeom`: the long axis is the CT z axis (apex to base); the centre line is the LV cavity's centroid slice by slice;
 * cavity radius and wall thickness are measured by marching out from the centre line at each level and angle.
 */
function measureLv(h: CtHeart): LvGeom & { apexZ: number } {
  const apexZ = h.meta.lv_apex_cm[2] * 10, baseZ = h.meta.valves.MV.c[2] * 10, L = baseZ - apexZ;
  // centre line, 1 mm per entry
  const n = Math.ceil(L) + 1, cx = new Float32Array(n), cy = new Float32Array(n), ok = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    const k = Math.round(apexZ + t - h.origin[2]);
    if (k < 0 || k >= h.nz) continue;
    let sx = 0, sy = 0, c = 0;
    for (let i = 0; i < h.nx; i++) for (let j = 0; j < h.ny; j++) if (h.labels[(i * h.ny + j) * h.nz + k] === CT.LV) { sx += i; sy += j; c++; }
    if (c > 4) { cx[t] = sx / c + h.origin[0]; cy[t] = sy / c + h.origin[1]; ok[t] = 1; }
  }
  // fill the tip (no cavity) from the first measured slice, and smooth
  let first = 0; while (first < n && !ok[first]) first++;
  for (let t = 0; t < first; t++) { cx[t] = cx[first]; cy[t] = cy[first]; }
  for (let t = 1; t < n; t++) if (!ok[t] && t > first) { cx[t] = cx[t - 1]; cy[t] = cy[t - 1]; }
  const sm = (a: Float32Array) => { const b = a.slice(); for (let t = 0; t < n; t++) { let s = 0, c = 0; for (let d = -4; d <= 4; d++) { const u = t + d; if (u >= 0 && u < n) { s += a[u]; c++; } } b[t] = s / c; } return b; };
  const CX = sm(cx), CY = sm(cy);
  const center = (t: number, out: [number, number]) => { const u = Math.max(0, Math.min(n - 1, t)), i = Math.floor(u), f = u - i, j = Math.min(n - 1, i + 1); out[0] = CX[i] + (CX[j] - CX[i]) * f; out[1] = CY[i] + (CY[j] - CY[i]) * f; return out; };
  const o: [number, number] = [0, 0];
  const frame = (p: V3, out: LvPoint): LvPoint => { const t = p[2] - apexZ; center(t, o); out.t = t; out.x = p[0] - o[0]; out.y = p[1] - o[1]; return out; };
  const point = (t: number, x: number, y: number, out: V3): V3 => { center(t, o); out[0] = x + o[0]; out[1] = y + o[1]; out[2] = t + apexZ; return out; };
  // cavity radius and wall by level and angle
  const rc = new Float32Array(NT * NA), wall = new Float32Array(NT * NA);
  const q: V3 = [0, 0, 0];
  for (let i = 0; i < NT; i++) for (let j = 0; j < NA; j++) {
    const t = ((i + 0.5) / NT) * L, a = ((-180 + (360 * (j + 0.5)) / NA) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    let r = 0, rCav = 0, rEpi = 0;
    for (r = 0; r < 60; r += 0.5) { point(t, r * ca, r * sa, q); const l = labelAt(h, q); if (l !== CT.LV && l !== CT.MV_PLANE && l !== CT.AV_PLANE) break; }
    rCav = r;
    for (; r < 80; r += 0.5) { point(t, r * ca, r * sa, q); const l = labelAt(h, q); if (!(l >= 40 && l <= 56)) break; }
    rEpi = r;
    rc[i * NA + j] = rCav; wall[i * NA + j] = Math.max(2, rEpi - rCav);
  }
  // the septal plane: x where the septum's RV face lies, at mid-ventricle
  let xs = 0, c = 0;
  for (let i = Math.floor(NT * 0.3); i < Math.floor(NT * 0.75); i++) {
    const j = 0; // angle -180 + 5 deg: the septal side
    center(((i + 0.5) / NT) * L, o); xs += o[0] - (rc[i * NA + j] + wall[i * NA + j]); c++;
  }
  const xSept = xs / c;
  let lvMean = 0, cnt = 0;
  for (let i = Math.floor(NT * 0.2); i < Math.floor(NT * 0.85); i++) for (let j = 0; j < NA; j++) { lvMean += wall[i * NA + j]; cnt++; }
  NATIVE.lv = lvMean / cnt;
  return { length: L, apexZ, frame, point, rc, wall, septal: (p: V3) => p[0] - xSept, septalNormal: [1, 0, 0] };
}

// ---- valves -------------------------------------------------------------------------------------------
interface Cusps { center: V3; axis: V3; u: V3; v: V3; radius: number; height: number; angles: number[] }

function buildValves(h: CtHeart): { mv: Annulus; tv: Annulus; av: Cusps; pv: Cusps } {
  const V = h.meta.valves, mvC = cm(V.MV.c), tvC = cm(V.TV.c), avC = cm(V.AV.c), pvC = cm(V.PV.c);
  const deg = (d: number) => (d * Math.PI) / 180;
  // MV: the build's R is a maximum radius that takes in the wall; the area-equivalent ring is about 16 mm in radius
  const mvR = 0.86 * V.MV.R * 10, tvR = 0.92 * V.TV.R * 10;
  const mvAxis = unit(V.MV.n), mvSide = perpTo(sub(avC, mvC), mvAxis); // anterior leaflet hinges on the aortic side
  const tvAxis = unit(V.TV.n), tvSide = perpTo(sub(mvC, tvC), tvAxis); // septal leaflet on the septal side
  const mv: Annulus = { center: mvC, axis: mvAxis, side: mvSide, lat: unit(cross(mvAxis, mvSide)), radius: [0.78 * mvR, 0.62 * mvR], len: [1.45 * mvR, 0.95 * mvR], closed: [deg(46), deg(27)], open: deg(82) };
  const tv: Annulus = { center: add(tvC, tvSide, -4), axis: tvAxis, side: tvSide, lat: unit(cross(tvAxis, tvSide)), radius: [0.7 * tvR, 0.62 * tvR], len: [0.95 * tvR, 1.0 * tvR], closed: [deg(40), deg(40)], open: deg(82) };
  const cusps = (c: V3, n: V3, R: number): Cusps => {
    const axis = unit(n), u = perpTo([0, 0, 1], axis), v = unit(cross(axis, u));
    return { center: c, axis, u, v, radius: R, height: 5.5, angles: [deg(90), deg(210), deg(330)] };
  };
  return { mv, tv, av: cusps(avC, V.AV.n, 0.82 * V.AV.R * 10), pv: cusps(pvC, V.PV.n, 0.7 * V.PV.R * 10) };
}

/** Three semilunar cusps radiating from the root axis (a Y in the short axis when closed); they swing out to the sinus wall as they open. */
function onCusp(p: V3, c: Cusps, phase: number, look: ValveLook): boolean {
  const d = sub(p, c.center), dy = dot(d, c.axis);
  const extra = look.thick - LEAFLET_MM;
  if (Math.abs(dy) > c.height / 2 + extra * 0.5) return false;
  const dx = dot(d, c.u), dz = dot(d, c.v), r = Math.hypot(dx, dz);
  if (r > c.radius) return false;
  const ph = Math.max(0, Math.min(1, phase)) * Math.max(0, Math.min(1, look.openMax));
  if (r < c.radius * 0.8 * ph) return false;
  if (look.gap > 0 && r < c.radius * 0.12 * Math.min(1, look.gap / 10)) return false;
  const half = look.thick / 2 + extra * 0.5 * (1 - r / c.radius);
  for (const a of c.angles) {
    const along = dx * Math.cos(a) + dz * Math.sin(a), tang = -dx * Math.sin(a) + dz * Math.cos(a);
    if (along > 0 && Math.abs(tang) <= half) return true;
  }
  return false;
}

// ---- papillary muscles ------------------------------------------------------------------------------
interface Capsule { a: V3; b: V3; r0: number; r1: number }
/**
 * The CT average has no papillary muscles (a smooth cavity). Two are added in LV coordinates: anterolateral (between the lateral and
 * anterior walls) and posteromedial (between the inferior wall and the septum), each a tapered capsule from the mid-apical free wall up
 * toward the mitral leaflets.
 */
function buildPapillary(): Capsule[] {
  const g = G!, L = g.length, out: Capsule[] = [];
  for (const angDeg of [40, -115]) {
    const a = (angDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const j = Math.min(NA - 1, Math.floor(((angDeg + 180) / 360) * NA));
    const rcAt = (tau: number) => g.rc[Math.min(NT - 1, Math.floor(tau * NT)) * NA + j];
    const t0 = 0.3 * L, t1 = 0.64 * L;
    const root = g.point(t0, (rcAt(0.3) + 1) * ca, (rcAt(0.3) + 1) * sa, [0, 0, 0]);
    const head = g.point(t1, 0.5 * rcAt(0.64) * ca, 0.5 * rcAt(0.64) * sa, [0, 0, 0]);
    out.push({ a: root, b: head, r0: 6.5, r1: 4.5 });
  }
  return out;
}
function capsuleDistance(p: V3, c: Capsule): number {
  const ab = sub(c.b, c.a), ap = sub(p, c.a), t = Math.max(0, Math.min(1, dot(ap, ab) / dot(ab, ab)));
  const q = add(c.a, ab, t);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) - (c.r0 + (c.r1 - c.r0) * t);
}

// ---- the great vessels beyond the CT's stubs -------------------------------------------------------------
interface Tube { part: number; pts: V3[]; r: number; lo: V3; hi: V3 }
/**
 * The CT holds only stubs of the great vessels. The rest is drawn as tubes, laid out in the patient frame from where the stubs and
 * ostia are (the arch over the left atrium, the descending aorta behind it, the venae cavae entering the right atrium from above and
 * below, four pulmonary veins, the pulmonary branches), then converted to the CT frame. Schematic, but in the right places for the
 * views that need them (suprasternal, subcostal IVC, bicaval, descending aorta).
 */
function buildVessels(h: CtHeart, toCtP: (p: V3) => V3, toCtDir: (d: V3) => V3): Tube[] {
  const toPat = (c: V3): V3 => { // CT -> patient, numerically through the given map's inverse (rotation only, so solve by 3 basis probes)
    const o = toCtP([0, 0, 0]), ex = sub(toCtP([1, 0, 0]), o), ey = sub(toCtP([0, 1, 0]), o), ez = sub(toCtP([0, 0, 1]), o), d = sub(c, o);
    return [dot(d, ex), dot(d, ey), dot(d, ez)];
  };
  const tube = (part: number, ptsPatient: V3[], r: number): Tube => {
    const pts = ptsPatient.map(toCtP), lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - r); hi[k] = Math.max(hi[k], p[k] + r); }
    return { part, pts, r, lo, hi };
  };
  const T = h.meta.tubes, O = h.meta.ostia;
  const aoEnd = toPat(cm(T.ao.end)), aoU = toPat(add(cm(T.ao.end), T.ao.u, 1)), up = unit(sub(aoU, aoEnd));
  const la = toPat(cm(h.meta.centroids.LA));
  // the descending aorta runs behind the left atrium and a little to the left
  const dao: V3 = [la[0] + 22, 0, la[2] - 40];
  const asc2 = add(aoEnd, up, 18), archTop: V3 = [aoEnd[0] + 8, aoEnd[1] + 40, aoEnd[2] - 18];
  const archBack: V3 = [dao[0] - 4, archTop[1] - 4, (archTop[2] + dao[2]) / 2 - 8], descTop: V3 = [dao[0], archTop[1] - 22, dao[2]];
  const out: Tube[] = [
    tube(Part.Aorta, [aoEnd, asc2, archTop], 14),
    tube(Part.Aorta, [archTop, archBack, descTop], 12.5),
    tube(MorphPart.DAO, [descTop, [dao[0], la[1] - 10, dao[2]], [dao[0] - 2, la[1] - 140, dao[2] + 6]], 11.5),
  ];
  const ost = (k: string) => toPat(cm(O[k].c));
  const svc = ost("SVC"), ivc = ost("IVC");
  out.push(tube(MorphPart.SVC, [svc, [svc[0] - 2, svc[1] + 25, svc[2] + 2], [svc[0] - 3, svc[1] + 60, svc[2] + 3]], 9));
  out.push(tube(MorphPart.IVC, [ivc, [ivc[0] + 2, ivc[1] - 25, ivc[2] - 4], [ivc[0] + 4, ivc[1] - 80, ivc[2] - 8]], 10.5));
  for (const k of ["LUPV", "LLPV", "RUPV", "RLPV"]) {
    const c = O[k], a = toPat(cm(c.c)), n = unit(sub(toPat(add(cm(c.c), c.n, 1)), a));
    out.push(tube(MorphPart.PV, [a, add(a, n, 14), add(add(a, n, 28), [0, 0, -6])], Math.max(5, c.r * 10 * 0.75)));
  }
  const paEnd = toPat(cm(T.pa.end)), paU = unit(sub(toPat(add(cm(T.pa.end), T.pa.u, 1)), paEnd)), bif = add(paEnd, paU, 14);
  out.push(tube(MorphPart.PA, [paEnd, bif], T.pa.r * 10 + 1));
  out.push(tube(MorphPart.PA, [bif, [bif[0] + 18, bif[1] + 4, bif[2] - 22], [bif[0] + 30, bif[1], bif[2] - 40]], 8.5)); // left
  out.push(tube(MorphPart.PA, [bif, [bif[0] - 20, bif[1] - 2, bif[2] - 18], [bif[0] - 45, bif[1] - 4, bif[2] - 26]], 8.5)); // right, under the arch
  void toCtDir;
  return out;
}
function tubeDistance(p: V3, t: Tube): number {
  if (p[0] < t.lo[0] - 3 || p[1] < t.lo[1] - 3 || p[2] < t.lo[2] - 3 || p[0] > t.hi[0] + 3 || p[1] > t.hi[1] + 3 || p[2] > t.hi[2] + 3) return Infinity;
  let d = Infinity;
  for (let i = 1; i < t.pts.length; i++) {
    const a = t.pts[i - 1], b = t.pts[i], ab = sub(b, a), ap = sub(p, a), s = Math.max(0, Math.min(1, dot(ap, ab) / dot(ab, ab)));
    d = Math.min(d, Math.hypot(ap[0] - ab[0] * s, ap[1] - ab[1] * s, ap[2] - ab[2] * s) - t.r);
  }
  return d;
}

// ---- classification -----------------------------------------------------------------------------------
/** What the classifier needs of a patient (a subset of `EchoHeart`, tissue.ts). */
export interface CtPatient {
  lvScale: number; lvWall: number; septum: number; rvWall: number; effusion: number; asdMm: number; organic: number;
  valves: { mv: ValveLook; av: ValveLook; tv: ValveLook };
  scar: number[];
  /** Linear scales of the other chambers against normal (1 = unchanged). */
  chamberScale: { rv: number; ra: number; la: number };
  shape: { map: import("./motion").ContractionMap };
}
export interface CtFrameState { motion: import("./motion").FrameMotion; open: { mv: number; av: number; tv: number; pv?: number } }

/** Septal segments (AHA, 0-based): basal and mid anteroseptal and inferoseptal, apical septal. */
const SEPTAL = new Set([1, 2, 7, 8, 13]);
const PERI = { center: 4.6, half: 1.1 }; // the parietal pericardium with the fat on it: a band about 2 mm thick
const TRAB = { lv: 0.9, lvApex: 1.8, rv: 1.0 }; // mm at full depth; the CT RV is a thin crescent in long-axis cuts, so its trabeculae must not meet across it

const c0: V3 = [0, 0, 0], qr: V3 = [0, 0, 0], an: V3 = [0, 0, 0];
const lp: LvPoint = { t: 0, x: 0, y: 0 };

/** Result: tissue (a `Tissue` value), part (Part/MorphPart, -1 none), distance to the heart's outer surface, and the material point. */
export interface CtSample { tissue: number; part: number; sdf: number; ref: V3 }

/** Tissue codes (the same numbers as `Tissue` in tissue.ts, which imports this file). */
export const T_ = { Outside: 0, Blood: 1, Myocardium: 2, Septum: 3, Leaflet: 4, Papillary: 5, Pericardium: 6, Fluid: 7, Calcium: 8, Scar: 9 } as const;

/** Inflate a chamber about its centre: a point at distance d sat at d / (1 + (k - 1) w(d)) before, with w fading out past 1.6 R. */
function inflate(p: V3, center: V3, k: number, R: number) {
  if (Math.abs(k - 1) < 1e-3) return;
  const dx = p[0] - center[0], dy = p[1] - center[1], dz = p[2] - center[2], d = Math.hypot(dx, dy, dz);
  const u = d / (1.6 * R), w = u >= 1 ? 0 : 1 - u * u * (3 - 2 * u), f = 1 / (1 + (k - 1) * w);
  p[0] = center[0] + dx * f; p[1] = center[1] + dy * f; p[2] = center[2] + dz * f;
}

/**
 * Scale the LV by `s` in its own frame, about the base: uniform across the cavity and the wall (so a dilated ventricle keeps its wall
 * in proportion and the case's thickness rules apply evenly), fading out over 20 mm outside the epicardium. In place, current to
 * reference (divides by `s` where the weight is 1).
 */
const lpS: LvPoint = { t: 0, x: 0, y: 0 };
function scaleLv(p: V3, s: number) {
  if (Math.abs(s - 1) < 1e-3) return;
  const g = G!;
  g.frame(p, lpS);
  const L = g.length, t = lpS.t, r = Math.hypot(lpS.x, lpS.y);
  // epicardial radius at this level (reference), scaled to where it now is
  const tau = Math.min(1, Math.max(0, (L - (L - t) / s) / L)), ang = (Math.atan2(lpS.y, lpS.x) * 180) / Math.PI;
  const i = Math.min(NT - 1, Math.floor(tau * NT)), j = Math.min(NA - 1, Math.max(0, Math.floor(((ang + 180) / 360) * NA)));
  const re = (g.rc[i * NA + j] + g.wall[i * NA + j]) * s;
  const out = r - (re + 4), w = out <= 0 ? 1 : out >= 20 ? 0 : 1 - (out / 20) * (out / 20) * (3 - 2 * (out / 20));
  const along = t > L + 4 ? Math.max(0, 1 - (t - L - 4) / 15) : t < -10 ? Math.max(0, 1 - (-10 - t) / 15) : 1, k = w * along;
  if (k <= 0) return;
  const inv = 1 + (1 / s - 1) * k;
  g.point(L - (L - t) * inv, lpS.x * inv, lpS.y * inv, p);
}

/**
 * Classify a heart-frame point of a patient at one moment. `warp` is motion.ts's warp (passed in to avoid an import cycle).
 */
export function classifyCt(pHeart: V3, pt: CtPatient, fr: CtFrameState, warpFn: (q: V3, f: import("./motion").FrameMotion, s: { map: import("./motion").ContractionMap }, out: V3) => V3, out: CtSample): CtSample {
  const h = H!, g = G!;
  heartToCt(h, pHeart, c0);
  // other chambers enlarged by the case (scaled about their centres; the LV is scaled below, with its motion)
  inflate(c0, CHAMBER_CENTER.LA, pt.chamberScale.la, 22);
  inflate(c0, CHAMBER_CENTER.RA, pt.chamberScale.ra, 24);
  inflate(c0, CHAMBER_CENTER.RV, pt.chamberScale.rv, 30);
  // a bigger or smaller left ventricle, scaled in its own coordinates about the base (the atria and vessels stay as they are), then
  // the beat's motion
  const s = pt.lvScale;
  scaleLv(c0, s);
  warpFn(c0, fr.motion, pt.shape, qr);
  const ref = out.ref;
  ref[0] = qr[0]; ref[1] = qr[1]; ref[2] = qr[2];
  // a light irregularity on top of the CT shape (which, as an average, is smoother than any one heart)
  if (pt.organic > 0) organicWarp(ref, 0.35 * pt.organic, an); else { an[0] = ref[0]; an[1] = ref[1]; an[2] = ref[2]; }
  const o = sampleField(h, h.body, an), b = sampleField(h, h.blood, an);
  out.sdf = o;

  // the great vessels beyond the stubs (no pericardium around them)
  if (o > -0.5) {
    for (const t of VESSELS) {
      const d = tubeDistance(an, t);
      if (d < 0) { out.part = t.part; out.tissue = d > -2 ? T_.Myocardium : T_.Blood; return out; }
    }
  }
  if (o >= 0) { // outside the heart: effusion and pericardium
    out.part = -1;
    const e = pt.effusion, center = PERI.center + e;
    out.tissue = Math.abs(o - center) <= PERI.half ? T_.Pericardium : e > 0 && o < center - PERI.half ? T_.Fluid : T_.Outside;
    return out;
  }

  g.frame(qr, lp);
  const tau = lp.t / g.length, ang = (Math.atan2(lp.y, lp.x) * 180) / Math.PI;

  if (b < 0) { // blood, unless a leaflet, papillary muscle, trabecula or a thickened wall is here
    let l = labelAt(h, an);
    if (!isChamber(l)) l = nearestLabel(h, an, isChamber, 3) || CT.LV;
    const part = PART_OF[l] ?? Part.LV;
    // leaflets and cusps
    const v = pt.valves, op = fr.open;
    if (onAtrioventricularLeaflet(an, VALVES!.mv, op.mv, v.mv)) { out.part = Part.LV; out.tissue = v.mv.calcium > 0.3 ? T_.Calcium : T_.Leaflet; return out; }
    if (onAtrioventricularLeaflet(an, VALVES!.tv, op.tv, v.tv)) { out.part = Part.RV; out.tissue = v.tv.calcium > 0.3 ? T_.Calcium : T_.Leaflet; return out; }
    if (onCusp(an, VALVES!.av, op.av, v.av)) { out.part = Part.LV; out.tissue = v.av.calcium > 0.3 ? T_.Calcium : T_.Leaflet; return out; }
    if (onCusp(an, VALVES!.pv, op.pv ?? op.av, { thick: 1.2, openMax: 1, gap: 0, calcium: 0 })) { out.part = Part.RV; out.tissue = T_.Leaflet; return out; }
    if (l === CT.LV) {
      for (const c of PAPILLARY) if (capsuleDistance(qr, c) < 0) { out.part = Part.LV; out.tissue = T_.Papillary; return out; }
      // a thicker wall (hypertrophy) takes the outer part of the cavity; trabeculae roughen what is left
      const septal = Math.max(0, Math.cos(((ang - 180) * Math.PI) / 180 * 1.3)) * (tau > 0.1 && tau < 0.85 ? 1 : 0);
      // in reference millimetres: the case's wall, scaled back by the LV's size, against the CT's own
      const want = (pt.lvWall + (pt.septum - pt.lvWall) * septal) / s, extra = want - NATIVE.lv;
      // trabeculae sit on the effective endocardium: on a thinned wall that is out in the native wall, handled below
      const trab = extra >= 0 ? pt.organic * (tau < 0.35 ? TRAB.lvApex : TRAB.lv) * roughness(ref) : 0;
      if (b > -(Math.max(0, extra) + trab)) { out.part = Part.LV; out.tissue = septal > 0.5 && extra > 0 ? T_.Septum : T_.Myocardium; return out; }
    }
    if (l === CT.RV) {
      const extra = Math.max(0, pt.rvWall - NATIVE.rv) + pt.organic * TRAB.rv * roughness(ref);
      if (b > -extra) { out.part = Part.RV; out.tissue = T_.Myocardium; return out; }
    }
    out.part = part; out.tissue = T_.Blood;
    return out;
  }

  // tissue. The fields are smoothed, so right at a cavity's edge a point can read as tissue while its voxel is still labeled blood: it is
  // that cavity's own wall (for the LV, the nearest LV segment), not whatever other wall happens to be closest.
  const raw = labelAt(h, an);
  let l = raw;
  if (raw === CT.LV) l = nearestLabel(h, an, (x) => x >= 40 && x <= 56, 3) || CT.LV_SEG0;
  else if (raw === CT.RV) l = CT.RV_WALL;
  else if (!isWallLabel(l)) l = nearestLabel(h, an, isWallLabel, 3);
  if (l >= 40 && l <= 56) {
    const seg = ahaSegment(l), scar = pt.scar[seg] ?? 0;
    // a thinner wall (dilated cardiomyopathy, scar): its inner part becomes cavity
    const thin = Math.max(0, NATIVE.lv - pt.lvWall / s) + 0.45 * scar * NATIVE.lv; // reference millimetres
    if (thin > 0) {
      const trab = scar > 0.4 ? 0 : pt.organic * TRAB.lv * roughness(ref);
      if (b < thin - trab) { out.part = Part.LV; out.tissue = T_.Blood; return out; }
    }
    out.part = Part.LV;
    out.tissue = scar > 0.4 ? T_.Scar : SEPTAL.has(seg) ? T_.Septum : T_.Myocardium;
    return out;
  }
  if (l === CT.IAS && pt.asdMm > 0 && Math.hypot(an[0] - IAS_CENTER[0], an[1] - IAS_CENTER[1], an[2] - IAS_CENTER[2]) < pt.asdMm / 2) {
    out.part = Part.RA; out.tissue = T_.Blood; return out;
  }
  out.part = l === CT.RV_WALL ? Part.RV : l === CT.LA_WALL ? Part.LA : l === CT.RA_WALL || l === CT.IAS ? Part.RA : l === CT.AO_WALL ? Part.Aorta : l === CT.PA_WALL ? MorphPart.PA : Part.LV;
  out.tissue = T_.Myocardium;
  return out;
}

/** The great-vessel tubes' centre lines in the heart frame, by part (for poses that aim at them). */
export function vesselPathsHeart(part: number): V3[][] {
  return VESSELS.filter((t) => t.part === part).map((t) => t.pts.map((p) => ctToHeart(H!, p)));
}

/** For tests and tools: the CT LV's measured cavity radius and wall (mm) at a level (0 apex .. 1 base) and angle (degrees). */
export function lvTable(tau: number, angDeg: number): { rc: number; wall: number } {
  const g = G!, i = Math.min(NT - 1, Math.max(0, Math.floor(tau * NT))), j = Math.min(NA - 1, Math.max(0, Math.floor(((angDeg + 180) / 360) * NA)));
  return { rc: g.rc[i * NA + j], wall: g.wall[i * NA + j] };
}
export { IAS_CENTER as _iasCenter };

/**
 * The LV size (linear scale about its own frame) at which the CT LV's cavity, with the case's diastolic walls (`lvWall`, `septum`, mm)
 * in place of its own, holds `edvMl`. The engine's end-diastolic volume is the cavity's, so thick walls must push the epicardium out
 * (concentric hypertrophy keeps a near-normal cavity) and thin walls give the cavity room (a dilated ventricle): sizing by the cube root
 * of the volume ratio alone would ignore both. Integrates the measured cavity and wall tables; bisection.
 */
export function lvScaleFor(edvMl: number, lvWall: number, septum: number): number {
  const g = G!, dT = g.length / NT, dA = (2 * Math.PI) / NA;
  const cavity = (s: number, own: boolean) => {
    let v = 0;
    for (let i = 0; i < NT; i++) for (let j = 0; j < NA; j++) {
      const c = i * NA + j, tau = (i + 0.5) / NT, ang = -180 + (360 * (j + 0.5)) / NA;
      const septal = Math.max(0, Math.cos(((ang - 180) * Math.PI) / 180 * 1.3)) * (tau > 0.1 && tau < 0.85 ? 1 : 0);
      const re = g.rc[c] + g.wall[c], wt = own ? g.wall[c] * s : lvWall + (septum - lvWall) * septal;
      const r = Math.max(0, s * re - wt);
      v += 0.5 * r * r * dA * dT * s;
    }
    return v / 1000;
  };
  // calibrate the table integral against the CT's own cavity volume (the tables are a polar approximation of it)
  let own = 0; for (const l of H!.labels) if (l === CT.LV) own++;
  const k = own / 1000 / cavity(1, true);
  let lo = 0.6, hi = 1.8;
  for (let n = 0; n < 40; n++) { const m = (lo + hi) / 2; if (cavity(m, false) * k < edvMl) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * The CT LV geometry as one patient's walls make it: in reference millimetres, the case's diastolic wall (`lvWallRef`, `septumRef`)
 * replaces the CT's own and the cavity takes up the difference, so the motion warp contracts the cavity the case actually has (a thinned
 * wall's inner part is cavity and shortens like it; a thickened wall's inner part is wall and thickens like it).
 */
export function ctGeomFor(lvWallRef: number, septumRef: number): LvGeom {
  const g = G!, rc = new Float32Array(g.rc.length), wall = new Float32Array(g.wall.length);
  for (let i = 0; i < NT; i++) for (let j = 0; j < NA; j++) {
    const c = i * NA + j, tau = (i + 0.5) / NT, ang = -180 + (360 * (j + 0.5)) / NA;
    const septal = Math.max(0, Math.cos(((ang - 180) * Math.PI) / 180 * 1.3)) * (tau > 0.1 && tau < 0.85 ? 1 : 0);
    const wt = lvWallRef + (septumRef - lvWallRef) * septal, re = g.rc[c] + g.wall[c];
    rc[c] = Math.max(1, re - wt); wall[c] = re - rc[c];
  }
  return { ...g, rc, wall };
}

/**
 * The CT heart as a surface mesh in the heart frame, for the 3D probe pane: its outer surface and the great vessels beyond the stubs,
 * each vertex labeled with the chamber or vessel it covers (found by stepping inward from the surface to the first blood).
 */
export function ctMesh(step = 1.6): import("../anatomy/heartSurface").SurfaceMesh {
  const h = H!, c: V3 = [0, 0, 0];
  const field = (q: V3) => {
    heartToCt(h, q, c);
    let d = sampleField(h, h.body, c);
    for (const t of VESSELS) { const dv = tubeDistance(c, t); if (dv < d) d = dv; }
    return d;
  };
  const which = (q: V3) => {
    heartToCt(h, q, c);
    for (const t of VESSELS) if (tubeDistance(c, t) < 0.5) return t.part;
    const e = 0.75, gx = sampleField(h, h.body, [c[0] + e, c[1], c[2]]) - sampleField(h, h.body, [c[0] - e, c[1], c[2]]);
    const gy = sampleField(h, h.body, [c[0], c[1] + e, c[2]]) - sampleField(h, h.body, [c[0], c[1] - e, c[2]]);
    const gz = sampleField(h, h.body, [c[0], c[1], c[2] + e]) - sampleField(h, h.body, [c[0], c[1], c[2] - e]);
    const n = unit([gx, gy, gz]);
    for (let t = 1; t < 18; t += 1) { const l = labelAt(h, [c[0] - n[0] * t, c[1] - n[1] * t, c[2] - n[2] * t]); if (isChamber(l)) return PART_OF[l] ?? Part.LV; }
    return Part.LV;
  };
  // the box: the CT volume's corners (and the vessels') in the heart frame
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  const grow = (p: V3) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - 3); hi[k] = Math.max(hi[k], p[k] + 3); } };
  for (let i = 0; i < 8; i++) grow(ctToHeart(h, [h.origin[0] + (i & 1 ? h.nx : 0), h.origin[1] + (i & 2 ? h.ny : 0), h.origin[2] + (i & 4 ? h.nz : 0)]));
  for (const t of VESSELS) for (const p of t.pts) grow(ctToHeart(h, p));
  return meshSdf(field, which, [lo, hi], step);
}
