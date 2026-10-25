// D3: the real Impella (D2) and IABP (D5) in the ACS simulation on the core engine. Direction tests on teaching scenarios; the
// legacy engine is untouched (simulation.test.ts, management.test.ts). Set CORE_VERBOSE=1 to print the numbers.
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import type { PatientSpec } from "../src/sim/patient";
import { CASE_BY_ID } from "../src/cath/cases";

const say = (...a: unknown[]) => { if (process.env.CORE_VERBOSE) console.log(...a); };
const LAD = CASE_BY_ID.ladocc.scenario;
const LV = 7;

function make(sc: PatientSpec = {}, warm = 40) {
  const s = new Simulation({}, { engine: "core" });
  s.reset({ seed: 3, ...sc }, { settled: true });
  s.warmup(warm); s.history = [];
  return s;
}
function measure(s: Simulation, sec = 30) {
  s.run(sec);
  const r = s.rolling(sec), h = s.hemo(sec)!;
  return { map: r.map, sbp: r.sbp, dbp: r.dbp, co: r.cardiacOutput, pcwp: h.pcwp, lvedp: h.lvedp, lvEsv: h.lvEsv, flow: s.circ.deviceFlow, cp: s.circ.coronaryPressure, perfusion: s.perfusion };
}

describe("Impella in an anterior STEMI (core engine)", () => {
  const base = measure(make(LAD)), imp = make({ ...LAD, support: { impella: true } }), m = measure(imp);
  it("unloads the ventricle and holds or raises the pressure, with a class-sized flow", () => {
    say("LAD", base, "LAD + CP P6", m);
    expect(m.flow).toBeGreaterThan(2); expect(m.flow).toBeLessThan(3.6);
    expect(m.pcwp).toBeLessThan(base.pcwp - 3);
    expect(m.lvedp).toBeLessThan(base.lvedp - 3);
    expect(m.map).toBeGreaterThanOrEqual(base.map - 1);
    expect(m.co).toBeGreaterThan(base.co);
  });
  it("is the real device: no placeholder warning, taps exist, the console reads the pump", () => {
    expect(imp.warnings.some((w) => /placeholder/i.test(w))).toBe(false);
    expect(imp.live!.engine.sample().taps.impella).toBeDefined();
    expect(imp.live!.engine.sample().taps.impellaPlaceholder).toBeUndefined();
    const d = imp.devices()!.impella!;
    expect(d.on).toBe(true); expect(d.model).toBe("CP"); expect(d.level).toBe(6); expect(d.position).toBe("correct");
    expect(d.flowLpm).toBeCloseTo(m.flow, 0);
    expect(d.motorCurrentMa).toBeGreaterThan(300);
    expect(d.placementMmHg).toBeGreaterThan(0); // aortic minus LV pressure, positive on average
    expect(d.placementAmplitudeMmHg).toBeGreaterThan(20); // the LV-aortic difference swings with the beat
    expect(d.suctionAlarm).toBe(false);
  });
  it("never draws the LV below its unloaded volume", () => {
    const v0 = imp.live!.model.chambers[LV]!.v0;
    expect(Math.min(...imp.live!.records.map((b) => b.esv.LV))).toBeGreaterThan(v0);
  });
});

describe("P-level", () => {
  it("raising it raises the device flow and lowers the wedge pressure", () => {
    const s = make({ ...LAD, devices: { impella: { level: 3 } } }), lo = measure(s);
    expect(s.devices()!.impella!.level).toBe(3);
    s.setImpellaLevel(8);
    const hi = measure(s);
    say("P3", lo, "P8", hi);
    expect(s.devices()!.impella!.level).toBe(8);
    expect(hi.flow).toBeGreaterThan(lo.flow + 0.4);
    expect(hi.pcwp).toBeLessThan(lo.pcwp);
  });
  it("takes the model and level from devices.impella; the legacy boolean means CP at P6", () => {
    const a = make({ ...LAD, devices: { impella: { model: "5.5", level: 4 } } }, 10);
    expect(a.support.impella).toBe(true);
    const d = a.devices()!.impella!;
    expect([d.model, d.level, d.position]).toEqual(["5.5", 4, "correct"]);
    const b = make({ support: { impella: true } }, 10).devices()!.impella!;
    expect([b.model, b.level, b.position]).toEqual(["CP", 6, "correct"]);
  });
  it("switching the support toggle off removes the flow, on brings it back", () => {
    const s = make({ ...LAD, support: { impella: true } }, 20);
    measure(s, 10);
    expect(s.circ.deviceFlow).toBeGreaterThan(2);
    s.apply({ support: { impella: false } }); s.run(20);
    expect(s.circ.deviceFlow).toBeLessThan(0.1);
    expect(s.devices()!.impella!.on).toBe(false);
    s.apply({ support: { impella: true } }); s.run(20);
    expect(s.circ.deviceFlow).toBeGreaterThan(2);
  });
});

describe("suction alarm", () => {
  it("a normal heart at P6 does not alarm, at any beat", () => {
    const s = make({ support: { impella: true } }, 30);
    let alarms = 0; s.run(40);
    const d = s.devices()!.impella!;
    for (let i = 0; i < 20; i++) { s.run(2); if (s.devices()!.impella!.suctionAlarm) alarms++; }
    say("normal P6", d);
    expect(alarms).toBe(0); expect(d.flowLpm).toBeGreaterThan(2);
  });
  it("a hypovolemic patient at P8 alarms and the LV stays above its floor", () => {
    const s = make({ bloodLoss: 0.4, devices: { impella: { level: 8 } } }, 30);
    s.run(40);
    const d = s.devices()!.impella!;
    say("hypovolemic P8", d);
    expect(d.suctionAlarm).toBe(true);
    const v0 = s.live!.model.chambers[LV]!.v0, late = s.live!.records.filter((b) => b.t > 10);
    expect(Math.min(...late.map((b) => b.esv.LV))).toBeGreaterThan(v0);
  });
});

describe("IABP in an anterior STEMI (core engine)", () => {
  const base = make(LAD), b = measure(base), s = make({ ...LAD, support: { iabp: true } }), m = measure(s);
  it("is the real balloon: no placeholder, diastolic augmentation measured, coronary pressure up, no fixed +10", () => {
    say("LAD", b, "LAD + IABP", m, s.devices()!.iabp);
    expect(s.warnings.some((w) => /placeholder/i.test(w))).toBe(false);
    expect(s.live!.engine.sample().taps.iabp).toBeDefined();
    const d = s.devices()!.iabp!;
    expect(d.on).toBe(true); expect(d.ratio).toBe(1);
    expect(d.balloonPressureMmHg).toBeGreaterThan(5);
    expect(d.coronaryAugmentationMmHg).toBeGreaterThan(3);
    expect(d.peakDiastolicMmHg).toBeGreaterThan(d.diastolicMeanMmHg);
    expect(s.circ.coronaryPressure).toBeGreaterThan(s.circ.map + 3);
    expect(s.circ.coronaryPressure - s.circ.map).toBeCloseTo(d.coronaryAugmentationMmHg, 6);
    expect(Math.abs(s.circ.coronaryPressure - s.circ.map - 10)).toBeGreaterThan(0.01);
    expect(m.perfusion).toBeGreaterThan(b.perfusion + 3);
    expect(base.circ.coronaryPressure).toBeCloseTo(base.circ.map, 6);
    expect(d.peakDiastolicMmHg).toBeGreaterThan(base.devices()!.iabp!.peakDiastolicMmHg + 5);
  });
  it("unloads the ventricle: lower ejection peak (a little) and wedge pressure, with the ischemia held fixed", () => {
    // speed 0 stops the slow ischemia/infarct clock, so only the balloon's fast effect on the same settled patient is compared
    const frozen = (sc: PatientSpec) => { const x = make(sc); x.speed = 0; return x; };
    const a = frozen(LAD), c = frozen({ ...LAD, support: { iabp: true } });
    // the ejection peak varies beat to beat (ectopy, rate), so average the console over 40 s
    const avgSys = (x: Simulation) => { let t = 0; for (let i = 0; i < 40; i++) { x.run(1); t += x.devices()!.iabp!.systolicMmHg; } return t / 40; };
    const ma = measure(a, 10), mc = measure(c, 10), sys0 = avgSys(a), sys = avgSys(c);
    say("frozen ischemia: base", ma, sys0, "IABP", mc, sys);
    expect(sys).toBeLessThan(sys0); expect(sys).toBeGreaterThan(0.8 * sys0); // 5-10 % in the textbook; the band here is 0-20 %
    expect(mc.pcwp).toBeLessThanOrEqual(ma.pcwp + 0.5);
    expect(mc.map).toBeGreaterThan(ma.map - 3);
  });
  it("1:2 augments every second beat; the legacy boolean is 1:1 at correct timing and 40 ml", () => {
    const d = s.devices()!.iabp!;
    expect([d.ratio, d.inflateMs, d.deflateMs, d.volumeMl]).toEqual([1, 0, 0, 40]);
    const s2 = make({ ...LAD, devices: { iabp: { ratio: 2 } } }, 20);
    s2.run(20);
    const d2 = s2.devices()!.iabp!;
    expect(d2.ratio).toBe(2);
    expect(d2.coronaryAugmentationMmHg).toBeLessThan(d.coronaryAugmentationMmHg);
    expect(d2.coronaryAugmentationMmHg).toBeGreaterThan(0.5);
  });
  it("turning the pump off removes the augmentation", () => {
    const x = make({ ...LAD, support: { iabp: true } }, 20); x.run(10);
    x.apply({ support: { iabp: false } }); x.run(20);
    expect(x.devices()!.iabp!.on).toBe(false);
    expect(x.circ.coronaryPressure - x.circ.map).toBeLessThan(1);
  });
});

describe("legacy engine", () => {
  it("has no live devices; the boolean toggles keep the legacy numbers", () => {
    const s = new Simulation({ seed: 3, support: { impella: true, iabp: true } });
    expect(s.devices()).toBeNull();
    s.warmup(20);
    expect(s.circ.coronaryPressure - s.circ.map).toBeCloseTo(10, 6);
  });
});

describe("no devices", () => {
  it("devices() reports both off when nothing is on, and the circulation is as before", () => {
    const s = make({}, 10), d = s.devices()!;
    expect(d.impella!.on).toBe(false); expect(d.iabp!.on).toBe(false);
    expect(s.circ.deviceFlow).toBe(0);
    expect(s.circ.coronaryPressure).toBeCloseTo(s.circ.map, 6);
  });
});
