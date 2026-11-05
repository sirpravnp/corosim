import { describe, it, expect } from "vitest";
import { buildPoses, insideHeart } from "../src/echo/poses";
import { controlsFromPose } from "../src/echo/probe";
import { WINDOWS, bestWindowPose, viewPlane, windowCandidates } from "../src/echo/window";

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const poses = buildPoses();

describe("window-first poses", () => {
  it.each(["plax", "subcostal"] as const)("%s: every candidate keeps its probe outside the heart, on the plane, inside the window", (id) => {
    const plane = viewPlane(id), w = WINDOWS[id], cands = windowCandidates(plane, w);
    expect(cands.length).toBeGreaterThan(5);
    for (const p of cands) {
      expect(insideHeart(p.probe as [number, number, number])).toBe(false);
      expect(Math.abs(dot(plane.normal, [p.probe[0] - plane.point[0], p.probe[1] - plane.point[1], p.probe[2] - plane.point[2]]))).toBeLessThan(0.5);
      const c = controlsFromPose(p);
      expect(c.yaw).toBeGreaterThanOrEqual(w.yaw[0] - 0.02); expect(c.yaw).toBeLessThanOrEqual(w.yaw[1] + 0.02);
      expect(c.pitch).toBeGreaterThanOrEqual(w.pitch[0] - 0.02); expect(c.pitch).toBeLessThanOrEqual(w.pitch[1] + 0.02);
    }
  });
  it.each(["plax", "subcostal"] as const)("%s: the pose stored in poses.ts is what the search finds", (id) => {
    const best = bestWindowPose(id)!, stored = poses[id];
    expect(Math.hypot(best.pose.probe[0] - stored.probe[0], best.pose.probe[1] - stored.probe[1], best.pose.probe[2] - stored.probe[2])).toBeLessThan(0.5);
    expect(dot(best.pose.beam, stored.beam)).toBeGreaterThan(0.9999);
    expect(dot(best.pose.lateral, stored.lateral)).toBeGreaterThan(0.9999);
  });
  it("the long-axis probe is on the anterior chest and the beam heads back, the subcostal probe is below the heart", () => {
    expect(poses.plax.probe[2]).toBeGreaterThan(30);
    expect(poses.plax.beam[2]).toBeLessThan(-0.5);
    expect(poses.subcostal.probe[1]).toBeLessThan(-15);
  });
});
