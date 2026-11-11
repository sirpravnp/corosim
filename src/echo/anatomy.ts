import { V3 } from "../anatomy/curve";
import { septalDistance } from "../anatomy/heartSurface";
import { LANDMARKS_HEART_FRAME } from "./poses";

/**
 * The echo layer's own ventricle, valve and papillary geometry, in the heart frame (mm). The display heart (`heartSdf`) is one ellipsoid cut by
 * a flat septal plane, so a short-axis cut through it is D-shaped. Echo wants a round left ventricle with the right ventricle wrapped around it
 * as a crescent, so the ventricular interior is re-divided here. Everything is schematic: shapes placed by hand to read like the textbook views.
 *
 * Everything below is precomputed once; `lvFrame` and the shape tests are scalar math with no allocation (the page calls them ~90000 times per
 * repaint while the user drags the probe).
 */
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const perpTo = (v: V3, a: V3): V3 => sub(v, mul(a, dot(v, a)));

const L = LANDMARKS_HEART_FRAME;

/** Shape parameters, mm. */
export const LV = {
  /** Epicardial radius in the short axis (the cut is round), and the wall thickness (cavity inset). */
  radius: 32.5,
  wall: 9.5,
  /** Length of the rounded apical cap along the long axis. */
  cap: 50,
  /** The RV cavity stops where it would round the lateral side of the LV: septal distance above this is LV wall. */
  rvSideLimit: 10,
  /** Inset of the RV cavity from the display heart's outer surface (the RV free wall). */
  rvWall: 3.5,
};

// ---- the LV frame -------------------------------------------------------------------------------
/** Long axis of the LV: from the apex landmark to the mitral landmark (the same axis the probe poses use). */
export const LV_AXIS: V3 = unit(sub(L.mitral, L.apex));
export const LV_LENGTH = Math.hypot(...sub(L.mitral, L.apex));
/** Normal of the display heart's septal plane, from the plane's own distance function (points from the RV toward the LV). */
const SEPT_NORMAL: V3 = [septalDistance([1, 0, 0]) - septalDistance([0, 0, 0]), 0, septalDistance([0, 0, 1]) - septalDistance([0, 0, 0])];
const lvToward = unit(perpTo(SEPT_NORMAL, LV_AXIS)); // perpendicular to the axis

/** Unit vectors of the short-axis plane: e1 toward the LV side (lateral), e2 anterior. */
export const E1: V3 = lvToward;
const e2raw = cross(LV_AXIS, E1);
export const E2: V3 = e2raw[2] >= 0 ? e2raw : mul(e2raw, -1);

/** LV center line, as an offset in (E1, E2) from the apex-mitral axis, at fractions 0, 0.4, 1 of its length. */
const base = mul(add(L.mitral, L.aortic), 0.5);
const toBase = sub(base, add(L.apex, LV_AXIS, LV_LENGTH));
const OFF_BASE: [number, number] = [0.5 * dot(toBase, E1) + 0.5 * 0, 0.5 * dot(toBase, E2)];
const OFF_MID: [number, number] = [3, 0];

export interface LvPoint {
  /** Distance along the axis from the apex landmark, mm. */
  t: number;
  /** Position in the short-axis plane relative to the center line, mm (e1, e2). */
  x: number;
  y: number;
}

/** Offset of the LV center line from the apex-mitral axis at distance `t` from the apex, along E1 (index 0) and E2 (index 1). */
function centerOffset(t: number, out: [number, number]): [number, number] {
  const f = Math.max(0, Math.min(1, t / LV_LENGTH));
  if (f < 0.4) { const k = f / 0.4; out[0] = OFF_MID[0] * k; out[1] = OFF_MID[1] * k; }
  else { const k = (f - 0.4) / 0.6; out[0] = OFF_MID[0] + (OFF_BASE[0] - OFF_MID[0]) * k; out[1] = OFF_MID[1] + (OFF_BASE[1] - OFF_MID[1]) * k; }
  return out;
}
const off: [number, number] = [0, 0];

/** Coordinates of a heart-frame point in the LV frame, written into `out` (no allocation). */
export function lvFrame(p: V3, out: LvPoint): LvPoint {
  const rx = p[0] - L.apex[0], ry = p[1] - L.apex[1], rz = p[2] - L.apex[2];
  const t = rx * LV_AXIS[0] + ry * LV_AXIS[1] + rz * LV_AXIS[2];
  const a = rx * E1[0] + ry * E1[1] + rz * E1[2], b = rx * E2[0] + ry * E2[1] + rz * E2[2];
  centerOffset(t, off);
  out.t = t; out.x = a - off[0]; out.y = b - off[1];
  return out;
}

/** The inverse of `lvFrame`: the heart-frame point at LV coordinates (t, x, y), written into `out`. */
export function lvPoint(t: number, x: number, y: number, out: V3): V3 {
  centerOffset(t, off);
  const a = x + off[0], b = y + off[1];
  for (let i = 0; i < 3; i++) out[i] = L.apex[i] + t * LV_AXIS[i] + a * E1[i] + b * E2[i];
  return out;
}

/** Radius of the LV epicardium at distance `t` from the apex, for the shape `lvEpiDistance` describes (0 beyond the tip). */
export function lvEpiRadius(t: number): number {
  const ts = t - LV_APEX_SHIFT;
  if (ts >= LV.cap) return LV.radius * taperAt(t);
  if (ts <= 0) return 0;
  const u = (ts - LV.cap) / LV.cap;
  return LV.radius * Math.sqrt(Math.max(0, 1 - u * u));
}

/**
 * How much the LV narrows from its widest point (the end of the apical cap) to the base, as a fraction of its radius: a real ventricle
 * is bullet-shaped, widest in its middle third, not a cylinder with parallel walls.
 */
export const LV_TAPER = 0.1;
/**
 * The echo LV's epicardial tip sits this far up the axis from the apex landmark. The display heart, laid out for the coronary tree, is
 * long and narrow (cavity about 3:1); a real left ventricle is under 2:1 (about 85 by 48 mm at end-diastole), so the echo LV is shorter
 * and wider than the display shape, and owns its own outline (see tissue.ts).
 */
export const LV_APEX_SHIFT = 12;
const taperAt = (t: number) => { const u = Math.min(1, Math.max(0, (t - LV.cap) / (LV_LENGTH - LV.cap))); return 1 - LV_TAPER * u * u; };

/** Approximate signed distance (mm, negative inside) to the LV epicardial surface: a rounded cap, then a body narrowing gently to the base. */
export function lvEpiDistance(f: LvPoint): number {
  const rho = Math.hypot(f.x, f.y);
  const t = f.t - LV_APEX_SHIFT;
  if (t >= LV.cap) return rho - LV.radius * taperAt(f.t);
  const R = LV.radius, T = LV.cap, dt = t - T;
  const k0 = Math.sqrt((rho / R) ** 2 + (dt / T) ** 2), k1 = Math.sqrt(rho * rho / R ** 4 + dt * dt / T ** 4);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -R;
}

// ---- papillary muscles --------------------------------------------------------------------------
/** A papillary muscle: a capsule from its root in the free wall to its head in the cavity, in LV-frame coordinates (t, radius, angle). */
interface Papillary { t0: number; r0: number; t1: number; r1: number; cx: number; cy: number; radius: number }
/** Angles from the lateral direction (E1), toward anterior (+) and posterior (-). In a short-axis cut seen from the apex these sit at about 4 and 8 o'clock. */
const PM_ANGLE = (62 * Math.PI) / 180;
export const PAPILLARY: Papillary[] = [PM_ANGLE, -PM_ANGLE].map((ang) => ({
  t0: 0.2 * LV_LENGTH, r0: 21, t1: 0.7 * LV_LENGTH, r1: 11.5,
  cx: Math.cos(ang), cy: Math.sin(ang), radius: 5.6,
}));

/** Distance (mm, negative inside) to the nearer papillary muscle; also reports which with `papIndex`. */
export function papillaryDistance(f: LvPoint): number {
  let best = Infinity;
  for (let i = 0; i < PAPILLARY.length; i++) {
    const m = PAPILLARY[i];
    const h = Math.max(0, Math.min(1, (f.t - m.t0) / (m.t1 - m.t0)));
    const r = m.r0 + (m.r1 - m.r0) * h, tt = m.t0 + (m.t1 - m.t0) * h;
    const d = Math.hypot(f.x - m.cx * r, f.y - m.cy * r, (f.t - tt) * 0.75) - m.radius; // slightly elongated along the axis
    if (d < best) best = d;
  }
  return best;
}

// ---- valves -------------------------------------------------------------------------------------
/** Leaflet thickness, mm, and how far a leaflet's middle bows out of the straight line from hinge to tip. */
export const LEAFLET_MM = 2.4;
export const LEAFLET_BOW = 1.6;

interface Sheet { origin: V3; dir: V3; lat: V3; norm: V3; length: number; halfWidth: number }
const makeSheet = (origin: V3, dir: V3, lat: V3, length: number, halfWidth: number): Sheet => ({ origin, dir, lat, norm: unit(cross(lat, dir)), length, halfWidth });

/** Hinged flaps on an annulus: two sheets that close toward the center line and swing toward the wall as `phase` goes 0 -> 1. */
interface Annulus { center: V3; axis: V3; side: V3; lat: V3; radius: [number, number]; len: [number, number]; closed: [number, number]; open: number }
const OPEN_ANGLE = (82 * Math.PI) / 180;

const deg = (d: number) => (d * Math.PI) / 180;
const mvSide = unit(perpTo(sub(L.aortic, L.mitral), LV_AXIS)); // anterior leaflet hinges on the aortic side
export const MITRAL: Annulus = {
  center: L.mitral, axis: mul(LV_AXIS, -1), side: mvSide, lat: unit(cross(LV_AXIS, mvSide)),
  radius: [13, 9], len: [22, 15], closed: [deg(46), deg(27)], open: OPEN_ANGLE,
};
const tvSide = unit(perpTo(sub(L.mitral, L.tricuspid), LV_AXIS)); // septal leaflet hinges on the septal side
export const TRICUSPID: Annulus = {
  center: add(L.tricuspid, tvSide, -6), axis: mul(LV_AXIS, -1), side: tvSide, lat: unit(cross(LV_AXIS, tvSide)),
  radius: [12, 9], len: [16, 17], closed: [deg(40), deg(40)], open: OPEN_ANGLE,
};

/**
 * What disease does to a valve, per valve. `thick` is the leaflet thickness in mm, `openMax` caps the opening (a stenosis: the leaflets
 * stop short of the wall), `gap` opens the closed position by that many degrees so the leaflets no longer meet (regurgitation), and
 * `calcium` (0..1) marks the leaflets as calcified: brighter, and they shadow what lies behind them. Defaults are a normal valve.
 */
export interface ValveLook { thick: number; openMax: number; gap: number; calcium: number }
export const NORMAL_VALVE: ValveLook = { thick: 2.4, openMax: 1, gap: 0, calcium: 0 };

/** The two flap sheets of a valve at a given opening. */
export function flaps(a: Annulus, phase: number, look: ValveLook = NORMAL_VALVE): [Sheet, Sheet] {
  const ph = Math.max(0, Math.min(1, phase)) * Math.max(0, Math.min(1, look.openMax));
  const make = (side: number, i: 0 | 1) => {
    const closed = a.closed[i] + deg(look.gap);
    const th = closed + (a.open - closed) * ph;
    const inward = mul(a.side, -side);
    const dir = add(mul(inward, Math.cos(th)), a.axis, Math.sin(th));
    return makeSheet(add(a.center, a.side, side * a.radius[i]), dir, a.lat, a.len[i], Math.max(a.radius[0], a.radius[1]) * 1.15);
  };
  return [make(1, 0), make(-1, 1)];
}

function onSheet(p: V3, s: Sheet, thick = LEAFLET_MM): boolean {
  const vx = p[0] - s.origin[0], vy = p[1] - s.origin[1], vz = p[2] - s.origin[2];
  const along = vx * s.dir[0] + vy * s.dir[1] + vz * s.dir[2];
  if (along < -0.5 || along > s.length) return false;
  // rheumatic and calcific leaflets thicken most at the tips; every leaflet bows along its length instead of lying flat
  const u = Math.max(0, along / s.length), half = thick / 2 + (thick - LEAFLET_MM) * 0.35 * u;
  if (Math.abs(vx * s.norm[0] + vy * s.norm[1] + vz * s.norm[2] - LEAFLET_BOW * Math.sin(Math.PI * Math.min(1, u))) > half) return false;
  return Math.abs(vx * s.lat[0] + vy * s.lat[1] + vz * s.lat[2]) <= s.halfWidth;
}

/** Cheap bound: within `r` of the annulus center. */
const near = (p: V3, c: V3, r: number) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 < r * r;

export function onAtrioventricularLeaflet(p: V3, a: Annulus, phase: number, look: ValveLook = NORMAL_VALVE): boolean {
  if (!near(p, a.center, 50)) return false;
  const [s0, s1] = flaps(a, phase, look);
  return onSheet(p, s0, look.thick) || onSheet(p, s1, look.thick);
}

/** Aortic valve: three cusps as thin sheets radiating from the root axis (y in the heart frame), a Y in the short axis when closed. */
export const AORTIC = { center: L.aortic, radius: 11.5, height: 5.5, angles: [deg(90), deg(210), deg(330)] };

export function onAorticCusp(p: V3, phase: number, look: ValveLook = NORMAL_VALVE): boolean {
  const c = AORTIC.center, dx = p[0] - c[0], dz = p[2] - c[2], dy = p[1] - c[1];
  const extra = look.thick - LEAFLET_MM;
  if (Math.abs(dy) > AORTIC.height / 2 + extra * 0.5 || dx * dx + dz * dz > AORTIC.radius * AORTIC.radius) return false;
  const ph = Math.max(0, Math.min(1, phase)) * Math.max(0, Math.min(1, look.openMax));
  const r = Math.hypot(dx, dz), inner = AORTIC.radius * 0.8 * ph; // opening: the free edges swing out to the sinus wall
  if (r < inner) return false;
  if (look.gap > 0 && r < AORTIC.radius * 0.12 * Math.min(1, look.gap / 10)) return false; // a central coaptation gap
  // a calcified cusp is thick and lumpy: the nodules sit toward the free edge
  const half = look.thick / 2 + extra * 0.5 * (1 - r / AORTIC.radius);
  for (let i = 0; i < 3; i++) {
    const a = AORTIC.angles[i], ca = Math.cos(a), sa = Math.sin(a);
    const along = dx * ca + dz * sa, tang = -dx * sa + dz * ca;
    if (along > 0 && Math.abs(tang) <= half) return true;
  }
  return false;
}
