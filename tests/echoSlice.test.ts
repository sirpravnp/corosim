import { describe, it, expect } from "vitest";
import { Part, PART_NAMES, heartSdf } from "../src/anatomy/heartSurface";
import { buildPoses, SECTOR, toHeart } from "../src/echo/poses";
import { sampleSlice } from "../src/echo/slice";

const poses = buildPoses();
type V = number[];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

describe("echo slice of the three calibrated poses", () => {
  it("samples only the sector, in the pose plane, and classifies inside points with the heart field", () => {
    for (const [id, pose] of Object.entries(poses)) {
      const slice = sampleSlice(pose);
      expect(slice.samples.length, id).toBeGreaterThan(100);
      const n = cross(pose.beam, pose.lateral);
      for (const s of slice.samples) {
        const rel = sub(s.point, pose.probe);
        expect(Math.abs(dot(rel, n)), `${id} on plane`).toBeLessThan(1e-6);
        const radius = Math.hypot(s.depth, s.lateral);
        expect(radius, `${id} depth`).toBeLessThanOrEqual(pose.depth + 1e-6);
        expect(s.depth, `${id} in front of the probe`).toBeGreaterThanOrEqual(-1e-6);
        expect(Math.abs(Math.atan2(s.lateral, s.depth)), `${id} sector angle`).toBeLessThanOrEqual(SECTOR.halfAngle + 1e-6);
        const sdf = heartSdf(toHeart(s.point));
        expect(s.sdf, id).toBeCloseTo(sdf, 5);
        if (s.part === null) expect(sdf, `${id} outside`).toBeGreaterThanOrEqual(0);
        else expect(sdf, `${id} inside`).toBeLessThan(0);
      }
    }
  });

  it("parasternal long axis holds the left ventricle, the left atrium and the aorta", () => {
    const parts = new Set(sampleSlice(poses.plax).samples.map((s) => s.part));
    expect(parts.has(Part.LV)).toBe(true);
    expect(parts.has(Part.LA)).toBe(true);
    expect(parts.has(Part.Aorta)).toBe(true);
  });

  it("papillary short axis holds both ventricles and not the atria", () => {
    const parts = new Set(sampleSlice(poses.psaxPM).samples.map((s) => s.part));
    expect(parts.has(Part.LV)).toBe(true);
    expect(parts.has(Part.RV)).toBe(true);
    expect(parts.has(Part.LA)).toBe(false);
    expect(parts.has(Part.RA)).toBe(false);
  });

  it("subcostal four-chamber holds all four chambers", () => {
    const parts = new Set(sampleSlice(poses.subcostal).samples.map((s) => s.part));
    expect(parts.has(Part.LV)).toBe(true);
    expect(parts.has(Part.RV)).toBe(true);
    expect(parts.has(Part.LA)).toBe(true);
    expect(parts.has(Part.RA)).toBe(true);
  });

  it("places each label at the centroid of that part, under its anatomical name", () => {
    const slice = sampleSlice(poses.subcostal);
    const named = new Set(slice.labels.map((label) => label.part));
    for (const s of slice.samples) if (s.part !== null) expect(named.has(s.part)).toBe(true);
    expect(slice.labels.length).toBeGreaterThan(0);
    for (const label of slice.labels) {
      const pts = slice.samples.filter((s) => s.part === label.part);
      expect(pts.length).toBeGreaterThan(0);
      expect(label.name).toBe(PART_NAMES[label.part]);
      expect(label.depth).toBeCloseTo(pts.reduce((a, s) => a + s.depth, 0) / pts.length, 5);
      expect(label.lateral).toBeCloseTo(pts.reduce((a, s) => a + s.lateral, 0) / pts.length, 5);
    }
  });
});
