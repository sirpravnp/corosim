import type { V3 } from "../anatomy/curve";
import { BODY } from "../lab/access";

/**
 * A procedural patient for the fluoroscopy backdrop, in the same patient frame as the vessels (mm; +x patient left, +y cranial, +z anterior).
 * Soft tissue, lungs, gas and flat bones are ellipsoids; a ray through an ellipsoid has a closed-form chord, so the backdrop is the
 * sum of chords for the actual C-arm angle, not a flat picture. Vertebrae, ribs, sternum and clavicles are drawn as projected
 * solids by `backdrop.ts`, from the lists here.
 */

/** Screen axes in patient coordinates for a C-arm at `rot` (LAO positive) and `tilt` (cranial positive). e3 is the ray direction. */
export interface Basis { e1: V3; e2: V3; e3: V3 }
export function viewBasis(rotDeg: number, tiltDeg: number): Basis {
  const ry = (rotDeg * Math.PI) / 180, rx = (tiltDeg * Math.PI) / 180;
  const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
  // matches `project` in angio.ts: x' = x cy + z sy; y' = y cx - z' sx with z' = -x sy + z cy; depth = y sx + z' cx
  return { e1: [cy, 0, sy], e2: [sy * sx, cx, -cy * sx], e3: [-sy * cx, sx, cy * cx] };
}

export type Group = "body" | "lung" | "gas" | "heart" | "mediastinum" | "bone";
export interface Ellipsoid {
  c: V3; a: V3; // centre and semi-axes before rotation
  yaw?: number; roll?: number; // degrees: about y (turns the plate toward or away from the viewer), then about z (tilts it in the coronal plane)
  w: number; // tissue-equivalent millimeters per millimeter of path: +1 soft tissue, -0.8 lung, +2.2 bone
  group: Group;
  clipY?: number; // half-height (mm, along the screen's vertical) where the chord is cut off with a soft edge: turns an ellipsoid into a rounded block, like a vertebral body
  sharp?: number; // >0 flattens the chord profile into a plateau with a steeper edge (lungs, whose boundary is a surface, not a dome)
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Axes of an ellipsoid in the patient frame: R = Rz(roll) Ry(yaw) applied to the unit vectors. */
export function axesOf(e: Ellipsoid): [V3, V3, V3] {
  const yw = ((e.yaw ?? 0) * Math.PI) / 180, rl = ((e.roll ?? 0) * Math.PI) / 180;
  const cy = Math.cos(yw), sy = Math.sin(yw), cz = Math.cos(rl), sz = Math.sin(rl);
  const ry = (v: V3): V3 => [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy];
  const rz = (v: V3): V3 => [v[0] * cz - v[1] * sz, v[0] * sz + v[1] * cz, v[2]];
  return [rz(ry([1, 0, 0])), rz(ry([0, 1, 0])), rz(ry([0, 0, 1]))];
}

/** An ellipsoid prepared for one view: its projected center, the inverse of its silhouette matrix, and the chord through its center. */
export interface Prepared { clip: number; c1: number; c2: number; i11: number; i12: number; i22: number; ext1: number; ext2: number; chord: number; w: number; sharp: number; group: Group }
export function prepare(e: Ellipsoid, b: Basis, shift: [number, number] = [0, 0]): Prepared {
  const ax = axesOf(e), a = e.a;
  let m11 = 0, m12 = 0, m22 = 0, q = 0;
  for (let k = 0; k < 3; k++) {
    const u = ax[k], s = a[k] * a[k], p1 = dot(b.e1, u), p2 = dot(b.e2, u), p3 = dot(b.e3, u);
    m11 += s * p1 * p1; m12 += s * p1 * p2; m22 += s * p2 * p2; q += (p3 / a[k]) ** 2;
  }
  const det = m11 * m22 - m12 * m12 || 1e-9;
  return {
    clip: e.clipY ?? 0, c1: dot(b.e1, e.c) + shift[0], c2: dot(b.e2, e.c) + shift[1],
    i11: m22 / det, i12: -m12 / det, i22: m11 / det, ext1: Math.sqrt(m11), ext2: Math.sqrt(m22), // half-width and half-height of the silhouette
    chord: 2 / Math.sqrt(q || 1e-9), w: e.w, sharp: e.sharp ?? 0, group: e.group,
  };
}

/** Path length (mm) of the ray at image-plane position (x1, x2), relative to the screen axes, through a prepared ellipsoid. */
export function chordAt(p: Prepared, x1: number, x2: number): number {
  const q1 = x1 - p.c1, q2 = x2 - p.c2;
  const r2 = p.i11 * q1 * q1 + 2 * p.i12 * q1 * q2 + p.i22 * q2 * q2;
  if (r2 >= 1) return 0;
  const s = Math.sqrt(1 - r2), cut = p.clip > 0 ? Math.min(1, Math.max(0, (p.clip - Math.abs(q2)) / 1.3)) : 1; // soft end plates
  return cut * p.chord * (p.sharp > 0 ? Math.min(1, s / p.sharp) : s);
}

const xm = BODY.midlineX;
const sym = (e: Omit<Ellipsoid, "c"> & { c: V3 }): Ellipsoid[] => [
  e,
  { ...e, c: [2 * xm - e.c[0], e.c[1], e.c[2]], yaw: -(e.yaw ?? 0), roll: -(e.roll ?? 0) },
];

/** The patient, as ellipsoids. `heartCentre` is the middle of the coronary tree. */
export function patientEllipsoids(heartCentre: V3, breath = 0): Ellipsoid[] {
  const br = breath * 3.5; // the diaphragm moves about 7 mm peak to peak in quiet breathing
  const out: Ellipsoid[] = [
    // soft tissue
    { c: [xm, 218, -14], a: [52, 70, 50], w: 1, group: "body" },
    { c: [xm, 122, -8], a: [188, 46, 58], w: 1, group: "body" }, // shoulder girdle
    { c: [xm, 20, -4], a: [128, 172, 92], w: 1, group: "body" },
    { c: [xm, -175, -6], a: [124, 122, 88], w: 1, group: "body" },
    { c: [xm, -345, 0], a: [150, 126, 98], w: 1, group: "body" },
    ...sym({ c: [xm - 80, -500, 10], a: [62, 150, 60], w: 1, group: "body" }),
    // lungs, with the diaphragm as their lower surface
    { c: [xm - 64, 76 - br, -2], a: [84, 102 + br, 84], w: -0.7, group: "lung" },
    { c: [xm + 64, 56 - br, -2], a: [84, 102 + br, 84], w: -0.7, group: "lung" },
    { c: [xm - 20, -100 - br, 0], a: [150, 70, 92], w: 1.0, group: "mediastinum", sharp: 0.28 }, // liver, stomach and spleen under the domes: the dark mass below the diaphragm edge
    { c: [xm + 4, 40, -32], a: [30, 108, 38], w: 0.3, group: "mediastinum" },
    { c: [xm + 1, 108, -22], a: [8, 62, 8], w: -0.9, group: "gas" }, // trachea
    // gas in the stomach and bowel
    { c: [xm + 74, -96 - br, -8], a: [22, 18, 22], w: -0.85, group: "gas" },
    { c: [xm + 28, -218, 22], a: [20, 30, 16], w: -0.8, group: "gas" },
    { c: [xm - 38, -252, 26], a: [18, 24, 14], w: -0.8, group: "gas" },
    { c: [xm + 58, -296, 12], a: [24, 32, 20], w: -0.8, group: "gas" },
    { c: [xm - 6, -362, 30], a: [26, 20, 18], w: -0.8, group: "gas" },
    // the heart: left ventricle and the right-sided chambers, long axis down and to the left
    { c: [heartCentre[0] + 16, heartCentre[1] - 4, heartCentre[2] + 4], a: [48, 72, 42], roll: 40, w: 0.8, group: "heart", sharp: 0.55 },
    { c: [heartCentre[0] - 12, heartCentre[1] + 6, heartCentre[2] + 8], a: [40, 56, 38], roll: 15, w: 0.7, group: "heart", sharp: 0.55 },
    // flat bones: scapulae, iliac wings, sacrum, pubic rami, femoral heads, necks, shafts
    ...sym({ c: [xm + 118, 96, -62], a: [46, 62, 5], yaw: 18, roll: -12, w: 2.2, group: "bone" }),
    ...sym({ c: [xm + 88, -240, -22], a: [52, 56, 9], yaw: 38, roll: 22, w: 2.2, group: "bone" }),
    { c: [xm, -330, -64], a: [40, 50, 14], w: 2.2, group: "bone" },
    ...sym({ c: [xm + 42, -438, 22], a: [48, 8, 8], roll: 8, w: 2.2, group: "bone" }),
    ...sym({ c: [xm + 78, -405, 6], a: [23, 23, 23], w: 2.4, group: "bone" }),
    ...sym({ c: [xm + 97, -432, 6], a: [32, 9, 9], roll: -38, w: 2.2, group: "bone" }),
    ...sym({ c: [xm + 102, -540, 8], a: [14, 110, 14], roll: 3, w: 2.2, group: "bone" }),
  ];
  return out;
}

/**
 * One vertebra as ellipsoids: a body (a capped ellipsoid, so it reads as a cylinder) with a dense cortical shell, two pedicles, a spinous
 * process and two transverse processes. The shell is an outer ellipsoid minus a smaller inner one, so its path length is the difference of
 * the two chords: a bright rim and a lighter, textured center from any C-arm angle, with no outline drawn anywhere.
 */
export function vertebraEllipsoids(v: Vertebra, seed = 0): Ellipsoid[] {
  const [wx, h, d] = [v.size[0], v.size[2], v.size[1]], c = v.c;
  const j = (k: number) => 1 + 0.06 * Math.sin(seed * 12.9898 + k * 78.233 + v.c[1] * 0.37); // each level differs a little
  const tilt = 4 * Math.sin(v.c[1] * 0.05 + seed);
  const body: Ellipsoid = { c, a: [wx * 0.56 * j(1), h * 0.8, d * 0.5 * j(2)], roll: tilt * 0.3, w: 0.61, group: "bone", sharp: 0.4, clipY: h * 0.5 };
  const out: Ellipsoid[] = [body,
    { ...body, w: 0.55, sharp: 0.3 }, // cortex: the outer solid again ...
    { ...body, a: [body.a[0] * 0.8, body.a[1] * 0.8, body.a[2] * 0.8], w: -0.55, sharp: 0.3, clipY: h * 0.5 - 2.2 }, // ... minus the marrow cavity
  ];
  for (const s of [-1, 1]) {
    out.push({ c: [c[0] + s * wx * 0.33, c[1] + h * 0.22, c[2] - d * 0.5 - 2], a: [4.2, 4.6, 11], w: 1.21, group: "bone" }); // pedicle: the owl's eye in an AP view
    out.push({ c: [c[0] + s * (wx * 0.5 + 15), c[1] + h * 0.2, c[2] - d * 0.45 - 12], a: [18, 3.2, 4.5], yaw: s * -14, w: 0.99, group: "bone" }); // transverse process
    out.push({ c: [c[0] + s * wx * 0.3, c[1] + h * 0.55, c[2] - d * 0.5 - 14], a: [3.5, 7, 4], w: 0.88, group: "bone" }); // facet
  }
  out.push({ c: [c[0], c[1] - h * 0.1, c[2] - d * 0.5 - 22], a: [3.4, h * 0.8, 20], roll: 0, w: 0.94, group: "bone" }); // spinous process, long in the thoracic spine
  return out;
}

/** One vertebra or disc-spaced block of the spine. */
export interface Vertebra { c: V3; size: V3; level: string }
/** Cervical, thoracic and lumbar vertebral bodies, with the kyphosis and lordosis, from the neck down to the sacrum. */
export function spine(): Vertebra[] {
  const out: Vertebra[] = [];
  const zAt = (y: number) => (y < -120 ? -82 - 0.02 * (-120 - y) : -90 - 8 * Math.sin((Math.PI * (y + 120)) / 330));
  for (let i = 0; i < 6; i++) { const y = 262 - i * 17; out.push({ c: [xm + 3, y, zAt(y)], size: [24 + i, 22 + i, 13], level: `C${2 + i}` }); }
  for (let i = 0; i < 12; i++) { const y = 152 - i * 23.8, u = i / 11; out.push({ c: [xm + 3 - 2 * Math.sin(u * 3), y, zAt(y)], size: [28 + 15 * u, 27 + 8 * u, 15 + 8 * u], level: `T${i + 1}` }); }
  for (let i = 0; i < 5; i++) { const y = -140 - i * 32; out.push({ c: [xm + 2, y, zAt(y)], size: [46 + 3 * i, 34, 24], level: `L${i + 1}` }); }
  return out;
}

/** The ribs on one side as 3D polylines (patient frame), with a width in mm at each point. Rib 1 is the highest; they run down and forward. */
export interface Rib { pts: V3[]; widthMm: number[]; level: number }
export function ribs(): Rib[] {
  const A = [58, 75, 92, 105, 115, 122, 126, 128, 127, 123, 113, 100];
  const Bz = [45, 56, 66, 72, 76, 79, 80, 80, 78, 75, 68, 60];
  const drop = [26, 46, 62, 76, 90, 100, 106, 104, 96, 80, 44, 22];
  const ends = [0.78, 0.8, 0.82, 0.84, 0.85, 0.85, 0.85, 0.84, 0.82, 0.78, 0.6, 0.5];
  const out: Rib[] = [];
  for (const side of [1, -1]) {
    for (let i = 0; i < 12; i++) {
      const y0 = 152 - i * 23.8, phi0 = 0.3, phi1 = Math.PI * ends[i], pts: V3[] = [], widthMm: number[] = [];
      for (let k = 0; k <= 14; k++) {
        const u = k / 14, phi = phi0 + (phi1 - phi0) * u;
        pts.push([xm + side * A[i] * Math.sin(phi), y0 - drop[i] * u * u * 0.4 - drop[i] * u * 0.6, -4 - Bz[i] * Math.cos(phi)]);
        widthMm.push(11 - 5 * u);
      }
      out.push({ pts, widthMm, level: i + 1 });
    }
  }
  return out;
}

/** Cardiac and respiratory displacement of a point, in image-plane mm (x', y'): how far it moves from its resting place at `now` ms. */
export function bodyMotion(now: number, heartRate: number, weight: number): { dx: number; dy: number; breath: number; beat: number } {
  const beat = ((now / 1000) * (heartRate / 60)) % 1, breath = Math.sin((now / 1000) * ((2 * Math.PI) / 4.6));
  // systole moves the heart in the first 40 % of the beat; diastole rests (a 3 mm lateral and 5 mm vertical excursion at the coronaries)
  const ph = beat < 0.4 ? (1 - Math.cos((beat / 0.4) * 2 * Math.PI)) / 2 : 0;
  return { dx: weight * (-3 * ph), dy: weight * (5 * ph - 3.5 * breath), breath, beat };
}

/** How much a point at distance `d` mm from the heart moves with it: all of it at the coronaries, little at the arch, none in the pelvis. */
export const motionWeight = (d: number) => Math.exp(-((d / 95) ** 2));
