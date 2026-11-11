import { V3 } from "../anatomy/curve";
import { rotateHeart } from "../anatomy/tree";
import { heartSdf } from "../anatomy/heartSurface";
import { ctBodyDistance, ctGeom, ctLandmarksHeart, vesselPathsHeart } from "./ctEcho";
import { MorphPart, Part as HPart } from "../anatomy/heartSurface";

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

export { LANDMARKS_HEART_FRAME } from "./landmarks";
import { LANDMARKS_HEART_FRAME } from "./landmarks";

/** Rotate a heart-frame point or direction into the patient frame, and back (the rotation is orthonormal, so the inverse is the transpose). */
const cols = [rotateHeart([1, 0, 0]), rotateHeart([0, 1, 0]), rotateHeart([0, 0, 1])];
export const toPatient = (v: V3): V3 => rotateHeart(v);
/** A heart-frame direction in the patient frame (the map is a rotation, so directions and points convert alike). */
const toPatientDir = (v: V3): V3 => rotateHeart(v);
export const toHeart = (v: V3): V3 => [dot(v, cols[0]), dot(v, cols[1]), dot(v, cols[2])];
/** Inside the heart (patient frame): the CT heart's outer surface when it is installed, else the schematic display heart's. */
const insideHeart = (p: V3) => (ctGeom() ? ctBodyDistance(toHeart(p)) : heartSdf(toHeart(p))) < 0;
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
  let apex: V3, mv: V3, av: V3, tv: V3;
  if (ctGeom()) {
    // the CT heart's own: epicardial apex and the centres of its fitted valve rings
    const c = ctLandmarksHeart();
    apex = toPatient(c.apex); mv = toPatient(c.mv); av = toPatient(c.av); tv = toPatient(c.tv);
  } else {
    const L = LANDMARKS_HEART_FRAME;
    apex = toPatient(L.apex); mv = toPatient(L.mitral); av = toPatient(L.aortic); tv = toPatient(L.tricuspid);
  }
  const longAxis = unit(sub(mv, apex));
  const toTV = perp(sub(tv, mv), longAxis);
  return { apex, mv, av, tv, longAxis, toTV, toAV: perp(sub(av, apex), longAxis) };
}

type Raw = Omit<Pose, "marker" | "depth">;
/** Stored values are rounded: make the beam exactly unit and the lateral exactly unit and perpendicular to it. */
const squareUp = (r: Raw): Raw => { const beam = unit(r.beam); return { ...r, beam, lateral: perp(r.lateral, beam) }; };
/** Output of `bestWindowPose` (src/echo/window.ts) for the views whose plane is fixed by landmarks. tests/echoWindow.test.ts checks they still match. */
const WINDOW_POSES: Record<"plax" | "subcostal", Raw> = {
  plax: { probe: [-7.551, -17.585, 49.96], beam: [0.238556, 0.261774, -0.935182], lateral: [-0.739909, 0.672707, -0.00044], target: [-1.835, 8.107, -10.393] },
  subcostal: { probe: [-31.085, -32.182, 36.906], beam: [0.274881, 0.608421, -0.744489], lateral: [0.939429, -0.334832, 0.073221], target: [-7.299, 4.859, -10.594] },
};
/** Sector depth per view, mm: deep enough to hold the heart, no deeper (the short axis cuts only the base, so it is shown larger). */
const DEPTH: Record<string, number> = {
  plax: 150, psaxPM: 130, subcostal: 150, a4c: 165, a5c: 165, a2c: 165, a3c: 165, psaxAV: 120, psaxMV: 130, psaxApex: 120,
  rvInflow: 150, ivc: 150, suprasternal: 150,
};
/**
 * Where the index mark points in the usual convention, as a direction in the patient frame (left = +x, toward the head = +y,
 * anterior = +z). The image's right side is the marker side, as on the scanner: in PLAX the aorta is on the right, in the apical views
 * the left ventricle.
 */
const MARKER_TOWARD: Record<string, V3> = {
  subcostal: [1, 0, 0], psaxPM: [0.7, 0.7, 0], plax: [-0.5, 1, 0], psaxAV: [0.7, 0.7, 0], psaxMV: [0.7, 0.7, 0], psaxApex: [0.7, 0.7, 0],
  a4c: [1, 0, 0], a5c: [1, 0, 0], a2c: [0, 0.6, 0.8], a3c: [-0.6, 0.8, 0], rvInflow: [-0.5, 1, 0], ivc: [0, 1, 0], suprasternal: [0.3, 0, -1],
};

/** Every transthoracic view: parasternal, apical, subcostal and suprasternal. */
export function buildPoses(): Record<string, Pose> {
  const l = landmarks(), raw: Record<string, Raw> = {};
  const outside = (target: V3, beam: V3, allowance: number): V3 => add(target, beam, -(exitDistance(target, scale(beam, -1)) + allowance));
  const mid = (a: V3, b: V3, k = 0.5): V3 => add(a, sub(b, a), k);
  /** A plane through three points, imaged with the beam along `beam` (squared into the plane) from a probe on the skin. */
  const planePose = (a: V3, b: V3, c: V3, target: V3, beamHint: V3, skin = SKIN): Raw => {
    const n = unit(cross(sub(b, a), sub(c, a)));
    const beam = unit(sub(beamHint, scale(n, dot(beamHint, n))));
    return { probe: outside(target, beam, skin), beam, lateral: unit(cross(n, beam)), target };
  };

  // Parasternal long axis and subcostal four-chamber: window-first poses (see window.ts), stored here because window.ts imports this file.
  // Each plane holds its landmarks (long axis: apex, mitral and aortic valves; subcostal: apex and both atrioventricular valves);
  // the probe sits where that plane meets the schematic chest inside the view's window. Regenerate with scripts/echo/windowPoses.ts.
  if (ctGeom()) {
    // on the CT heart, both are landmark planes like the other views: long axis through the apex and the mitral and aortic valves,
    // from the left parasternal window; four-chamber through the apex and both atrioventricular valves, from below the xiphoid
    // the long-axis beam comes from in front, square to the LV long axis, so the ventricle lies across the image
    raw.plax = planePose(l.apex, l.mv, l.av, mid(l.apex, mid(l.mv, l.av), 0.62), perp(scale(ANTERIOR, -1), l.longAxis));
    // the subcostal beam comes up from below the xiphoid, through the liver, roughly square to the long axis from underneath
    raw.subcostal = planePose(l.apex, l.mv, l.tv, mid(l.apex, mid(l.mv, l.tv), 0.5), unit(add(perp([0, 1, 0], l.longAxis), [0, 0, -1], 0.5)), SUBCOSTAL_SKIN);
  } else {
    raw.plax = squareUp(WINDOW_POSES.plax);
    raw.subcostal = squareUp(WINDOW_POSES.subcostal);
  }

  // Parasternal short axes: planes perpendicular to the long axis, from the base to the apex, beam from the front.
  const beamSax = perp(scale(ANTERIOR, -1), l.longAxis);
  const sax = (k: number, tiltToBase = 0): Raw => {
    const t = add(l.apex, sub(l.mv, l.apex), k);
    const beam = unit(add(beamSax, l.longAxis, tiltToBase));
    return { probe: outside(t, beam, SKIN), beam, lateral: unit(cross(l.longAxis, beam)), target: t };
  };
  raw.psaxPM = sax(0.42);
  raw.psaxMV = sax(0.88);
  raw.psaxApex = sax(0.3);
  // at the aortic valve: the plane across the aortic root (on the CT heart, square to the root's own axis), so it cuts the three
  // cusps, the RV outflow wrapping in front, the right atrium and the left atrium behind
  if (ctGeom()) {
    // the cut sits 5 mm above the valve's center, through the sinuses, so it shows the three cusps and not the outflow tract below them
    let ao = unit(toPatientDir(ctLandmarksHeart().aoAxis)); if (dot(ao, l.longAxis) < 0) ao = scale(ao, -1);
    const t = add(l.av, ao, 5), beam = perp(scale(ANTERIOR, -1), ao);
    raw.psaxAV = { probe: outside(t, beam, SKIN), beam, lateral: unit(cross(ao, beam)), target: t };
  } else {
    const t = l.av, beam = unit(add(beamSax, l.longAxis, 0.25));
    raw.psaxAV = { probe: outside(t, beam, SKIN), beam, lateral: unit(cross(l.longAxis, beam)), target: t };
  }

  // Apical views: the probe beyond the apex, the beam up the long axis; the plane turns about that axis.
  const apicalTarget = mid(l.apex, l.mv, 0.55);
  raw.a4c = planePose(l.apex, l.mv, l.tv, apicalTarget, l.longAxis);
  raw.a3c = planePose(l.apex, l.mv, l.av, apicalTarget, l.longAxis);
  const CA = ctGeom() ? ctLandmarksHeart() : null;
  if (CA) {
    // on the CT heart both are anatomical planes: the five-chamber view tilts up from the four-chamber one until it holds the aortic
    // valve (apex, aortic and tricuspid valves); the two-chamber view holds the apex, the mitral valve and the left atrial appendage
    // the five-chamber plane holds the apex and the aortic root's own axis (the outflow tract and the ascending aorta), and the beam
    // turns partway from the LV axis toward the outflow: the probe slides a little medial of the apex, as a sonographer moves it to
    // line the continuous-wave cursor up with an aortic jet
    let ao = unit(toPatientDir(CA.aoAxis)); if (dot(ao, l.longAxis) < 0) ao = scale(ao, -1);
    raw.a5c = planePose(l.apex, l.av, add(l.av, ao, 30), mid(l.apex, l.av, 0.6), unit(add(l.longAxis, ao, 3)));
    raw.a2c = planePose(l.apex, l.mv, toPatient(CA.laa), apicalTarget, l.longAxis);
  } else {
    raw.a5c = planePose(l.apex, l.av, mid(l.mv, l.tv), apicalTarget, l.longAxis);
    // two-chamber: the four-chamber plane turned about the long axis until it holds only the left heart (60 to 70 degrees)
    const a4 = raw.a4c, ax = a4.beam, k = (65 * Math.PI) / 180;
    const lat = unit(add(scale(a4.lateral, Math.cos(k)), unit(cross(ax, a4.lateral)), Math.sin(k)));
    raw.a2c = { ...a4, lateral: lat };
  }
  // RV inflow: from the long-axis window, tilted toward the right hip: a plane through the right atrium, the tricuspid valve and the RV body
  const C = ctGeom() ? ctLandmarksHeart() : null;
  {
    const ra = C ? toPatient(C.ra) : toPatient([-30, 54, -6]), rvBody = C ? toPatient(mid(C.rv, C.apex, 0.25)) : toPatient([-22, -10, 14]);
    raw.rvInflow = planePose(ra, l.tv, rvBody, mid(l.tv, rvBody, 0.3), sub(mid(l.tv, rvBody, 0.3), raw.plax.probe));
  }
  // Subcostal IVC: a sagittal plane through the right atrium and the inferior vena cava, from below the xiphoid
  {
    const ivcPath = C ? vesselPathsHeart(MorphPart.IVC)[0] : null;
    const ra = C ? toPatient(C.ra) : toPatient([-30, 50, -10]);
    const ivcLow: V3 = ivcPath ? toPatient(ivcPath[ivcPath.length - 1]) : [ra[0] - 4, ra[1] - 60, ra[2] - 6];
    const target = mid(ra, ivcLow, 0.4);
    raw.ivc = planePose(ra, ivcLow, add(ra, [0, 0, 1], 30), target, unit(add([0, 1, 0], [0, 0, -1], 0.6)), SUBCOSTAL_SKIN);
  }
  // Suprasternal: the probe in the notch above the arch, the beam down into the arch's plane (ascending aorta, arch, start of the
  // descending aorta); the right pulmonary artery and the left atrium lie under it
  {
    const arch = C ? vesselPathsHeart(HPart.Aorta).flat().map(toPatient) : null, dao = C ? vesselPathsHeart(MorphPart.DAO)[0].map(toPatient) : null;
    const asc = arch ? arch[1] : toPatient([0, 70, 1]), top: V3 = arch ? arch[2] : [-30, 76, -52], desc: V3 = dao ? dao[0] : [-16, 45, -83];
    const n = unit(cross(sub(top, asc), sub(desc, asc)));
    const target = scale(add(add(asc, top), desc), 1 / 3);
    const down = unit(sub([0, -1, 0], scale(n, dot([0, -1, 0], n))));
    // the notch sits about 3 cm above the top of the arch
    const probe = add(top, down, -30);
    raw.suprasternal = { probe, beam: unit(sub(target, probe)), lateral: unit(cross(n, unit(sub(target, probe)))), target };
  }

  const poses: Record<string, Pose> = {};
  for (const [id, p] of Object.entries(raw)) {
    // the image's right side is the marker side
    const lateral = dot(p.lateral, MARKER_TOWARD[id]) >= 0 ? p.lateral : scale(p.lateral, -1);
    poses[id] = { ...p, lateral, depth: DEPTH[id], marker: lateral };
  }
  return poses;
}

/** The sector's half-angle. */
export const SECTOR = { halfAngle: Math.PI / 4 };
export { insideHeart };
