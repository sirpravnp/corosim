import { describe, expect, it } from "vitest";
import { RAMP, RAMP_STOPS, thermal, thermalGradient } from "../src/stipple";

// Relative luminance (WCAG) of an sRGB color given as 0..255 channels.
const lum = ([r, g, b]: number[]) => {
  const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const rgb = (s: string) => s.match(/\d+/g)!.map(Number);

describe("thermal ramp", () => {
  it("is a sequential map: luminance rises monotonically from cold to hot", () => {
    let last = -1;
    for (let i = 0; i <= 100; i++) {
      const l = lum(rgb(thermal(i / 100)));
      expect(l).toBeGreaterThanOrEqual(last);
      last = l;
    }
  });
  it("exports the same stops for THREE and for the CSS legend", () => {
    expect(RAMP_STOPS.map(([t, c]) => [t, "#" + c.toString(16).padStart(6, "0")])).toEqual(RAMP);
    for (const [, c] of RAMP) expect(thermalGradient()).toContain(c);
  });
  it("cuts the CSS gradient at a stop, rescaled to the full width", () => {
    expect(thermalGradient(0.7)).toBe("linear-gradient(90deg,#3a0603 0%,#8c130b 31.428571428571434%,#d8401a 68.57142857142857%,#f49218 100%)");
  });
});
