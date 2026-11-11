import { describe, it, expect } from "vitest";
import { buildPoses, insideHeart, Pose } from "../src/echo/poses";
import {
  controlsFromPose,
  nearestPreset,
  poseFromControls,
  presetsFromPoses,
  projectOntoChest,
  snapPose,
} from "../src/echo/probe";
import { installCtHeartNode } from "../src/echo/ctNode";

// the echo images the CT heart in production; these tests check that path
installCtHeartNode();

const poses = buildPoses();
const presets = presetsFromPoses(poses);
type V = number[];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a: V, b: V) => len(sub(a, b));

const alike = (a: Pose, b: Pose, where: string) => {
  // Calibrated poses sit on the skin along the beam; the free model sits on the radial chest shell.
  expect(dist(a.probe, b.probe), `${where} probe`).toBeLessThan(15);
  expect(dot(a.beam, b.beam), `${where} beam`).toBeGreaterThan(0.995);
  expect(Math.abs(dot(a.lateral, b.lateral)), `${where} lateral`).toBeGreaterThan(0.995);
  expect(a.depth, `${where} depth`).toBeCloseTo(b.depth, 5);
};

describe("echo probe controls on the chest shell", () => {
  it("round-trips each calibrated pose that sits on the chest shell through the chest controls", () => {
    // the subcostal, IVC and suprasternal probes sit below the xiphoid or in the notch, off the radial shell the free probe slides on
    let n = 0;
    for (const [id, pose] of Object.entries(poses)) {
      if (dist(pose.probe, projectOntoChest(pose.probe)) > 15) continue;
      n++; alike(poseFromControls(controlsFromPose(pose)), pose, id);
    }
    expect(n).toBeGreaterThanOrEqual(6);
  });

  it("keeps the probe on the chest shell and outside the heart", () => {
    for (const pose of Object.values(poses)) {
      const on = projectOntoChest(pose.probe);
      expect(insideHeart(on)).toBe(false);
      expect(dist(on, projectOntoChest(on))).toBeLessThan(1e-6);
      const moved = poseFromControls({ ...controlsFromPose(pose), yaw: controlsFromPose(pose).yaw + 0.4 });
      expect(insideHeart(moved.probe)).toBe(false);
      expect(dist(moved.probe, projectOntoChest(moved.probe))).toBeLessThan(1e-3);
    }
  });

  it("names the nearest preset for each calibrated pose, and none when far away", () => {
    for (const [id, pose] of Object.entries(poses)) {
      expect(nearestPreset(pose, presets)?.id).toBe(id);
    }
    const far = poseFromControls({ ...controlsFromPose(poses.plax), yaw: controlsFromPose(poses.plax).yaw + Math.PI });
    expect(nearestPreset(far, presets)).toBeNull();
  });

  it("snaps a nearly-calibrated pose onto its preset, and leaves a distant one alone", () => {
    const near = poseFromControls({
      ...controlsFromPose(poses.psaxPM),
      yaw: controlsFromPose(poses.psaxPM).yaw + 0.03,
      pitch: controlsFromPose(poses.psaxPM).pitch - 0.02,
    });
    const snapped = snapPose(near, presets);
    expect(snapped.id).toBe("psaxPM");
    alike(snapped.pose, poses.psaxPM, "snapped");
    const far = poseFromControls({ ...controlsFromPose(poses.subcostal), yaw: controlsFromPose(poses.subcostal).yaw + 1.2 });
    expect(snapPose(far, presets).id).toBeNull();
    alike(snapPose(far, presets).pose, far, "unsnapped");
  });

  it("slides the probe across the chest when yaw and pitch change", () => {
    const base = controlsFromPose(poses.plax);
    const a = poseFromControls(base);
    const b = poseFromControls({ ...base, yaw: base.yaw + 0.35, pitch: base.pitch - 0.15 });
    expect(dist(a.probe, b.probe)).toBeGreaterThan(15);
    expect(dot(a.beam, b.beam)).toBeLessThan(0.999);
  });
});

import { tiltProbe } from "../src/echo/probe";

describe("tilt", () => {
  it("rocks the beam about the lateral axis, keeps the probe on the chest, and refuses to point out of the chest", () => {
    const pose = buildPoses().plax;
    const t = tiltProbe(pose, 0.2);
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(d(t.probe, poseFromControls(controlsFromPose(pose)).probe)).toBeLessThan(1e-6);
    expect(d(t.beam, pose.beam)).toBeGreaterThan(0.05);
    expect(Math.abs(t.beam[0] * t.lateral[0] + t.beam[1] * t.lateral[1] + t.beam[2] * t.lateral[2])).toBeLessThan(1e-6);
    expect(tiltProbe(pose, 3)).toBe(pose);
  });
});
