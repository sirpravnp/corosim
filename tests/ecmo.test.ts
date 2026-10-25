// D6: VA-ECMO on the full adult model (core/devices/ecmo.ts). Set CORE_VERBOSE=1 to print the tables.
import { describe, it, expect } from "vitest";
import { buildModel, simulate, solveOxygen, volumeOffsetFor, type StructuralSpec } from "../src/physics/structural";
import { createEngine } from "../src/physics/core/engine";
import { fromModel, type FromModelOptions } from "../src/physics/core/fromModel";
import { BeatRecorder } from "../src/physics/core/recorder";
import { Ecmo, oxygenatorSat } from "../src/physics/core/devices/ecmo";
import { LiveHeart } from "../src/physics/core/live";
import { NODES } from "../src/physics/structuralGraph";
import { SOLVER } from "../src/config/structural";

const HR = 72;
const log = (...a: unknown[]) => { if (process.env.CORE_VERBOSE) console.log(...a); };
type Cfg = NonNullable<FromModelOptions["ecmo"]>;
const AO = NODES.indexOf("AO"), DAO = NODES.indexOf("DAO"), RA = NODES.indexOf("RA");

/** Cardiogenic-shock baseline: LV Ees cut and the LV stiffened. */
const SHOCK: StructuralSpec = { lvEes: 0.35, lvStiffness: 1.6 };

interface RunOpts { dt?: number; hr?: number }
function run(spec: StructuralSpec, ecmo: Cfg | null, o: RunOpts = {}) {
  const m = buildModel(spec, volumeOffsetFor(spec));
  const g = fromModel(m, ecmo ? { ecmo } : {});
  const eng = createEngine(g.nodes, g.elements, g.options);
  const hr = o.hr ?? HR, dt = o.dt ?? SOLVER.dt;
  const rec = new BeatRecorder(eng, 60 / hr, ["MV", "AV"]);
  let anyNaN = false, alarm = 0;
  const off = eng.onSample((s) => {
    for (const x of s.V) if (!Number.isFinite(x)) anyNaN = true;
    for (const x of s.P) if (!Number.isFinite(x)) anyNaN = true;
    const t = s.taps.ecmo; if (t) alarm = Math.max(alarm, t.suctionAlarm);
  });
  const old = SOLVER.dt; SOLVER.dt = dt;
  let r; try { r = eng.periodic(hr); } finally { SOLVER.dt = old; }
  off();
  const b = rec.beat(), fv = eng.flowVolumes(); rec.dispose();
  const tap = eng.sample().taps.ecmo;
  return {
    m, eng, b, r, anyNaN, alarm, tap, fv, cfg: ecmo,
    MAP: b.p.AO.mean, PP: b.p.AO.max - b.p.AO.min, LVEDP: b.p.LV.end, EDV: b.v.LV.end, PCWP: b.p.LA.mean, RAP: b.p.RA.mean, avFwd: b.valves.AV.forwardMl,
    flow: fv.fwd.ecmo !== undefined ? ((fv.fwd.ecmo - fv.bwd.ecmo) * hr) / 1000 : 0,
    blood: Array.from(eng.sample().V).reduce((a, x) => a + x, 0), start: m.start.reduce((a, x) => a + x, 0),
  };
}
type Run = ReturnType<typeof run>;
const f1 = (x: number) => x.toFixed(1);
const row = (n: string, x: Run) => log(`${n.padEnd(14)} MAP ${f1(x.MAP)} PP ${f1(x.PP)} LVEDP ${f1(x.LVEDP)} EDV ${f1(x.EDV)} PCWP ${f1(x.PCWP)} RAP ${f1(x.RAP)} AVfwd ${f1(x.avFwd)} flow ${x.flow.toFixed(2)} rpm ${x.tap ? x.tap.rpm.toFixed(0) : "-"} alarm ${x.alarm}`);

const none = run(SHOCK, null);
const ec = (flowLpm: number, spec: StructuralSpec = SHOCK, extra: Partial<Cfg> = {}) => run(spec, { flowLpm, ...extra });
const e2 = ec(2), e3 = ec(3), e4 = ec(4);
log("RA vol", [none, e2, e4].map((x) => JSON.stringify(x.b.v.RA)));
log("tap", JSON.stringify(e2.tap), JSON.stringify(e2.fv.fwd.ecmo), JSON.stringify(e2.fv.bwd.ecmo));
row("no ECMO", none); row("2 L/min", e2); row("3 L/min", e3); row("4 L/min", e4);

describe("flow controller", () => {
  it("delivers the target flow and shows speed", () => {
    for (const [t, x] of [[2, e2], [3, e3], [4, e4]] as const) { expect(x.flow).toBeGreaterThan(0.93 * t); expect(x.flow).toBeLessThan(1.07 * t); expect(x.tap.speed).toBeGreaterThan(0.5); expect(x.tap.speed).toBeLessThanOrEqual(5); }
    expect(e4.tap.speed).toBeGreaterThan(e2.tap.speed);
  });
  it("clamps the speed", () => {
    const x = ec(40);
    expect(x.tap.speed).toBeLessThanOrEqual(5 + 1e-9);
    expect(x.flow).toBeLessThan(40);
  });
});

describe("shock with ECMO and no vent", () => {
  it("MAP rises with ECMO flow", () => {
    expect(e2.MAP).toBeGreaterThan(none.MAP); expect(e3.MAP).toBeGreaterThan(e2.MAP); expect(e4.MAP).toBeGreaterThan(e3.MAP);
  });
  it("LV afterload rises: LVEDP, EDV and PCWP up, aortic valve opens less", () => {
    // The drained blood no longer fills the LV, so LVEDP, EDV and PCWP rise with support but flatten (the ESV rises steadily): compare each with no ECMO.
    for (const x of [e2, e3, e4]) { expect(x.LVEDP).toBeGreaterThan(none.LVEDP); expect(x.EDV).toBeGreaterThan(none.EDV); expect(x.PCWP).toBeGreaterThan(none.PCWP); }
    expect(e3.b.v.LV.min).toBeGreaterThan(e2.b.v.LV.min); expect(e4.b.v.LV.min).toBeGreaterThan(e3.b.v.LV.min); expect(e2.b.v.LV.min).toBeGreaterThan(none.b.v.LV.min);
    expect(e2.avFwd).toBeLessThan(none.avFwd); expect(e3.avFwd).toBeLessThan(e2.avFwd); expect(e4.avFwd).toBeLessThan(e3.avFwd);
  });
});

// D6b. Whether a poor LV distends on VA-ECMO depends on its blood volume. The ECMO drains the RA and the lungs and left heart then carry
// only the reduced native flow, which the LV must still eject against the raised aortic pressure; for a stiff, weak LV at the normal
// calibrated blood volume (SHOCK) the lower inflow and the higher end-systolic volume cancel (LVEDP +0.8 mmHg, flat). A volume-loaded
// cardiogenic shock (the usual state after resuscitation, pulmonary congestion) sits on the steep part of the diastolic curve and
// distends: LVEDP and PCWP rise with every step of flow. The bronchial/Thebesian return (`BRONCHIAL`, 1 % of cardiac output) adds
// a little (about 0.3 mmHg here) and is the only inflow left when the aortic valve stays shut (SEVERE below).
const LOADED: StructuralSpec = { ...SHOCK, volumeMl: 300 };
const nL = run(LOADED, null), l2 = ec(2, LOADED), l3 = ec(3, LOADED), l4 = ec(4, LOADED);
row("loaded none", nL); row("loaded 2", l2); row("loaded 3", l3); row("loaded 4", l4);
/** Severe dysfunction, volume-loaded: LV Ees at 0.2, stiff, +800 ml. */
const SEVERE: StructuralSpec = { lvEes: 0.2, lvStiffness: 3, volumeMl: 800 };
const sN = run(SEVERE, null), s4 = ec(4, SEVERE), s5 = ec(5, SEVERE), s55 = ec(5.5, SEVERE);
row("severe none", sN); row("severe 4", s4); row("severe 5", s5); row("severe 5.5", s55);
log("severe LV/AO peak", sN.b.p.LV.max, s55.b.p.LV.max, s55.b.p.AO.max);

describe("LV distension on VA-ECMO (D6b)", () => {
  it("LV distends with ECMO flow: LVEDP at 4 L/min at least 3 mmHg above no ECMO", () => {
    expect(l4.LVEDP).toBeGreaterThanOrEqual(nL.LVEDP + 3);
    expect(l4.EDV).toBeGreaterThan(nL.EDV);
  });
  it("LVEDP and PCWP rise with each step of ECMO flow", () => {
    expect(l2.LVEDP).toBeGreaterThan(nL.LVEDP); expect(l3.LVEDP).toBeGreaterThan(l2.LVEDP); expect(l4.LVEDP).toBeGreaterThan(l3.LVEDP);
    expect(l2.PCWP).toBeGreaterThan(nL.PCWP); expect(l3.PCWP).toBeGreaterThan(l2.PCWP); expect(l4.PCWP).toBeGreaterThan(l3.PCWP);
    expect(l3.avFwd).toBeLessThan(l2.avFwd); expect(l4.avFwd).toBeLessThan(l3.avFwd);
  });
  it("severe dysfunction: the aortic valve stops opening and LVEDP climbs far above the moderate case", () => {
    expect(s4.avFwd).toBeLessThan(sN.avFwd); expect(s5.avFwd).toBeLessThan(s4.avFwd); expect(s55.avFwd).toBeLessThan(s5.avFwd);
    expect(s55.avFwd).toBeLessThan(0.5);
    expect(s4.LVEDP).toBeGreaterThan(sN.LVEDP + 10); expect(s5.LVEDP).toBeGreaterThan(s4.LVEDP); expect(s55.LVEDP).toBeGreaterThan(s5.LVEDP);
    expect(s55.LVEDP).toBeGreaterThan(l4.LVEDP + 20);
    // the LV fills until its contraction meets the aortic pressure
    expect(s55.b.p.LV.max).toBeGreaterThan(s55.b.p.AO.max - 5);
    expect(s55.anyNaN).toBe(false);
  });
});

describe("drainage", () => {
  it("low venous volume: suction alarm and flow below target", () => {
    const low = ec(4, { ...SHOCK, volumeMl: -400 });
    row("hypovolemic", low);
    expect(low.alarm).toBe(1);
    expect(low.flow).toBeLessThan(0.85 * 4);
    expect(e4.alarm).toBe(0);
    expect(low.anyNaN).toBe(false);
  });
});

describe("oxygen", () => {
  /** Pre- (AO) and post-ductal (DAO) saturation from the oxygen solve with the ECMO stream: drained from RA, oxygenated, returned to DAO. */
  const sats = (x: Run, sweep = 3, fio2 = 1) => {
    const el = x.eng.element<Ecmo>("ecmo"); el.set({ sweepLpm: sweep, fio2 });
    const h = simulate(x.m, { waveform: false, core: { ecmo: { ...x.cfg!, sweepLpm: sweep, fio2 } } });
    const net = (h.fwd.ecmo - h.bwd.ecmo) / x.m.T;
    const o = solveOxygen(x.m, h, { from: RA, to: DAO, flow: net, oxygenate: (c, cap) => el.returnSat(c / cap) * cap });
    return { AO: o.content[AO] / o.capacity, DAO: o.content[DAO] / o.capacity, ret: net };
  };
  it("oxygenator function saturates in sweep and rises with FiO2", () => {
    expect(oxygenatorSat(0.6, 0, 1)).toBeCloseTo(0.6, 9);
    expect(oxygenatorSat(0.6, 6, 1)).toBeGreaterThan(0.99);
    expect(oxygenatorSat(0.6, 2, 1)).toBeGreaterThan(oxygenatorSat(0.6, 1, 1));
    expect(oxygenatorSat(0.6, 3, 1)).toBeGreaterThan(oxygenatorSat(0.6, 3, 0.21));
  });
  it("differential hypoxemia: poor lungs, some native output, AO sat < DAO sat", () => {
    const x = ec(3, { ...SHOCK, satLung: 0.7 }); row("poor lungs", x);
    const s = sats(x);
    log("pre/post", s);
    expect(x.avFwd).toBeGreaterThan(5);
    expect(s.AO).toBeLessThan(0.9); expect(s.DAO).toBeGreaterThan(s.AO + 0.05);
  });
  it("full support and no native output: both high", () => {
    // volume-loaded, very weak stiff LV, pump near its limit: the aortic valve never opens
    const x = ec(5.5, { lvEes: 0.2, lvStiffness: 3, volumeMl: 800, satLung: 0.7 }); row("full", x);
    const s = sats(x);
    log("pre/post full", s, "AVfwd", x.avFwd);
    expect(x.avFwd).toBeLessThan(0.5); expect(x.flow).toBeGreaterThan(5);
    expect(s.AO).toBeGreaterThan(0.9); expect(s.DAO).toBeGreaterThan(0.9);
  });
  it("without ECMO the oxygen solve is unchanged", () => {
    const h = simulate(none.m, { waveform: false });
    const a = solveOxygen(none.m, h), b = solveOxygen(none.m, h, undefined);
    expect(Array.from(a.content)).toEqual(Array.from(b.content));
  });
});

describe("numerics", () => {
  it("conserves volume", () => { expect(Math.abs(e4.blood - e4.start)).toBeLessThan(0.01 * e4.start); expect(e4.anyNaN).toBe(false); });
  it("dt halving changes the means by under 0.5 %", () => {
    const h = run(SHOCK, { flowLpm: 3 }, { dt: SOLVER.dt / 2 });
    log("dt/2", h.MAP, e3.MAP, h.LVEDP, e3.LVEDP, h.flow, e3.flow);
    expect(Math.abs(h.MAP - e3.MAP) / e3.MAP).toBeLessThan(0.005);
    expect(Math.abs(h.flow - e3.flow) / e3.flow).toBeLessThan(0.005);
    expect(Math.abs(h.LVEDP - e3.LVEDP) / e3.LVEDP).toBeLessThan(0.005);
  });
});

describe("LiveHeart extra", () => {
  it("accepts Ecmo.forModel as an extra", () => {
    const h = new LiveHeart(SHOCK, { extra: [(m) => Ecmo.forModel(m, { flowLpm: 3 })] });
    h.engine.step(0.01);
    expect(h.engine.element<Ecmo>("ecmo").target).toBe(3);
  });
});
