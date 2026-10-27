import { describe, expect, it } from "vitest";
import { analyze } from "../src/physics/structural";
import type { StructuralReport } from "../src/physics/structural";
import { LESIONS, defaults } from "../src/sim/structural";
import { PATIENTS, O2_PER_G_HB } from "../src/config/structural";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";
import type { BeatSummary, HemoNode, HemoNumbers, Saturations } from "../src/sim/hemoSource";
import { createStubSource } from "../src/sim/stubSource";
import { rightHeartCath, mixedVenous, wedgeFromLA } from "../src/sim/rightHeartCath";
import type { RhcSnapshot } from "../src/sim/rightHeartCath";

/** A StructuralReport as the snapshot the module takes (numbers as the bridge builds them, one beat from the waveform). */
function snapshot(r: StructuralReport): RhcSnapshot {
  const base = PATIENTS[r.spec.patient ?? "adult"], p = r.pressure, w = r.waveform!;
  const numbers: HemoNumbers = {
    hr: r.hr, map: p.AO.mean, systolic: p.AO.max, diastolic: p.AO.min, cvp: p.RA.mean,
    pa: { systolic: p.PA.max, diastolic: p.PA.min, mean: p.PA.mean }, pcwp: p.LA.mean, lvedp: p.LV.end, rvedp: p.RV.end,
    co: r.qs, ci: r.qs / base.bsa, svr: r.svr, pvr: r.pvr, lvEf: r.lvEf, rvEf: r.rvEf, qpQs: r.qpQs,
  };
  const node = {} as Record<HemoNode, number>;
  for (const k of Object.keys(r.saturation) as HemoNode[]) node[k] = r.saturation[k];
  const sats: Saturations = {
    node, spo2: r.preductalSat, preductal: r.preductalSat, postductal: r.postductalSat, svo2: r.saturation.PA,
    do2: r.qs * base.hb * 10 * O2_PER_G_HB * r.preductalSat, vo2: base.vo2PerKg * base.weightKg, lactate: NaN, bed: {}, bedSource: "ischemia-derived",
  };
  const pressure = {} as Record<HemoNode, Float32Array>;
  for (const k of Object.keys(w.p) as HemoNode[]) pressure[k] = Float32Array.from(w.p[k]);
  const time = Float32Array.from(w.t), rr = w.t[w.t.length - 1] + (w.t[1] - w.t[0]);
  const beat = { t: 0, rr, pvc: false, pressure, time, atrial: new Float32Array(0) } as unknown as BeatSummary;
  return { numbers: () => numbers, saturations: () => sats, beats: () => [beat] };
}

const lesion = (id: string) => { const l = LESIONS.find((x) => x.id === id)!; return analyze(l.build(defaults(l))); };
const cases = { normal: analyze({}), asd: lesion("asd"), vsd: lesion("vsd") };
const out = Object.fromEntries(Object.entries(cases).map(([k, r]) => [k, rightHeartCath(snapshot(r))!]));
const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(tol);

describe("right-heart cath on structural lesions", () => {
  it("normal heart: no step-up, Flamm formula, normal pressures", () => {
    const o = out.normal;
    expect(o.oximetry.stepUp).toBeNull();
    expect(mixedVenous(0.6, 0.8)).toBeCloseTo(0.65, 10);
    expect(o.derived.papi).toBeGreaterThan(1.5);
    expect(o.pullback!.segments.map((s) => s.site)).toEqual(["RA", "RV", "PA", "Wedge"]);
    expect(o.pullback!.pcwp).toBeCloseTo(cases.normal.pressure.LA.mean, 6);
  });
  it("ASD: atrial step-up and Fick Qp:Qs within 10% of the engine's", () => {
    const o = out.asd;
    expect(o.oximetry.stepUp?.level).toBe("atrial");
    expect(o.oximetry.deltas.atrial).toBeGreaterThanOrEqual(0.07);
    near(o.derived.qpQs, cases.asd.qpQs, 0.1);
    expect(o.derived.qpQs).toBeGreaterThan(1.5);
  });
  it("VSD: ventricular step-up", () => {
    expect(out.vsd.oximetry.stepUps.map((s) => s.level)).toContain("ventricular");
    expect(out.vsd.derived.qpQs).toBeGreaterThan(1.5);
  });
  it("PVR and SVR equal the structural report's within 5%", () => {
    for (const k of Object.keys(cases) as (keyof typeof cases)[]) {
      near(out[k].derived.pvr, cases[k].pvr, 0.05);
      near(out[k].derived.svr, cases[k].svr, 0.05);
    }
  });
  it("derived quantities follow their definitions", () => {
    const o = out.normal, n = o.numbers;
    expect(o.derived.tpg).toBeCloseTo(n.pa.mean - n.pcwp, 9);
    expect(o.derived.dpg).toBeCloseTo(n.pa.diastolic - n.pcwp, 9);
    expect(o.derived.cpo).toBeCloseTo((n.map * n.co) / 451, 9);
    expect(o.derived.ci).toBeCloseTo(n.co / PATIENTS.adult.bsa, 6);
    expect(o.output.hb).toBeCloseTo(PATIENTS.adult.hb, 3); // recovered from the source's DO2
    near(o.output.fick, n.co, 0.1);
  });
  it("the wedge is delayed, damped and keeps the mean", () => {
    const la = Float32Array.from({ length: 200 }, (_, i) => 8 + 6 * Math.max(0, Math.sin((i / 200) * 2 * Math.PI)));
    const w = wedgeFromLA(la, 1, 10);
    expect(w.reduce((a, b) => a + b, 0) / w.length).toBeCloseTo(10, 4);
    expect(Math.max(...w) - Math.min(...w)).toBeLessThan(Math.max(...la) - Math.min(...la));
  });
  it("works on the stub source and returns null before the first solve", () => {
    expect(rightHeartCath(createStubSource())).not.toBeNull();
    const nan = Number.NaN;
    expect(rightHeartCath({ numbers: () => ({ map: nan, co: nan }) as HemoNumbers, saturations: () => ({ node: { PA: nan } }) as unknown as Saturations, beats: () => [] })).toBeNull();
  });
});

describe("right-heart cath through the live source: RV infarct", () => {
  const sim = new Simulation({}, { engine: "core" });
  const bridge = new LiveSource(sim);
  sim.reset({ seed: 3, lesions: [{ artery: "RCA", occluded: true, position: 0.25 }] }, { settled: true });
  sim.warmup(40); sim.history = [];
  sim.run(40);
  const r = rightHeartCath(bridge)!;
  it("gives a low PAPi and RA/PCWP >= 0.8", () => {
    console.log("RV infarct PAPi", r.derived.papi.toFixed(2), "RA", r.numbers.cvp.toFixed(1), "PCWP", r.numbers.pcwp.toFixed(1), "RA/PCWP", (r.numbers.cvp / r.numbers.pcwp).toFixed(2));
    expect(r.derived.papi).toBeLessThan(1.0);
    expect(r.numbers.cvp / r.numbers.pcwp).toBeGreaterThanOrEqual(0.8);
    expect(r.pullback).not.toBeNull();
    expect(r.pullback!.ra.a).toBeGreaterThan(0);
  });
});
