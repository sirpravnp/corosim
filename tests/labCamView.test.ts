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
