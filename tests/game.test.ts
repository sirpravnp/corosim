import { describe, it, expect } from "vitest";
import { buildTree, TYPICAL } from "../src/anatomy/tree";
import { analyze } from "../src/physics/network";
import { dailyCase, dayKey, dayNumber, drawCase, explain, fullFindings, judge, keyOfDay, parseDay, rvInvolvement, streaks, MAX_SCORE, locationScore, randomVariant, score, seeded, signal, solvable, timeFactor, treeDistance, EPOCH, POINTS, SOLVABLE } from "../src/game";

/** Seeded LCG so a failing draw is reproducible. */
const lcg = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

describe("the day's case", () => {
  it("keys the day in the player's own calendar and numbers cases from the first", () => {
    expect(dayKey(new Date(2026, 9, 7, 23, 59))).toBe("2026-10-07");
    expect(dayKey(new Date(2027, 0, 3, 0, 1))).toBe("2027-01-03");
    expect(dayNumber(EPOCH)).toBe(1);
    expect(dayNumber("2026-10-08")).toBe(2);
    expect(dayNumber("2027-10-07")).toBe(366);
  });
  it("draws the same case for the same day and different cases on different days", () => {
    expect(dailyCase("2026-10-07")).toEqual(dailyCase("2026-10-07"));
    const keys = Array.from({ length: 60 }, (_, i) => `2026-11-${String(i % 30 + 1).padStart(2, "0")}-${Math.floor(i / 30)}`);
    const distinct = new Set(keys.map((k) => JSON.stringify(dailyCase(k))));
    expect(distinct.size).toBeGreaterThan(50);
  });
  it("seeded generators are uniform on [0, 1) and independent of each other", () => {
    const r = seeded("x"), xs = Array.from({ length: 2000 }, r);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0); expect(Math.max(...xs)).toBeLessThan(1);
    expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeCloseTo(0.5, 1);
    expect(seeded("2026-10-07")()).not.toBe(seeded("2026-10-08")());
  });
  it("the vessel exists in the drawn variant; stenoses come with exertion", () => {
    const rng = lcg(2);
    let occl = 0, sten = 0;
    for (let i = 0; i < 300; i++) {
      const c = drawCase(rng);
      expect(buildTree(c.variant).byId[c.lesion.segId]).toBeDefined();
      expect(c.lesion.pos).toBeGreaterThanOrEqual(0.05); expect(c.lesion.pos).toBeLessThanOrEqual(0.9);
      if (c.lesion.occluded) { occl++; expect(c.lesion.ds).toBe(1); expect(c.exert).toBe(false); }
      else { sten++; expect(c.lesion.ds).toBeGreaterThanOrEqual(0.88); expect(c.lesion.ds).toBeLessThanOrEqual(0.95); expect(c.exert).toBe(true); }
    }
    expect(occl).toBeGreaterThan(100); expect(sten).toBeGreaterThan(50);
  });
  it("every drawn case starves at least one bed, so there is always something to find", () => {
    const rng = lcg(3);
    for (let i = 0; i < 80; i++) {
      const c = drawCase(rng);
      const a = analyze(buildTree(c.variant), [c.lesion], c.exert);
      expect(Math.max(...a.cond.terminals.map((t) => t.severity))).toBeGreaterThan(0.5);
    }
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
    expect(perfect).toEqual({ distance: 0, location: 100, floored: false, time: 1, rv: 0, total: 100 });
    const late = score(t, lesion, lesion, POINTS.timeTau);
    expect(late.total).toBe(Math.round(100 / Math.E));
    const off = score(t, { segId: "LAD", pos: 0.5 }, lesion, 0);
    expect(off.distance).toBeCloseTo(0.2 * t.byId.LAD.length, 6);
    expect(off.total).toBeLessThan(perfect.total); expect(off.total).toBeGreaterThan(POINTS.territoryFloor);
    expect(score(t, null, lesion, 10).total).toBe(0);
  });
  it("the right system is never worth nothing: a PDA call on a proximal RCA lesion gets the floor, an LAD call does not", () => {
    const lesion = { segId: "RCA", pos: 0.2 };
    const pda = score(t, { segId: "PDA_R", pos: 0.5 }, lesion, 0), lad = score(t, { segId: "LAD", pos: 0.2 }, lesion, 0);
    expect(pda.distance).toBeGreaterThan(80);
    expect(pda.floored).toBe(true); expect(pda.location).toBe(POINTS.territoryFloor); expect(pda.total).toBe(POINTS.territoryFloor);
    expect(lad.floored).toBe(false); expect(lad.total).toBe(0);
    // the floor never lifts a call that already beats it, and the clock still applies to it
    const near = score(t, { segId: "RCA", pos: 0.35 }, lesion, 0);
    expect(near.floored).toBe(false); expect(near.location).toBeGreaterThan(POINTS.territoryFloor);
    expect(score(t, { segId: "PDA_R", pos: 0.5 }, lesion, POINTS.timeTau).total).toBe(Math.round(POINTS.territoryFloor / Math.E));
  });
});

describe("debrief", () => {
  const t = buildTree(TYPICAL);
  it("names the lesion, the leads and the territory", () => {
    const s = explain(t, { variant: TYPICAL, lesion: { segId: "D1", pos: 0.3, ds: 1, occluded: true }, exert: false, rhythm: "sinus", bbb: "none" }, { stUp: ["I", "aVL", "V2"], stDown: ["III", "aVF"], rhythm: "Sinus tachycardia" });
    expect(s).toContain("Complete occlusion of the Diagonal 1, 30% of the way along it");
    expect(s).toContain("At full ischemia: ST elevation in I, aVL, V2, depression in III, aVF.");
    expect(s).toContain("Rhythm: Sinus tachycardia.");
    expect(s).toContain("diagonals add I and aVL");
  });
  it("describes a stenosis under exertion and a silent tracing", () => {
    const s = explain(t, { variant: TYPICAL, lesion: { segId: "SAN", pos: 0.5, ds: 0.9, occluded: false }, exert: true, rhythm: "sinus", bbb: "none" }, { stUp: [], stDown: [], rhythm: "" });
    expect(s).toContain("90% stenosis of the SA-node artery");
    expect(s).toContain("under exertion");
    expect(s).toContain("No lead reaches 1 mm");
    expect(s).toContain("sinus slowing");
  });
});

describe("solvable cases", () => {
  it("every day's case can be found: ST somewhere, AV block, or a rate change", () => {
    for (let i = 0; i < 120; i++) {
      const d = new Date(2026, 9, 7 + i);
      const c = dailyCase(dayKey(d));
      expect(solvable(c)).toBe(true);
    }
  });
  it("some raw draws are not, so the check earns its keep", () => {
    const rng = lcg(11);
    let bad = 0;
    for (let i = 0; i < 200; i++) if (!solvable(drawCase(rng))) bad++;
    expect(bad).toBeGreaterThan(0);
  });
  it("the conus branch is never a case: too little muscle to move any lead", () => {
    const c = { variant: TYPICAL, lesion: { segId: "CONUS", pos: 0.5, ds: 1, occluded: true }, exert: false, rhythm: "sinus" as const, bbb: "none" as const };
    expect(signal(c).stMax).toBeLessThan(SOLVABLE.stMm);
    expect(solvable(c)).toBe(false);
  });
  it("the SA-node artery is a case in sinus rhythm (the rate falls) but not in atrial fibrillation", () => {
    const san = (rhythm: "sinus" | "af") => ({ variant: TYPICAL, lesion: { segId: "SAN", pos: 0.5, ds: 1, occluded: true }, exert: false, rhythm, bbb: "none" as const });
    expect(signal(san("sinus")).rateChange).toBeGreaterThanOrEqual(SOLVABLE.rateBpm);
    expect(solvable(san("sinus"))).toBe(true);
    expect(signal(san("af")).rateChange).toBeLessThan(SOLVABLE.rateBpm);
    expect(solvable(san("af"))).toBe(false);
  });
  it("the AV-node artery is a case in either rhythm: the node blocks", () => {
    for (const rhythm of ["sinus", "af"] as const) {
      const c = { variant: TYPICAL, lesion: { segId: "AVN", pos: 0.5, ds: 1, occluded: true }, exert: false, rhythm, bbb: "none" as const };
      expect(signal(c).avDegree).toBeGreaterThanOrEqual(1);
      expect(solvable(c)).toBe(true);
    }
  });
  it("posterior leads see a circumflex occlusion the twelve leads barely do", () => {
    const c = { variant: { ...TYPICAL, dominance: "left" as const }, lesion: { segId: "LCX", pos: 0.5, ds: 1, occluded: true }, exert: false, rhythm: "sinus" as const, bbb: "none" as const };
    const s = signal(c);
    const posterior = Math.max(s.st.V7, s.st.V8, s.st.V9), twelve = Math.max(...(["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"] as const).map((l) => s.st[l]));
    expect(posterior).toBeGreaterThan(SOLVABLE.posteriorStMm);
    expect(posterior).toBeGreaterThan(twelve * 0.6); // elevation on the back, with the posterior attenuation, at least rivals the best standard lead
    expect(s.st.V2).toBeLessThan(0); // the anterior leads show it as reciprocal depression
  });
  it("draws fibrillation and both blocks over many cases", () => {
    const rng = lcg(12), seen = new Set<string>();
    for (let i = 0; i < 200; i++) { const c = drawCase(rng); seen.add("r:" + c.rhythm); seen.add("b:" + c.bbb); }
    for (const k of ["r:sinus", "r:af", "b:none", "b:rbbb", "b:lbbb"]) expect(seen.has(k)).toBe(true);
  });
  it("the debrief names the background", () => {
    const c = { variant: TYPICAL, lesion: { segId: "LAD", pos: 0.3, ds: 1, occluded: true }, exert: false, rhythm: "af" as const, bbb: "lbbb" as const };
    const s = explain(buildTree(TYPICAL), c, { stUp: ["V2"], stDown: [], rhythm: "Atrial fibrillation, left bundle branch block" });
    expect(s).toContain("atrial fibrillation");
    expect(s).toContain("Sgarbossa");
  });
});

describe("full findings", () => {
  it("lists the leads a case moves at full ischemia, with the posterior bar at 0.5 mm", () => {
    const f = fullFindings({ variant: TYPICAL, lesion: { segId: "LAD", pos: 0.1, ds: 1, occluded: true }, exert: false, rhythm: "sinus", bbb: "none" });
    expect(f.stUp).toEqual(expect.arrayContaining(["V2", "V3", "V4"]));
    expect(f.stDown.length + f.stUp.length).toBeGreaterThan(4);
    const lcx = fullFindings({ variant: { ...TYPICAL, dominance: "left" }, lesion: { segId: "LCX", pos: 0.5, ds: 1, occluded: true }, exert: false, rhythm: "sinus", bbb: "none" });
    expect(lcx.stUp.some((l) => ["V7", "V8", "V9"].includes(l))).toBe(true);
    expect(lcx.stDown).toContain("V2");
  });
  it("the debrief quotes the myocardium actually beyond the lesion, not the whole vessel", () => {
    const t = buildTree(TYPICAL);
    const near = explain(t, { variant: TYPICAL, lesion: { segId: "LAD", pos: 0.1, ds: 1, occluded: true }, exert: false, rhythm: "sinus", bbb: "none" }, { stUp: [], stDown: [], rhythm: "" });
    const far = explain(t, { variant: TYPICAL, lesion: { segId: "LAD", pos: 0.9, ds: 1, occluded: true }, exert: false, rhythm: "sinus", bbb: "none" }, { stUp: [], stDown: [], rhythm: "" });
    const pct = (s: string) => +s.match(/(\d+)% of the myocardium lies beyond/)![1];
    expect(pct(near)).toBeGreaterThan(35);
    expect(pct(far)).toBeLessThan(15);
  });
});

describe("streak, archive and the right ventricle", () => {
  it("counts a streak ending today or yesterday, and the best run ever", () => {
    expect(streaks([], 10)).toEqual({ current: 0, best: 0 });
    expect(streaks([8, 9, 10], 10)).toEqual({ current: 3, best: 3 });
    expect(streaks([7, 8, 9], 10)).toEqual({ current: 3, best: 3 }); // yesterday still counts
    expect(streaks([6, 7, 8], 10)).toEqual({ current: 0, best: 3 }); // two days off: it is over
    expect(streaks([1, 2, 3, 4, 9, 10], 10)).toEqual({ current: 2, best: 4 });
    expect(streaks([10, 10, 9], 10).current).toBe(2); // duplicates do not count twice
  });
  it("keys and numbers round-trip; the archive accepts any case from the first up to today", () => {
    for (const n of [1, 2, 31, 100, 366]) expect(dayNumber(keyOfDay(n))).toBe(n);
    expect(keyOfDay(1)).toBe(EPOCH);
    const today = "2026-10-20";
    expect(parseDay("2026-10-07", today)).toBe("2026-10-07");
    expect(parseDay(today, today)).toBe(today);
    expect(parseDay("2026-10-21", today)).toBeNull(); // tomorrow
    expect(parseDay("2026-10-06", today)).toBeNull(); // before the first case
    expect(parseDay("2026-2-3", today)).toBeNull(); expect(parseDay("2026-13-40", today)).toBeNull();
    expect(parseDay(null, today)).toBeNull(); expect(parseDay("drop table", today)).toBeNull();
  });
  it("a proximal RCA occlusion takes the right ventricle; a LAD occlusion does not", () => {
    const mk = (segId: string) => ({ variant: TYPICAL, lesion: { segId, pos: 0.2, ds: 1, occluded: true }, exert: false, rhythm: "sinus" as const, bbb: "none" as const });
    const rca = rvInvolvement(mk("RCA")), lad = rvInvolvement(mk("LAD"));
    expect(rca.involved).toBe(true); expect(rca.fraction).toBeGreaterThan(POINTS.rvInvolvedAt);
    expect(lad.involved).toBe(false); expect(lad.fraction).toBeLessThan(0.1);
    expect(rvInvolvement({ ...mk("RCA"), lesion: { segId: "RCA", pos: 0.9, ds: 1, occluded: true } }).involved).toBe(false); // distal: the acute marginal is upstream
  });
  it("the right-ventricle call adds or takes ten, never below zero, and nothing without a location call", () => {
    const t = buildTree(TYPICAL), lesion = { segId: "RCA", pos: 0.2 };
    expect(score(t, lesion, lesion, 0, { answer: true, truth: true }).total).toBe(MAX_SCORE);
    expect(score(t, lesion, lesion, 0, { answer: false, truth: true }).total).toBe(POINTS.location - POINTS.rv);
    expect(score(t, { segId: "LAD", pos: 0.2 }, lesion, 0, { answer: false, truth: true }).total).toBe(0);
    expect(score(t, null, lesion, 0, { answer: true, truth: true }).total).toBe(0);
    expect(score(t, lesion, lesion, 0).rv).toBe(0);
  });
});
