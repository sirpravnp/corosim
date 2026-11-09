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
  it("1 Protected PCI: pump unloads LM occlusion without extra MAP loss", () => {
    const lm = { heart: { lvEes: 0.15 }, lesions: [{ artery: "LM", occluded: true }] };
    const unsupported = make({ heart: { lvEes: 0.15 } });
    unsupported.run(30);
    const off = make(lm);
    off.run(30);
    const on = make({ ...lm, devices: { coroPump: { level: 6 } } });
    on.run(30);
    const hOff = off.hemo(25)!;
    const hOn = on.hemo(25)!;
    expect(hOff.lvedp - hOn.lvedp).toBeGreaterThan(15);
    expect(hOff.pcwp - hOn.pcwp).toBeGreaterThan(4);
    expect(Math.abs(mapOf(on) - mapOf(unsupported))).toBeLessThan(5);
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

  it("6 Purge rising: PURGE PRESSURE HIGH within the case time limit; opening has no alarm", () => {
    const spec = PRESET_BY_ID["purge-rising"]!.spec;
    const open = make(spec, 10);
    expect(open.devices()!.coroPump!.alarms).not.toContain("PURGE PRESSURE HIGH");
    const s = make(spec);
    const caseClinicalMin = 96 * 60;
    let seen = false;
    for (let m = 0; m <= caseClinicalMin && !seen; m += 120) {
      s.step(60, { minutes: Math.min(120, caseClinicalMin - m) });
      if (s.devices()!.coroPump!.alarms.includes("PURGE PRESSURE HIGH")) seen = true;
    }
    expect(seen).toBe(true);
  });

  it("6 Purge rising: heparin 50 plus a solution change halts growth once the alarm is up", () => {
    const s = make(PRESET_BY_ID["purge-rising"]!.spec);
    let seen = false;
    for (let m = 0; m <= 96 * 60 && !seen; m += 120) {
      s.step(60, { minutes: 120 });
      seen = s.devices()!.coroPump!.alarms.includes("PURGE PRESSURE HIGH");
    }
    expect(seen).toBe(true);
    const d = s.devices()!.coroPump!;
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

  it("8 Weaning: MAP stable at P4; at P2 pump flow falls", () => {
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

  it("9 Myocarditis bridge: MAP above 65 only with the pump", () => {
    const sick = { heart: { lvEes: 0.12, lvStiffness: 2.8 } };
    const off = mapAfter(sick, 30);
    const on = mapAfter({ ...sick, devices: { coroPump: { level: 6 } } }, 30);
    expect(off).toBeLessThan(66);
    expect(on).toBeGreaterThan(65);
  });

  it("10 VT with shock: MAP above 65 and over 4 mmHg higher with the pump", () => {
    const vt = { ...LAD, patient: { rhythm: "vt-mono" }, heart: { lvEes: 0.25 } };
    const off = mapAfter(vt, 30);
    const on = mapAfter({ ...vt, devices: { coroPump: { level: 7 } } }, 30);
    expect(on).toBeGreaterThan(off + 4);
    expect(on).toBeGreaterThan(65);
  });
});
