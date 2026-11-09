/**
 * Engine behavior each CoroPump teaching case relies on (plan C7). Bands only; do not loosen without cause.
 */
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import type { PatientSpec } from "../src/sim/patient";
import { CASE_BY_ID } from "../src/cath/cases";
import { PRESET_BY_ID } from "../src/sim/presets";
import { OrderBook } from "../src/cases/orderBook";
import { effectiveDelayS, itemById, PatientNow } from "../src/cases/orders";

const LAD = CASE_BY_ID.ladocc.scenario;
const now = (o: Partial<PatientNow> = {}): PatientNow => ({
  respRateBase: 15, map: 90, spo2: 0.98, lactate: 1, congestion: 0, arrest: "none",
  hr: 75, sbp: 120, dbp: 70, urineMlHr: 60, lvIschemia: 0, rvIschemia: 0, rhythmLabel: "Sinus rhythm", tempC: 37, respRate: 15, ...o,
});

function make(sc: PatientSpec = {}, warm = 40) {
  const s = new Simulation({}, { engine: "core" });
  s.reset({ seed: 3, ...sc }, { settled: true });
  s.warmup(warm);
  s.history = [];
  return s;
}
const mapOf = (s: Simulation, sec = 25) => {
  const roll = s.rolling(sec).map;
  return Number.isFinite(roll) ? roll : s.map;
};
const pcwpOf = (s: Simulation, sec = 25) => s.hemo(sec)!.pcwp;
const mapAfter = (sc: PatientSpec, sec = 30) => {
  const s = make(sc);
  s.run(sec);
  return mapOf(s, sec);
};

describe("CoroPump case behaviors", () => {
  it("1 Protected PCI: LM occlusion drops MAP less with the pump on", () => {
    const weak = { heart: { lvEes: 0.25 } };
    const lm = { ...weak, lesions: [{ artery: "LM", occluded: true }] };
    const ref = mapAfter(weak, 30);
    const off = mapAfter(lm, 30);
    const on = mapAfter({ ...lm, devices: { coroPump: { level: 6 } } }, 30);
  /** Tuning: core LM occlusion drops MAP ~9 mmHg off-pump (not 30); pump cuts that to ~3 mmHg. */
    expect(ref - off).toBeGreaterThan(5);
    expect(ref - on).toBeLessThan(ref - off - 3);
    expect(ref - on).toBeLessThan(15);
    expect(on).toBeGreaterThan(off);
  });

  it("2 STEMI shock: pump on lowers PCWP by over 5 mmHg within 2 clinical minutes", () => {
    const shock: PatientSpec = { ...LAD, heart: { lvEes: 0.35, lvStiffness: 1.6 } };
    const s0 = make(shock); s0.run(30);
    const s1 = make({ ...shock, devices: { coroPump: { level: 6 } } }); s1.run(30);
    const without = s0.hemo(25)!.pcwp;
    const withPump = s1.hemo(25)!.pcwp;
    expect(without - withPump).toBeGreaterThan(5);
  });

  it("3 Suction: bleed 25% at P8 alarms; P4 plus volume clears it", () => {
    const hypo = { bloodLoss: 0.25, devices: { coroPump: { level: 8 } } };
    const s = make(hypo, 30);
    s.run(40);
    expect(s.devices()!.coroPump!.suctionAlarm).toBe(true);
    s.apply({ support: { fluids: 1 }, devices: { coroPump: { level: 4 } } });
    s.run(40);
    expect(s.devices()!.coroPump!.suctionAlarm).toBe(false);
  });

  it("4 Pulled back: aortic position alarms and does not unload the wedge", () => {
    const s = make({ ...LAD, devices: { coroPump: { level: 8, position: "aortic" } } });
    s.run(30);
    const d = s.devices()!.coroPump!;
    const base = make(LAD);
    base.run(30);
    expect(d.placementAmplitudeMmHg).toBeLessThan(12);
    expect(d.positionAlarm).toBe(true);
    expect(Math.abs(pcwpOf(s) - pcwpOf(base))).toBeLessThan(3);
  });

  it("5 Too deep: deep P9 suction and pfHb over 40 within 12 clinical hours", () => {
    const s = make({ ...LAD, devices: { coroPump: { level: 9, position: "deep" } } });
    s.run(20);
    expect(s.devices()!.coroPump!.suctionAlarm).toBe(true);
    s.step(720);
    expect(s.devices()!.coroPump!.hemolysis.plasmaFreeHbMgDl).toBeGreaterThan(40);
  });

  it("6 Purge rising: purge pressure climbs then heparin and solution change halt growth", () => {
    const s = make(PRESET_BY_ID["purge-rising"]!.spec);
    s.step(300, { minutes: 4000 });
    const d = s.devices()!.coroPump!;
    expect(d.thrombusBurden).toBeGreaterThan(0.46);
    expect(d.purge.pressureMmHg).toBeGreaterThan(700);
    const b0 = d.thrombusBurden;
    const p0 = d.purge.pressureMmHg;
    s.apply({ devices: { coroPump: { purge: { heparinUml: 50, solution: "bicarbonate" } } } });
    s.step(150, { minutes: 400 });
    expect(s.devices()!.coroPump!.thrombusBurden).toBeLessThanOrEqual(b0 + 0.03);
    expect(s.devices()!.coroPump!.purge.pressureMmHg).toBeLessThanOrEqual(p0 + 30);
  });

  it("7 Hemolysis: elevated pfHb and ordered lab, fixing volume lowers pfHb", () => {
    const s = make(PRESET_BY_ID["coropump-hemolysis"]!.spec);
    s.run(40);
    const pf = s.devices()!.coroPump!.hemolysis.plasmaFreeHbMgDl;
    expect(["tea", "dark"]).toContain(s.devices()!.coroPump!.hemolysis.urineColor);
    expect(pf).toBeGreaterThan(40);
    const book = new OrderBook();
    const lim = 900;
    book.order("hemolysis", 0, lim);
    const back = book.tick(effectiveDelayS(itemById("hemolysis")!, lim), now({ pfHbMgDl: pf }));
    expect(back[0].reading.text).toMatch(/4\d|5\d|6\d|7\d|8\d|9\d|1\d\d/);
    s.apply({ bloodLoss: -0.15, devices: { coroPump: { level: 5 } } });
    s.step(180);
    expect(s.devices()!.coroPump!.hemolysis.plasmaFreeHbMgDl).toBeLessThan(pf);
  });

  it("8 RV failure: RCA infarct preset suctions; lowering P-level clears it", () => {
    const base = PRESET_BY_ID["rv-infarct-coropump"]!.spec;
    const starved = make(base);
    starved.run(40);
    expect(starved.devices()!.coroPump!.suctionAlarm).toBe(true);
    const treated = make({ ...base, devices: { coroPump: { level: 5 } } });
    treated.run(40);
    expect(treated.devices()!.coroPump!.suctionAlarm).toBe(false);
  });

  it("9 Weaning: MAP stable at P4; at P2 pump flow falls", () => {
    const s = make({ heart: { lvEes: 0.4 }, devices: { coroPump: { level: 6 } } });
    s.run(30);
    const at6 = mapOf(s);
    s.setCoroPumpLevel(4);
    s.run(30);
    expect(mapOf(s)).toBeGreaterThan(at6 - 12);
    const flow4 = s.devices()!.coroPump!.flowLpm;
    s.setCoroPumpLevel(2);
    s.run(30);
    expect(s.devices()!.coroPump!.flowLpm).toBeLessThan(flow4 - 0.3);
  });

  it("10 Myocarditis bridge: MAP above 65 only with the pump", () => {
    const sick = { heart: { lvEes: 0.12, lvStiffness: 2.8 } };
    const off = mapAfter(sick, 30);
    const on = mapAfter({ ...sick, devices: { coroPump: { level: 6 } } }, 30);
    expect(off).toBeLessThan(66);
    expect(on).toBeGreaterThan(65);
  });

  it("11 VT with shock: MAP holds higher only with the pump", () => {
    const vt = { ...LAD, patient: { rhythm: "vt-mono" }, heart: { lvEes: 0.25 } };
    const off = mapAfter(vt, 30);
    const on = mapAfter({ ...vt, devices: { coroPump: { level: 7 } } }, 30);
    expect(on).toBeGreaterThan(off + 4);
    expect(on).toBeGreaterThan(65);
  });
});
