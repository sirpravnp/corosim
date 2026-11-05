import { V3 } from "../anatomy/curve";
import { Pose, insideHeart } from "./poses";
import { ProbeControls, controlsFromPose, poseFromControls } from "./probe";
import { ViewSpec, scorePose } from "./score";

/**
 * Derivative-free search for a better probe pose: coordinate search with shrinking steps over yaw, pitch, two beam tilts, roll
 * and depth, followed by a few seeded random-direction trials per sweep to escape coordinate-aligned ridges. Deterministic for
 * a fixed seed. Never returns a pose that scores lower than the start.
 */

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const comb = (a: V3, b: V3, k: number): V3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]];

/** Parameters: yaw, pitch, tilt about lateral, tilt about the up axis, roll about the beam (radians), depth (mm). */
type Params = [number, number, number, number, number, number];
const STEP0: Params = [0.12, 0.12, 0.12, 0.12, 0.2, 14];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tuneView(
  spec: ViewSpec,
  start: Pose,
  opts: { iterations?: number; seed?: number } = {},
): { pose: Pose; score: number; evals: number } {
  const iterations = opts.iterations ?? 10;
  const rng = mulberry32(opts.seed ?? 1);
  const c0 = controlsFromPose(start);
  const beam0 = unit(c0.beamLocal), lat0 = unit(c0.lateralLocal), up0 = unit(cross(beam0, lat0));
  const dMin = start.depth * 0.7, dMax = start.depth * 1.4;

  const build = (p: Params): Pose | null => {
    const beamLocal = unit(comb(comb(beam0, up0, Math.tan(p[2])), lat0, Math.tan(p[3])));
    if (beamLocal[2] < 0.3) return null;
    const lateralLocal = unit(comb(lat0, up0, Math.tan(p[4])));
    const depth = Math.max(dMin, Math.min(dMax, c0.depth + p[5]));
    const controls: ProbeControls = { yaw: c0.yaw + p[0], pitch: c0.pitch + p[1], beamLocal, lateralLocal, depth };
    const pose = poseFromControls(controls);
    return insideHeart(pose.probe) ? null : pose;
  };

  let evals = 0;
  const evaluate = (p: Params): number => {
    const pose = build(p);
    if (!pose) return -1;
    evals++;
    return scorePose(pose, spec);
  };

  let cur: Params = [0, 0, 0, 0, 0, 0];
  let best = evaluate(cur);
  const startScore = best;
  let scale = 1;
  for (let it = 0; it < iterations; it++) {
    let improved = false;
    for (let k = 0; k < 6; k++) {
      for (const sign of [1, -1]) {
        const trial = cur.slice() as Params;
        trial[k] += sign * STEP0[k] * scale;
        const s = evaluate(trial);
        if (s > best + 1e-9) { best = s; cur = trial; improved = true; break; }
      }
    }
    for (let j = 0; j < 4; j++) {
      const trial = cur.map((v, k) => v + (rng() * 2 - 1) * STEP0[k] * scale) as Params;
      const s = evaluate(trial);
      if (s > best + 1e-9) { best = s; cur = trial; improved = true; }
    }
    if (!improved) scale *= 0.5;
    if (scale < 0.02) break;
  }

  const pose = build(cur);
  if (!pose || best < startScore) return { pose: start, score: startScore, evals };
  return { pose, score: best, evals };
}
