import { describe, it, expect } from "vitest";
import { buildPoses, landmarks, insideHeart, LANDMARKS_HEART_FRAME } from "../src/echo/poses";
import { heartSdf } from "../src/anatomy/heartSurface";
import { VIEWS, imageFor } from "../src/echo/views";

const poses = buildPoses(), l = landmarks();
type V = number[];
type P3 = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const normal = (p: { beam: V; lateral: V }) => { const a = p.beam, b = p.lateral; return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; };
/** Distance of a point from a pose's image plane, mm. */
const offPlane = (p: { probe: V; beam: V; lateral: V }, x: V) => Math.abs(dot(sub(x, p.probe), normal(p)));

describe("echo atlas: views and probe poses on the simulator's heart", () => {
  it("lists only views that have both a probe pose and an echo loop", () => {
    expect(VIEWS.map((v) => v.id)).toEqual(["plax", "psax-pm", "subcostal"]);
    for (const v of VIEWS) { expect(poses[v.pose], v.id).toBeDefined(); expect(imageFor(v.id), v.id).toBeDefined(); }
    expect(Object.keys(poses).sort()).toEqual(["plax", "psaxPM", "subcostal"]);
  });
  it("gives every pose unit, perpendicular beam and lateral axes", () => {
    for (const p of Object.values(poses)) {
      expect(len(p.beam)).toBeCloseTo(1, 5); expect(len(p.lateral)).toBeCloseTo(1, 5);
      expect(Math.abs(dot(p.beam, p.lateral))).toBeLessThan(1e-6);
      expect(Math.abs(dot(p.marker, p.lateral))).toBeCloseTo(1, 6);
    }
  });
  it("places the valve and apex landmarks inside the heart (or on its valve plane)", () => {
    for (const [k, p] of Object.entries(LANDMARKS_HEART_FRAME)) expect(heartSdf(p as P3), k).toBeLessThan(0.5);
  });
  it("puts every probe outside the heart and every target inside it, with the beam pointing at the target", () => {
    for (const [id, p] of Object.entries(poses)) {
      expect(insideHeart(p.probe as P3), `${id} probe`).toBe(false);
      expect(insideHeart(p.target as P3), `${id} target`).toBe(true);
      const to = sub(p.target, p.probe), d = len(to);
      expect(dot(to, p.beam) / d, `${id} aim`).toBeGreaterThan(0.99);
      expect(d, `${id} distance`).toBeLessThan(200);
    }
  });
  it("parasternal long axis looks front to back and holds the apex, the aortic valve and the mitral valve", () => {
    const p = poses.plax;
    expect(p.beam[2]).toBeLessThan(-0.5);
    expect(offPlane(p, l.apex)).toBeLessThan(3); expect(offPlane(p, l.av)).toBeLessThan(3); expect(offPlane(p, l.mv)).toBeLessThan(3);
  });
  it("the papillary-level short axis is cut across the long axis, nearer the apex than the mitral valve", () => {
    const p = poses.psaxPM;
    expect(Math.abs(dot(normal(p), l.longAxis))).toBeGreaterThan(0.99);
    expect(dot(sub(p.target, l.apex), l.longAxis)).toBeLessThan(dot(sub(l.mv, l.apex), l.longAxis));
    expect(p.beam[2]).toBeLessThan(-0.7);
  });
  it("the subcostal probe is below the heart's centre, the beam heading up, and its plane holds the apex and both atrioventricular valves", () => {
    const p = poses.subcostal;
    expect(p.probe[1]).toBeLessThan(p.target[1]); expect(p.beam[1]).toBeGreaterThan(0.3);
    expect(offPlane(p, l.mv)).toBeLessThan(3); expect(offPlane(p, l.tv)).toBeLessThan(3); expect(offPlane(p, l.apex)).toBeLessThan(3);
  });
});
