import { describe, expect, it } from "vitest";
import { createStubSource } from "../src/sim/stubSource";
import { axisBottom, dataRange, isWaiting, legendText, legendValues, nextTop, niceMax, pickMaxPoints } from "../src/panels/traceMath";

const empty = { t: new Float32Array(0), v: new Float32Array(0) };

describe("traceMath", () => {
  it("asks for about one point per pixel, clamped", () => {
    expect(pickMaxPoints(640)).toBe(640);
    expect(pickMaxPoints(10)).toBe(100);
    expect(pickMaxPoints(99999)).toBe(1200);
    expect(pickMaxPoints(NaN)).toBe(300);
  });
  it("picks a nice max", () => {
    expect(niceMax(25)).toBe(30);
    expect(niceMax(121)).toBe(150);
    expect(niceMax(260)).toBe(300);
  });
  it("axis grows at once, shrinks only with margin", () => {
    let top = nextTop(undefined, 120);
    expect(top).toBe(150);
    expect(nextTop(top, 160)).toBe(200);
    expect(nextTop(150, 118)).toBe(150);
    expect(nextTop(150, 100)).toBe(150);
    expect(nextTop(150, 60)).toBe(80);
    expect(nextTop(150, NaN)).toBe(150);
    expect(nextTop(undefined, NaN)).toBe(10);
    top = nextTop(undefined, 119);
    for (const m of [117, 121, 118, 122, 120]) expect(nextTop(top, m)).toBeGreaterThanOrEqual(top);
    expect(nextTop(top, 100)).toBe(top);
  });
  it("bottom stays 0 unless pressures go negative", () => {
    expect(axisBottom(3)).toBe(0);
    expect(axisBottom(-4)).toBe(-10);
  });
  it("legend values from the stub source", () => {
    const src = createStubSource(() => 100);
    const ao = legendValues(src.trace("AO", 6, { maxPoints: 600 }));
    expect(ao.sys).toBeCloseTo(120, 0);
    expect(ao.dia).toBeGreaterThan(69);
    expect(ao.dia).toBeLessThan(75);
    expect(ao.mean).toBeGreaterThan(ao.dia);
    expect(ao.mean).toBeLessThan(ao.sys);
    expect(legendText(ao)).toMatch(/^120\/\d+ \(\d+\)$/);
    const ra = legendValues(src.trace("RA", 6, { maxPoints: 600 }));
    expect(ra.sys).toBeLessThan(ao.dia);
  });
  it("handles empty and NaN traces", () => {
    expect(isWaiting([empty, empty])).toBe(true);
    expect(isWaiting([{ t: Float32Array.of(0, 1), v: Float32Array.of(NaN, NaN) }])).toBe(true);
    expect(legendText(legendValues(empty))).toBe("–");
    expect(dataRange([{ t: Float32Array.of(0, 1, 2), v: Float32Array.of(NaN, 5, 9) }])).toEqual({ min: 5, max: 9 });
    expect(isWaiting([createStubSource().trace("LV", 6, { maxPoints: 200 })])).toBe(false);
  });
});
