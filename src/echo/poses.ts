import { V3 } from "../anatomy/curve";
import { rotateHeart } from "../anatomy/tree";
import { heartSdf } from "../anatomy/heartSurface";

/**
 * Where the probe goes for each standard transthoracic view, and which way it looks, on the simulator's own 3D heart (src/anatomy/heartSurface.ts),
 * derived from that heart's long axis and valve positions so that the plane of an apical two-chamber really holds the mitral valve and no
 * tricuspid valve. All vectors are in the patient frame, mm: x toward the patient's left, y up toward the head, z anterior.
 *
 * The heart is a schematic display shape, so the landmarks below are placed by hand on it (each is inside the chamber or at the valve plane it
 * names). What is modelled: the probe sits on the skin outside the heart's outer wall by a fixed allowance. What is not: ribs, lungs and
 * sternum, so a pose shows where a real probe has to be, not that the acoustic window exists there.
 */
export interface Pose {
  probe: V3;
  /** Unit vector the beam travels along, from the probe into the heart. */
  beam: V3;
  /** Unit vector in the image plane, perpendicular to the beam: the image's left-right axis. */
  lateral: V3;
  /** The structure at the middle of the sector. */
  target: V3;
  /** How deep the sector reaches, mm. */
  depth: number;
  /** Unit vector from the probe's centre toward its index mark: the lateral axis, signed to follow the usual convention for the view. */
  marker: V3;
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** The part of v perpendicular to unit axis a, as a unit vector. */
const perp = (v: V3, a: V3): V3 => unit(sub(v, scale(a, dot(v, a))));

/** Skin allowance beyond the heart's outer wall, mm (chest wall at the apex and parasternal windows; liver and abdominal wall below the xiphoid). */
const SKIN = 10, SUBCOSTAL_SKIN = 20;
const ANTERIOR: V3 = [0, 0, 1];

/** Landmarks of the heart in its own frame (x left, y base-ward along the long axis, z anterior), mm, placed on the schematic heart. */
export const LANDMARKS_HEART_FRAME = {
  apex: [0, -63, 0] as V3,          // just inside the tip of the tapered LV
  mitral: [15, 50, -14] as V3,      // LV side of the septal plane, at the valve plane (y = 54), well posterior to the aortic root
  tricuspid: [-18, 50, -4] as V3,   // RV side; the A4C plane through both valves passes behind the aortic root, as in life
  aortic: [0, 48, 2] as V3,         // aortic root, a little below the valve plane so the short-axis cut passes through the right ventricular outflow too
};

/** Rotate a heart-frame point or direction into the patient frame, and back (the rotation is orthonormal, so the inverse is the transpose). */
const cols = [rotateHeart([1, 0, 0]), rotateHeart([0, 1, 0]), rotateHeart([0, 0, 1])];
export const toPatient = (v: V3): V3 => rotateHeart(v);
export const toHeart = (v: V3): V3 => [dot(v, cols[0]), dot(v, cols[1]), dot(v, cols[2])];
const insideHeart = (p: V3) => heartSdf(toHeart(p)) < 0;
/** Distance in mm, walking from `from` along unit `dir`, to the last point of the heart on that line (the probe sits beyond all of it). */
const exitDistance = (from: V3, dir: V3, step = 0.5, max = 200) => {
  let last = 0;
  for (let t = 0; t < max; t += step) if (insideHeart(add(from, dir, t))) last = t;
  return last;
};

export interface Landmarks {
  apex: V3; mv: V3; av: V3; tv: V3;
  /** Apex-to-mitral-valve unit vector: the LV long axis. */
  longAxis: V3;
  /** Unit vector perpendicular to the long axis, from the mitral toward the tricuspid valve (the plane through both valves is the apical four-chamber). */
  toTV: V3;
  /** Unit vector perpendicular to the long axis, toward the aortic valve: the lateral axis of the parasternal long-axis plane. */
  toAV: V3;
}

export function landmarks(): Landmarks {
  const L = LANDMARKS_HEART_FRAME;
  const apex = toPatient(L.apex), mv = toPatient(L.mitral), av = toPatient(L.aortic), tv = toPatient(L.tricuspid);
  const longAxis = unit(sub(mv, apex));
  const toTV = perp(sub(tv, mv), longAxis);
  return { apex, mv, av, tv, longAxis, toTV, toAV: perp(sub(av, apex), longAxis) };
}

type Raw = Omit<Pose, "marker" | "depth">;
/** Sector depth per view, mm: deep enough to hold the heart, no deeper (the short axis cuts only the base, so it is shown larger). */
const DEPTH: Record<string, number> = { plax: 160, psaxPM: 130, subcostal: 160 };
/** Where the index mark points in the usual convention, as a direction in the patient frame (left = +x, toward the head = +y). */
const MARKER_TOWARD: Record<string, V3> = {
  subcostal: [1, 0, 0], psaxPM: [0.7, 0.7, 0], plax: [-0.5, 1, 0],
};

/** Poses for the views the atlas shows: parasternal long axis, parasternal short axis at the papillary level, and subcostal four-chamber. */
export function buildPoses(): Record<string, Pose> {
  const l = landmarks(), raw: Record<string, Raw> = {};
  const outside = (target: V3, beam: V3, allowance: number): V3 => add(target, beam, -(exitDistance(target, scale(beam, -1)) + allowance));

  // Parasternal long axis: the plane through the long axis and the aortic valve, entered from the front (the beam runs front to back).
  const beamPlax = l.toAV[2] > 0 ? scale(l.toAV, -1) : l.toAV;
  raw.plax = { probe: outside(l.mv, beamPlax, SKIN), beam: beamPlax, lateral: perp(l.longAxis, beamPlax), target: l.mv };

  // Parasternal short axis at the papillary-muscle level: plane perpendicular to the long axis, partway from the apex to the mitral valve.
  const beamPM = perp(scale(ANTERIOR, -1), l.longAxis), pm = add(l.apex, sub(l.mv, l.apex), 0.42);
  raw.psaxPM = { probe: outside(pm, beamPM, SKIN), beam: beamPM, lateral: unit(cross(l.longAxis, beamPM)), target: pm };

  // Subcostal four-chamber: the plane through both atrioventricular valves and the apex, entered from below and to the right, through the liver.
  const sc = (55 * Math.PI) / 180;
  const beam = unit(add(scale(l.longAxis, Math.cos(sc)), l.toTV, Math.sin(sc) * -1));
  const centre = scale(add(add(l.mv, l.tv), add(l.apex, l.mv)), 1 / 4);
  raw.subcostal = { probe: outside(centre, beam, SUBCOSTAL_SKIN), beam, lateral: perp(l.toTV, beam), target: centre };

  const poses: Record<string, Pose> = {};
  for (const [id, p] of Object.entries(raw)) poses[id] = { ...p, depth: DEPTH[id], marker: dot(p.lateral, MARKER_TOWARD[id]) >= 0 ? p.lateral : scale(p.lateral, -1) };
  return poses;
}

/** The sector's half-angle. */
export const SECTOR = { halfAngle: Math.PI / 4 };
export { insideHeart };
