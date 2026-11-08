import { describe, it, expect } from "vitest";
import { buildTree } from "../src/anatomy/tree";
import { buildAccess, unify } from "../src/lab/access";
import { zoneOf, deviceFocus, overviewBox, zonesAlongRoute } from "../src/lab/camera";
import { routeTo } from "../src/lab/route";
import type { LabState } from "../src/lab/types";

const tree = buildTree();
const roots = [tree.byId.LM.samples[0], tree.byId.RCA.samples[0]];
const g = unify(
  buildAccess({ arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 32, calcifiedIliac: false }, roots),
  tree,
);

describe("lab camera data", () => {
  it("zones march from access to coronaries along the femoral route", () => {
    const route = routeTo(g, "femoral-R", "LM");
    const zones = zonesAlongRoute(g, route);
    expect(zones[0]).toBe("access");
    expect(zones).toContain("arch");
    expect(zones[zones.length - 1]).toBe("coronary");
  });

  it("focus follows the leading device tip", () => {
    const st: LabState = {
      access: "femoral-R", sheathFr: 6, sheath: { site: "femoral-R", french: 6, lengthMm: 12 },
      act: 250, guide: { id: "guide-jl4", engaged: null, quality: 0.5, tipSeg: "ARCH", tipMm: 40 },
      wire: null, balloon: null, stent: null, carm: { rot: 0, tilt: 0 },
      contrastMl: 0, fluoroSeconds: 0, doseMGy: 0, elapsedS: 0, log: [],
    };
    const f = deviceFocus(st, g);
    expect(f.zone).toBe(zoneOf("ARCH", 40));
    const seg = g.byId.ARCH;
    const u = 40 / seg.length;
    const i = Math.floor(u * (seg.samples.length - 1));
    const p = seg.samples[i];
    expect(Math.hypot(f.point[0] - p[0], f.point[1] - p[1], f.point[2] - p[2])).toBeLessThan(5);
  });

  it("overview box spans the whole graph", () => {
    const box = overviewBox(g);
    expect(box.spanMm).toBeGreaterThan(500);
    expect(box.max[1]).toBeGreaterThan(box.min[1]);
  });
});
