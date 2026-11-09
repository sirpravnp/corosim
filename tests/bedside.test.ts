import { describe, it, expect } from "vitest";
import { bodyTempC, estimateRespRate, type BedsideInput } from "../src/sim/bedside";

const normal: BedsideInput = {
  respRateBase: 15, map: 90, spo2: 0.98, lactate: 1, congestion: 0, arrest: "none",
};

describe("bedside readings", () => {
  it("base 15 with normal state returns 15", () => {
    expect(estimateRespRate(normal)).toBe(15);
  });
  it("shock (map 55, lactate 4) raises rate above 22", () => {
    expect(estimateRespRate({ ...normal, map: 55, lactate: 4 })).toBeGreaterThan(22);
  });
  it("congestion 0.8 raises rate above base", () => {
    expect(estimateRespRate({ ...normal, congestion: 0.8 })).toBeGreaterThan(15);
  });
  it("rate is capped at 40", () => {
    expect(estimateRespRate({ ...normal, map: 20, lactate: 20, congestion: 1, spo2: 0.5 })).toBe(40);
  });
  it("arrest returns 0", () => {
    expect(estimateRespRate({ ...normal, arrest: "arrest" })).toBe(0);
    expect(estimateRespRate({ ...normal, arrest: "dead" })).toBe(0);
  });
  it("temp defaults to 37.0", () => {
    expect(bodyTempC(normal)).toBe(37.0);
  });
  it("temp uses tempOverrideC", () => {
    expect(bodyTempC({ ...normal, tempOverrideC: 38.9 })).toBe(38.9);
  });
  it("rate is always a finite integer for map NaN", () => {
    const r = estimateRespRate({ ...normal, map: NaN });
    expect(Number.isFinite(r)).toBe(true);
    expect(Number.isInteger(r)).toBe(true);
    expect(r).toBe(15);
  });
});
