import { describe, it, expect } from "vitest";
import {
  applyCollimator, bakeLoop, breatheShift, resizeGray, shiftVertical, stripVessels, syntheticBackground, temporalMax,
  FLUORO_BAKE,
} from "../src/cath/backdrop";

const px = (w: number, h: number, fill: number) => new Uint8Array(w * h).fill(fill);
const at = (f: Uint8Array, w: number, x: number, y: number) => f[y * w + x];

describe("syntheticBackground", () => {
  it("is black outside the collimator and lit inside", () => {
    const b = syntheticBackground(80, 80);
    expect(b[0]).toBe(0);
    expect(b[79]).toBe(0);
    expect(b[40 * 80 + 40]).toBeGreaterThan(0.3);
    expect(b[40 * 80 + 40]).toBeLessThan(0.7);
  });
});

describe("temporalMax and stripVessels", () => {
  it("the max is the empty field: a dark vessel on one frame is gone", () => {
    const w = 8, h = 8, nPix = w * h;
    const empty = px(w, h, 180);
    const filled = px(w, h, 180);
    for (let y = 0; y < h; y++) filled[y * w + 3] = 40; // a dark column of dye
    const mx = temporalMax([empty, filled], nPix);
    expect(at(mx, w, 3, 4)).toBe(180);
    const stripped = stripVessels(filled, mx, 18, 12);
    expect(at(stripped, w, 3, 4)).toBe(180);
    expect(at(stripped, w, 5, 4)).toBe(180);
  });
});

describe("shiftVertical", () => {
  it("moves a bright row down, clamping at the edge", () => {
    const w = 4, h = 6, src = px(w, h, 0);
    src.set([9, 9, 9, 9], 2 * w); // row 2
    const down = shiftVertical(src, w, h, 2);
    expect([...down.subarray(4 * w, 5 * w)]).toEqual([9, 9, 9, 9]);
    expect([...down.subarray(2 * w, 3 * w)]).toEqual([0, 0, 0, 0]);
    const up = shiftVertical(src, w, h, -2);
    expect([...up.subarray(0, w)]).toEqual([9, 9, 9, 9]);
    const clamp = shiftVertical(src, w, h, 20);
    expect([...new Set(clamp)]).toEqual([0]);
  });
});

describe("breatheShift", () => {
  it("is a closed loop of bounded shifts", () => {
    const n = 52;
    const s = Array.from({ length: n }, (_, i) => breatheShift(i, n, 5, 2));
    expect(s.every((v) => Math.abs(v) <= 5)).toBe(true);
    expect(s.some((v) => v !== 0)).toBe(true);
    expect(breatheShift(0, n, 5, 2)).toBe(breatheShift(n, n, 5, 2));
  });
});

describe("applyCollimator", () => {
  it("zeros the corners and keeps the center", () => {
    const w = 40, h = 40, f = px(w, h, 200);
    applyCollimator(f, w, h, 0.47);
    expect(at(f, w, 0, 0)).toBe(0);
    expect(at(f, w, 39, 39)).toBe(0);
    expect(at(f, w, 20, 20)).toBeGreaterThan(100);
  });
});

describe("resizeGray", () => {
  it("holds a uniform field and copies 1:1", () => {
    const src = px(4, 4, 77);
    expect([...resizeGray(src, 4, 4, 4, 4)]).toEqual([...src]);
    expect([...new Set(resizeGray(src, 4, 4, 8, 8))]).toEqual([77]);
  });
});

describe("bakeLoop", () => {
  it("emits bake-sized collimated frames that no longer hold a dark vessel", () => {
    const sw = 16, sh = 16, n = 8, nPix = sw * sh;
    const raw = new Uint8Array(n * nPix);
    for (let i = 0; i < n; i++) {
      const fr = raw.subarray(i * nPix, (i + 1) * nPix);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) fr[y * sw + x] = 80 + y * 6;
      if (i === 3) for (let y = 0; y < sh; y++) fr[y * sw + 8] = 20;
    }
    const frames = bakeLoop(raw, sw, sh, n);
    expect(frames.length).toBe(n);
    expect(frames[0].length).toBe(FLUORO_BAKE.w * FLUORO_BAKE.h);
    const { w, h } = FLUORO_BAKE;
    const mid = ((h / 2) | 0) * w + ((w / 2) | 0);
    expect(frames[3][mid]).toBeGreaterThan(80); // the dye column is gone
    expect(frames[0][0]).toBe(0); // outside the collimator
    expect(frames.some((f, i) => i > 0 && f[mid] !== frames[0][mid])).toBe(true); // breathing moved the gradient
  });
});
