import { describe, it, expect } from "vitest";
import { buildPoses } from "../src/echo/poses";
import { presetsFromPoses, referenceBlend } from "../src/echo/probe";
import { classifyHeart } from "../src/anatomy/heartSurface";
import { toHeart } from "../src/echo/poses";
import { echoGray, fitFrame, frameFor, insideFan, labelAnchors, layoutLabels, pxPerMm, rasterize, WALL_MM } from "../src/echo/paint";
import { sampleSlice } from "../src/echo/slice";
import { V3, add, mul } from "../src/anatomy/curve";

const poses = buildPoses();
const presets = presetsFromPoses(poses);

describe("echo stylized gray and reference blend", () => {
  it("makes walls brighter than deep chamber and falls off with depth", () => {
    const wall = echoGray(0, 40, 160, 0.5);
    const chamber = echoGray(-12, 40, 160, 0.5);
    const deep = echoGray(-12, 140, 160, 0.5);
    const outside = echoGray(20, 40, 160, 0.5);
    expect(wall).toBeGreaterThan(chamber);
    expect(chamber).toBeGreaterThan(deep);
    expect(wall).toBeGreaterThan(outside);
  });

  it("blends in the real reference only when the probe is near a calibrated view", () => {
    const on = referenceBlend(poses.plax, presets);
    expect(on.id).toBe("plax");
    expect(on.amount).toBe(1);
    const slice = sampleSlice(poses.plax, { rays: 9, steps: 9 });
    expect(slice.samples.some((s) => s.part !== null)).toBe(true);
    const far = referenceBlend(
      { ...poses.plax, probe: [poses.plax.probe[0] + 80, poses.plax.probe[1] - 40, poses.plax.probe[2] + 60] },
      presets,
    );
    expect(far.amount).toBe(0);
    expect(far.id).toBeNull();
  });
});

const ASPECT = 0.9;
const CW = 360, CH = 400;
const names = Object.keys(poses) as (keyof typeof poses)[];

describe("echoGray", () => {
  it("is bright at walls, dark in cavities and deterministic", () => {
    expect(echoGray(0, 40, 160, 0.5)).toBeGreaterThan(0.5);
    expect(echoGray(-14, 40, 160, 0.5)).toBeLessThan(0.6 * echoGray(0, 40, 160, 0.5));
    expect(echoGray(0, 40, 160, 0.3)).toBe(echoGray(0, 40, 160, 0.3));
  });
});

describe("shared framing", () => {
  it.each(names)("%s: heart fits the fan with a margin and fills 0.5 to 0.85 of its height", (name) => {
    const pose = poses[name];
    const frame = frameFor(pose, ASPECT);
    expect(frame.empty).toBe(false);
    expect(frame.heartFraction).toBeGreaterThanOrEqual(0.5);
    expect(frame.heartFraction).toBeLessThanOrEqual(0.85);
    const deep = sampleSlice({ ...pose, depth: pose.depth * 1.6 }, { rays: 81, steps: 110 });
    const heart = deep.samples.filter((s) => s.part !== null);
    expect(heart.length).toBeGreaterThan(0);
    const halfWidthMm = (CW / 2) / pxPerMm(frame, CH);
    for (const s of heart) {
      expect(Math.hypot(s.depth, s.lateral)).toBeLessThanOrEqual(frame.depth * 0.98);
      expect(Math.abs(s.lateral)).toBeLessThan(halfWidthMm);
      expect(insideFan(CW / 2 + s.lateral * pxPerMm(frame, CH), s.depth * pxPerMm(frame, CH), frame, CW, CH)).toBe(true);
    }
  });

  it("keeps the default framing when there is no heart", () => {
    const f = fitFrame([{ depth: 10, lateral: 0, part: null }], { depth: 120 });
    expect(f.empty).toBe(true);
    expect(f.depth).toBe(120);
  });
});

describe("label anchors", () => {
  it.each(names)("%s: each anchor lies in its own chamber's cavity, and its label sits outside the fan", (name) => {
    const pose = poses[name];
    const w = Math.round(120 * ASPECT), h = 120;
    const frame = frameFor(pose, ASPECT);
    const raster = rasterize(pose, w, h, frame);
    const anchors = labelAnchors(raster);
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      const point = add(pose.probe, add(mul(pose.beam, a.depth), mul(pose.lateral, a.lateral))) as V3;
      const hit = classifyHeart(toHeart(point));
      expect(hit.part).toBe(a.part);
      expect(hit.sdf).toBeLessThanOrEqual(-WALL_MM[a.part]);
    }
    for (const p of layoutLabels(anchors, frame, CW, CH)) {
      expect(insideFan(p.lx, p.ly, frame, CW, CH)).toBe(false);
      expect(p.ly).toBeGreaterThan(0);
      expect(p.ly).toBeLessThan(CH);
    }
  });
});

describe("empty slice", () => {
  it("does not throw when the probe is moved far along its lateral axis", () => {
    const pose = poses.plax;
    const far = { ...pose, probe: [0, 1, 2].map((i) => pose.probe[i] + 400 * pose.lateral[i]) as V3 };
    const frame = frameFor(far, ASPECT);
    expect(frame.empty).toBe(true);
    const raster = rasterize(far, 60, 66, frame);
    expect(labelAnchors(raster)).toEqual([]);
    expect(layoutLabels([], frame, CW, CH)).toEqual([]);
  });
});
