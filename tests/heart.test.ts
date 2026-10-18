import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

/** The baked anatomy for the cath lab's echo (scripts/cath turns the open CT-derived mesh into it). */
const meta = JSON.parse(readFileSync("src/cath/data/heart.json", "utf8"));
const bin = gunzipSync(readFileSync("src/cath/data/heart.bin.gz"));
const [NX, NY, NZ] = meta.shape as [number, number, number], N = NX * NY * NZ;
const labels = bin.subarray(0, N);

describe("heart volume", () => {
  it("is four planes (labels, wall depth, rotation and long-axis position), one byte per voxel, as heart.json says", () => {
    expect(bin.length).toBe(4 * N);
    expect(meta.origin_mm).toHaveLength(3);
  });
  it("holds every chamber, valve, great vessel and wall id the renderer expects", () => {
    const seen = new Set<number>(labels);
    for (const [name, id] of Object.entries({ LV: 1, RV: 2, RA: 3, LA: 4, AOROOT: 7, PA: 17, MV: 20, AV: 21, TV: 22, PV: 23, IAS: 24, RVW: 25, LAW: 26, RAW: 27, AOW: 28, PERI: 29 })) expect(seen.has(id), name).toBe(true);
    for (let seg = 40; seg < 57; seg++) expect(seen.has(seg), `AHA segment ${seg - 39}`).toBe(true); // all 17
  });
  it("has its landmarks inside the volume", () => {
    const inside = (c: number[]) => c.every((v, i) => v * 10 >= meta.origin_mm[i] && v * 10 < meta.origin_mm[i] + meta.shape[i]);
    for (const v of Object.values<any>(meta.valves)) expect(inside(v.c)).toBe(true);
    for (const v of Object.values<any>(meta.ostia)) expect(inside(v.c)).toBe(true);
    for (const c of Object.values<number[]>(meta.centroids)) expect(inside(c)).toBe(true);
  });
  it("has a left ventricle and wall of human size (1 mm voxels)", () => {
    const count = (ids: (v: number) => boolean) => { let n = 0; for (let i = 0; i < N; i++) if (ids(labels[i])) n++; return n / 1000; };
    const cavity = count((v) => v === 1); // ml: LV chamber
    const wall = count((v) => v >= 40 && v < 57) * 1.05; // g: LV myocardium (the 17 segments) at 1.05 g/ml
    expect(cavity).toBeGreaterThan(60); expect(cavity).toBeLessThan(250);
    expect(wall).toBeGreaterThan(80); expect(wall).toBeLessThan(250); // ~160 g here; adult LV mass is roughly 90 to 200 g
  });
});
