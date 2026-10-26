// P16: the core-engine Simulation reads the PatientSpec fields the page edits: structural heart, pericardium, ventilation, ECMO, Impella RP,
// Impella model/position. `setPatient` rebuilds only what is built in and applies the rest live. Set CORE_VERBOSE=1 to print.
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";

const mk = (spec = {}) => { const s = new Simulation({}, { engine: "core" }); s.reset({ seed: 3, ...spec }, { settled: true }); s.warmup(15); return s; };
const hemo = (s: Simulation, sec = 15) => { s.run(sec); return s.hemo(sec)!; };

describe("setPatient", () => {
  const s = mk();
  const normal = hemo(s);
  it("does nothing for the spec already in force, and does not rebuild the heart", () => {
    const live = s.live; s.setPatient({}); expect(s.live).toBe(live);
  });
  it("a structural lesion rebuilds the heart and shows in the numbers; removing it restores them", () => {
    const live = s.live;
    s.setPatient({ heart: { valves: { mv: { open: 0.3 } } } });
    expect(s.live).not.toBe(live);
    const ms = hemo(s, 20);
    expect(ms.pcwp).toBeGreaterThan(normal.pcwp + 3); expect(ms.lvedp).toBeLessThan(ms.pcwp); // mitral stenosis: the wedge exceeds the LV diastolic pressure
    s.setPatient({});
    const back = hemo(s, 20);
    expect(Math.abs(back.pcwp - normal.pcwp)).toBeLessThan(2.5);
  });
  it("a pericardium builds the sac once; effusion, stiffness and open then change live, without a rebuild", () => {
    s.setPatient({ pericardium: { effusionMl: 0 } });
    const live = s.live, quiet = hemo(s, 15);
    s.setPatient({ pericardium: { effusionMl: 220 } });
    expect(s.live).toBe(live);
    expect(s.pericardium()!.effusionMl).toBeCloseTo(220, 0);
    const t = hemo(s, 20);
    expect(t.cvp).toBeGreaterThan(quiet.cvp + 3);
    s.setPatient({ pericardium: { effusionMl: 220, open: true } });
    expect(s.live).toBe(live);
    const open = hemo(s, 20);
    expect(open.cvp).toBeLessThan(t.cvp - 2); // an opened pericardium does not constrain
    s.setPatient({});
    expect(s.pericardium()!.effusionMl).toBeCloseTo(0, 0); // spec removed: a normal sac
  });
  it("an effusion that keeps accumulating (ml per clinical minute) grows with the clinical clock, and stops with it", () => {
    const x = mk({ pericardium: { effusionMl: 50, effusionRateMlMin: 20 } });
    const e0 = x.pericardium()!.effusionMl;
    x.step(10, { minutes: 0 }); // no clinical time passes: no fluid
    expect(x.pericardium()!.effusionMl).toBeCloseTo(e0, 0);
    x.step(10, { minutes: 5 }); // 5 clinical minutes at 20 ml/min
    expect(x.pericardium()!.effusionMl).toBeGreaterThan(e0 + 80); expect(x.pericardium()!.effusionMl).toBeLessThan(e0 + 120);
  });
  it("ventilation builds the thorax; PEEP is live and raises the venous pressure", () => {
    const v = mk({ ventilation: { mode: "positive", peep: 0 } });
    const live = v.live, a = hemo(v, 20);
    v.setPatient({ ventilation: { mode: "positive", peep: 12 } });
    expect(v.live).toBe(live);
    const b = hemo(v, 25);
    expect(b.cvp).toBeGreaterThan(a.cvp + 3);
    expect(v.rolling(20).cardiacOutput).toBeLessThan(5.2);
  });
  it("ECMO and an Impella RP are added by a rebuild; ECMO flow is live", () => {
    const e = mk({ devices: { ecmo: { flowLpm: 3 } } });
    expect(e.devices()!.ecmo!.flowLpm).toBeGreaterThan(2); // instantaneous, pulsatile
    e.setPatient({ devices: { ecmo: { flowLpm: 5 } } });
    const live = e.live; e.run(20);
    expect(e.live).toBe(live);
    expect(e.circ.deviceFlow).toBeGreaterThan(4);
    const r = mk({ devices: { impellaRp: { level: 6 } } });
    expect(r.devices()!.impellaRp!.on).toBe(true);
    expect(mk().devices()!.ecmo).toBeUndefined();
  });
  it("Impella model and position rebuild; the P-level is live", () => {
    const i = mk({ support: { impella: true } });
    const live = i.live; expect(i.devices()!.impella!.model).toBe("CP");
    i.setPatient({ devices: { impella: { model: "CP", level: 3 } } });
    expect(i.live).toBe(live); expect(i.devices()!.impella!.level).toBe(3);
    i.setPatient({ devices: { impella: { model: "5.5", level: 3 } } });
    expect(i.live).not.toBe(live); expect(i.devices()!.impella!.model).toBe("5.5");
  });
  it("apply() takes a heart patch on the core engine, merged into what is there", () => {
    const x = mk({ heart: { valves: { av: { open: 0.4 } } } });
    const live = x.live;
    x.apply({ heart: { valves: { mv: { reg: 0.3 } } } });
    expect(x.live).not.toBe(live);
    const src = new LiveSource(x); x.run(25);
    const b = src.beats(3)[2];
    expect(b.valves.MV.regurgMl).toBeGreaterThan(5); expect(b.valves.AV.openMs).toBeGreaterThan(0);
    x.apply({ heart: { valves: { av: { open: 0.4 } } } }); // same field again: nothing changes
  });
  it("the legacy engine ignores it", () => {
    const l = new Simulation({ seed: 1 }); l.setPatient({ pericardium: { effusionMl: 300 } });
    expect(l.live).toBeUndefined();
  });
  it("a patient the core cannot settle falls back to a plain adult with an explanation (or settles; never leaves the simulation without a heart)", () => {
    const x = mk({ heart: { valves: { av: { open: 0 }, mv: { open: 0 } } } });
    expect(x.live).toBeDefined();
    const m = x.circ.map; expect(Number.isFinite(m)).toBe(true);
    if (x.coreNote) expect(x.coreNote).toMatch(/plain adult/);
  });
});
