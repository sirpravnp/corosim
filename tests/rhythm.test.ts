import { describe, it, expect } from "vitest";
import { buildTree, TYPICAL, Variant } from "../src/anatomy/tree";
import { solveNetwork } from "../src/physics/network";
import { bedSites, ischemicBurden, globalSeverity } from "../src/physics/ecgLink";
import { rhythmState, Conduction, CONDUCTION, RhythmState } from "../src/physics/rhythm";
import { RHYTHM } from "../src/config/ecg";

function afterOcclusion(v: Variant, segId: string, pos: number): RhythmState {
  const t = buildTree(v), sites = bedSites(t);
  const r = solveNetwork(t, [{ segId, pos, ds: 1, occluded: true }], 1);
  const sev = Object.fromEntries(r.terminals.map((x) => [x.key, x.blocked ? 1 : 0]));
  return rhythmState(sites, sev, globalSeverity(ischemicBurden(sites, sev)));
}
const minute = (st: RhythmState, seed = 3) => {
  const b = new Conduction(seed).advance(60, st);
  return { b, qrs: b.filter((x) => !x.pOnly && !x.pvc), p: b.filter((x) => !x.noP && !x.pvc), dropped: b.filter((x) => x.pOnly) };
};

describe("rate depends on where the ischemia is", () => {
  it("no ischemia: normal sinus rhythm at the baseline rate", () => {
    const st = rhythmState(bedSites(buildTree(TYPICAL)), {}, 0);
    expect(st.sinusRate).toBeCloseTo(RHYTHM.baseHr, 6);
    expect(st.avDegree).toBe(0);
  });
  it("proximal LAD occlusion: sympathetic sinus tachycardia, normal AV conduction", () => {
    const st = afterOcclusion(TYPICAL, "LAD", 0.1);
    expect(st.sinusRate).toBeGreaterThan(90);
    expect(st.vagal).toBe(0);
    expect(st.avDegree).toBe(0);
  });
  it("RCA occlusion in a right-dominant heart: vagal bradycardia and AV block", () => {
    const st = afterOcclusion(TYPICAL, "RCA", 0.6);
    expect(st.sinusRate).toBeLessThan(60);
    expect(st.avDegree).toBe(3);
  });
  it("AV block follows dominance: the circumflex, not the RCA, in a left-dominant heart", () => {
    const left = { ...TYPICAL, dominance: "left" as const };
    expect(afterOcclusion(left, "LCX", 0.2).avDegree).toBe(3);
    expect(afterOcclusion(left, "RCA", 0.2).avDegree).toBe(0);
    expect(afterOcclusion(TYPICAL, "LCX", 0.2).avDegree).toBe(0);
  });
  it("an occlusion proximal to the SA-node artery slows the sinus node further", () => {
    expect(afterOcclusion(TYPICAL, "RCA", 0.05).sinusRate).toBeLessThan(afterOcclusion(TYPICAL, "RCA", 0.6).sinusRate);
    const sanFromLcx = { ...TYPICAL, saNodeFrom: "LCx" as const };
    expect(afterOcclusion(sanFromLcx, "LCX", 0.1).sinusNodeIschemia).toBe(1);
    expect(afterOcclusion(TYPICAL, "LCX", 0.1).sinusNodeIschemia).toBe(0);
  });
});

describe("AV conduction", () => {
  const sites = bedSites(buildTree(TYPICAL));
  it("degree rises with AV-node ischemia through each threshold", () => {
    const deg = [0, 0.2, 0.6, 0.9].map((a) => rhythmState(sites, { "AVN#end": a }, 0).avDegree);
    expect(deg).toEqual([0, 1, 2, 3]);
  });
  it("first degree: every P conducts, with a fixed PR over 200 ms", () => {
    const { qrs, p, dropped } = minute(rhythmState(sites, { "AVN#end": 0.3 }, 0));
    expect(dropped).toHaveLength(0);
    expect(qrs.length).toBe(p.length);
    const prs = new Set(qrs.map((b) => b.pr));
    expect(prs.size).toBe(1);
    expect(qrs[0].pr!).toBeGreaterThan(0.2);
  });
  it("Mobitz I (Wenckebach): PR lengthens beat by beat until a P wave is dropped, then resets", () => {
    const { b } = minute(rhythmState(sites, { "AVN#end": 0.7 }, 0));
    const seq = b.filter((x) => !x.pvc);
    const firstDrop = seq.findIndex((x) => x.pOnly);
    expect(firstDrop).toBeGreaterThan(1);
    const before = seq.slice(0, firstDrop).map((x) => x.pr!);
    before.forEach((pr, i) => i && expect(pr).toBeGreaterThan(before[i - 1]));
    expect(seq[firstDrop + 1].pr).toBeCloseTo(CONDUCTION.wenckebachStartPr, 6);
  });
  it("complete heart block: atria and ventricles dissociate, with a regular narrow junctional escape", () => {
    const st = afterOcclusion(TYPICAL, "RCA", 0.6);
    const { qrs, p, dropped } = minute(st);
    expect(dropped.length).toBe(p.length); // no P wave conducts
    expect(qrs.every((b) => b.noP)).toBe(true);
    expect(Math.abs(qrs.length - CONDUCTION.junctionalEscape)).toBeLessThanOrEqual(2);
    expect(p.length).toBeGreaterThan(qrs.length); // atrial rate outpaces the escape
  });
  it("PVCs leave the sinus rate intact: the hidden P wave still fires and the pause is compensatory", () => {
    const st = { ...afterOcclusion(TYPICAL, "LAD", 0.1), pvcSeverity: 1 };
    const { b } = minute(st, 11);
    expect(b.some((x) => x.pvc)).toBe(true);
    const atrial = b.filter((x) => !x.noP && !x.pvc).length;
    expect(Math.abs(atrial - st.sinusRate)).toBeLessThan(4);
  });
  it("keeps Wenckebach cycles going across successive calls (stateful)", () => {
    const st = rhythmState(sites, { "AVN#end": 0.7 }, 0), c = new Conduction(9);
    const all = [...c.advance(2, st), ...c.advance(4, st), ...c.advance(6, st), ...c.advance(12, st)];
    const prs = all.filter((x) => !x.pOnly).map((x) => x.pr!);
    expect(Math.max(...prs)).toBeGreaterThan(CONDUCTION.wenckebachStartPr + CONDUCTION.wenckebachStep);
    expect(all.some((x) => x.pOnly)).toBe(true);
  });
});
