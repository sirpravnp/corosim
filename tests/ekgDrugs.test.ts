import { describe, it, expect } from "vitest";
import { measure } from "../src/ekg/engine";
import type { EkgSpec } from "../src/ekg/engine";
import { PRESET_BY_ID, resolveSpec } from "../src/ekg/presets";
import { applyDrug, isPreexcited } from "../src/ekg/drugs";

const specOf = (id: string) => resolveSpec(PRESET_BY_ID[id]);
const delta = { k: "wave" as const, v: [0.36, 0.3, -0.06] as [number, number, number], t: -0.05, w: 0.019 };
const preexcitedAf = (): EkgSpec => ({ rhythm: { kind: "af", rate: 180 }, morph: { qrsWide: 1.6, comps: [delta] } });

describe("applyDrug", () => {
  it("does not mutate the input spec", () => {
    const spec = specOf("wpw");
    const qrs = spec.morph!.qrsWide;
    const comps = spec.morph!.comps;
    const rate = spec.rhythm.kind === "sinus" ? spec.rhythm.rate : 0;
    applyDrug(spec, "flecainide", { rateBpm: 150 });
    expect(spec.morph!.qrsWide).toBe(qrs);
    expect(spec.morph!.comps).toBe(comps);
    expect(spec.rhythm.kind === "sinus" && spec.rhythm.rate).toBe(rate);
  });

  it("flecainide on NSR widens QRS more at 150 than at 60 (use-dependence), both wider than untreated", () => {
    const spec = specOf("nsr");
    const untreated = measure(spec).qrsMs!;
    const rest = measure(applyDrug(spec, "flecainide", { rateBpm: 60 }).spec).qrsMs!;
    const fast = measure(applyDrug(spec, "flecainide", { rateBpm: 150 }).spec).qrsMs!;
    expect(rest).toBeGreaterThan(untreated);
    expect(fast).toBeGreaterThan(rest);
  });

  it("sotalol on NSR prolongs QTc", () => {
    const spec = specOf("nsr");
    expect(measure(applyDrug(spec, "sotalol").spec).qtcMs!).toBeGreaterThan(measure(spec).qtcMs!);
  });

  it("adenosine terminates SVT to sinus", () => {
    const r = applyDrug(specOf("svt"), "adenosine");
    expect(r.spec.rhythm.kind).toBe("sinus");
    expect(r.events).toContain("terminated");
    expect(measure(r.spec).ventricularRate).toBeCloseTo(72, -1);
  });

  it("adenosine unmasks flutter (ratio 8); untreated 2:1 stays ~150", () => {
    const spec = specOf("flutter-21");
    expect(measure(spec).ventricularRate).toBeCloseTo(150, -1);
    const r = applyDrug(spec, "adenosine");
    expect(r.spec.rhythm.kind).toBe("flutter");
    expect(r.events).toContain("unmasked");
    if (r.spec.rhythm.kind === "flutter") expect(r.spec.rhythm.ratio).toBe(8);
    expect(measure(r.spec).ventricularRate!).toBeLessThan(60);
  });

  it("adenosine does not change monomorphic VT", () => {
    const r = applyDrug(specOf("vt-mono"), "adenosine");
    expect(r.spec.rhythm.kind).toBe("ventricular");
    expect(r.events).toContain("no-effect");
  });

  it("flecainide on 2:1 flutter produces 1:1 conduction with a wider QRS", () => {
    const spec = specOf("flutter-21");
    const r = applyDrug(spec, "flecainide");
    expect(r.spec.rhythm.kind).toBe("flutter");
    if (r.spec.rhythm.kind === "flutter") {
      expect(r.spec.rhythm.ratio).toBe(1);
      expect(r.spec.rhythm.atrial ?? 300).toBeLessThan(300);
    }
    const m = measure(r.spec);
    expect(m.atrialRate!).toBeLessThan(300);
    expect(m.ventricularRate!).toBeCloseTo(m.atrialRate!, -1);
    expect(m.qrsMs!).toBeGreaterThan(measure(spec).qrsMs!);
    expect(r.events).toContain("one-to-one");
    expect(r.events).toContain("widened");
    expect(r.warnings.join(" ").toLowerCase()).toMatch(/1:1|class ic/);
  });

  it("diltiazem on preexcited AF is dangerous and does not slow the rate", () => {
    const spec = preexcitedAf();
    expect(isPreexcited(spec)).toBe(true);
    const r = applyDrug(spec, "diltiazem");
    expect(r.events).toContain("dangerous");
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.spec.rhythm.kind === "af" && r.spec.rhythm.rate).toBeGreaterThanOrEqual(180);
  });

  it("procainamide on preexcited AF slows the ventricle and narrows QRS toward the pathway", () => {
    const spec = preexcitedAf();
    const r = applyDrug(spec, "procainamide");
    expect(r.spec.rhythm.kind === "af" && r.spec.rhythm.rate).toBeLessThan(180);
    expect(r.spec.morph!.qrsWide!).toBeLessThan(1.6);
    expect(r.events).toContain("slowed");
  });

  it("diltiazem on AF lowers the ventricular rate", () => {
    const spec = specOf("af");
    const r = applyDrug(spec, "diltiazem");
    expect(measure(r.spec).ventricularRate!).toBeLessThan(measure(spec).ventricularRate!);
  });

  it("diltiazem on sinus WPW is not the preexcited-AF emergency", () => {
    const r = applyDrug(specOf("wpw"), "diltiazem");
    expect(r.events).not.toContain("dangerous");
    expect(r.warnings.join(" ")).not.toMatch(/preexcited AF/i);
  });

  it("library AF with WPW is preexcited; an AV-nodal blocker is dangerous", () => {
    const spec = specOf("af-wpw");
    expect(isPreexcited(spec)).toBe(true);
    expect(applyDrug(spec, "adenosine").events).toContain("dangerous");
  });
});
