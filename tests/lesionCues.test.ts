import { describe, it, expect } from "vitest";
import { narrowing, plaqueSector, plaqueBulge, plaqueTint, calcification, thrombusAt, muralThrombus, flowDensity, flowSpeedScale, blushLevel } from "../src/anatomy/lesionCues";

describe("lesion cues", () => {
  it("reads no narrowing for a healthy lumen and a growing one for a tighter lumen", () => {
    expect(narrowing(3, 3)).toBe(0);
    expect(narrowing(2.95, 3)).toBe(0);
    let prev = 0;
    for (const f of [0.3, 0.5, 0.7, 0.9]) { const n = narrowing(3 * (1 - f), 3); expect(n).toBeGreaterThan(prev); expect(n).toBeCloseTo(f, 1); prev = n; }
  });
  it("is eccentric: the plaque sector peaks at its angle and is gone on the far side", () => {
    expect(plaqueSector(1, 1)).toBeCloseTo(1, 9);
    expect(plaqueSector(1 + Math.PI, 1)).toBeCloseTo(0, 9);
    expect(plaqueSector(1.5, 1)).toBeGreaterThan(plaqueSector(2.5, 1));
  });
  it("bulges only where there is plaque and stays bounded for a pin-hole lumen", () => {
    expect(plaqueBulge(0, 1, 1)).toBe(0);
    expect(plaqueBulge(0.7, 0, 3)).toBe(0);
    const b = plaqueBulge(0.7, 1, 1 / 0.3);
    expect(b).toBeGreaterThan(1); expect(b).toBeLessThan(6);
    expect(plaqueBulge(0.99, 1, 100)).toBeLessThan(8);
    expect(plaqueTint(0.5, 1)).toBe(1); expect(plaqueTint(0.05, 1)).toBeCloseTo(0.2, 9); expect(plaqueTint(0.5, 0)).toBe(0);
  });
  it("hints calcification only on tight plaque", () => {
    let hit = 0;
    for (let s = 0; s < 60; s += 0.4) { expect(calcification(s, 1, 0.4)).toBe(0); const c = calcification(s, 1, 0.9); expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); if (c > 0.5) hit++; }
    expect(hit).toBeGreaterThan(0);
  });
  it("caps an occlusion with clot on its proximal side only", () => {
    expect(thrombusAt(10, null)).toBe(0);
    expect(thrombusAt(20, 50)).toBe(0);
    expect(thrombusAt(50, 50)).toBeCloseTo(1, 9);
    expect(thrombusAt(47, 50)).toBeGreaterThan(0.3);
    expect(thrombusAt(47, 50)).toBeLessThan(0.7);
    expect(thrombusAt(60, 50)).toBe(0);
    expect(muralThrombus(0.7)).toBe(0); expect(muralThrombus(0.95)).toBeCloseTo(0.5, 9); expect(muralThrombus(0.9)).toBeGreaterThan(0);
  });
  it("thins and slows the flow past a stenosis and stops it beyond an occlusion", () => {
    expect(flowDensity(1, 1, false)).toBe(1);
    expect(flowDensity(2, 1, false)).toBe(1);
    expect(flowDensity(0.5, 1, false)).toBeCloseTo(0.5, 9);
    expect(flowDensity(0.01, 1, false)).toBeCloseTo(0.12, 9);
    expect(flowDensity(1, 1, true)).toBe(0);
    expect(flowSpeedScale(1)).toBe(1);
    expect(flowSpeedScale(0.12)).toBeLessThan(0.35);
    expect(flowSpeedScale(0.5)).toBeGreaterThan(flowSpeedScale(0.2));
  });
  it("blushes where perfused and not over an infarct or an ischemic bed", () => {
    expect(blushLevel(1, 0, 0)).toBe(1);
    expect(blushLevel(1, 0, 1)).toBe(0);
    expect(blushLevel(0, 0, 0)).toBe(0);
    expect(blushLevel(1, 0.8, 0)).toBeCloseTo(0.2, 9);
    expect(blushLevel(1.7, 0, 0)).toBe(1);
  });
});
