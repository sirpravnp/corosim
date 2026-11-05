import { describe, it, expect } from "vitest";
import { stylizeRaster, LookRaster } from "../src/echo/look";
import { Tissue } from "../src/echo/tissue";
import { buildPoses } from "../src/echo/poses";
import { frameFor, rasterize } from "../src/echo/paint";

const N = 40;

/** Synthetic raster: everything in the fan is `fill`; `paint` overrides pixels. Signed distance is given per pixel (mm). */
function make(w: number, h: number, fill: Tissue, paint?: (x: number, y: number) => { t: Tissue; sdf: number } | null): LookRaster {
  const part = new Int8Array(w * h), tissue = new Uint8Array(w * h), sdf = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = paint?.(x, y);
      part[i] = fill === Tissue.Outside && !o ? -1 : 0;
      tissue[i] = o ? o.t : fill;
      sdf[i] = o ? o.sdf : fill === Tissue.Outside ? 5 : -5;
    }
  }
  return { w, h, px: 1, part, tissue, sdf };
}

const mean = (d: Uint8ClampedArray, w: number, x0: number, x1: number, y0: number, y1: number) => {
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += d[(y * w + x) * 4]; n++; }
  return s / n;
};
const overall = (d: Uint8ClampedArray) => { let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; return s / (d.length / 4); };

describe("stylizeRaster", () => {
  it("is deterministic, drifts with t, and keeps the mean brightness", () => {
    const r = make(N, N, Tissue.Myocardium);
    const a = stylizeRaster(r, 1.3), b = stylizeRaster(r, 1.3), c = stylizeRaster(r, 1.9);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    expect(Math.abs(overall(a) - overall(c)) / overall(a)).toBeLessThan(0.05);
  });

  it("is black outside the fan", () => {
    const r = make(N, N, Tissue.Myocardium);
    for (let x = 0; x < N; x++) r.part[10 * N + x] = -2;
    r.part[20 * N + 5] = -2;
    const d = stylizeRaster(r, 0.4);
    for (let x = 0; x < N; x++) expect([d[(10 * N + x) * 4], d[(10 * N + x) * 4 + 1], d[(10 * N + x) * 4 + 2]]).toEqual([0, 0, 0]);
    expect(d[(20 * N + 5) * 4]).toBe(0);
    expect(d[(20 * N + 6) * 4]).toBeGreaterThan(0);
  });

  it("orders pericardium > leaflet > septum >= myocardium > haze > blood", () => {
    const w = 60, h = 40;
    // Six vertical bands at the same depth range.
    const kinds = [Tissue.Pericardium, Tissue.Leaflet, Tissue.Septum, Tissue.Myocardium, Tissue.Outside, Tissue.Blood];
    const r = make(w, h, Tissue.Outside, (x) => {
      const k = kinds[Math.floor(x / 10)];
      return { t: k, sdf: k === Tissue.Outside ? 5 : -5 };
    });
    const d = stylizeRaster(r, 2.2);
    const m = kinds.map((_, k) => mean(d, w, k * 10 + 2, k * 10 + 8, 14, 30));
    for (let k = 0; k < 4; k++) expect(m[k]).toBeGreaterThanOrEqual(m[k + 1]);
    expect(m[3]).toBeGreaterThan(m[4]);
    expect(m[4]).toBeGreaterThan(m[5]);
    expect(m[1]).toBeGreaterThan(m[2]);
    expect(m[0]).toBeGreaterThan(m[1]);
  });

  it("brightens an edge facing the beam over the same edge parallel to it", () => {
    const w = 41, h = 40;
    // Beam apex at top center (20.5, 0). Vertical wall straight below the apex: normal horizontal, parallel to the beam.
    const vertical = make(w, h, Tissue.Blood, (x, y) => (y >= 5 && y < 25 && x >= 19 && x <= 21 ? { t: Tissue.Myocardium, sdf: x - 20 } : null));
    // Horizontal wall at the same mean depth, same length: normal vertical, head-on.
    const horizontal = make(w, h, Tissue.Blood, (x, y) => (x >= 10 && x < 30 && y >= 14 && y <= 16 ? { t: Tissue.Myocardium, sdf: y - 15 } : null));
    // Vertical sdf gradient points along x, horizontal's along y.
    const dv = stylizeRaster(vertical, 3), dh = stylizeRaster(horizontal, 3);
    const mv = mean(dv, w, 19, 22, 5, 25), mh = mean(dh, w, 10, 30, 14, 17);
    expect(mh).toBeGreaterThan(mv * 1.3);
  });

  it("falls off with depth for the same tissue (TGC)", () => {
    const r = make(N, 100, Tissue.Blood);
    r.px = 2;
    const d = stylizeRaster(r, 1);
    const near = mean(d, N, 0, N, 30, 40), deep = mean(d, N, 0, N, 85, 95);
    expect(near).toBeGreaterThan(deep);
  });

  it("stylizes the real plax raster without NaN and with a plausible mean", () => {
    const poses = buildPoses();
    const frame = frameFor(poses.plax, 0.9);
    const r = rasterize(poses.plax, 90, 100, frame);
    const d = stylizeRaster(r, 0.7);
    expect(d.length).toBe(90 * 100 * 4);
    let fan = 0, sum = 0;
    for (let i = 0; i < r.part.length; i++) {
      expect(Number.isNaN(d[i * 4])).toBe(false);
      if (r.part[i] !== -2) { fan++; sum += d[i * 4]; } else expect(d[i * 4]).toBe(0);
    }
    expect(fan).toBeGreaterThan(0);
    const m = sum / fan;
    expect(m).toBeGreaterThan(25);
    expect(m).toBeLessThan(110);
  });
});
