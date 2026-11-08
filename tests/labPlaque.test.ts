import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/physics/ecg";
import { plaqueToLesions, dilate, deployStent, apparentStenosis } from "../src/lab/plaque";
import type { Plaque } from "../src/lab/types";

const base = (): Plaque => ({
  segId: "LAD", centerMm: 50, lengthMm: 18, ds: 0, referenceMm: 3,
  eccentric: 0, eccentricAngleDeg: 0, calcium: 0.1, lipid: 0.2, thrombus: 0,
  remodel: "none", stents: [],
});

const soft = (ds: number, calcium = 0.1): Plaque => ({ ...base(), ds, calcium });

describe("plaqueToLesions", () => {
  it("is empty for a clean plaque", () => {
    expect(plaqueToLesions(soft(0.02))).toEqual([]);
  });

  it("maps a 70% plaque to one lesion", () => {
    const p = soft(0.7);
    const L = plaqueToLesions(p);
    expect(L).toHaveLength(1);
    expect(L[0]).toMatchObject({ segId: "LAD", ds: 0.7, lengthMm: p.lengthMm });
  });

  it("maps an old stent by expansion percent", () => {
    const full = plaqueToLesions({
      ...soft(0.75), ds: 0, stents: [{ fromMm: 41, toMm: 59, diameterMm: 3, expansionPct: 100, apposition: 1, strutUm: 81 }],
    });
    expect(full).toEqual([]);
    const under = plaqueToLesions({
      ...soft(0.75), ds: 0,
      stents: [{ fromMm: 41, toMm: 59, diameterMm: 3, expansionPct: 80, apposition: 0.9, strutUm: 81 }],
    });
    expect(under).toHaveLength(1);
    expect(under[0].ds).toBeCloseTo(0.2, 6);
  });
});

describe("dilate", () => {
  const balloon = (type: "semi" | "cutting" = "semi") => ({
    type, diameterMm: 3, atXMm: 50, lengthMm: 12, pressureAtm: 10,
  });

  it("lowers ds monotonically with pressure on soft plaque", () => {
    const rand = () => 0.5;
    const ds: number[] = [];
    for (const atm of [6, 8, 10, 12, 14]) {
      const r = dilate(soft(0.75), { ...balloon(), pressureAtm: atm }, rand);
      ds.push(r.plaque.ds);
    }
    for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeLessThanOrEqual(ds[i - 1]);
  });

  it("calcium resists dilation", () => {
    const rand = () => 0.5;
    const hi = dilate({ ...soft(0.75), calcium: 0.9 }, balloon(), rand).plaque.ds;
    const lo = dilate(soft(0.75), balloon(), rand).plaque.ds;
    expect(hi).toBeGreaterThanOrEqual(0.35);
    expect(lo).toBeLessThanOrEqual(0.2);
    const cut = dilate({ ...soft(0.75), calcium: 0.9 }, balloon("cutting"), rand).plaque.ds;
    expect(cut).toBeLessThanOrEqual(0.3);
  });

  it("recoil after balloon deflation", () => {
    const rand = () => 0.5;
    const r = dilate(soft(0.75), balloon(), rand);
    const minD = r.plaque.referenceMm * (1 - r.plaque.ds);
    const expanded = minD / (1 - 0.08);
    expect(minD).toBeLessThan(expanded * (1 - 0.075));
  });
});

describe("deployStent", () => {
  const rand = () => 0.5;

  it("expansion depends on calcium", () => {
    const s = { diameterMm: 3, lengthMm: 24, atXMm: 50, strutUm: 81, pressureAtm: 12 };
    const softStent = deployStent(soft(0.75), s, rand);
    expect(softStent.plaque.stents[0].expansionPct).toBeGreaterThanOrEqual(90);
    const hard = deployStent({ ...soft(0.75), calcium: 0.9 }, s, rand);
    expect(hard.plaque.stents[0].expansionPct).toBeLessThanOrEqual(75);
  });

  it("oversizing raises injury risks", () => {
    const s1 = { diameterMm: 3, lengthMm: 24, atXMm: 50, strutUm: 81, pressureAtm: 12 };
    const s13 = { ...s1, diameterMm: 3.9 };
    const r1 = deployStent(soft(0.5), s1, rand);
    const r13 = deployStent(soft(0.5), s13, rand);
    expect(r13.perforationRisk).toBeGreaterThanOrEqual(r1.perforationRisk * 2);
    expect(r13.dissectionRisk).toBeGreaterThanOrEqual(r1.dissectionRisk * 2);
    const risky = deployStent(soft(0.5), s13, () => 0.01);
    const safe = deployStent(soft(0.5), s1, () => 0.5);
    expect(risky.dissection != null || risky.perforationRisk > r1.perforationRisk).toBe(true);
  });

  it("thrombus and lipid raise no-reflow risk", () => {
    const s = { diameterMm: 3, lengthMm: 24, atXMm: 50, strutUm: 81, pressureAtm: 12 };
    const baseRisk = deployStent(soft(0.6), s, rand).noReflowRisk;
    const throm = deployStent({ ...soft(0.6), thrombus: 0.8 }, s, rand).noReflowRisk;
    const lipid = deployStent({ ...soft(0.6), lipid: 0.9 }, s, rand).noReflowRisk;
    expect(throm).toBeGreaterThan(baseRisk);
    expect(lipid).toBeGreaterThan(baseRisk);
  });
});

describe("apparentStenosis", () => {
  it("eccentric lesions foreshorten in some views", () => {
    const p: Plaque = { ...soft(0.7), eccentric: 0.9, eccentricAngleDeg: 30 };
    const a = apparentStenosis(p, 30);
    const b = apparentStenosis(p, 120);
    expect(Math.abs(a - b)).toBeGreaterThanOrEqual(0.2);
  });

  it("concentric plaques read the same in every view", () => {
    const p = soft(0.55);
    const vals = [0, 45, 90, 135].map((d) => apparentStenosis(p, d));
    for (let i = 1; i < vals.length; i++) expect(Math.abs(vals[i] - vals[0])).toBeLessThanOrEqual(0.02);
  });
});

describe("seeded draws", () => {
  it("repeat the same dissection with the same rand stream", () => {
    const s = { diameterMm: 3.5, lengthMm: 24, atXMm: 50, strutUm: 81, pressureAtm: 14 };
    const seq = [0.2, 0.5, 0.8];
    let i = 0;
    const rand = () => seq[i++ % seq.length];
    const a = deployStent({ ...soft(0.7), calcium: 0.5 }, s, rand);
    i = 0;
    const b = deployStent({ ...soft(0.7), calcium: 0.5 }, s, rand);
    expect(a.dissection).toBe(b.dissection);
  });
});
