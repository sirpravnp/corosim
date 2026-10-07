import { describe, it, expect } from "vitest";
import { buildTree, TYPICAL, Variant } from "../src/anatomy/tree";
import { solveNetwork } from "../src/physics/network";
import { bedSites, ischemicBurden, globalSeverity } from "../src/physics/ecgLink";
import { rhythmState, RhythmState } from "../src/physics/rhythm";
import { circulation, CIRC, isRightVentricular } from "../src/physics/circulation";

const MMHG = 133.322;
function afterOcclusion(v: Variant, segId: string, pos: number) {
  const t = buildTree(v), sites = bedSites(t);
  const r = solveNetwork(t, [{ segId, pos, ds: 1, occluded: true }], 1);
  const sev = Object.fromEntries(r.terminals.map((x) => [x.key, x.blocked ? 1 : 0]));
  const rs = rhythmState(sites, sev, globalSeverity(ischemicBurden(sites, sev)));
  return { sites, sev, rs, c: circulation(sites, sev, rs) };
}
const sites = bedSites(buildTree(TYPICAL));
const calm = rhythmState(sites, {}, 0);

describe("baseline circulation", () => {
  it("rests at about 123/73 with MAP 90 and a cardiac output of 5 L/min", () => {
    const c = circulation(sites, {}, calm);
    expect(c.map).toBeCloseTo(CIRC.baseMap, 6);
    expect(c.cardiacOutput).toBeCloseTo(5.04, 2);
    expect(c.systolic).toBeGreaterThan(115); expect(c.systolic).toBeLessThan(130);
    expect(c.diastolic).toBeGreaterThan(65); expect(c.diastolic).toBeLessThan(80);
    expect(c.state).toBe("stable");
  });
  it("classifies right-ventricular beds by their arteries", () => {
    expect(isRightVentricular("AM#end")).toBe(true);
    expect(isRightVentricular("RCA#1")).toBe(true);
    expect(isRightVentricular("PDA_R#end")).toBe(false);
    expect(isRightVentricular("LAD#end")).toBe(false);
  });
});

describe("rate and filling", () => {
  it("a slower rate fills the ventricle more but still lowers cardiac output", () => {
    const slow: RhythmState = { ...calm, avDegree: 3, escapeRate: 42 };
    const a = circulation(sites, {}, calm), b = circulation(sites, {}, slow);
    expect(b.strokeVolume).toBeGreaterThan(a.strokeVolume);
    expect(b.cardiacOutput).toBeLessThan(a.cardiacOutput);
    expect(b.map).toBeLessThan(a.map);
    expect(b.systolic - b.diastolic).toBeGreaterThan(a.systolic - a.diastolic); // wider pulse pressure
  });
});

describe("pressure by culprit artery", () => {
  it("proximal LAD: stroke volume falls by about half; tachycardia and vasoconstriction hold MAP near 80", () => {
    const { c } = afterOcclusion(TYPICAL, "LAD", 0.1);
    expect(c.lvIschemia).toBeGreaterThan(0.4);
    expect(c.strokeVolume).toBeLessThan(45);
    expect(c.map).toBeGreaterThan(75); expect(c.map).toBeLessThan(88);
  });
  it("left main occlusion: cardiogenic shock", () => {
    expect(afterOcclusion(TYPICAL, "LM", 0.5).c.state).toBe("shock");
  });
  it("inferior infarct with heart block is hypotensive; right-ventricular involvement makes it worse", () => {
    const mid = afterOcclusion(TYPICAL, "RCA", 0.6).c, prox = afterOcclusion(TYPICAL, "RCA", 0.15).c;
    expect(mid.map).toBeLessThan(CIRC.hypotensionMap);
    expect(prox.rvIschemia).toBeGreaterThan(mid.rvIschemia);
    expect(prox.map).toBeLessThan(mid.map);
  });
  it("a small distal branch barely moves the pressure", () => {
    const { c } = afterOcclusion(TYPICAL, "D2", 0.3);
    expect(c.map).toBeGreaterThan(85);
  });
});

describe("hypotension feeds back on coronary perfusion", () => {
  const t = buildTree(TYPICAL);
  it("a healthy tree is fully perfused down to a MAP of about 55, then fails globally", () => {
    expect(solveNetwork(t, [], 1, 55 * MMHG).atRisk).toBe(0);
    expect(solveNetwork(t, [], 1, 40 * MMHG).atRisk).toBeGreaterThan(0.8);
  });
  it("a 70% stenosis that is silent at normal pressure becomes ischemic when pressure falls", () => {
    const les = [{ segId: "LAD", pos: 0.4, ds: 0.7 }];
    expect(solveNetwork(t, les, 1, 90 * MMHG).atRisk).toBe(0);
    expect(solveNetwork(t, les, 1, 70 * MMHG).atRisk).toBeGreaterThan(0.2);
  });
});
