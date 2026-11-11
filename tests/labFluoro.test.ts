import { describe, it, expect } from "vitest";
import { StubLabEngine } from "../src/lab/stub";
import { stubById } from "../src/lab/stubCatalog";
import { deviceGeometry, tipView } from "../src/cath/lab/fluoro";
import { frameOf, AngioOptions } from "../src/cath/angio";
import type { LabEngineLike } from "../src/lab/types";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { CATALOG } from "../src/config/labDevices";
import { routeTo } from "../src/lab/route";
import { peripheralCam, peripheralDye, peripheralSegments, PERIPHERAL_VIEWS } from "../src/cath/lab/camera";
import peripheral from "../src/cath/data/peripheral.json";

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

// ---------------------------------------------------------------- Task 7: peripheral rendering and run-off views

const realEngine = (() => {
  let e: LabEngine | null = null;
  return () => {
    if (!e) { const sim = new Simulation({ seed: 3 }); e = new LabEngine(sim, { seed: 5, access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false }, plaques: [] }); }
    return e;
  };
})();
const near = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const minDist = (p: number[], pts: number[][]) => Math.min(...pts.map((q) => near(p, q)));

describe("peripheral rendering and run-off views", () => {
  it("femoral route is drawn end to end: sheath at the CFA, iliacs, aortic bifurcation, aorta, arch, root, all in one Follow-device sequence", () => {
    const e = realEngine(); e.reset();
    e.apply({ t: "access", site: "femoral-R" }); e.apply({ t: "sheath", french: 6 });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" }); e.apply({ t: "autoAdvance", to: "LM" });
    const g = e.graph(), geo = deviceGeometry(e.state(), g, e.plaques(), (id) => CATALOG.find((d) => d.id === id));
    expect(routeTo(g, "femoral-R", "LM").slice(0, 6)).toEqual(["FEM_R", "ILIAC_R", "AORTA_ABD", "AORTA_THOR", "ARCH", "AORTA_ASC"]);
    expect(near(geo.guide[0], g.byId.FEM_R.samples[0])).toBeLessThan(1);
    for (const id of ["ILIAC_R", "AORTA_ABD", "AORTA_THOR", "ARCH", "AORTA_ASC"]) {
      const mid = g.byId[id].samples[Math.floor(g.byId[id].samples.length / 2)];
      expect(minDist(mid, geo.guide), id).toBeLessThan(4);
    }
  });

  it("radial route is drawn end to end: radial, brachial, axillary, subclavian, brachiocephalic or left subclavian origin, arch, root", () => {
    const g = realEngine().graph();
    const r = routeTo(g, "radial-R", "LM");
    expect(r.slice(0, 5)).toEqual(["RADIAL_R", "BRACH_R", "SUBCLAV_R", "INNOM", "AORTA_ASC"]);
  });

  it("a guide in the aorta is drawn as a catheter lying in the lumen with its curve", () => {
    const e = realEngine(); e.reset();
    e.apply({ t: "access", site: "femoral-R" }); e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    for (let i = 0; i < 10; i++) e.apply({ t: "advance", mm: 40 });
    const g = e.graph(), geo = deviceGeometry(e.state(), g, e.plaques(), (id) => CATALOG.find((d) => d.id === id));
    const aorta = ["AORTA_ABD", "AORTA_THOR"].flatMap((id) => g.byId[id].samples.map((p, i) => ({ p, r: g.byId[id].diameterMm[i] / 2 })));
    const inAorta = geo.guide.filter((p) => p[1] > -250 && p[1] < 60);
    expect(inAorta.length).toBeGreaterThan(10);
    for (const p of inAorta) {
      const best = aorta.reduce((a, b) => (near(p, b.p) < near(p, a.p) ? b : a));
      expect(near(p, best.p)).toBeLessThanOrEqual(best.r + 1);
    }
  });

  it("runoff camera frames both legs with every peripheral segment inside the field", () => {
    const g = realEngine().graph(), cam = peripheralCam("runoff", g), half = cam.spanMm / 2;
    const legs = peripheralSegments(g).filter((s) => PERIPHERAL_VIEWS.runoff.vessels.test(s.id));
    expect(legs.some((s) => s.id.endsWith("_R"))).toBe(true);
    expect(legs.some((s) => s.id.endsWith("_L"))).toBe(true);
    for (const s of legs) for (const p of s.samples) {
      expect(Math.abs(p[0] - cam.centre[0]), s.id).toBeLessThanOrEqual(half);
      expect(Math.abs(p[1] - cam.centre[1]), s.id).toBeLessThanOrEqual(half);
    }
    for (const v of ["aortogram", "iliac", "arm"] as const) expect(peripheralCam(v, g).spanMm).toBeLessThan(cam.spanMm);
  });

  it("lumen width follows baked radius within 10 percent in pixels", () => {
    const g = realEngine().graph(), dye = peripheralDye("runoff", g);
    const baked = (peripheral as { segments: { id: string; radiusMm: number[] }[] }).segments;
    let checked = 0;
    for (const id of ["POP_R", "ATA_R", "PTA_R", "PERONEAL_R", "DP_R"]) {
      const b = baked.find((x) => x.id === id)!, d = dye.segs.find((x) => x.id === id)!;
      expect(d, id).toBeTruthy();
      const sc = 640 / peripheralCam("runoff", g).spanMm; // pixels per mm at the run-off zoom
      for (let i = 0; i < d.diameterMm.length; i++) {
        const px = d.diameterMm[i] * sc, want = 2 * b.radiusMm[Math.min(i, b.radiusMm.length - 1)] * sc;
        expect(Math.abs(px - want) / want).toBeLessThanOrEqual(0.1); checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("distal vessels fill later than proximal (contrast transit)", () => {
    const g = realEngine().graph(), dye = peripheralDye("runoff", g);
    const dist = (id: string) => near(dye.segs.find((s) => s.id === id)!.samples[0], dye.origin);
    expect(dist("SFA_R")).toBeLessThan(dist("POP_R"));
    expect(dist("POP_R")).toBeLessThan(dist("ATA_R") + 1);
    expect(dist("ATA_R")).toBeLessThan(dist("DP_R"));
    expect(dye.reachMm).toBeGreaterThan(dist("DP_R")); // the bolus chase reaches the foot
  });
});

describe("the shaped wire tip on fluoroscopy", () => {
  it("is straight without a bend, swings sideways with torque, and flips side past 90 degrees", () => {
    expect(tipView(0, 70)).toEqual({ along: 1, side: 0 });
    const a = tipView(45, 0), b = tipView(45, 60), c = tipView(45, 180);
    expect(a.side).toBeGreaterThan(b.side);
    expect(b.side).toBeGreaterThan(0);
    expect(c.side).toBeCloseTo(-a.side, 9);
    expect(Math.abs(tipView(45, 90).side)).toBeLessThan(1e-9);
  });
});
