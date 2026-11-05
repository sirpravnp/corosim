import { describe, it, expect } from "vitest";
import { buildPoses } from "../src/echo/poses";
import { presetsFromPoses, referenceBlend } from "../src/echo/probe";
import { echoGray } from "../src/echo/paint";
import { sampleSlice } from "../src/echo/slice";

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
