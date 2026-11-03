// E3: regional elastance from coronary bed supply/demand — chamber segment law, core-native bed map, LAD vs RCA territory split.
import { describe, it, expect } from "vitest";
import { ElastanceChamber } from "../src/physics/core/chamber";
import { LiveHeart } from "../src/physics/core/live";
import { ISCHEMIA, REGIONAL, ischemiaFactors } from "../src/config/ischemia";
import { regionalActiveScale, regionalDeadVolume, regionalVentricles } from "../src/physics/regional";
import { ischemicFractions, isRightVentricular } from "../src/physics/circulation";
import { Simulation } from "../src/sim/simulation";

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

describe("regional segment math", () => {
  it("matches ischemiaFactors for a uniform injury equal to the ischemic fraction", () => {
    const L = 0.4, segs = [{ key: "a", weight: 0.5, injury: L }, { key: "b", weight: 0.5, injury: L }];
    expect(regionalActiveScale(segs, ISCHEMIA.lvEesLoss, ISCHEMIA.eesFloor)).toBeCloseTo(ischemiaFactors(L, 0).lvEes!, 12);
    expect(regionalDeadVolume(segs, REGIONAL.lvBulgeMl)).toBeCloseTo(REGIONAL.lvBulgeMl * L, 12);
  });
  it("matches the mass-weighted mean when injury is regional (linear until the floor)", () => {
    // 40 % of mass fully injured: same α as lumped ischemia 0.4
    const segs = [{ key: "hot", weight: 0.4, injury: 1 }, { key: "ok", weight: 0.6, injury: 0 }];
    expect(regionalActiveScale(segs, ISCHEMIA.lvEesLoss, ISCHEMIA.eesFloor)).toBeCloseTo(ischemiaFactors(0.4, 0).lvEes!, 12);
  });
  it("floors a fully infarcted ventricle", () => {
    expect(regionalActiveScale([{ key: "x", weight: 1, injury: 1 }], ISCHEMIA.lvEesLoss, ISCHEMIA.eesFloor)).toBe(ISCHEMIA.eesFloor);
  });
});

describe("ElastanceChamber regional law", () => {
  it("adds dead volume and scales active elastance; clearing restores the lumped law", () => {
    const c = new ElastanceChamber("LV", { v0: 10, ees: 2, a: 0.5, b: 0.04 }, "ventricular", 0.83);
    c.onEvent({ kind: "ventricular", t: 0, strength: 1 });
    const tp = c.peakTime, v = 60;
    const p0 = c.pressure(v, tp);
    c.setRegional([{ key: "bed", weight: 1, injury: 0.5 }], { eesLoss: 1, eesFloor: 0.2, bulgeMl: 10 });
    expect(c.regionalDeadVolume).toBeCloseTo(5, 12);
    expect(c.regionalActive).toBeCloseTo(0.5, 12);
    // same activation, half Ees, volume measured above a raised V0 → lower systolic pressure
    expect(c.pressure(v, tp)).toBeLessThan(p0 - 5);
    c.setRegional(null);
    expect(c.regionalDeadVolume).toBe(0);
    expect(c.regionalActive).toBe(1);
    expect(c.pressure(v, tp)).toBeCloseTo(p0, 9);
  });
});

describe("regionalVentricles from beds", () => {
  const sites = [
    { key: "LAD#0", mass: 0.3, dir: [1, 0, 0] as [number, number, number] },
    { key: "D1#0", mass: 0.1, dir: [1, 0, 0] as [number, number, number] },
    { key: "OM1#0", mass: 0.2, dir: [0, 1, 0] as [number, number, number] },
    { key: "PDA_R#0", mass: 0.15, dir: [0, 0, 1] as [number, number, number] },
    { key: "AM#0", mass: 0.15, dir: [0, 0, 1] as [number, number, number] },
    { key: "SAN#0", mass: 0.01, dir: [0, 0, 1] as [number, number, number] },
  ];
  it("splits LV vs RV beds, skips nodal mass, and matches ischemicFractions", () => {
    const sev = { "LAD#0": 1, "D1#0": 1, "AM#0": 0.8 };
    const reg = regionalVentricles(sites, sev);
    expect(reg.lv.every((s) => !isRightVentricular(s.key))).toBe(true);
    expect(reg.rv.every((s) => isRightVentricular(s.key))).toBe(true);
    expect(reg.lv.find((s) => s.key === "SAN#0")).toBeUndefined();
    const frac = ischemicFractions(sites, sev);
    expect(reg.lvIschemia).toBeCloseTo(frac.lv, 12);
    expect(reg.rvIschemia).toBeCloseTo(frac.rv, 12);
    // LV: 0.4 of 0.75 mass injured → ~0.53; RV: AM fully weighted at 0.8 → 0.8
    expect(reg.lvIschemia).toBeCloseTo(0.4 / 0.75, 12);
    expect(reg.rvIschemia).toBeCloseTo(0.8, 12);
    expect(reg.stiffness.lvStiffness).toBeCloseTo(ischemiaFactors(reg.lvIschemia, reg.rvIschemia).lvStiffness!, 12);
  });
  it("puts RCA-bed injury on the RV and leaves LAD beds for the LV", () => {
    const lad = regionalVentricles(sites, { "LAD#0": 1, "D1#0": 1 });
    const rca = regionalVentricles(sites, { "AM#0": 1 });
    expect(lad.lv.filter((s) => s.injury > 0).map((s) => s.key).sort()).toEqual(["D1#0", "LAD#0"]);
    expect(rca.rv.some((s) => s.key === "AM#0" && s.injury === 1)).toBe(true);
    expect(rca.lv.every((s) => s.injury === 0)).toBe(true);
    expect(lad.lvIschemia).toBeGreaterThan(0.4);
    expect(rca.rvIschemia).toBe(1);
  });
});

describe("LiveHeart.setRegional", () => {
  it("weakens only the named ventricle's regional state", () => {
    const h = new LiveHeart();
    h.setRegional([{ key: "a", weight: 1, injury: 0.8 }], [{ key: "b", weight: 1, injury: 0 }]);
    const r = h.regionalState();
    expect(r.lv.active).toBeLessThan(0.5);
    expect(r.lv.deadMl).toBeGreaterThan(0);
    expect(r.rv.active).toBe(1);
    expect(r.rv.deadMl).toBe(0);
    h.setRegional(null, null);
    expect(h.regionalState().lv.active).toBe(1);
  });
});

describe("ACS core: LAD vs RCA regional elastance", () => {
  const make = (sc: { lesions?: { artery: string; occluded?: boolean; position?: number }[] } = {}, warm = 40) => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 3, arrhythmiaTendency: 0, ...sc }, { settled: true });
    s.warmup(warm); s.history = [];
    return s;
  };
  it("proximal LAD occlusion injures LV (anterior) beds and leaves RV active near 1", () => {
    const s = make({ lesions: [{ artery: "LAD", occluded: true, position: 0.15 }] });
    s.run(20);
    const r = s.regionalElastance()!;
    expect(r.lv.segments!.some((x) => x.injury > 0.5 && /^(LAD|D\d)/.test(x.key))).toBe(true);
    expect(r.lv.active).toBeLessThan(0.75);
    expect(r.lv.deadMl).toBeGreaterThan(0.5);
    expect(r.rv.active).toBeGreaterThan(0.85);
    expect(s.circ.lvIschemia).toBeGreaterThan(s.circ.rvIschemia);
    expect(s.circ.ejectionFraction).toBeLessThan(0.45);
  });
  it("proximal RCA occlusion injures RV beds far more than an LAD occlusion does", () => {
    const lad = make({ lesions: [{ artery: "LAD", occluded: true, position: 0.15 }] });
    const rca = make({ lesions: [{ artery: "RCA", occluded: true, position: 0.2 }] });
    lad.run(20); rca.run(20);
    const L = lad.regionalElastance()!, R = rca.regionalElastance()!;
    expect(R.rv.active).toBeLessThan(L.rv.active - 0.15);
    expect(R.rv.deadMl).toBeGreaterThan(L.rv.deadMl + 0.5);
    expect(rca.circ.rvIschemia).toBeGreaterThan(0.5);
    expect(R.lv.active).toBeGreaterThan(L.lv.active); // inferior LV hit is smaller than a proximal LAD territory
  });
  it("healthy patient keeps α = 1 and no dead volume", () => {
    const s = make();
    s.run(10);
    const r = s.regionalElastance()!;
    expect(r.lv.active).toBeCloseTo(1, 5);
    expect(r.rv.active).toBeCloseTo(1, 5);
    expect(r.lv.deadMl).toBeLessThan(0.05);
    expect(r.rv.deadMl).toBeLessThan(0.05);
  });
  it("stays finite over a minute of untreated anterior STEMI (no divergence)", () => {
    const s = make({ lesions: [{ artery: "LAD", occluded: true, position: 0.15 }] });
    s.run(60);
    const last = s.live!.records.slice(-5);
    expect(last.length).toBeGreaterThan(0);
    expect(last.every((b) => Number.isFinite(b.map) && Number.isFinite(b.strokeVolume))).toBe(true);
    expect(mean(last.map((b) => b.map))).toBeGreaterThan(40);
  });
});
