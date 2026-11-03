import { describe, it, expect, vi } from "vitest";
import { assess, LESIONS, LESION_BY_ID, lesionHash, patientFromLesionHash } from "../src/sim/structural";
import { normalizePatient } from "../src/sim/patient";
import { lesionForHeart } from "../src/sim/crossLinks";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";

/**
 * Adult congenital lesions in the Simulator (decision D1, docs/CONGENITAL_ADULT.md): ASD, unrepaired VSD progressing to
 * Eisenmenger, repaired tetralogy of Fallot, adult PDA. Each is read two ways: the structural engine (deterministic, no reflexes)
 * and the Simulator's core engine through the same LiveSource the oxygen and cath panels read. Slow: the Simulator runs are real.
 */
vi.setConfig({ testTimeout: 300_000 });

const struct = (id: string, v: Record<string, number> = {}) => assess(id as never, v);
const sim = (id: string, v: Record<string, number> = {}) => {
  const s = new Simulation({}, { engine: "core" }), src = new LiveSource(s);
  s.reset({ seed: 1, ...patientFromLesionHash(lesionHash(id as never, v)) }, { settled: true });
  s.warmup(40); s.history = []; s.run(30);
  const n = src.numbers(), o = src.saturations(), b = src.beats().at(-1)!;
  return { n, o, pp: n.systolic - n.diastolic, edvRv: b.edv.RV, pr: b.valves.PV.regurgMl / b.valves.PV.forwardMl };
};
const normal = struct("normal").report, normalSim = sim("normal");

describe("the library and the Simulator's lesion dropdown", () => {
  it("lists the adult congenital lessons beside ASD, and keeps the newborn ones for the Structural page", () => {
    const adult = LESIONS.filter((l) => l.group === "congenital" && l.patient === "adult").map((l) => l.id);
    expect(adult).toEqual(expect.arrayContaining(["asd", "vsd-eisenmenger", "tof-repaired", "pda-adult"]));
    for (const id of ["pda", "vsd", "tof"]) expect(LESION_BY_ID[id]!.patient).toBe("neonate");
  });
  it("each new lesson opens in the Simulator as a warning-free adult heart and is recognised from it", () => {
    for (const id of ["vsd-eisenmenger", "tof-repaired", "pda-adult"]) {
      const p = patientFromLesionHash(`#lesion=${id}`);
      expect(p.heart).not.toHaveProperty("patient"); expect(p.heart).not.toHaveProperty("hr");
      expect(normalizePatient(p).warnings).toEqual([]);
      expect(lesionForHeart(p)?.id).toBe(id);
    }
  });
});

describe("atrial septal defect (kept)", () => {
  it("shunts left to right with Qp:Qs 1.3 to 1.8, normal saturation and no pressure rise", () => {
    const r = struct("asd").report, s = sim("asd");
    expect(r.qpQs).toBeGreaterThan(1.3); expect(r.qpQs).toBeLessThan(1.8);
    expect(s.n.qpQs).toBeGreaterThan(1.3); expect(s.n.qpQs).toBeLessThan(1.8);
    expect(r.preductalSat).toBeGreaterThan(0.96); expect(s.o.spo2).toBeGreaterThan(0.96);
    expect(r.pressure.PA.mean).toBeLessThan(20);
  });
});

describe("adult patent ductus arteriosus", () => {
  const r = struct("pda-adult").report, s = sim("pda-adult");
  it("shunts aorta to pulmonary artery: Qp:Qs 1.8 to 2.8 by flow and by oxygen", () => {
    expect(r.shunt.pda).toBeGreaterThan(0);
    expect(r.qpQs).toBeGreaterThan(1.8); expect(r.qpQs).toBeLessThan(2.8);
    expect(Math.abs(r.qpQsFick - r.qpQs) / r.qpQs).toBeLessThan(0.1);
    expect(s.n.qpQs).toBeGreaterThan(1.8); expect(s.n.qpQs).toBeLessThan(2.8);
  });
  it("widens the pulse pressure (aortic diastolic run-off): at least 60 mmHg against 45 in the normal adult", () => {
    const pp = r.pressure.AO.max - r.pressure.AO.min;
    expect(pp).toBeGreaterThanOrEqual(60); expect(r.pressure.AO.min).toBeLessThan(35);
    expect(s.pp).toBeGreaterThanOrEqual(60); expect(s.n.diastolic).toBeLessThan(55);
    expect(pp).toBeGreaterThan(normal.pressure.AO.max - normal.pressure.AO.min + 15);
    expect(s.pp).toBeGreaterThan(normalSim.pp + 15);
  });
  it("is pink with equal hand and foot saturation, and loads the pulmonary artery", () => {
    expect(r.preductalSat).toBeGreaterThan(0.97); expect(Math.abs(r.preductalSat - r.postductalSat)).toBeLessThan(0.01);
    expect(r.pressure.PA.mean).toBeGreaterThan(normal.pressure.PA.mean + 8);
    expect(s.o.spo2).toBeGreaterThan(0.88); // the Simulator's lung-water model takes a few points off the pulmonary venous saturation
  });
  it("a smaller duct shunts less and pulses less; a high resistance narrows and reverses it, with a bluer foot (differential cyanosis)", () => {
    const small = struct("pda-adult", { diameter: 3 }).report;
    expect(small.qpQs).toBeLessThan(r.qpQs); expect(small.qpQs).toBeGreaterThan(1.1);
    expect(small.pressure.AO.max - small.pressure.AO.min).toBeLessThan(r.pressure.AO.max - r.pressure.AO.min);
    const eis = struct("pda-adult", { diameter: 8, pvri: 30 }).report;
    expect(eis.qpQs).toBeLessThan(1.2); expect(eis.rightToLeft).toBeGreaterThan(0.2);
    expect(eis.preductalSat - eis.postductalSat).toBeGreaterThan(0.05);
    expect(eis.pressure.AO.max - eis.pressure.AO.min).toBeLessThan(25);
  });
});

describe("unrepaired VSD to Eisenmenger", () => {
  const early = struct("vsd-eisenmenger", { pvri: 5 }).report, late = struct("vsd-eisenmenger").report;
  const earlySim = sim("vsd-eisenmenger", { pvri: 5 }), lateSim = sim("vsd-eisenmenger");
  it("early, low lung resistance: left-to-right, Qp:Qs above 1.8, pink, PA pressure raised but below systemic", () => {
    expect(early.shunt.vsd).toBeGreaterThan(0); expect(early.qpQs).toBeGreaterThan(1.8);
    expect(early.preductalSat).toBeGreaterThan(0.95); expect(earlySim.o.spo2).toBeGreaterThan(0.93);
    expect(earlySim.n.qpQs).toBeGreaterThan(1.8);
    expect(early.pressure.PA.mean).toBeGreaterThan(25); expect(early.pressure.PA.max).toBeLessThan(early.pressure.AO.max - 15);
  });
  it("Eisenmenger: the shunt has reversed (net right to left, Qp:Qs 0.7 to 0.97) and the patient is cyanosed (SpO2 75 to 88 %)", () => {
    expect(late.shunt.vsd).toBeLessThan(0);
    expect(late.qpQs).toBeGreaterThan(0.7); expect(late.qpQs).toBeLessThan(0.97);
    expect(late.rightToLeft).toBeGreaterThan(late.leftToRight);
    expect(late.preductalSat).toBeGreaterThan(0.75); expect(late.preductalSat).toBeLessThan(0.88);
    expect(Math.abs(late.qpQsFick - late.qpQs) / late.qpQs).toBeLessThan(0.1);
  });
  it("Eisenmenger: the pulmonary artery and right ventricle are at systemic pressure; the pulse pressure is not wide", () => {
    expect(late.pressure.PA.mean).toBeGreaterThan(50);
    expect(Math.abs(late.pressure.RV.max - late.pressure.AO.max)).toBeLessThan(10);
    expect(late.pressure.PA.min).toBeGreaterThan(40);
    expect(late.pressure.AO.max - late.pressure.AO.min).toBeLessThan(35);
  });
  it("on the Simulator it is blue (SpO2 under 85 %) with the right ventricle within 15 mmHg of the aorta, and bluer than the early stage", () => {
    expect(lateSim.o.spo2).toBeLessThan(0.85); expect(lateSim.o.spo2).toBeGreaterThan(0.55);
    expect(lateSim.n.pa.systolic).toBeGreaterThan(70); expect(Math.abs(lateSim.n.pa.systolic - lateSim.n.systolic)).toBeLessThan(15);
    expect(lateSim.o.spo2).toBeLessThan(earlySim.o.spo2 - 0.2);
  });
  it("saturation falls and Qp:Qs falls as the pulmonary resistance rises", () => {
    const at = (pvri: number) => struct("vsd-eisenmenger", { pvri }).report;
    const a = at(5), b = at(18), c = at(30), d = at(45);
    expect(a.preductalSat).toBeGreaterThan(b.preductalSat); expect(b.preductalSat).toBeGreaterThan(c.preductalSat); expect(c.preductalSat).toBeGreaterThan(d.preductalSat);
    expect(a.qpQs).toBeGreaterThan(b.qpQs); expect(b.qpQs).toBeGreaterThan(c.qpQs); expect(c.qpQs).toBeGreaterThan(d.qpQs);
    expect(d.shunt.vsd).toBeLessThan(0);
  });
});

describe("repaired tetralogy of Fallot", () => {
  const f = struct("tof-repaired"), r = f.report, s = sim("tof-repaired");
  it("pulmonary regurgitation fraction is 20 to 40 % of the forward flow, graded severe by the regurgitant orifice", () => {
    const pv = f.valves.find((v) => v.valve === "PVL")!;
    expect(pv.regurgFraction!).toBeGreaterThan(0.2); expect(pv.regurgFraction!).toBeLessThan(0.4);
    expect(pv.regurgitation).toBe("severe"); expect(pv.stenosis).toBe("none");
    expect(s.pr).toBeGreaterThan(0.2); expect(s.pr).toBeLessThan(0.4);
  });
  it("the right ventricle is dilated: end-diastolic volume at least 1.6 times normal (about 110 to 125 ml/m2 or more) with a lower ejection fraction", () => {
    expect(r.rvEdv).toBeGreaterThan(1.6 * normal.rvEdv); expect(s.edvRv).toBeGreaterThan(1.6 * normalSim.edvRv);
    expect(r.rvEf).toBeLessThan(normal.rvEf - 0.1); expect(r.rvEf).toBeGreaterThan(0.35);
    expect(s.n.rvEf).toBeLessThan(normalSim.n.rvEf - 0.1);
  });
  it("is pink with no residual shunt, low pulmonary diastolic pressure and a normal pulmonary artery systolic pressure", () => {
    expect(r.preductalSat).toBeGreaterThan(0.97); expect(s.o.spo2).toBeGreaterThan(0.96);
    expect(Math.abs(r.qpQs - 1)).toBeLessThan(0.05); expect(Math.abs(s.n.qpQs - 1)).toBeLessThan(0.08);
    expect(Math.abs(r.shunt.vsd)).toBe(0);
    expect(r.pressure.PA.min).toBeLessThan(normal.pressure.PA.min); expect(r.pressure.PA.max).toBeLessThan(30);
  });
  it("the regurgitation and the dilation follow their sliders; with none of either it is the normal heart", () => {
    const frac = (reg: number) => struct("tof-repaired", { reg }).valves.find((v) => v.valve === "PVL")!.regurgFraction!;
    expect(frac(0.2)).toBeLessThan(frac(0.4)); expect(frac(0.4)).toBeLessThan(frac(0.6));
    expect(frac(0)).toBeLessThan(0.02);
    expect(struct("tof-repaired", { reg: 0.3 }).report.rvEdv).toBeLessThan(r.rvEdv);
    const none = struct("tof-repaired", { reg: 0, rvOutflow: 0 }).report;
    expect(Math.abs(none.rvEdv - normal.rvEdv)).toBeLessThan(3); expect(Math.abs(none.pressure.AO.max - normal.pressure.AO.max)).toBeLessThan(2);
  });
});
