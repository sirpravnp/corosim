import { describe, it, expect } from "vitest";
import { buildTree, TYPICAL } from "../src/anatomy/tree";
import { analyze } from "../src/physics/network";
import { drawCase, eligible, explain, judge, maxScore, points, randomVariant, speedBonus, POINTS, ROUNDS, Level } from "../src/game";

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
  it("speed bonus is full early, falls to zero late, and never goes negative", () => {
    expect(speedBonus(0)).toBe(POINTS.speedBonus);
    expect(speedBonus(POINTS.speedFullUntil)).toBe(POINTS.speedBonus);
    expect(speedBonus((POINTS.speedFullUntil + POINTS.speedZeroAt) / 2)).toBe(POINTS.speedBonus / 2);
    expect(speedBonus(POINTS.speedZeroAt)).toBe(0);
    expect(speedBonus(1e6)).toBe(0);
  });
  it("only a correct vessel earns the speed bonus", () => {
    expect(points("vessel", 10)).toEqual({ base: 100, bonus: 50, total: 150 });
    expect(points("territory", 10)).toEqual({ base: 40, bonus: 0, total: 40 });
    expect(points("miss", 10)).toEqual({ base: 0, bonus: 0, total: 0 });
    expect(maxScore()).toBe(ROUNDS * 150);
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
