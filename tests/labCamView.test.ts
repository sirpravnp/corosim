import { describe, it, expect } from "vitest";
import { StubLabEngine } from "../src/lab/stub";
import { camTarget, easeCam, HEART_SPAN_MM } from "../src/cath/lab/camera";

const heart: [number, number, number] = [10, 20, 30];

describe("camera view", () => {
  it("heart mode frames the angiogram's own centre at the default span", () => {
    const e = new StubLabEngine();
    expect(camTarget("heart", e.state(), e.graph(), heart)).toEqual({ centre: heart, spanMm: HEART_SPAN_MM });
  });
  it("overview spans the whole graph, wider than the heart frame", () => {
    const e = new StubLabEngine();
    expect(camTarget("overview", e.state(), e.graph(), heart).spanMm).toBeGreaterThan(0);
  });
  it("follow aims at the device focus", () => {
    const e = new StubLabEngine();
    e.apply({ t: "access", site: "femoral-R" });
    const c = camTarget("follow", e.state(), e.graph(), heart);
    expect(c.spanMm).toBeGreaterThan(0);
    expect(c.centre.every(Number.isFinite)).toBe(true);
  });
  it("easing closes the gap without overshooting and converges", () => {
    let c = { centre: [0, 0, 0] as [number, number, number], spanMm: 100 };
    const to = { centre: [100, 0, 0] as [number, number, number], spanMm: 300 };
    for (let i = 0; i < 80; i++) { const n = easeCam(c, to); expect(n.centre[0]).toBeLessThanOrEqual(100); c = n; }
    expect(c.centre[0]).toBeCloseTo(100, 1); expect(c.spanMm).toBeCloseTo(300, 0);
  });
});

import { startCam } from "../src/cath/lab/camera";
import { defaultUnifiedGraph } from "../src/lab/access";

describe("a procedure starts at the puncture site", () => {
  it("Follow looks at the groin before there is any device, and at the wrist for a radial start", () => {
    const e = new StubLabEngine(), g = defaultUnifiedGraph();
    const fem = camTarget("follow", e.state(), g, heart, "femoral-R"), want = startCam(g, "femoral-R");
    expect(fem).toEqual(want);
    expect(fem.centre[1]).toBeLessThan(-350); // the groin, far below the heart
    expect(fem.spanMm).toBeLessThanOrEqual(260);
    const rad = startCam(g, "radial-R");
    expect(rad.centre[0]).toBeLessThan(-300); // the arm
    const left = startCam(g, "femoral-L");
    expect(left.centre[0]).toBeGreaterThan(fem.centre[0]); // the other side
  });
  it("moves up the body as the device does: the focus rises from the groin through the aorta toward the heart", () => {
    const g = defaultUnifiedGraph(), e = new StubLabEngine(), st = { ...e.state(), access: "femoral-R" as const };
    const at = (seg: string, mm: number) => camTarget("follow", { ...st, guide: { id: "guide-jl4", engaged: null, quality: 0, tipSeg: seg, tipMm: mm } }, g, heart).centre[1];
    const ys = [at("FEM_R", 10), at("ILIAC_R", 100), at("AORTA_ABD", 100), at("AORTA_THOR", 100), at("AORTA_THOR", 170)];
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    expect(ys[0]).toBeLessThan(-350);
  });
});
