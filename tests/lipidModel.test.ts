import { describe, it, expect } from "vitest";
import { DrugId, GenoId, LipidModel, steadyLabs } from "../src/lipids/model";

const labs = (g: GenoId, ...d: DrugId[]) => steadyLabs(g, new Set(d));
const change = (g: GenoId, d: DrugId[], key: "ldl" | "tg" | "hdl" | "lpa" = "ldl") => labs(g, ...d)[key] / labs(g)[key] - 1;

describe("lipid model, untreated patients", () => {
  it("reads LDL-C 100, TG about 120 and HDL-C 50 for a normal patient", () => {
    const l = labs("wt");
    expect(l.ldl).toBeCloseTo(100, 5);
    expect(l.tg).toBeGreaterThan(110); expect(l.tg).toBeLessThan(130);
    expect(l.hdl).toBeCloseTo(50, 5);
    expect(l.apob).toBeGreaterThan(80); expect(l.apob).toBeLessThan(95);
  });
  it("raises LDL-C about 1.6 times in HeFH and more than 5 times in HoFH", () => {
    expect(labs("hefh").ldl / labs("wt").ldl).toBeGreaterThan(1.4);
    expect(labs("hefh").ldl / labs("wt").ldl).toBeLessThan(2.2);
    expect(labs("hofh").ldl / labs("wt").ldl).toBeGreaterThan(5);
  });
  it("gives FCS a fasting TG near 1,000 with low LDL-C and HDL-C", () => {
    const l = labs("fcs");
    expect(l.tg).toBeGreaterThan(800);
    expect(l.ldl).toBeLessThan(60);
    expect(l.hdl).toBeLessThan(35);
  });
});

describe("lipid model, drugs", () => {
  it("puts single LDL drugs near their trial means", () => {
    expect(change("wt", ["statin"])).toBeLessThan(-0.38); expect(change("wt", ["statin"])).toBeGreaterThan(-0.55);
    expect(change("wt", ["eze"])).toBeLessThan(-0.12); expect(change("wt", ["eze"])).toBeGreaterThan(-0.3);
    expect(change("wt", ["mab"])).toBeLessThan(-0.4);
    expect(change("wt", ["incl"])).toBeLessThan(-0.3);
  });
  it("compounds combinations instead of adding them", () => {
    const s = change("wt", ["statin"]), sm = change("wt", ["statin", "mab"]), sem = change("wt", ["statin", "eze", "mab"]);
    expect(sm).toBeLessThan(s); expect(sem).toBeLessThan(sm);
    expect(sm).toBeGreaterThan(-0.9); // not the sum of the two single-drug effects
    expect(1 + sem).toBeGreaterThan(0);
  });
  it("blunts LDLR-dependent drugs in HoFH and keeps the LDLR-independent ones working", () => {
    expect(change("hofh", ["statin", "mab"])).toBeGreaterThan(-0.3);
    expect(change("hofh", ["evin"])).toBeLessThan(-0.4);
    expect(change("hofh", ["lomi"])).toBeLessThan(-0.4);
  });
  it("lowers FCS triglycerides with ApoC-III silencing but barely with a fibrate", () => {
    expect(change("fcs", ["olez"], "tg")).toBeLessThan(-0.5);
    expect(change("fcs", ["fib"], "tg")).toBeGreaterThan(-0.35);
  });
  it("cuts Lp(a) by more than 90% with olpasiran and modestly with a PCSK9 antibody", () => {
    expect(change("lpa", ["olpa"], "lpa")).toBeLessThan(-0.9);
    expect(change("lpa", ["mab"], "lpa")).toBeGreaterThan(-0.35);
    expect(change("lpa", ["statin"], "lpa")).toBeGreaterThan(0);
  });
  it("raises HDL-C with obicetrapib and lowers it with evinacumab", () => {
    expect(change("wt", ["obi"], "hdl")).toBeGreaterThan(0.5);
    expect(change("wt", ["evin"], "hdl")).toBeLessThan(0);
  });
});

describe("lipid model over time", () => {
  it("lets a statin take effect gradually and settle at the steady state", () => {
    const m = new LipidModel(); m.toggle("statin");
    const start = m.snapshot().ldl;
    for (let i = 0; i < 30 * 10; i++) m.step(1 / 30);
    const mid = m.snapshot().ldl;
    for (let i = 0; i < 30 * 300; i++) m.step(1 / 30);
    const end = m.snapshot().ldl;
    expect(mid).toBeLessThan(start); expect(end).toBeLessThan(mid);
    expect(end).toBeCloseTo(labs("wt", "statin").ldl, 0);
    expect(m.snapshot().pcsk9).toBeGreaterThan(1.3); // statins raise PCSK9
  });
  it("sends a meal's chylomicrons through and clears them", () => {
    const m = new LipidModel(); const fasting = m.snapshot().tg;
    m.feed(); expect(m.snapshot().tg).toBeGreaterThan(fasting + 150);
    for (let i = 0; i < 30 * 150; i++) m.step(1 / 30);
    expect(m.snapshot().tg).toBeLessThan(fasting + 5);
  });
});
