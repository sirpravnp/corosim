import { V3 } from "../anatomy/curve";
import { Pose, insideHeart, landmarks } from "./poses";
import { outwardFrom, projectOntoChest } from "./probe";
import { VIEW_SPECS, scorePose } from "./score";

/**
 * Window-first poses. A standard view fixes a plane through heart landmarks (the long-axis view holds the apex, the mitral valve and
 * the aortic valve; the subcostal four-chamber holds the apex and both atrioventricular valves), but a probe can only sit where the
 * chest lets it: the left parasternal window for the long axis, below the xiphoid for the subcostal. So the plane is fixed, the probe
 * is slid along the curve where that plane meets the schematic chest inside the window, and the beam is tilted in the plane; the
 * scorer picks the best of these. Windows are expressed as yaw (0 = straight in front, positive toward the patient's left) and pitch
 * (0 = level with the heart, positive toward the head) of the contact point as seen from the heart's centre: the same angles `probe.ts` uses.
 */
export interface ChestWindow { yaw: [number, number]; pitch: [number, number] }

/** Windows are estimates from standard teaching, not measurements; widen them rather than trust them to the degree. */
export const WINDOWS: Record<string, ChestWindow> = {
  plax: { yaw: [-0.15, 0.9], pitch: [-0.35, 0.65] },       // left parasternal, third to fifth intercostal space, near the sternum
  subcostal: { yaw: [-0.7, 0.35], pitch: [-1.4, -0.55] }, // just below the xiphoid, from below and in front
};

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export interface PlaneSpec { id: string; point: V3; normal: V3; target: V3 }

/** The fixed planes of the two views whose plane is set by landmarks. */
export function viewPlane(id: "plax" | "subcostal"): PlaneSpec {
  const l = landmarks();
  const a = id === "plax" ? [l.apex, l.mv, l.av] : [l.apex, l.mv, l.tv];
  const normal = unit(cross(sub(a[1], a[0]), sub(a[2], a[0])));
  const target = scale(add(add(a[0], a[1]), a[2]), 1 / 3);
  return { id, point: a[0], normal, target };
}

const shellPoint = (yaw: number, pitch: number): V3 => projectOntoChest(scale(outwardFrom(yaw, pitch), 100));

/** For one yaw: the pitch inside the window where the chest shell crosses the plane, or null. Bisection on the signed distance. */
function pitchOnPlane(plane: PlaneSpec, yaw: number, w: ChestWindow): number | null {
  const f = (pitch: number) => dot(plane.normal, sub(shellPoint(yaw, pitch), plane.point));
  const N = 24;
  let prevP = w.pitch[0], prevF = f(prevP);
  for (let i = 1; i <= N; i++) {
    const p = w.pitch[0] + ((w.pitch[1] - w.pitch[0]) * i) / N, fp = f(p);
    if (prevF === 0) return prevP;
    if (prevF * fp < 0) {
      let lo = prevP, hi = p, flo = prevF;
      for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2, fm = f(mid); if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; } }
      return (lo + hi) / 2;
    }
    prevP = p; prevF = fp;
  }
  return null;
}

export interface Candidate { pose: Pose; yaw: number; pitch: number; tilt: number; flip: boolean; score: number }

/** All plane-locked poses in the window: probe slid along the plane-shell curve, beam tilted in the plane, image either way round. */
export function windowCandidates(plane: PlaneSpec, w: ChestWindow, opts: { yawSteps?: number; tilts?: number[] } = {}): Pose[] {
  const yawSteps = opts.yawSteps ?? 14, tilts = opts.tilts ?? [-0.5, -0.35, -0.2, -0.1, 0, 0.1, 0.2, 0.35, 0.5];
  const out: Pose[] = [];
  for (let i = 0; i <= yawSteps; i++) {
    const yaw = w.yaw[0] + ((w.yaw[1] - w.yaw[0]) * i) / yawSteps, pitch = pitchOnPlane(plane, yaw, w);
    if (pitch === null) continue;
    const probe = shellPoint(yaw, pitch);
    if (insideHeart(probe)) continue;
    const toTarget = unit(sub(plane.target, probe));
    for (const t of tilts) {
      const beam = unit(add(scale(toTarget, Math.cos(t)), cross(plane.normal, toTarget), Math.sin(t)));
      for (const flip of [false, true]) {
        const lateral = scale(unit(cross(plane.normal, beam)), flip ? -1 : 1);
        const depth = Math.max(150, Math.min(240, 1.8 * Math.hypot(...sub(plane.target, probe))));
        out.push({ probe, beam, lateral, target: plane.target, depth, marker: lateral });
      }
    }
  }
  return out;
}

/** The best window pose for a view by its spec score; `candidates` lists everything that was tried, best first. */
export function bestWindowPose(id: "plax" | "subcostal"): { pose: Pose; score: number; tried: number } | null {
  const plane = viewPlane(id), spec = VIEW_SPECS[id];
  let best: { pose: Pose; score: number } | null = null;
  const cands = windowCandidates(plane, WINDOWS[id]);
  for (const pose of cands) {
    const score = scorePose(pose, spec);
    if (!best || score > best.score) best = { pose, score };
  }
  return best ? { ...best, tried: cands.length } : null;
}
