import { describe, it, expect } from "vitest";
import { StubLabEngine } from "../src/lab/stub";
import { stubById } from "../src/lab/stubCatalog";
import { deviceGeometry } from "../src/cath/lab/fluoro";
import { frameOf, AngioOptions } from "../src/cath/angio";
import type { LabEngineLike } from "../src/lab/types";

const opts: AngioOptions = { rot: 30, tilt: 20, injection: "left", labels: false, heartRate: 70 };
const prep = (e: LabEngineLike, advance = 0) => {
  e.apply({ t: "access", site: "femoral-R" }); e.apply({ t: "select", slot: "guide", id: "guide-jl4" }); e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
  for (let i = 0; i < advance; i++) e.apply({ t: "advance", mm: 40 });
};
const arc = (pts: number[][]) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]), 0);

describe("deviceGeometry", () => {
  it("has no geometry when no device is in", () => {
    const e = new StubLabEngine();
    const g = deviceGeometry(e.state(), e.graph(), e.plaques(), (id) => stubById[id]);
    expect(g.guide).toEqual([]); expect(g.wire).toEqual([]); expect(g.wireTip).toBeNull(); expect(g.balloon).toBeUndefined(); expect(g.stent).toBeUndefined();
  });
  it("starts the wire at the puncture and ends it at the tip", () => {
    const e = new StubLabEngine(); prep(e, 14);
    const g = deviceGeometry(e.state(), e.graph(), e.plaques(), (id) => stubById[id]);
    const acc = e.graph().byId.FEM_R;
    expect(g.wire[0]).toEqual(acc.samples[0]);
    const w = e.state().wire!, seg = e.graph().byId[w.tipSeg];
    expect(g.wireTip).toEqual(g.wire[g.wire.length - 1]);
    const NS = seg.samples.length - 1, idx = Math.round((w.tipMm / seg.length) * NS);
    expect(g.wireTip).toEqual(seg.samples[idx]);
  });
  it("wire length matches the distance travelled within one sample step", () => {
    const e = new StubLabEngine(); prep(e, 14);
    const g = deviceGeometry(e.state(), e.graph(), e.plaques(), (id) => stubById[id]);
    const w = e.state().wire!, graph = e.graph();
    let travelled = 0;
    for (const id of w.route) { if (id === w.tipSeg) { travelled += w.tipMm; break; } travelled += graph.byId[id].length; }
    expect(Math.abs(arc(g.wire) - travelled)).toBeLessThan(6);
  });
  it("puts the guide at the left main ostium once engaged", () => {
    const e = new StubLabEngine(); prep(e);
    const g = deviceGeometry(e.state(), e.graph(), e.plaques(), (id) => stubById[id]);
    expect(g.guide.length).toBeGreaterThan(2);
    const tip = g.guide[g.guide.length - 1], os = e.graph().byId.LM.samples[0];
    expect(Math.hypot(tip[0] - os[0], tip[1] - os[1], tip[2] - os[2])).toBeLessThan(0.5);
  });
  it("puts balloon markers on both sides of the balloon length", () => {
    const e = new StubLabEngine(); prep(e, 14);
    e.apply({ t: "select", slot: "balloon", id: "bal-semi-3.00-12" });
    const g = deviceGeometry(e.state(), e.graph(), e.plaques(), (id) => stubById[id]);
    expect(g.balloon).toBeDefined();
    const span = Math.hypot(g.balloon!.to[0] - g.balloon!.from[0], g.balloon!.to[1] - g.balloon!.from[1], g.balloon!.to[2] - g.balloon!.from[2]);
    expect(span).toBeGreaterThan(8); expect(span).toBeLessThan(13); // 12 mm, a little shorter on a curved vessel
    expect(g.markers.length).toBe(2);
  });
  it("projects the wire tip inside the canvas at the default C-arm angles", () => {
    const e = new StubLabEngine(); prep(e, 14);
    const g = deviceGeometry(e.state(), e.graph(), e.plaques(), (id) => stubById[id]);
    const f = frameOf(e.graph().byId.LM.samples[0], opts, 0, 560, 560);
    const [x, y] = f.toScreen(g.wireTip!);
    expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(560); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(560);
  });
});
