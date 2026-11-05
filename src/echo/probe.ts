import { V3 } from "../anatomy/curve";
import { Pose, insideHeart } from "./poses";

/**
 * Free probe on a schematic chest shell around the heart. Slide is yaw and pitch of the contact
 * point; tilt and roll live as the beam and lateral in the local chest frame, so they follow when
 * the probe slides. The shell is not a torso: it only keeps the probe outside the heart. Standard
 * views are presets of this state.
 */

const ORIGIN: V3 = [0, 0, 0];
/** Skin allowance beyond the last heart point on a ray from the origin, mm. */
const SKIN = 12;
const STEP = 0.5;
const MAX = 250;
/** Distance below this counts as "at" a preset (mm of position plus weighted radians). */
const NEAR = 18;
/** Distance below this pulls the probe onto the preset. */
const SNAP = 12;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface ProbeControls {
  /** Azimuth of the chest contact around the patient vertical, radians. */
  yaw: number;
  /** Elevation of the chest contact from the horizontal, radians. */
  pitch: number;
  /** Beam in the local chest frame (z inward). */
  beamLocal: V3;
  /** Lateral axis in the local chest frame. */
  lateralLocal: V3;
  depth: number;
}

export interface ProbePreset {
  id: string;
  pose: Pose;
  controls: ProbeControls;
}

type Frame = { x: V3; y: V3; z: V3 };

/** Outward unit direction from yaw and pitch (patient frame: +y up, +z anterior). */
export function outwardFrom(yaw: number, pitch: number): V3 {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return unit([cp * Math.sin(yaw), sp, cp * Math.cos(yaw)]);
}

/** Local chest axes at an outward contact: z inward, y toward the head in the tangent plane. */
function chestFrame(outward: V3): Frame {
  const z = scale(outward, -1);
  let y = unit(sub([0, 1, 0], scale(z, dot([0, 1, 0], z))));
  if (len(y) < 0.2) y = unit(sub([1, 0, 0], scale(z, dot([1, 0, 0], z))));
  const x = unit(cross(y, z));
  return { x, y, z };
}

const toLocal = (v: V3, f: Frame): V3 => [dot(v, f.x), dot(v, f.y), dot(v, f.z)];
const fromLocal = (v: V3, f: Frame): V3 => unit(add(add(scale(f.x, v[0]), scale(f.y, v[1])), scale(f.z, v[2])));

/** The point on the schematic chest along the ray from the heart origin through `p`. */
export function projectOntoChest(p: V3): V3 {
  const dir = unit(sub(p, ORIGIN));
  let last = 0;
  for (let t = 0; t < MAX; t += STEP) if (insideHeart(add(ORIGIN, dir, t))) last = t;
  const radius = last > 0 ? last + SKIN : 90;
  return add(ORIGIN, dir, radius);
}

function anglesOf(dir: V3): { yaw: number; pitch: number } {
  return { pitch: Math.asin(clamp(dir[1], -1, 1)), yaw: Math.atan2(dir[0], dir[2]) };
}

/** Build chest controls that reproduce a pose. */
export function controlsFromPose(pose: Pose): ProbeControls {
  const outward = unit(sub(pose.probe, ORIGIN));
  const { yaw, pitch } = anglesOf(outward);
  const frame = chestFrame(outward);
  const beam = unit(pose.beam);
  const lateral = unit(sub(pose.lateral, scale(beam, dot(pose.lateral, beam))));
  return {
    yaw,
    pitch,
    beamLocal: toLocal(beam, frame),
    lateralLocal: toLocal(lateral, frame),
    depth: pose.depth,
  };
}

/** Pose for these controls: contact on the chest shell, beam and lateral from the local frame. */
export function poseFromControls(c: ProbeControls): Pose {
  const outward = outwardFrom(c.yaw, c.pitch);
  const frame = chestFrame(outward);
  const probe = projectOntoChest(add(ORIGIN, outward, 100));
  const beam = fromLocal(c.beamLocal, frame);
  let lateral = fromLocal(c.lateralLocal, frame);
  lateral = unit(sub(lateral, scale(beam, dot(lateral, beam))));
  if (len(lateral) < 0.5) lateral = unit(cross(beam, Math.abs(beam[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const target = add(probe, beam, Math.min(c.depth * 0.55, 90));
  return { probe, beam, lateral, target, depth: c.depth, marker: lateral };
}

export function presetsFromPoses(poses: Record<string, Pose>): ProbePreset[] {
  return Object.entries(poses).map(([id, pose]) => ({ id, pose, controls: controlsFromPose(pose) }));
}

/** Weighted distance between two poses: millimetres of probe gap plus angle costs. */
export function poseDistance(a: Pose, b: Pose): number {
  const pos = len(sub(a.probe, b.probe));
  const beam = Math.acos(clamp(dot(unit(a.beam), unit(b.beam)), -1, 1));
  const lat = Math.acos(clamp(Math.abs(dot(unit(a.lateral), unit(b.lateral))), -1, 1));
  return pos + 45 * beam + 25 * lat;
}

/** Closest preset within the "near" band, or null. */
export function nearestPreset(pose: Pose, presets: ProbePreset[]): ProbePreset | null {
  let best: ProbePreset | null = null, bestD = Infinity;
  for (const preset of presets) {
    const d = poseDistance(pose, preset.pose);
    if (d < bestD) { bestD = d; best = preset; }
  }
  return best && bestD <= NEAR ? best : null;
}

/** Snap onto a preset when close enough; otherwise return the pose unchanged. */
export function snapPose(pose: Pose, presets: ProbePreset[]): { id: string | null; pose: Pose } {
  let best: ProbePreset | null = null, bestD = Infinity;
  for (const preset of presets) {
    const d = poseDistance(pose, preset.pose);
    if (d < bestD) { bestD = d; best = preset; }
  }
  if (best && bestD <= SNAP) return { id: best.id, pose: best.pose };
  return { id: null, pose };
}

/** Move the contact to a chest point, keeping the local beam and lateral. */
export function slideProbe(pose: Pose, pointOnChest: V3): Pose {
  const c = controlsFromPose(pose);
  const on = projectOntoChest(pointOnChest);
  const { yaw, pitch } = anglesOf(unit(sub(on, ORIGIN)));
  return poseFromControls({ ...c, yaw, pitch });
}

/** Rotate the image about the beam (index-mark roll), radians. */
export function twistProbe(pose: Pose, delta: number): Pose {
  const c = controlsFromPose(pose);
  const beam = unit(c.beamLocal);
  const lat = unit(c.lateralLocal);
  const up = unit(cross(beam, lat));
  const lateralLocal = unit(add(scale(lat, Math.cos(delta)), scale(up, Math.sin(delta))));
  return poseFromControls({ ...c, lateralLocal });
}
