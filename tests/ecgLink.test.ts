import { describe, it, expect } from "vitest";
import { buildTree, TYPICAL, Variant } from "../src/anatomy/tree";
import { solveNetwork } from "../src/physics/network";
import { bedSites, injuryVector, ischemicBurden, globalSeverity } from "../src/physics/ecgLink";
import { generateBeats, stLevelVec } from "../src/physics/ecg";
import { LeadName, LEADS } from "../src/config/ecg";

const beats = generateBeats(10, () => 0, 1);
/** ST (mm) in each lead after a complete occlusion, with every downstream bed fully ischemic. */
function occlusionST(v: Variant, segId: string, pos: number): Record<LeadName, number> {
  const t = buildTree(v);
  const r = solveNetwork(t, [{ segId, pos, ds: 1, occluded: true }], 1);
  const inj = injuryVector(bedSites(t), Object.fromEntries(r.terminals.map((x) => [x.key, x.blocked ? 1 : 0])));
  return Object.fromEntries(LEADS.map((l) => [l, stLevelVec(l, beats[3], beats, inj, 0) * 10])) as Record<LeadName, number>;
}

describe("bed sites", () => {
  const t = buildTree(TYPICAL), sites = bedSites(t);
  it("one unit direction per perfused bed, with masses summing to 1", () => {
    expect(sites.reduce((a, s) => a + s.mass, 0)).toBeCloseTo(1, 6);
    for (const s of sites) expect(Math.hypot(...s.dir)).toBeCloseTo(1, 6);
  });
  it("anterior beds face forward, posterior/inferior beds face back or down", () => {
    const lad = sites.find((s) => s.key === "LAD#0")!, pda = sites.find((s) => s.key === "PDA_R#end")!;
    expect(lad.dir[2]).toBeGreaterThan(0.3);
    expect(pda.dir[2] < 0 || pda.dir[1] > 0.5).toBe(true);
  });
  it("no ischemia gives no injury current", () => {
    expect(injuryVector(sites, {})).toEqual([0, 0, 0]);
    expect(ischemicBurden(sites, {})).toBe(0);
  });
  it("burden and global severity scale with ischemic mass", () => {
    const all = Object.fromEntries(sites.map((s) => [s.key, 1]));
    expect(ischemicBurden(sites, all)).toBeCloseTo(1, 6);
    expect(globalSeverity(0)).toBe(0);
    expect(globalSeverity(1)).toBe(1);
  });
});

describe("culprit artery → ST pattern (emerges from the tree geometry)", () => {
  it("proximal LAD: anterior and high-lateral elevation with inferior reciprocal depression", () => {
    const s = occlusionST(TYPICAL, "LAD", 0.1);
    expect(s.V2).toBeGreaterThan(2.5); expect(s.V2).toBeLessThan(5);
    for (const l of ["V1", "V3", "V4", "I", "aVL"] as const) expect(s[l]).toBeGreaterThan(1);
    expect(s.III).toBeLessThan(-1);
  });
  it("first diagonal: high-lateral elevation (I, aVL) with inferior reciprocal change", () => {
    const s = occlusionST(TYPICAL, "D1", 0.2);
    expect(s.aVL).toBeGreaterThan(0.5); expect(s.I).toBeGreaterThan(0.5);
    expect(s.III).toBeLessThan(0);
  });
  it("proximal RCA: inferior elevation with III > II and reciprocal aVL depression", () => {
    const s = occlusionST(TYPICAL, "RCA", 0.2);
    expect(s.III).toBeGreaterThan(s.II); expect(s.II).toBeGreaterThan(1);
    expect(s.aVL).toBeLessThan(-1);
    expect(s.V1).toBeGreaterThan(s.V2); // right-ventricular branches pull V1 up relative to V2
  });
  it("left-dominant circumflex: posterior pattern (V1–V2 depression) with lateral elevation", () => {
    const s = occlusionST({ ...TYPICAL, dominance: "left" }, "LCX", 0.2);
    expect(s.V1).toBeLessThan(-2); expect(s.V2).toBeLessThan(-2);
    expect(s.I).toBeGreaterThan(1);
  });
  it("a wrap-around LAD adds inferior elevation that a normal LAD does not", () => {
    const wrap = occlusionST({ ...TYPICAL, ladCourse: "wrap" }, "LAD", 0.6);
    const normal = occlusionST(TYPICAL, "LAD", 0.6);
    expect(wrap.aVF).toBeGreaterThan(normal.aVF);
    expect(wrap.aVF).toBeGreaterThan(0.5);
  });
  it("a small branch changes the ECG far less than its parent", () => {
    const big = occlusionST(TYPICAL, "LAD", 0.1), small = occlusionST(TYPICAL, "D2", 0.3);
    const mag = (s: Record<LeadName, number>) => Math.max(...LEADS.map((l) => Math.abs(s[l])));
    expect(mag(small)).toBeLessThan(mag(big) / 2);
  });
});
