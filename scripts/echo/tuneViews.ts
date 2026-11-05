import { buildPoses } from "../../src/echo/poses";
import { controlsFromPose, poseDistance } from "../../src/echo/probe";
import { VIEW_SPECS, scorePose } from "../../src/echo/score";
import { tuneView } from "../../src/echo/tune";

const f = (n: number, d = 3) => n.toFixed(d);
const deg = (r: number) => f((r * 180) / Math.PI, 1);
const poses = buildPoses();
console.log("view        start  tuned  probe mm  beam deg  evals");
for (const id of Object.keys(poses)) {
  const spec = VIEW_SPECS[id], start = poses[id];
  const t0 = Date.now();
  const r = tuneView(spec, start, { iterations: 14, seed: 1 });
  const mm = Math.hypot(...r.pose.probe.map((v, i) => v - start.probe[i]) as [number, number, number]);
  const ang = Math.acos(Math.max(-1, Math.min(1, r.pose.beam.reduce((s, v, i) => s + v * start.beam[i], 0))));
  console.log(`${id.padEnd(10)} ${f(scorePose(start, spec))}  ${f(r.score)}  ${f(mm, 1).padStart(7)}  ${deg(ang).padStart(8)}  ${r.evals} (${Date.now() - t0} ms)  dist ${f(poseDistance(start, r.pose), 1)}`);
  const c = controlsFromPose(r.pose);
  console.log("   controls", JSON.stringify({ yaw: +f(c.yaw), pitch: +f(c.pitch), beamLocal: c.beamLocal.map((v) => +f(v)), lateralLocal: c.lateralLocal.map((v) => +f(v)), depth: +f(c.depth, 1) }));
}
