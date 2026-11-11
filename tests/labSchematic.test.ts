import { describe, it, expect } from "vitest";
import { defaultUnifiedGraph } from "../src/lab/access";
import { schematicLayout, schematicStations, schematicVessels } from "../src/cath/lab/schematic";
import { camTarget, isSchematic, MAX_FLUORO_SPAN_MM } from "../src/cath/lab/camera";
import { StubLabEngine } from "../src/lab/stub";

const g = defaultUnifiedGraph();

describe("overview schematic", () => {
  it("is the only schematic mode", () => {
    expect(isSchematic("overview")).toBe(true); expect(isSchematic("heart")).toBe(false); expect(isSchematic("follow")).toBe(false);
  });
  it("fits every vessel it draws inside the canvas margin, keeping the aspect", () => {
    for (const site of ["femoral-R", "radial-R"] as const) {
      const segs = schematicVessels(g, site), L = schematicLayout(segs, 640, 640, 40, 100);
      for (const s of segs) for (const p of s.samples) { const [x, y] = L.toScreen(p); expect(x).toBeGreaterThanOrEqual(39.9); expect(x).toBeLessThanOrEqual(640 - 100 - 39.9); expect(y).toBeGreaterThanOrEqual(39.9); expect(y).toBeLessThanOrEqual(600.1); }
      const w = L.bounds.x1 - L.bounds.x0, h = L.bounds.y1 - L.bounds.y0, a = L.toScreen([L.bounds.x0, L.bounds.y1, 0]), b = L.toScreen([L.bounds.x1, L.bounds.y0, 0]);
      expect((b[0] - a[0]) / (b[1] - a[1])).toBeCloseTo(w / h, 6);
    }
  });
  it("draws the leg for a femoral puncture and the arm for a radial one, never both", () => {
    const fem = schematicVessels(g, "femoral-R").map((s) => s.id), rad = schematicVessels(g, "radial-R").map((s) => s.id);
    expect(fem).toContain("ILIAC_R"); expect(fem).not.toContain("RADIAL_R");
    expect(rad).toContain("RADIAL_R"); expect(rad).not.toContain("ILIAC_R");
    expect(fem).toContain("RENAL_R"); expect(fem).toContain("LAD");
  });
  it("orders the levels from the puncture toward the heart", () => {
    const ys = schematicStations(g, "femoral-R").map((s) => s.y);
    for (let i = 1; i < ys.length - 1; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
  });
});

describe("follow camera", () => {
  it("never frames more than a real C-arm field, even in the widest zone", () => {
    const e = new StubLabEngine(); e.apply({ t: "access", site: "femoral-R" });
    const c = camTarget("follow", e.state(), e.graph(), [0, 0, 0]);
    expect(c.spanMm).toBeLessThanOrEqual(MAX_FLUORO_SPAN_MM);
  });
});
