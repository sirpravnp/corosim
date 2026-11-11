import { V3 } from "../anatomy/curve";
import { Pose, insideHeart, landmarks, toPatient } from "./poses";
import { ctGeom, ctLandmarksHeart, vesselPathsHeart } from "./ctEcho";
import { MorphPart } from "../anatomy/heartSurface";

/**
 * Transesophageal probe. The probe rides a fixed path: down the esophagus just behind the left atrium, then forward into the stomach
 * under the left ventricle. The operator has the four real controls:
 *   level   advance (more negative, toward the stomach) or withdraw, mm along the path from the mid-esophageal reference;
 *   turn    rotate the shaft to the patient's left (positive) or right, degrees;
 *   flex    ante- (positive: the tip and beam tilt toward the head) or retroflexion, degrees;
 *   angle   the omniplane angle, 0 to 180 degrees: 0 is a transverse plane, 90 a sagittal one.
 * At 0 degrees the image's right side is the patient's left; at 90 degrees it is the head. These are the usual display conventions.
 * Patient frame, mm: x toward the patient's left, y toward the head, z anterior. Schematic: the path is placed against this heart,
 * not measured from a patient. Lungs, the left main bronchus and the trachea are not modeled.
 */
export interface TeeControls { level: number; turn: number; flex: number; angle: number }

/**
 * Esophagus: a vertical line just behind the left atrium (on the CT heart, 6 mm behind its posterior wall at the atrium's centre, found
 * by walking back from the centre until the heart ends). Stomach: the path bends forward and to the left under the heart. `y0` is the
 * mid-esophageal reference level, at the left atrium's centre.
 */
const ESO = { x: -20, z: -66, y0: 28 };
let esoFor: unknown = null;
function esophagus() {
  if (!ctGeom()) return ESO;
  const key = ctGeom();
  if (esoFor !== key) {
    const la = toPatient(ctLandmarksHeart().la);
    let z = la[2];
    while (z > la[2] - 120 && insideHeart([la[0], la[1], z])) z -= 0.5;
    ESO.x = la[0]; ESO.z = z - 6; ESO.y0 = la[1]; esoFor = key;
  }
  return ESO;
}
/**
 * Levels (mm from the mid-esophageal reference at the left atrium's centre): where the esophagus meets the stomach (it runs several
 * centimetres below the left atrium before it crosses the diaphragm), the fundus under the LV's mid inferior wall, and the deep
 * transgastric position under the apex.
 */
const GE_JUNCTION = -55, FUNDUS_LEVEL = -85, DEEP_LEVEL = -125;
/** Levels the probe can take: higher, the modeled aortic arch crosses the path; lower is the deep stomach. */
export const LEVEL_RANGE: [number, number] = [-140, 22];

/** Where the probe tip is for a level, and the path's forward (anterior) direction at that point. */
/** The stomach on the CT heart: the fundus point under the LV's mid inferior wall and the deep point under the apex, 12 mm below the heart. */
let stomachFor: unknown = null, ST: { fundus: V3; deep: V3 } | null = null;
function stomach(): { fundus: V3; deep: V3 } | null {
  if (!ctGeom()) return null;
  if (stomachFor !== ctGeom()) {
    const c = ctLandmarksHeart(), below = (p: V3): V3 => { const q: V3 = [p[0], p[1], p[2]]; let n = 0; while (insideHeart(q) && n++ < 300) q[1] -= 0.5; q[1] -= 12; return q; };
    const lv = toPatient(c.lv), apex = toPatient(c.apex);
    ST = { fundus: below(lv), deep: below([apex[0] - 8, apex[1] + 12, apex[2] - 10]) };
    stomachFor = ctGeom();
  }
  return ST;
}

export function probePoint(level: number): { at: V3; forward: V3 } {
  const ESO = esophagus();
  level = Math.max(LEVEL_RANGE[0], Math.min(LEVEL_RANGE[1], level));
  if (level >= GE_JUNCTION) return { at: [ESO.x, ESO.y0 + level, ESO.z], forward: [0, 0, 1] };
  const st = stomach();
  if (st) {
    // on the CT heart: from the junction down to the fundus under the LV's mid inferior wall (level -62), on to below the apex (-110),
    // the tip looking up through the inferior wall
    const ge: V3 = [ESO.x, ESO.y0 + GE_JUNCTION, ESO.z];
    const seg = level >= FUNDUS_LEVEL ? { a: ge, b: st.fundus, u: (GE_JUNCTION - level) / (GE_JUNCTION - FUNDUS_LEVEL) } : { a: st.fundus, b: st.deep, u: Math.min(1, (FUNDUS_LEVEL - level) / (FUNDUS_LEVEL - DEEP_LEVEL)) };
    const at: V3 = [seg.a[0] + (seg.b[0] - seg.a[0]) * seg.u, seg.a[1] + (seg.b[1] - seg.a[1]) * seg.u, seg.a[2] + (seg.b[2] - seg.a[2]) * seg.u];
    const k = Math.min(1, (GE_JUNCTION - level) / 40);
    return { at, forward: unit(add(scale([0, 0, 1], 1 - k), unit([0.15, 0.75, 0.6]), k)) };
  }
  // below the junction the tip curves into the fundus: forward and to the left, under the inferior wall
  const k = Math.min(1, (GE_JUNCTION - level) / 70);
  const y = ESO.y0 + GE_JUNCTION - 0.55 * (GE_JUNCTION - level);
  return { at: [ESO.x + 30 * k, y, ESO.z + 46 * k], forward: [0.3 * k, 0.55 * k, 1 - 0.3 * k] };
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rad = (d: number) => (d * Math.PI) / 180, deg = (r: number) => (r * 180) / Math.PI;
const rotY = (v: V3, a: number): V3 => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];

/** The pose for a set of controls. `depth` is the sector depth, mm. */
export function teePose(c: TeeControls, depth = 140): Pose {
  const { at, forward } = probePoint(c.level);
  // turn about the vertical, then flex toward the head (positive) or the feet
  const f0 = unit(rotY(forward, rad(c.turn)));
  const side = unit(cross([0, 1, 0], f0)); // horizontal, perpendicular to the beam; points to the patient's left when the beam is anterior
  const beam = unit(add(scale(f0, Math.cos(rad(c.flex))), [0, 1, 0], Math.sin(rad(c.flex))));
  const L0 = unit(sub(side, scale(beam, dot(side, beam))));
  const up = unit(cross(beam, L0)); // completes the frame; toward the head at 90 degrees
  const lateral = unit(add(scale(L0, Math.cos(rad(c.angle))), up, Math.sin(rad(c.angle))));
  return { probe: at, beam, lateral, marker: lateral, target: add(at, beam, depth * 0.5), depth };
}

/**
 * The controls that put a plane through the probe and two target points, with the beam aimed at `aim`: how a standard view is
 * defined anatomically and then expressed in the probe's own terms. `level` is fixed by the view; the screen-right side of the image is
 * chosen toward `rightward` (a direction in the patient frame) so each view comes up the way it is usually displayed.
 */
export function controlsFor(level: number, a: V3, b: V3, aim: V3, rightward: V3): TeeControls {
  const { at, forward } = probePoint(level);
  const toAim = unit(sub(aim, at));
  const n = unit(cross(sub(a, at), sub(b, at)));
  // beam: the aim direction, squared into the plane
  const beam = unit(sub(toAim, scale(n, dot(toAim, n))));
  // turn and flex: the beam's heading against the path's forward direction
  const turn = deg(Math.atan2(beam[0], beam[2])) - deg(Math.atan2(forward[0], forward[2]));
  const flex = deg(Math.asin(Math.max(-1, Math.min(1, beam[1])))) - deg(Math.asin(Math.max(-1, Math.min(1, forward[1]))));
  const base = teePose({ level, turn, flex, angle: 0 });
  let lat = unit(cross(n, base.beam));
  if (dot(lat, rightward) < 0) lat = scale(lat, -1);
  const L0 = base.lateral, up = unit(cross(base.beam, L0));
  let angle = deg(Math.atan2(dot(lat, up), dot(lat, L0)));
  if (angle < 0) angle += 360;
  // the omniplane runs 0 to 180; beyond that the same plane comes up mirrored, so mirror back and accept the flipped side
  if (angle > 180) angle -= 180;
  return { level, turn, flex, angle };
}

/** The standard TEE views as controls, from the heart's landmarks. */
export function teeViews(): Record<string, TeeControls> {
  const l = landmarks();
  const P = (h: V3) => toPatient(h);
  const mid = (a: V3, b: V3, k = 0.5): V3 => add(a, sub(b, a), k);
  const ct = ctGeom() ? ctLandmarksHeart() : null;
  // the caval entries into the right atrium, the pulmonary valve and the descending aorta: from the CT heart when it is installed
  const raTop = ct ? P(vesselPathsHeart(MorphPart.SVC)[0][0]) : P([-30, 70, -8]), raBottom = ct ? P(vesselPathsHeart(MorphPart.IVC)[0][0]) : P([-28, 36, -6]);
  const rvot = ct ? P(ct.pv) : P([0, 52, 25]);
  const left: V3 = [1, 0, 0], head: V3 = [0, 1, 0], ant: V3 = [0, 0, 1];
  const rootAxis = P([0, 1, 0]);
  const E = esophagus(), mvLevel = l.mv[1] - E.y0, avLevel = l.av[1] - E.y0 + 6;
  const tgTarget = mid(l.apex, l.mv, 0.42);
  return {
    // the four- and two-chamber views from behind the left atrium, about 2 cm above the mitral valve, looking down through it: the beam
    // then runs within about 20 degrees of mitral inflow, as it does on a real ME four-chamber view (lower, the angle opens past 50)
    me4c: controlsFor(mvLevel + 24, l.mv, l.tv, mid(l.apex, mid(l.mv, l.tv), 0.45), left),
    me2c: (() => { const c = controlsFor(mvLevel + 24, l.mv, l.tv, mid(l.apex, mid(l.mv, l.tv), 0.45), left); return { ...c, angle: Math.min(180, c.angle + 85) }; })(),
    meLax: controlsFor(mvLevel - 2, l.mv, l.av, mid(l.apex, l.mv, 0.55), head),
    meAvSax: controlsFor(avLevel, l.av, add(l.av, cross(rootAxis, ant), 10), l.av, left),
    meAvLax: controlsFor(avLevel, l.av, add(l.av, rootAxis, 25), l.av, head),
    meRvIo: controlsFor(mvLevel + 2, l.tv, rvot, mid(l.tv, rvot), left),
    meBicaval: controlsFor(mvLevel + 4, raTop, raBottom, mid(raTop, raBottom), head),
    tgMidSax: (() => { const lv = l.longAxis, e = unit(cross(lv, left)); return controlsFor(FUNDUS_LEVEL, tgTarget, add(tgTarget, unit(cross(lv, e)), 20), tgTarget, left); })(),
    tg2c: (() => { const lv = l.longAxis, e = unit(cross(lv, left)); const c = controlsFor(FUNDUS_LEVEL, tgTarget, add(tgTarget, unit(cross(lv, e)), 20), tgTarget, left); return { ...c, angle: Math.min(180, c.angle + 90) }; })(),
    deepTgLax: controlsFor(DEEP_LEVEL, l.apex, l.av, mid(l.apex, l.av, 0.6), left),
    descAortaSax: (() => {
      if (!ct) return { level: 18, turn: 180, flex: 0, angle: 0 };
      // a transverse cut through the descending aorta at the mid-esophageal level, the probe turned back toward it
      const level = 0, at = probePoint(level).at, dao = vesselPathsHeart(MorphPart.DAO)[0].map(P);
      const a = dao[1], b = dao[2], k = (at[1] - a[1]) / (b[1] - a[1]), c: V3 = [a[0] + (b[0] - a[0]) * k, at[1], a[2] + (b[2] - a[2]) * k];
      return controlsFor(level, c, add(c, [1, 0, 0], 10), c, left);
    })(),
  };
}

export { insideHeart };
