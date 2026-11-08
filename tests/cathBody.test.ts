import { describe, it, expect } from "vitest";
import { axesOf, bodyMotion, chordAt, motionWeight, patientEllipsoids, prepare, ribs, spine, viewBasis } from "../src/cath/body";
import { frameOf, type AngioOptions } from "../src/cath/angio";
import { balloonProfile, levelRuns, plaqueShift, smoothPath, wallLines, arcLengths, calciumSpan } from "../src/cath/lumen";
import type { Plaque } from "../src/lab/types";

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const opts = (rot: number, tilt: number): AngioOptions => ({ rot, tilt, injection: "both", labels: false, heartRate: 70 });

describe("view basis", () => {
  it("is orthonormal for any C-arm angle", () => {
    for (const [rot, tilt] of [[0, 0], [30, -20], [-45, 25], [60, 30]]) {
      const b = viewBasis(rot, tilt);
      for (const v of [b.e1, b.e2, b.e3]) expect(dot(v, v)).toBeCloseTo(1, 9);
      expect(dot(b.e1, b.e2)).toBeCloseTo(0, 9); expect(dot(b.e1, b.e3)).toBeCloseTo(0, 9); expect(dot(b.e2, b.e3)).toBeCloseTo(0, 9);
    }
  });
  it("matches the mapping the vessels are drawn with", () => {
    for (const [rot, tilt] of [[30, -20], [-40, 15]]) {
      const o = opts(rot, tilt), f = frameOf([10, 5, 0], o, 0, 640, 640), b = f.basis, p: [number, number, number] = [37, -12, 21];
      const [sx, sy] = f.toStatic(p);
      expect((sx - f.ox) / f.sc).toBeCloseTo(dot(b.e1, p), 6);
      expect((f.oy - sy) / f.sc).toBeCloseTo(dot(b.e2, p), 6);
    }
  });
});

describe("analytic chords", () => {
  const sphere = { c: [0, 0, 0] as [number, number, number], a: [20, 20, 20] as [number, number, number], w: 1, group: "body" as const };
  it("a sphere has a 2r chord through its center from any angle and none outside the silhouette", () => {
    for (const [rot, tilt] of [[0, 0], [50, 20]]) {
      const p = prepare(sphere, viewBasis(rot, tilt));
      expect(chordAt(p, 0, 0)).toBeCloseTo(40, 6);
      expect(chordAt(p, 20.01, 0)).toBe(0);
      expect(chordAt(p, 10, 0)).toBeCloseTo(2 * Math.sqrt(400 - 100), 6); // 2 sqrt(r^2 - d^2)
    }
  });
  it("a flat plate seen face-on is thin and seen edge-on is long, so the backdrop turns with the C-arm", () => {
    const plate = { ...sphere, a: [50, 50, 4] as [number, number, number] };
    const face = chordAt(prepare(plate, viewBasis(0, 0)), 0, 0), edge = chordAt(prepare(plate, viewBasis(90, 0)), 0, 0);
    expect(face).toBeCloseTo(8, 6); expect(edge).toBeCloseTo(100, 4);
  });
  it("rotating an ellipsoid turns its axes", () => {
    const [u] = axesOf({ ...sphere, roll: 90 });
    expect(u[0]).toBeCloseTo(0, 9); expect(u[1]).toBeCloseTo(1, 9);
  });
  it("the patient has a heart that moves with the beat and lungs that move with the breath", () => {
    const hc: [number, number, number] = [10, 10, 0];
    const lung = (br: number) => patientEllipsoids(hc, br).filter((e) => e.group === "lung")[0];
    expect(lung(1).c[1]).toBeLessThan(lung(-1).c[1]);
    const sys = bodyMotion(100, 60, 1), dia = bodyMotion(800, 60, 1);
    expect(Math.abs(sys.dx)).toBeGreaterThan(0.5); expect(dia.dx).toBeCloseTo(0, 9); // the heart moves in systole and rests in diastole
    expect(bodyMotion(100, 60, 0).dx).toBeCloseTo(0, 9);
  });
  it("motion falls off with distance from the heart", () => {
    expect(motionWeight(0)).toBe(1);
    expect(motionWeight(80)).toBeGreaterThan(motionWeight(200));
    expect(motionWeight(400)).toBeLessThan(0.001);
  });
  it("lists the spine from the neck to the lumbar vertebrae and 24 ribs", () => {
    const sp = spine();
    expect(sp.length).toBe(23);
    expect(sp[0].c[1]).toBeGreaterThan(sp[sp.length - 1].c[1]);
    expect(ribs().length).toBe(24);
  });
});

describe("lumen geometry", () => {
  it("gives a straight vessel parallel walls one diameter apart", () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [20, 0], [30, 0]];
    const { left, right } = wallLines(pts, [6, 6, 6, 6]);
    for (let i = 0; i < 4; i++) expect(Math.hypot(left[i][0] - right[i][0], left[i][1] - right[i][1])).toBeCloseTo(6, 9);
  });
  it("keeps a thin vessel at least a pixel wide and shifts the lumen toward an eccentric plaque", () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [20, 0]];
    const thin = wallLines(pts, [0.1, 0.1, 0.1]);
    expect(Math.abs(thin.left[1][1] - thin.right[1][1])).toBeGreaterThanOrEqual(1.3);
    const off = wallLines(pts, [8, 8, 8], [0.4, 0.4, 0.4]);
    expect(Math.abs(off.left[1][1] - 0)).toBeGreaterThan(Math.abs(off.right[1][1] - 0)); // the lumen leans toward the left wall
    expect(Math.hypot(off.left[1][0] - off.right[1][0], off.left[1][1] - off.right[1][1])).toBeCloseTo(8 * (1 + 0.4 + 1 - 0.4) / 2, 6);
  });
  it("splits sample levels into runs that abut", () => {
    const r = levelRuns([0, 0, 3, 3, 3, 6, 6, 0]);
    expect(r).toEqual([{ a: 2, b: 5, level: 3 }, { a: 5, b: 7, level: 6 }]);
  });
  const plaque: Plaque = { segId: "LAD", centerMm: 50, lengthMm: 16, ds: 0.8, referenceMm: 3, eccentric: 0.8, eccentricAngleDeg: 0, calcium: 0.6, lipid: 0.2, thrombus: 0, remodel: "none", stents: [] };
  it("a plaque shifts the lumen only near itself, and more when eccentric", () => {
    expect(plaqueShift(plaque, 50).ew).toBeCloseTo(1, 6);
    expect(plaqueShift(plaque, 90).ew).toBeLessThan(0.01);
    expect(Math.abs(plaqueShift(plaque, 50).asym)).toBeGreaterThan(Math.abs(plaqueShift({ ...plaque, eccentric: 0.1 }, 50).asym));
    expect(Math.abs(plaqueShift(plaque, 50, 90).asym)).toBeLessThan(1e-9); // seen from the side the thick wall points at the viewer
  });
  it("marks calcium only where the plaque has it", () => {
    expect(calciumSpan({ ...plaque, calcium: 0.1 }, 100, 240)).toBeNull();
    const s = calciumSpan(plaque, 100, 240)!; expect(s.from).toBeLessThan(120); expect(s.to).toBeGreaterThan(120);
  });
  it("smoothing keeps both ends and the path length stays close", () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 10], [20, 10]];
    const s = smoothPath(pts, 2);
    expect(s[0]).toEqual(pts[0]); expect(s[s.length - 1]).toEqual(pts[3]); expect(s.length).toBeGreaterThan(pts.length);
    const a = arcLengths(s); expect(a[a.length - 1]).toBeLessThan(arcLengths(pts).pop()!);
  });
  it("a balloon waists at the lesion and fills out with pressure", () => {
    const lesion = { offsetMm: 0, lengthMm: 8, lumenRadiusMm: 0.5 };
    const low = balloonProfile(41, 12, 1.5, 4, 8, lesion), high = balloonProfile(41, 12, 1.5, 16, 8, lesion);
    const mid = 20;
    expect(low[mid]).toBeLessThan(low[3]);
    expect(high[mid]).toBeGreaterThan(low[mid]);
    expect(balloonProfile(5, 12, 1.5, 0, 8)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
  });
});

import { vertebraEllipsoids } from "../src/cath/body";
import { makeTwigs } from "../src/cath/twigs";

describe("vertebrae", () => {
  const v = spine()[10];
  it("builds a body with a cortical shell, two pedicles, two transverse processes, two facets and a spinous process", () => {
    const e = vertebraEllipsoids(v, 3);
    expect(e.length).toBe(3 + 2 * 3 + 1);
    const [body, cortex, marrow] = e;
    expect(body.w).toBeGreaterThan(0); expect(cortex.w).toBeGreaterThan(0); expect(marrow.w).toBeCloseTo(-cortex.w, 6);
    expect(marrow.a[0]).toBeLessThan(cortex.a[0]);
  });
  it("the shell is brighter at the rim than the center: the chord difference is largest near the edge", () => {
    const e = vertebraEllipsoids(v, 0), b = viewBasis(0, 0), net = (x: number) => e.slice(0, 3).reduce((s, q) => s + q.w * chordAt(prepare(q, b), v.c[0] + x, v.c[1]), 0);
    const half = e[0].a[0];
    expect(net(half * 0.9)).toBeGreaterThan(0);
    // chord shrinks toward the rim, but the shell's share grows: the net density per unit path is higher at the rim
    const dens = (x: number) => net(x) / chordAt(prepare(e[0], b), v.c[0] + x, v.c[1]);
    expect(dens(half * 0.9)).toBeGreaterThan(dens(0));
  });
  it("end plates are cut flat: no chord beyond the clip height", () => {
    const e = vertebraEllipsoids(v, 0)[0], p = prepare(e, viewBasis(0, 0));
    expect(chordAt(p, v.c[0], v.c[1] + e.clipY! + 2)).toBe(0);
    expect(chordAt(p, v.c[0], v.c[1])).toBeGreaterThan(10);
  });
  it("levels differ a little from one another but are repeatable for a given seed", () => {
    expect(vertebraEllipsoids(v, 1)[0].a[0]).not.toBeCloseTo(vertebraEllipsoids(v, 2)[0].a[0], 3);
    expect(vertebraEllipsoids(v, 1)[0].a).toEqual(vertebraEllipsoids(v, 1)[0].a);
  });
});

describe("fine branches", () => {
  const seg = { id: "LAD", samples: Array.from({ length: 41 }, (_, i) => [i * 2, -i, 0] as [number, number, number]), diameterMm: Array(41).fill(3), length: 90 };
  it("are deterministic, start on the vessel, and stay short and thin", () => {
    const a = makeTwigs(seg), b = makeTwigs(seg);
    expect(a).toEqual(b); expect(a.length).toBeGreaterThan(3);
    for (const t of a) {
      const p = seg.samples[t.at]; expect(t.pts[0]).toEqual(p);
      expect(t.dMm).toBeLessThan(1); expect(t.lengthMm).toBeLessThan(20); expect(t.pts.length).toBeGreaterThan(5);
    }
  });
  it("skip tiny vessels", () => {
    expect(makeTwigs({ ...seg, diameterMm: Array(41).fill(0.8) })).toEqual([]);
    expect(makeTwigs({ ...seg, length: 15 })).toEqual([]);
  });
});
