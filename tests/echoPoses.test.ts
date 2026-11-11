import { describe, it, expect } from "vitest";
import { installCtHeartNode } from "../src/echo/ctNode";
import { buildPoses, landmarks, insideHeart } from "../src/echo/poses";
import { IMAGES, VIEWS } from "../src/echo/views";
import { teeViews } from "../src/echo/tee";

/**
 * Probe poses for the transthoracic views, on the CT heart: each standard plane holds the landmarks that define it, the probe is outside
 * the heart and aimed at its target, and the image's right side is the index-mark side. (What each plane shows when rendered is checked
 * against the view specs in tests/echoScore.test.ts.)
 */
installCtHeartNode();
const poses = buildPoses(), l = landmarks();
type V = number[];
type P3 = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const normal = (p: { beam: V; lateral: V }) => { const a = p.beam, b = p.lateral; return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; };
/** Distance of a point from a pose's image plane, mm. */
const offPlane = (p: { probe: V; beam: V; lateral: V }, x: V) => Math.abs(dot(sub(x, p.probe), normal(p)));
const TTE = ["plax", "subcostal", "psaxPM", "psaxMV", "psaxApex", "psaxAV", "a4c", "a3c", "a5c", "a2c", "rvInflow", "ivc", "suprasternal"];

describe("transthoracic probe poses on the CT heart", () => {
  it("covers every standard transthoracic view; every listed view has a pose and every reference image a view", () => {
    expect(Object.keys(poses).sort()).toEqual([...TTE].sort());
    const tee = teeViews();
    for (const v of VIEWS) expect(v.approach === "tte" ? poses[v.pose] : tee[v.pose], v.id).toBeDefined();
    for (const im of IMAGES) expect(VIEWS.some((v) => v.id === im.view), im.view).toBe(true);
  });
  it("gives every pose unit, perpendicular beam and lateral axes, with the marker on the lateral (screen-right) side", () => {
    for (const [id, p] of Object.entries(poses)) {
      expect(len(p.beam), id).toBeCloseTo(1, 5); expect(len(p.lateral), id).toBeCloseTo(1, 5);
      expect(Math.abs(dot(p.beam, p.lateral)), id).toBeLessThan(1e-6);
      expect(dot(p.marker, p.lateral), id).toBeCloseTo(1, 6);
    }
  });
  it("puts every probe outside the heart, with the beam pointing at its target", () => {
    for (const [id, p] of Object.entries(poses)) {
      expect(insideHeart(p.probe as P3), `${id} probe`).toBe(false);
      if (id !== "suprasternal" && id !== "ivc") expect(insideHeart(p.target as P3), `${id} target`).toBe(true); // those aim at vessels
      const to = sub(p.target, p.probe);
      expect(dot(to, p.beam) / len(to), `${id} aim`).toBeGreaterThan(0.9);
      expect(len(to), `${id} distance`).toBeLessThan(200);
    }
  });
  it("long-axis planes hold their landmarks: PLAX and A3C the apex and the mitral and aortic valves; A4C and subcostal the apex and both AV valves", () => {
    for (const id of ["plax", "a3c"]) for (const k of ["apex", "mv", "av"] as const) expect(offPlane(poses[id], l[k]), `${id} ${k}`).toBeLessThan(3);
    for (const id of ["a4c", "subcostal"]) for (const k of ["apex", "mv", "tv"] as const) expect(offPlane(poses[id], l[k]), `${id} ${k}`).toBeLessThan(3);
  });
  it("PLAX looks from the front, square to the long axis; the apical views look up the long axis from beyond the apex", () => {
    expect(poses.plax.beam[2]).toBeLessThan(-0.5);
    expect(Math.abs(dot(poses.plax.beam, l.longAxis))).toBeLessThan(0.1);
    for (const id of ["a4c", "a3c", "a5c", "a2c"]) {
      // the five-chamber beam turns partway toward the outflow tract, to line up with an aortic jet (about 35 degrees off the LV axis)
      expect(dot(poses[id].beam, l.longAxis), id).toBeGreaterThan(id === "a5c" ? 0.75 : 0.95);
      // the probe is beyond the apex (the five-chamber probe slides medially, beside it)
      expect(dot(sub(poses[id].probe, l.apex), l.longAxis), id).toBeLessThan(id === "a5c" ? 10 : 0);
    }
  });
  it("the two-chamber plane is the four-chamber plane turned 55 to 75 degrees about the long axis", () => {
    const c = Math.abs(dot(normal(poses.a2c), normal(poses.a4c))), deg = (Math.acos(Math.min(1, c)) * 180) / Math.PI;
    expect(deg).toBeGreaterThan(55); expect(deg).toBeLessThan(75);
  });
  it("short axes are cut across the long axis, ordered from the base to the apex", () => {
    const along = (id: string) => dot(sub(poses[id].target, l.apex), l.longAxis);
    for (const id of ["psaxMV", "psaxPM", "psaxApex"]) expect(Math.abs(dot(normal(poses[id]), l.longAxis)), id).toBeGreaterThan(0.99);
    expect(along("psaxMV")).toBeGreaterThan(along("psaxPM")); expect(along("psaxPM")).toBeGreaterThan(along("psaxApex"));
  });
  it("the subcostal and IVC probes sit below the heart with the beam heading up; the suprasternal probe sits above it, heading down", () => {
    for (const id of ["subcostal", "ivc"]) { expect(poses[id].probe[1], id).toBeLessThan(poses[id].target[1]); expect(poses[id].beam[1], id).toBeGreaterThan(0.3); }
    expect(poses.suprasternal.probe[1]).toBeGreaterThan(poses.suprasternal.target[1]); expect(poses.suprasternal.beam[1]).toBeLessThan(-0.7);
  });
});
