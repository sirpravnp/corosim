import { describe, it, expect } from "vitest";
import { buildTree, TYPICAL } from "../src/anatomy/tree";
import { analyze } from "../src/physics/network";
import { drawCase, eligible, explain, judge, locationScore, maxScore, randomVariant, score, timeFactor, treeDistance, POINTS, ROUNDS, Level } from "../src/game";

/** Seeded LCG so a failing draw is reproducible. */
const lcg = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const LEVELS: Level[] = ["resident", "attending"];

describe("case drawing", () => {
  it("resident cases: typical anatomy, a complete occlusion of a main artery, proximal", () => {
    const rng = lcg(1);
    for (let i = 0; i < 200; i++) {
      const c = drawCase(rng, "resident");
      expect(c.variant).toEqual(TYPICAL);
      expect(c.lesion.occluded).toBe(true); expect(c.exert).toBe(false);
      expect(["LM", "LAD", "LCX", "RCA", "D1", "OM1", "PDA_R"]).toContain(c.lesion.segId);
      expect(c.lesion.pos).toBeGreaterThanOrEqual(0.1); expect(c.lesion.pos).toBeLessThanOrEqual(0.4);
    }
  });
  it("attending cases: the vessel exists in the drawn variant; stenoses come with exertion", () => {
    const rng = lcg(2);
    let occl = 0, sten = 0;
    for (let i = 0; i < 300; i++) {
      const c = drawCase(rng, "attending");
      expect(buildTree(c.variant).byId[c.lesion.segId]).toBeDefined();
      expect(c.lesion.pos).toBeGreaterThanOrEqual(0.05); expect(c.lesion.pos).toBeLessThanOrEqual(0.9);
      if (c.lesion.occluded) { occl++; expect(c.lesion.ds).toBe(1); expect(c.exert).toBe(false); }
      else { sten++; expect(c.lesion.ds).toBeGreaterThanOrEqual(0.88); expect(c.lesion.ds).toBeLessThanOrEqual(0.95); expect(c.exert).toBe(true); }
    }
    expect(occl).toBeGreaterThan(100); expect(sten).toBeGreaterThan(50);
  });
  it("every drawn case starves at least one bed, so there is always something to find", () => {
    for (const level of LEVELS) {
      const rng = lcg(3);
      for (let i = 0; i < 60; i++) {
        const c = drawCase(rng, level);
        const a = analyze(buildTree(c.variant), [c.lesion], c.exert);
        expect(Math.max(...a.cond.terminals.map((t) => t.severity))).toBeGreaterThan(0.5);
      }
    }
  });
  it("never repeats the vessel it is told to avoid", () => {
    const rng = lcg(4);
    for (let i = 0; i < 100; i++) expect(drawCase(rng, "resident", "LAD").lesion.segId).not.toBe("LAD");
  });
  it("eligibility: resident asks about the main arteries present; attending asks about every vessel", () => {
    const t = buildTree(TYPICAL), l = buildTree({ ...TYPICAL, dominance: "left", lm: "absent" });
    expect(eligible(t, "resident").sort()).toEqual(["D1", "LAD", "LCX", "LM", "OM1", "PDA_R", "RCA"]);
    expect(eligible(l, "resident")).not.toContain("LM"); expect(eligible(l, "resident")).toContain("PDA_L");
    expect(eligible(t, "attending")).toEqual(t.segments.map((s) => s.id));
  });
  it("random variants cover every dominance and left-main pattern over many draws", () => {
    const rng = lcg(5), seen = new Set<string>();
    for (let i = 0; i < 200; i++) { const v = randomVariant(rng); seen.add("d:" + v.dominance); seen.add("lm:" + v.lm); seen.add("lad:" + v.ladCourse); }
    for (const k of ["d:right", "d:co", "d:left", "lm:bifurcation", "lm:trifurcation", "lm:absent", "lad:normal", "lad:short", "lad:wrap"]) expect(seen.has(k)).toBe(true);
  });
});

describe("scoring", () => {
  const t = buildTree(TYPICAL);
  it("judges the vessel, the territory, or a miss", () => {
    expect(judge(t, "D1", "D1")).toBe("vessel");
    expect(judge(t, "LAD", "D1")).toBe("territory");
    expect(judge(t, "RCA", "D1")).toBe("miss");
    expect(judge(t, "", "D1")).toBe("miss");
    expect(judge(t, "PDA_R", "AVN")).toBe("territory");
  });
  describe("distance along the tree", () => {
    const lad = t.byId.LAD, d1 = t.byId.D1, d2 = t.byId.D2, rca = t.byId.RCA;
    it("is arc length on the same vessel, and zero at the same point", () => {
      expect(treeDistance(t, { segId: "LAD", pos: 0.2 }, { segId: "LAD", pos: 0.5 })).toBeCloseTo(0.3 * lad.length, 6);
      expect(treeDistance(t, { segId: "LAD", pos: 0.4 }, { segId: "LAD", pos: 0.4 })).toBe(0);
    });
    it("runs through the branch point between a vessel and its branch", () => {
      const d = treeDistance(t, { segId: "D1", pos: 0.5 }, { segId: "LAD", pos: 0.5 });
      expect(d).toBeCloseTo(0.5 * d1.length + (0.5 - d1.attach) * lad.length, 6);
    });
    it("runs through the common parent between sibling branches", () => {
      const d = treeDistance(t, { segId: "D1", pos: 0.3 }, { segId: "D2", pos: 0.3 });
      expect(d).toBeCloseTo(0.3 * d1.length + 0.3 * d2.length + (d2.attach - d1.attach) * lad.length, 6);
    });
    it("runs through the left main and the aortic root between the two systems", () => {
      const d = treeDistance(t, { segId: "LAD", pos: 0.1 }, { segId: "RCA", pos: 0.1 });
      expect(d).toBeCloseTo(0.1 * lad.length + t.byId.LM.length + 0.1 * rca.length, 6);
    });
    it("is symmetric", () => {
      const a = { segId: "OM1", pos: 0.7 }, b = { segId: "PDA_R", pos: 0.2 };
      expect(treeDistance(t, a, b)).toBeCloseTo(treeDistance(t, b, a), 9);
    });
    it("just distal to a branch is far from just proximal to it, as the physiology is", () => {
      // 1 mm apart on the LAD, but the D1 territory lies between them: the metric must not be Euclidean
      const near = treeDistance(t, { segId: "LAD", pos: d1.attach - 0.01 }, { segId: "LAD", pos: d1.attach + 0.01 });
      expect(near).toBeCloseTo(0.02 * lad.length, 6);
      expect(treeDistance(t, { segId: "D1", pos: 0.9 }, { segId: "LAD", pos: d1.attach + 0.01 })).toBeGreaterThan(0.9 * d1.length);
    });
  });
  it("location score is full on the lesion, free within its half-length, then falls off smoothly", () => {
    expect(locationScore(0)).toBe(POINTS.location);
    expect(locationScore(POINTS.freeMm)).toBe(POINTS.location);
    expect(locationScore(POINTS.freeMm + POINTS.sigmaMm)).toBeCloseTo(POINTS.location / Math.E, 6);
    const xs = Array.from({ length: 20 }, (_, i) => locationScore(i * 5));
    xs.forEach((x, i) => i && expect(x).toBeLessThanOrEqual(xs[i - 1]));
    expect(locationScore(100)).toBeLessThan(0.01);
  });
  it("time factor is one at the occlusion and decays continuously, never to zero", () => {
    expect(timeFactor(0)).toBe(1);
    expect(timeFactor(POINTS.timeTau)).toBeCloseTo(1 / Math.E, 9);
    expect(timeFactor(30)).toBeGreaterThan(timeFactor(31));
    expect(timeFactor(1e4)).toBeGreaterThan(0);
    expect(timeFactor(-5)).toBe(1);
  });
  it("score multiplies location by time; no call scores nothing", () => {
    const lesion = { segId: "LAD", pos: 0.3 };
    const perfect = score(t, lesion, lesion, 0);
    expect(perfect).toEqual({ distance: 0, location: 100, time: 1, total: 100 });
    const late = score(t, lesion, lesion, POINTS.timeTau);
    expect(late.total).toBe(Math.round(100 / Math.E));
    const off = score(t, { segId: "LAD", pos: 0.5 }, lesion, 0);
    expect(off.distance).toBeCloseTo(0.2 * t.byId.LAD.length, 6);
    expect(off.total).toBeLessThan(perfect.total); expect(off.total).toBeGreaterThan(0);
    expect(score(t, null, lesion, 10).total).toBe(0);
    expect(maxScore()).toBe(ROUNDS * POINTS.location);
  });
});

describe("debrief", () => {
  const t = buildTree(TYPICAL);
  it("names the lesion, the leads and the territory", () => {
    const s = explain(t, { variant: TYPICAL, lesion: { segId: "D1", pos: 0.3, ds: 1, occluded: true }, exert: false }, { stUp: ["I", "aVL", "V2"], stDown: ["III", "aVF"], rhythm: "Sinus tachycardia" });
    expect(s).toContain("Complete occlusion of the Diagonal 1, 30% of the way along it");
    expect(s).toContain("ST elevation in I, aVL, V2, depression in III, aVF.");
    expect(s).toContain("Rhythm: Sinus tachycardia.");
    expect(s).toContain("diagonals add I and aVL");
  });
  it("describes a stenosis under exertion and a silent tracing", () => {
    const s = explain(t, { variant: TYPICAL, lesion: { segId: "SAN", pos: 0.5, ds: 0.9, occluded: false }, exert: true }, { stUp: [], stDown: [], rhythm: "" });
    expect(s).toContain("90% stenosis of the SA-node artery");
    expect(s).toContain("under exertion");
    expect(s).toContain("No lead reached 1 mm");
    expect(s).toContain("sinus slowing");
  });
});
