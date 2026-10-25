// P16: the Simulator page's HemoSource over the core engine (src/sim/liveSource.ts). Set CORE_VERBOSE=1 to print the numbers.
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";
import type { PatientSpec } from "../src/sim/patient";
import { CASE_BY_ID } from "../src/cath/cases";
import { analyzeJvp } from "../src/physics/jvp";
import { CATH_NODES } from "../src/physics/structural";

const say = (...a: unknown[]) => { if (process.env.CORE_VERBOSE) console.log(...a); };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a: number[]) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));

/** A settled core-engine patient read through a LiveSource: seed 3, 20 s of reflex settling, then `run` s. */
function patient(spec: PatientSpec = {}, run = 25) {
  const sim = new Simulation({}, { engine: "core" });
  const src = new LiveSource(sim);
  sim.reset({ seed: 3, ...spec }, { settled: true });
  sim.warmup(20); sim.run(run);
  return { sim, src, n: src.numbers(), sat: src.saturations() };
}
const LAD = CASE_BY_ID.ladocc.scenario;

describe("the source of a normal adult", () => {
  const { sim, src, n, sat } = patient();
  it("is live, adult and not standalone, with the nodes of the contract", () => {
    expect(src.kind).toBe("live"); expect(src.patientKind).toBe("adult"); expect(src.standalone).toBe(false);
    for (const nd of CATH_NODES) expect(src.nodes()).toContain(nd);
    expect(src.now()).toBeCloseTo(sim.t, 6);
  });
  it("reads normal catheter numbers", () => {
    say("normal", n, sat);
    expect(n.hr).toBeGreaterThan(65); expect(n.hr).toBeLessThan(80);
    expect(n.map).toBeGreaterThan(85); expect(n.map).toBeLessThan(95);
    expect(n.systolic - n.diastolic).toBeGreaterThan(30); expect(n.systolic - n.diastolic).toBeLessThan(60);
    expect(n.co).toBeGreaterThan(4.5); expect(n.co).toBeLessThan(5.8);
    expect(n.cvp).toBeGreaterThan(2); expect(n.cvp).toBeLessThan(7);
    expect(n.pcwp).toBeGreaterThan(5); expect(n.pcwp).toBeLessThan(12);
    expect(n.pa.mean).toBeGreaterThan(10); expect(n.pa.mean).toBeLessThan(18);
    expect(n.lvEf).toBeGreaterThan(0.5); expect(n.lvEf).toBeLessThan(0.7);
    expect(n.qpQs).toBeGreaterThan(0.9); expect(n.qpQs).toBeLessThan(1.1);
    expect(n.svr).toBeGreaterThan(12); expect(n.svr).toBeLessThan(22);
    expect(n.ci).toBeCloseTo(n.co / 1.9, 0);
  });
  it("agrees with the simulation's own monitor", () => {
    const h = sim.hemo(8)!;
    expect(Math.abs(n.cvp - h.cvp)).toBeLessThan(0.7); expect(Math.abs(n.pcwp - h.pcwp)).toBeLessThan(1);
    expect(Math.abs(n.co - sim.rolling(8).cardiacOutput)).toBeLessThan(0.5);
  });
  it("has normal saturations from the bridge's oxygen model, finite everywhere", () => {
    expect(sat.spo2).toBeGreaterThan(0.95); expect(sat.preductal).toBeCloseTo(sat.postductal, 2);
    expect(sat.svo2).toBeGreaterThan(0.62); expect(sat.svo2).toBeLessThan(0.8);
    expect(sat.do2).toBeGreaterThan(800); expect(sat.do2).toBeLessThan(1200);
    for (const nd of CATH_NODES) expect(Number.isFinite(sat.node[nd]), nd).toBe(true);
    expect(sat.bedSource).toBe("ischemia-derived");
  });
  it("completes beats with a full summary: loops, a pressure trace per node, one atrial event, valves, volumes", () => {
    const bs = src.beats(6);
    expect(bs.length).toBe(6);
    for (const b of bs) {
      expect(b.rr).toBeGreaterThan(0.7); expect(b.rr).toBeLessThan(0.95); expect(b.pvc).toBe(false);
      expect(b.time.length).toBeGreaterThan(300);
      for (let k = 1; k < b.time.length; k++) expect(b.time[k]).toBeGreaterThan(b.time[k - 1]);
      for (const nd of CATH_NODES) expect(b.pressure[nd].length).toBe(b.time.length);
      for (const c of ["RA", "RV", "LA", "LV"] as const) { expect(b.loops[c].p.length).toBe(b.time.length); expect(b.loops[c].v.length).toBe(b.time.length); }
      expect(b.atrial.length).toBe(1); expect(b.atrial[0]).toBeGreaterThan(0.5 * b.rr);
      expect(b.strokeVolume).toBeGreaterThan(55); expect(b.strokeVolume).toBeLessThan(90);
      expect(b.edv.LV).toBeGreaterThan(b.esv.LV);
      expect(Math.abs(b.valves.AV.forwardMl - b.valves.AV.regurgMl - b.strokeVolume)).toBeLessThan(3); // the aortic valve carries the stroke
      expect(b.valves.AV.openMs).toBeGreaterThan(200); expect(b.valves.MV.openMs).toBeGreaterThan(150);
    }
    for (let i = 1; i < bs.length; i++) expect(bs[i].t).toBeGreaterThan(bs[i - 1].t);
  });
  it("serves traces on the simulation clock, increasing in time, decimated to maxPoints; volumes for the chambers only", () => {
    const tr = src.trace("AO", 6, { maxPoints: 300 });
    expect(tr.t.length).toBe(300); expect(tr.v.length).toBe(300);
    for (let k = 1; k < tr.t.length; k++) expect(tr.t[k]).toBeGreaterThan(tr.t[k - 1]);
    expect(tr.t[tr.t.length - 1]).toBeLessThanOrEqual(sim.t + 1e-3); expect(tr.t[tr.t.length - 1]).toBeGreaterThan(sim.t - 0.1); expect(tr.t[0]).toBeGreaterThan(sim.t - 6.1);
    expect(Math.max(...tr.v)).toBeGreaterThan(100); expect(Math.min(...tr.v)).toBeLessThan(75);
    const lv = src.trace("LV", 3, { quantity: "volume" });
    expect(lv.v.length).toBeGreaterThan(10); expect(Math.max(...lv.v)).toBeGreaterThan(110);
    expect(src.trace("AO", 3, { quantity: "volume" }).t.length).toBe(0); // no volume trace for a vessel
    expect(src.trace("nope", 3).t.length).toBe(0);
  });
  it("tells subscribers of each beat as it completes, and nothing after unsubscribe", () => {
    const got: number[] = [], off = src.onBeat((b) => got.push(b.rr));
    sim.run(5);
    expect(got.length).toBeGreaterThanOrEqual(5); off();
    sim.run(3); expect(got.length).toBeLessThan(10);
  });
  it("lists no device consoles", () => { expect(src.devices()).toEqual([]); });
  it("starts afresh when the simulation is reset, and has numbers at once (the settled beat)", () => {
    sim.reset({ seed: 5 }, { settled: true });
    expect(src.beats(3).length).toBe(0);
    const k = src.numbers();
    expect(k.map).toBeGreaterThan(70); expect(Number.isFinite(k.co)).toBe(true);
    sim.warmup(5); expect(src.beats(2).length).toBe(2);
  });
});

describe("beat-level signs on the live page", () => {
  it("anterior STEMI: wedge pressure and LVEDP up, low ejection fraction, lower output; the Impella unloads it and has a console", () => {
    const base = patient().n, s = patient(LAD), i = patient({ ...LAD, devices: { impella: { model: "CP", level: 6 } } });
    say("STEMI", s.n, "STEMI+Impella", i.n);
    expect(s.n.pcwp).toBeGreaterThan(15); expect(s.n.lvedp).toBeGreaterThan(15); expect(s.n.lvEf).toBeLessThan(0.4); expect(s.n.co).toBeLessThan(base.co - 0.8);
    expect(i.n.pcwp).toBeLessThan(s.n.pcwp - 3);
    const d = i.src.devices();
    expect(d.map((x) => x.id)).toEqual(["impella"]);
    const imp = d[0];
    expect(imp.readings.flowLpm).toBeGreaterThan(2); expect(imp.readings.flowLpm).toBeLessThan(3.6);
    expect(imp.readings.level).toBe(6); expect(imp.label).toMatch(/CP/);
    expect(imp.traces!.placement.v.length).toBeGreaterThan(100); // the placement signal the console draws
    expect(s.src.devices()).toEqual([]);
  });
  it("RV infarct with complete heart block: slow ventricular rate, two atrial events in most beats, a raised JVP, low output", () => {
    const { src, n } = patient(CASE_BY_ID.rcaocc.scenario, 35);
    say("RCA", n);
    expect(n.hr).toBeLessThan(50); expect(n.cvp).toBeGreaterThan(8); expect(n.co).toBeLessThan(3.5);
    const bs = src.beats(10);
    expect(bs.filter((b) => b.atrial.length >= 2).length).toBeGreaterThan(5); // atria beat faster than the ventricles
    const j = analyzeJvp({ p: bs[bs.length - 1].pressure.RA, t: bs[bs.length - 1].time, atrial: bs[bs.length - 1].atrial, rr: bs[bs.length - 1].rr });
    expect(j.classes).toContain("raised");
    expect(j.aWaves.length).toBeGreaterThanOrEqual(1);
  });
  it("atrial fibrillation: no atrial events and a beat-to-beat stroke volume that follows the preceding interval", () => {
    const { src } = patient({ patient: { rhythm: "af", bbb: "none" } }, 40);
    const bs = src.beats(20);
    expect(bs.every((b) => b.atrial.length === 0)).toBe(true);
    const sv = bs.map((b) => b.strokeVolume), rr = bs.map((b) => b.rr);
    expect(sd(sv)).toBeGreaterThan(1.5); expect(sd(rr)).toBeGreaterThan(0.03);
  });
  it("tamponade: a raised, near-flat venous trace, raised JVP and a small stroke volume; the sac is readable", () => {
    const base = patient().n, { sim, src, n } = patient({ pericardium: { effusionMl: 200 } });
    say("tamponade", n);
    expect(n.cvp).toBeGreaterThan(base.cvp + 3); expect(n.co).toBeLessThan(base.co - 1); expect(n.hr).toBeGreaterThan(base.hr + 8);
    expect(Math.abs(n.cvp - n.pcwp)).toBeLessThan(4); // the filling pressures draw together
    expect(sim.pericardium()!.effusionMl).toBeCloseTo(200, 0); expect(sim.pericardium()!.pressureMmHg).toBeGreaterThan(2);
    const b = src.beats(1)[0], j = analyzeJvp({ p: b.pressure.RA, t: b.time, atrial: b.atrial, rr: b.rr });
    expect(j.heightCm).toBeGreaterThan(4);
  });
  it("VA-ECMO: the circuit's flow is in the output, the console reads it, the return saturation follows the sweep and FiO2, the lungs get less", () => {
    const base = patient().n, { src, n, sat } = patient({ devices: { ecmo: { flowLpm: 4, sweepLpm: 3, fio2: 0.8 } } });
    say("ECMO", n, sat);
    const e = src.devices().find((d) => d.id === "ecmo")!;
    expect(e.readings.flowLpm).toBeGreaterThan(3.6); expect(e.readings.flowLpm).toBeLessThan(4.6);
    expect(e.readings.returnSat).toBeGreaterThan(0.95);
    expect(n.qpQs).toBeLessThan(0.7); expect(n.co).toBeGreaterThan(base.co);
    expect(sat.svo2).toBeGreaterThan(base.co > 0 ? 0.72 : 0); // blood drained from the right atrium is more saturated than the normal mixed venous
  });
  it("an IABP at 1:2 shows its console and alternate augmented beats on the aortic trace", () => {
    const { src } = patient({ ...LAD, devices: { iabp: { ratio: 2 } } }, 30);
    const d = src.devices().find((x) => x.id === "iabp")!;
    expect(d.readings.ratio).toBe(2); expect(d.traces!.arterial.v.length).toBeGreaterThan(100);
    const peaks = src.beats(8).map((b) => Math.max(...b.pressure.AO));
    expect(Math.max(...peaks) - Math.min(...peaks)).toBeGreaterThan(5); // assisted and unassisted beats differ
  });
});

describe("a patient the live source cannot represent", () => {
  it("a neonate's structural fields are not applied to the adult core, which runs on (the page reads the bridge instead)", () => {
    const sim = new Simulation({}, { engine: "core" });
    sim.reset({ seed: 3, kind: "neonate", heart: { vsd: { diameterMm: 5 } } }, { settled: true });
    expect(sim.patientKind).toBe("neonate"); expect(sim.coreNote).toBe("");
    sim.warmup(10);
    const n = new LiveSource(sim).numbers();
    expect(n.map).toBeGreaterThan(70); // a plain adult
  });
});
