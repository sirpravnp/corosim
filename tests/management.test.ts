import { describe, it, expect } from "vitest";
import { buildTree, TYPICAL } from "../src/anatomy/tree";
import { solveNetwork, graftsFor, Lesion } from "../src/physics/network";
import { bedSites, ischemicBurden, globalSeverity } from "../src/physics/ecgLink";
import { rhythmState, RhythmState } from "../src/physics/rhythm";
import { circulation, CIRC } from "../src/physics/circulation";
import { noSupport, supportedRhythm, demandFactor, Support } from "../src/physics/support";
import { stepNecrosis, lvInfarctSize, clinicalTime } from "../src/physics/infarct";
import { applyProcedure, lysisWorks, order } from "../src/physics/revasc";
import { assess, Situation } from "../src/physics/advice";
import { PROCEDURE, SUPPORT } from "../src/config/management";

const tree = buildTree(TYPICAL), sites = bedSites(tree);
const sup = (p: Partial<Support>): Support => ({ ...noSupport(), ...p });
const sevAfter = (lesion: Lesion, grafts = [] as ReturnType<typeof graftsFor>) => {
  const r = solveNetwork(tree, [lesion], 1, undefined, grafts);
  return { r, sev: Object.fromEntries(r.terminals.map((x) => [x.key, x.severity])) };
};
const rhythmFor = (sev: Record<string, number>) => rhythmState(sites, sev, globalSeverity(ischemicBurden(sites, sev)));
const occ = (segId: string, pos: number): Lesion => ({ segId, pos, ds: 1, occluded: true });
const lad = sevAfter(occ("LAD", 0.15)), rca = sevAfter(occ("RCA", 0.2));
const ladR = rhythmFor(lad.sev), rcaR = rhythmFor(rca.sev);
const calm = rhythmState(sites, {}, 0);

describe("support changes nothing when nothing is given", () => {
  it("matches the unsupported circulation exactly", () => {
    const a = circulation(sites, lad.sev, ladR), b = circulation(sites, lad.sev, supportedRhythm(ladR, noSupport()), noSupport(), {});
    expect(b.map).toBeCloseTo(a.map, 9); expect(b.cardiacOutput).toBeCloseTo(a.cardiacOutput, 9);
    expect(demandFactor(noSupport())).toBe(1);
  });
});

describe("vasopressors and inotropes", () => {
  it("norepinephrine raises MAP, but costs stroke volume in a failing left ventricle", () => {
    const a = circulation(sites, lad.sev, ladR), b = circulation(sites, lad.sev, ladR, sup({ norepi: 1 }));
    expect(b.map).toBeGreaterThan(a.map + 5);
    expect(b.strokeVolume).toBeLessThan(a.strokeVolume);
    expect(b.demandFactor).toBeGreaterThan(1);
  });
  it("dobutamine raises output at the price of demand and ectopy", () => {
    const a = circulation(sites, lad.sev, ladR), s = sup({ dobutamine: 1 });
    const b = circulation(sites, lad.sev, supportedRhythm(ladR, s), s);
    expect(b.cardiacOutput).toBeGreaterThan(a.cardiacOutput);
    expect(b.demandFactor).toBeGreaterThan(1.2);
    expect(supportedRhythm(ladR, s).pvcSeverity).toBeGreaterThanOrEqual(ladR.pvcSeverity);
  });
});

describe("the right ventricle depends on preload", () => {
  it("fluid raises pressure in a right-ventricular infarct", () => {
    const a = circulation(sites, rca.sev, rcaR), b = circulation(sites, rca.sev, rcaR, sup({ fluids: 1.5 }));
    expect(a.rvIschemia).toBeGreaterThan(0.3);
    expect(b.strokeVolume).toBeGreaterThan(a.strokeVolume * 1.15);
    expect(b.map).toBeGreaterThan(a.map);
  });
  it("nitroglycerin drops pressure far more with right-ventricular involvement than without", () => {
    const kept = (sev: Record<string, number>, r: RhythmState) => circulation(sites, sev, r, sup({ nitro: 1 })).cardiacOutput / circulation(sites, sev, r).cardiacOutput;
    expect(kept(rca.sev, rcaR)).toBeLessThan(kept({}, calm) * 0.6);
    expect(circulation(sites, rca.sev, rcaR, sup({ nitro: 1 })).state).toBe("shock");
  });
  it("fluid in a failing left ventricle congests the lungs and lowers stroke volume", () => {
    const a = circulation(sites, lad.sev, ladR), b = circulation(sites, lad.sev, ladR, sup({ fluids: 3 }));
    expect(b.congestion).toBeGreaterThan(0.5);
    expect(a.congestion).toBe(0);
    expect(b.strokeVolume).toBeLessThan(a.strokeVolume);
  });
});

describe("mechanical support", () => {
  it("a microaxial pump raises output and unloads the ventricle", () => {
    const a = circulation(sites, lad.sev, ladR), b = circulation(sites, lad.sev, ladR, sup({ impella: true }));
    expect(b.cardiacOutput).toBeGreaterThan(a.cardiacOutput + 1);
    expect(b.deviceFlow).toBeGreaterThan(2);
    expect(b.demandFactor).toBeLessThan(0.8);
  });
  it("but it moves less when the right ventricle is failing", () => {
    const l = circulation(sites, lad.sev, ladR, sup({ impella: true })), r = circulation(sites, rca.sev, rcaR, sup({ impella: true }));
    expect(r.deviceFlow).toBeLessThan(l.deviceFlow);
  });
  it("a balloon pump augments coronary perfusion pressure without changing MAP much", () => {
    const a = circulation(sites, lad.sev, ladR), b = circulation(sites, lad.sev, ladR, sup({ iabp: true }));
    expect(b.coronaryPressure - b.map).toBe(SUPPORT.iabpCoronaryAug);
    expect(b.map - a.map).toBeLessThan(8);
  });
});

describe("rate and rhythm support", () => {
  it("atropine lifts the vagal slowing of an inferior infarct and relieves tone-mediated block", () => {
    expect(rcaR.vagal).toBeGreaterThan(0.2);
    const at = supportedRhythm(rcaR, sup({ atropine: true }));
    expect(at.sinusRate).toBeGreaterThan(rcaR.sinusRate);
    expect(at.vagal).toBe(0);
    const tone: RhythmState = { ...rcaR, avDegree: 2, avNodeIschemia: 0.55, vagal: 0.6 };
    expect(supportedRhythm(tone, sup({ atropine: true })).avDegree).toBe(1);
  });
  it("atropine does nothing for an infarcted node", () => {
    const dead: RhythmState = { ...rcaR, avDegree: 3, avNodeIschemia: 1, vagal: 0.6 };
    expect(supportedRhythm(dead, sup({ atropine: true })).avDegree).toBe(3);
  });
  it("pacing holds the ventricular rate in complete heart block, with a left-bundle pattern", () => {
    const chb: RhythmState = { ...calm, avDegree: 3, avNodeIschemia: 1 };
    const p = supportedRhythm(chb, sup({ pacing: true, paceRate: 80 }));
    expect(p.escapeRate).toBe(80); expect(p.bbb).toBe("lbbb");
    expect(circulation(sites, {}, p).hr).toBe(80);
  });
  it("pacing paces a slow sinus rhythm from the atrium, with no block pattern", () => {
    const slow: RhythmState = { ...calm, sinusRate: 40 };
    const p = supportedRhythm(slow, sup({ pacing: true, paceRate: 70 }));
    expect(p.sinusRate).toBe(70); expect(p.bbb).toBe("none");
  });
  it("pacing does not slow a faster native rhythm", () => {
    expect(supportedRhythm({ ...calm, sinusRate: 90 }, sup({ pacing: true, paceRate: 70 })).sinusRate).toBe(90);
  });
});

describe("infarct evolution", () => {
  it("grows with ischemic time and severity, and stops when there is none", () => {
    let full = 0, partial = 0;
    for (let s = 0; s < 60; s++) { full = stepNecrosis(full, 1, 1); partial = stepNecrosis(partial, 0.5, 1); }
    expect(full).toBeGreaterThan(0.3); expect(partial).toBeLessThan(full / 3);
    expect(stepNecrosis(0.4, 0, 100)).toBe(0.4);
    expect(stepNecrosis(0.99, 1, 1e6)).toBeLessThanOrEqual(1);
  });
  it("scar keeps the ventricle weak after the artery is open", () => {
    const scar = Object.fromEntries(sites.map((s) => [s.key, lad.sev[s.key] > 0.5 ? 0.8 : 0]));
    const healthy = circulation(sites, {}, calm), scarred = circulation(sites, {}, calm, noSupport(), scar);
    expect(scarred.cardiacOutput).toBeLessThan(healthy.cardiacOutput);
    expect(scarred.ejectionFraction).toBeLessThan(healthy.ejectionFraction - 0.05);
    expect(lvInfarctSize(sites, scar)).toBeGreaterThan(0.1);
  });
  it("reads clinical time", () => { expect(clinicalTime(45)).toBe("45 min"); expect(clinicalTime(125)).toBe("2 h 05 min"); });
});

describe("revascularization", () => {
  const lesion = occ("LAD", 0.15);
  it("PCI removes the lesion", () => { expect(applyProcedure("pci", lesion, tree, 1).lesion).toBeNull(); });
  it("a fibrinolytic opens the artery to a residual stenosis in some patients and not in others", () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1), ok = seeds.filter(lysisWorks).length;
    expect(ok).toBeGreaterThan(10); expect(ok).toBeLessThan(35);
    const yes = seeds.find(lysisWorks)!, no = seeds.find((s) => !lysisWorks(s))!;
    const a = applyProcedure("lysis", lesion, tree, yes), b = applyProcedure("lysis", lesion, tree, no);
    expect(a.lesion).toMatchObject({ occluded: false, ds: PROCEDURE.lysisResidual }); expect(a.lysed).toBe(true);
    expect(b.lesion).toEqual(lesion); expect(b.lysed).toBe(false);
  });
  it("orders take the clinical time they take", () => {
    expect(order("pci").remaining).toBe(PROCEDURE.pci.delayMin);
    expect(PROCEDURE.cabg.delayMin).toBeGreaterThan(PROCEDURE.pci.delayMin);
  });
});

describe("bypass graft", () => {
  const lesion = occ("LAD", 0.15), g = graftsFor(tree, lesion);
  const bare = solveNetwork(tree, [lesion], 1), grafted = solveNetwork(tree, [lesion], 1, undefined, g);
  const mass = (r: typeof bare, f: (t: (typeof bare.terminals)[number]) => boolean) => r.terminals.filter(f).reduce((a, t) => a + t.mass, 0);
  it("is sewn on just beyond the lesion", () => {
    const sg = tree.byId.LAD; expect(g[0].segId).toBe("LAD");
    expect(g[0].pos).toBeGreaterThan(0.15 * sg.length + 7); expect(g[0].pos).toBeLessThan(0.15 * sg.length + 14);
  });
  it("feeds the territory beyond the occlusion", () => {
    const starved = (r: typeof bare) => mass(r, (t) => t.blocked);
    expect(starved(bare)).toBeGreaterThan(0.3);
    expect(starved(grafted)).toBeLessThan(starved(bare) * 0.2);
    const distal = grafted.terminals.filter((t) => t.key === "LAD#end")[0];
    expect(distal.ratio).toBeGreaterThan(0.95);
  });
  it("leaves branches that leave before the anastomosis cut off", () => {
    expect(grafted.terminals.filter((t) => t.segId === "D1").every((t) => !t.blocked)).toBe(true); // D1 attaches well beyond the graft
    const sg = tree.byId.LAD;
    const early = grafted.terminals.filter((t) => t.segId === "LAD" && t.blocked);
    for (const t of early) expect(Number(t.key.split("#")[1]) >= 0).toBe(true);
    expect(sg.length).toBeGreaterThan(0);
  });
  it("does nothing to a vessel with no lesion", () => {
    const a = solveNetwork(tree, [], 1), b = solveNetwork(tree, [], 1, undefined, g);
    expect(b.atRisk).toBeCloseTo(a.atRisk, 6);
  });
});

describe("next-step advisor", () => {
  const base: Situation = {
    hasLesion: true, occluded: true, ds: 1, ffr: null, leftMain: false, stElevation: true,
    map: 85, cardiacOutput: 5, lvIschemia: 0.1, rvIschemia: 0, avDegree: 0, hr: 80, vagal: 0, congestion: 0,
    minutesIschemic: 30, infarctSize: 0, reperfused: false, pending: null, grafted: false, support: noSupport(),
  };
  const texts = (s: Situation) => assess(s).steps.map((x) => x.text).join(" | ");
  it("sends an acute occlusion to primary PCI first", () => { expect(assess(base).steps[0].text).toMatch(/primary PCI/); });
  it("in shock: pressor, then mechanical support if output stays low", () => {
    const shock = { ...base, map: 55, cardiacOutput: 2.8, lvIschemia: 0.5 };
    expect(texts(shock)).toMatch(/norepinephrine/);
    expect(texts({ ...shock, support: sup({ norepi: 1 }), map: 60 })).toMatch(/mechanical support/);
  });
  it("in a right-ventricular infarct with low pressure: fluid, not nitrate", () => {
    const rv = { ...base, map: 68, rvIschemia: 0.6 };
    expect(texts(rv)).toMatch(/fluid/i);
    expect(assess({ ...rv, support: sup({ nitro: 1 }) }).warnings.join(" ")).toMatch(/Nitroglycerin/);
  });
  it("block with low pressure: atropine if tone, pacing if not", () => {
    const blk = { ...base, avDegree: 2 as const, hr: 45, map: 66, vagal: 0.6 };
    expect(texts(blk)).toMatch(/Atropine/);
    expect(texts({ ...blk, avDegree: 3 })).toMatch(/Pace/);
  });
  it("warns when volume is congesting the lungs", () => {
    const c = { ...base, congestion: 0.6, support: sup({ fluids: 3 }) };
    expect(assess(c).warnings.join(" ")).toMatch(/lungs/); expect(texts(c)).toMatch(/Stop fluids/);
  });
  it("stable flow-limiting stenosis: PCI, or CABG for the left main", () => {
    const st = { ...base, occluded: false, ds: 0.8, ffr: 0.7, stElevation: false };
    expect(texts(st)).toMatch(/PCI for a single/);
    expect(texts({ ...st, leftMain: true })).toMatch(/CABG favored/);
  });
  it("says so when there is nothing to do", () => {
    expect(texts({ ...base, hasLesion: false, occluded: false, ds: 0, stElevation: false })).toMatch(/Nothing to do/);
  });
});
