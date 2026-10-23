// D2: Impella 2.5 / CP / 5.5 on the full adult model (core/devices/impella.ts). Set CORE_VERBOSE=1 to print the tables.
import { describe, it, expect } from "vitest";
import { buildModel, volumeOffsetFor, type StructuralSpec } from "../src/physics/structural";
import { createEngine } from "../src/physics/core/engine";
import { fromModel, type FromModelOptions } from "../src/physics/core/fromModel";
import { BeatRecorder } from "../src/physics/core/recorder";
import { Impella, ImpellaConsole, levelSpeed, motorCurrent } from "../src/physics/core/devices/impella";
import { cannulaInertance, IMPELLA, IMPELLA_SUCTION } from "../src/config/devices";
import { LiveHeart } from "../src/physics/core/live";
import { Compliance } from "../src/physics/core/chamber";
import { pumpHead } from "../src/physics/core/devices/pump";
import { NODES } from "../src/physics/structuralGraph";
import { SOLVER } from "../src/config/structural";

const HR = 72;
const log = (...a: unknown[]) => { if (process.env.CORE_VERBOSE) console.log(...a); };
type Imp = NonNullable<FromModelOptions["impella"]>;
const LV = NODES.indexOf("LV");

/** Cardiogenic-shock baseline: LV Ees cut and the LV stiffened, as the ischemia mapping of src/config/bridge.ts does. */
const SHOCK: StructuralSpec = { lvEes: 0.35, lvStiffness: 1.6 };

/**
 * PVA from an LV loop (one beat of P, V samples, mmHg and ml): stroke work = |∮P dV| (the loop area, trapezoids, mmHg·ml),
 * potential energy PE = ½·P_es·(V_es − V0) with the end-systolic point at the maximum of P/(V − V0), PVA = SW + PE.
 */
function loopMetrics(P: number[], V: number[], v0: number) {
  let sw = 0; for (let i = 1; i < P.length; i++) sw += 0.5 * (P[i] + P[i - 1]) * (V[i] - V[i - 1]);
  let k = 0, best = -Infinity; for (let i = 0; i < P.length; i++) { const e = P[i] / Math.max(V[i] - v0, 1e-6); if (e > best) { best = e; k = i; } }
  const pe = 0.5 * P[k] * (V[k] - v0);
  return { sw: Math.abs(sw), pe, pva: Math.abs(sw) + pe, ves: V[k], pes: P[k] };
}

interface RunOpts { dt?: number; hr?: number }
/** Steady state of the adult model with (or without) an Impella, summarised over the last beat. */
function run(spec: StructuralSpec, imp: Imp | null, o: RunOpts = {}) {
  const m = buildModel(spec, volumeOffsetFor(spec));
  const g = fromModel(m, imp ? { impella: imp } : {});
  const eng = createEngine(g.nodes, g.elements, g.options);
  const hr = o.hr ?? HR, T = 60 / hr, dt = o.dt ?? SOLVER.dt;
  const el = imp ? eng.element<Impella>("impella") : null;
  const rec = new BeatRecorder(eng, T, ["MV", "AV"]);
  const con = el ? new ImpellaConsole(eng) : null;
  // the LV loop of the last complete beat, and the lowest LV volume of the whole run
  let P: number[] = [], V: number[] = [], last: { P: number[]; V: number[] } = { P: [], V: [] }, idx = 0, vMin = Infinity, anyNaN = false;
  const off = eng.onSample((s) => {
    const k = Math.floor((s.t - 1e-9) / T); if (k !== idx) { last = { P, V }; P = []; V = []; idx = k; }
    P.push(s.P[LV]); V.push(s.V[LV]); vMin = Math.min(vMin, s.V[LV]); if (!Number.isFinite(s.P[LV]) || !Number.isFinite(s.V[LV])) anyNaN = true;
  });
  const old = SOLVER.dt; SOLVER.dt = dt;
  let r; try { r = eng.periodic(hr); } finally { SOLVER.dt = old; }
  off();
  const b = rec.beat(), fv = eng.flowVolumes(); rec.dispose(); con?.dispose();
  const v0 = m.chambers[LV]!.v0;
  const loop = loopMetrics(last.P, last.V, v0);
  const sv = fv.fwd.AV - fv.bwd.AV;
  return {
    eng, el, con, b, r, v0, vMin, anyNaN, loop, sv, avFwd: b.valves.AV.forwardMl,
    MAP: b.p.AO.mean, PP: b.p.AO.max - b.p.AO.min, LVEDP: b.p.LV.end, EDV: b.v.LV.end, ESV: b.v.LV.min,
    /** Device flow, L/min (net volume through the pump over the last beat). */
    flow: fv.fwd.impella !== undefined ? ((fv.fwd.impella - fv.bwd.impella) * hr) / 1000 : 0,
    blood: Array.from(eng.sample().V).reduce((a, x) => a + x, 0), start: m.start.reduce((a, x) => a + x, 0),
  };
}
type Run = ReturnType<typeof run>;
const f1 = (x: number) => x.toFixed(1);
const row = (n: string, x: Run) => log(`${n.padEnd(22)} MAP ${f1(x.MAP)} PP ${f1(x.PP)} LVEDP ${f1(x.LVEDP)} EDV ${f1(x.EDV)} ESV ${f1(x.ESV)} SV(AV) ${f1(x.sv)} SW ${f1(x.loop.sw)} PVA ${f1(x.loop.pva)} flow ${x.flow.toFixed(2)} LVmin ${f1(x.vMin)} alarm ${x.con?.last?.suctionAlarm}`);

const none = run(SHOCK, null);
const cp = (level: number, spec: StructuralSpec = SHOCK, extra: Partial<Imp> = {}) => run(spec, { model: "CP", level, ...extra });

describe("device definitions", () => {
  const big = 1e6;
  /** Settled flow (L/min) of a model at P-level between fixed pressures, `dP` across. */
  const fixedFlow = (model: "2.5" | "CP" | "5.5", level: number, dP: number) => {
    const pump = new Impella("impella", 0, 1, { model, level, v0: 10 });
    const eng = createEngine([{ name: "in", model: new Compliance("in", big), group: "none", start: 40 * big }, { name: "out", model: new Compliance("out", big), group: "none", start: (40 + dP) * big }], [pump]);
    for (let i = 0; i < 2000; i++) eng.step(0.0005);
    return eng.sample().taps.impella.flow;
  };
  it("P-levels map to increasing speeds, P0 is off, the table is per model", () => {
    for (const m of ["2.5", "CP", "5.5"] as const) {
      expect(levelSpeed(m, 0)).toBe(0);
      for (let l = 2; l <= 9; l++) expect(levelSpeed(m, l)).toBeGreaterThan(levelSpeed(m, l - 1));
      expect(levelSpeed(m, 12)).toBe(levelSpeed(m, 9));
    }
    expect(levelSpeed("2.5", 9)).toBeGreaterThan(levelSpeed("CP", 9)); expect(levelSpeed("CP", 9)).toBeGreaterThan(levelSpeed("5.5", 9));
  });
  it("maximum flow at P9 against a normal pressure difference is in the published class (2.5, 3.5-4.0, 5.5 L/min)", () => {
    const q = { "2.5": fixedFlow("2.5", 9, 60), CP: fixedFlow("CP", 9, 60), "5.5": fixedFlow("5.5", 9, 60) };
    log("max flow at dP 60:", q);
    expect(q["2.5"]).toBeGreaterThan(2.2); expect(q["2.5"]).toBeLessThan(2.8);
    expect(q.CP).toBeGreaterThan(3.5); expect(q.CP).toBeLessThan(4.0);
    expect(q["5.5"]).toBeGreaterThan(5.0); expect(q["5.5"]).toBeLessThan(6.0);
    for (const m of ["2.5", "CP", "5.5"] as const) { expect(fixedFlow(m, 9, 100)).toBeLessThan(q[m]); expect(fixedFlow(m, 5, 60)).toBeLessThan(q[m]); }
  });
  it("cannula inertance L = ρℓ/A: 13 cm and 4 mm gives about 0.08 mmHg·s²/ml; each model carries its own", () => {
    expect(cannulaInertance(13, 4)).toBeGreaterThan(0.075); expect(cannulaInertance(13, 4)).toBeLessThan(0.09);
    for (const m of ["2.5", "CP", "5.5"] as const) expect(new Impella("i", 0, 1, { model: m, v0: 10 }).params.L).toBeCloseTo(cannulaInertance(IMPELLA[m].lengthCm, IMPELLA[m].diameterMm), 9);
  });
  it("motor current rises with hydraulic load at one speed and with speed at none; zero when off", () => {
    const k = IMPELLA.CP, w = 40, H = (q: number) => pumpHead(k, w, q);
    expect(motorCurrent(w, H(30), 30)).toBeGreaterThan(motorCurrent(w, H(5), 5));
    expect(motorCurrent(50, 0, 0)).toBeGreaterThan(motorCurrent(30, 0, 0));
    expect(motorCurrent(0, 100, 50)).toBe(0);
  });
  it("set({ level }) moves the speed live", () => {
    const p = new Impella("i", 0, 1, { model: "CP", level: 3, v0: 10 });
    p.set({ level: 8 }); expect(p.params.speed).toBe(levelSpeed("CP", 8)); expect(p.level).toBe(8);
  });
});

describe("cardiogenic shock with an Impella CP", () => {
  const hi = cp(8);
  it("baseline is a shock state and the engine converged", () => {
    row("shock", none); row("shock CP P8", hi);
    expect(none.MAP).toBeLessThan(70); expect(none.LVEDP).toBeGreaterThan(15); expect(none.sv).toBeLessThan(55);
    expect(none.r.converged && hi.r.converged).toBe(true);
  });
  it("at a high level: MAP up, LV EDV and LVEDP down, pulse pressure narrower, stroke work and PVA down", () => {
    expect(hi.MAP).toBeGreaterThan(none.MAP + 5);
    expect(hi.EDV).toBeLessThan(none.EDV - 8);
    expect(hi.LVEDP).toBeLessThan(none.LVEDP - 3);
    expect(hi.PP).toBeLessThan(none.PP - 10);
    expect(hi.loop.sw).toBeLessThan(0.85 * none.loop.sw);
    expect(hi.loop.pva).toBeLessThan(0.95 * none.loop.pva);
    expect(hi.flow).toBeGreaterThan(3);
  });
  it("more unloading at higher levels (LVEDP and PVA fall, MAP and flow rise)", () => {
    const r = [2, 5, 8].map((l) => cp(l));
    for (let i = 1; i < r.length; i++) { expect(r[i].LVEDP).toBeLessThan(r[i - 1].LVEDP); expect(r[i].loop.pva).toBeLessThan(r[i - 1].loop.pva); expect(r[i].MAP).toBeGreaterThan(r[i - 1].MAP); expect(r[i].flow).toBeGreaterThan(r[i - 1].flow); }
  });
  it("device flow falls as afterload rises (systemic resistance up)", () => {
    const q = [0.7, 1, 1.4, 1.9].map((svrScale) => cp(7, { ...SHOCK, svrScale }).flow);
    log("flow vs SVR 0.7,1,1.4,1.9:", q.map((x) => x.toFixed(2)).join(" "));
    for (let i = 1; i < q.length; i++) expect(q[i]).toBeLessThan(q[i - 1]);
  });
  it("at the highest level the aortic valve stops opening (forward volume near zero), and opens more at lower levels", () => {
    const top = cp(9), mid = cp(6);
    log("AV forward ml: none", none.avFwd.toFixed(1), "P6", mid.avFwd.toFixed(1), "P9", top.avFwd.toFixed(1));
    expect(top.avFwd).toBeLessThan(0.1 * none.avFwd);
    expect(top.avFwd).toBeLessThan(mid.avFwd); expect(mid.avFwd).toBeLessThan(none.avFwd);
  });
  it("the 5.5 gives more flow than the CP, and the CP more than the 2.5, at the same level and load", () => {
    for (const level of [6, 9]) {
      const q = (model: "2.5" | "CP" | "5.5") => run(SHOCK, { model, level }).flow;
      const a = q("2.5"), b = q("CP"), c = q("5.5");
      log(`P${level}: 2.5 ${a.toFixed(2)}  CP ${b.toFixed(2)}  5.5 ${c.toFixed(2)} L/min`);
      expect(c).toBeGreaterThan(b); expect(b).toBeGreaterThan(a);
    }
  });
});

describe("console", () => {
  it("motor current and placement carry the LV-aortic pressure difference", () => {
    const r = cp(8), b = r.con!.last!;
    log("console CP P8:", JSON.stringify(b));
    expect(b.level).toBe(8);
    expect(b.flow.mean).toBeCloseTo(r.flow, 0);
    expect(b.placement.max).toBeGreaterThan(40); // diastole: aortic pressure far above the emptied LV
    expect(b.placement.amplitude).toBeGreaterThan(30);
    expect(b.pulsatility).toBeGreaterThan(20);
    expect(b.current.mean).toBeGreaterThan(200); expect(b.current.mean).toBeLessThan(1500);
    expect(b.suctionAlarm).toBe(false);
  });
  it("current follows the pressure difference over the beat (correlation with the placement signal)", () => {
    const eng = cp(8).eng, s: { dp: number; i: number }[] = [];
    for (let n = 0; n < 1500; n++) { eng.step(0.0005); if (n % 5 === 0) { const t = eng.sample().taps.impella; s.push({ dp: t.placement, i: t.current }); } }
    const m = (f: (x: { dp: number; i: number }) => number) => s.reduce((a, x) => a + f(x), 0) / s.length;
    const mdp = m((x) => x.dp), mi = m((x) => x.i);
    let sxy = 0, sxx = 0, syy = 0; for (const x of s) { sxy += (x.dp - mdp) * (x.i - mi); sxx += (x.dp - mdp) ** 2; syy += (x.i - mi) ** 2; }
    const c = sxy / Math.sqrt(sxx * syy);
    log("corr(placement, current) =", c.toFixed(2));
    expect(c).toBeGreaterThan(0.8);
  });
});

describe("hypovolemia: suction", () => {
  const hypo = cp(9, { ...SHOCK, volumeMl: -600 }), full = cp(9);
  it("trips the suction alarm and the flow drops; not tripped when filled", () => {
    row("hypovolemic CP P9", hypo); row("filled CP P9", full);
    expect(hypo.con!.last!.suctionAlarm).toBe(true);
    expect(full.con!.last!.suctionAlarm).toBe(false);
    expect(hypo.flow).toBeLessThan(0.7 * full.flow);
  });
  it("the pump never draws the LV below V0 + floor (the heart's own ejection excepted): no NaN, even when drained hard", () => {
    for (const volumeMl of [-600, -900, -1200]) {
      const spec = { ...SHOCK, volumeMl }, r = cp(9, spec), bare = run(spec, null), floor = r.v0 + IMPELLA_SUCTION.floorMl;
      log(`volume ${volumeMl}: LV min ${r.vMin.toFixed(2)} ml with the pump, ${bare.vMin.toFixed(2)} without (V0 ${r.v0.toFixed(2)}, floor ${floor.toFixed(2)}), flow ${r.flow.toFixed(2)}`);
      expect(r.anyNaN).toBe(false); expect(Number.isFinite(r.MAP)).toBe(true);
      expect(r.vMin).toBeGreaterThan(Math.min(bare.vMin, floor) - 0.3);
    }
    expect(cp(9, { ...SHOCK, volumeMl: -900 }).vMin).toBeGreaterThan(IMPELLA_SUCTION.floorMl + 9.6); // above V0 + floor, where the bare LV is far above
  });
  it("a pump forced far past its table cannot draw the LV below V0", () => {
    const m = buildModel(SHOCK, volumeOffsetFor(SHOCK)), g = fromModel(m, { impella: { model: "CP", level: 9 } });
    const eng = createEngine(g.nodes, g.elements, g.options), v0 = m.chambers[LV]!.v0;
    eng.element<Impella>("impella").set({ speed: 80 });
    let lo = Infinity; for (let n = 0; n < 24000; n++) { eng.step(0.0005); lo = Math.min(lo, eng.sample().V[LV]); }
    log("forced drain: LV min", lo.toFixed(2), "V0", v0.toFixed(2));
    expect(Number.isFinite(lo)).toBe(true); expect(lo).toBeGreaterThan(v0);
  });
});

describe("position", () => {
  const correct = cp(8), aortic = cp(8, SHOCK, { position: "aortic" });
  it("aortic: no LV unloading (LVEDP, EDV, MAP, aortic valve flow as without a device), flow recirculates, placement changes", () => {
    row("aortic CP P8", aortic);
    expect(Math.abs(aortic.LVEDP - none.LVEDP)).toBeLessThan(0.5);
    expect(Math.abs(aortic.EDV - none.EDV)).toBeLessThan(2);
    expect(Math.abs(aortic.MAP - none.MAP)).toBeLessThan(2);
    expect(aortic.avFwd).toBeGreaterThan(0.9 * none.avFwd);
    expect(aortic.flow).toBeGreaterThan(3); // the pump runs, the blood goes round in the aorta
    const a = aortic.con!.last!.placement, c = correct.con!.last!.placement;
    log("placement amplitude/mean: correct", c.amplitude.toFixed(1), c.mean.toFixed(1), "aortic", a.amplitude.toFixed(1), a.mean.toFixed(1));
    expect(Math.abs(a.mean)).toBeLessThan(0.5); expect(a.amplitude).toBeLessThan(0.5);
    expect(c.mean).toBeGreaterThan(20);
    expect(aortic.con!.last!.pulsatility).toBeLessThan(0.5 * correct.con!.last!.pulsatility);
  });
  it("deep: suction develops earlier (at a larger LV volume) and flow is lower", () => {
    const vol = { ...SHOCK, volumeMl: -400 }, dp = cp(8, vol, { position: "deep" }), cr = cp(8, vol);
    log("deep vs correct at -400: flow", dp.flow.toFixed(2), cr.flow.toFixed(2), "suction level", dp.con!.last!.suctionLevel.toFixed(2), cr.con!.last!.suctionLevel.toFixed(2));
    expect(dp.con!.last!.suctionLevel).toBeGreaterThan(cr.con!.last!.suctionLevel + 0.2);
    expect(dp.con!.last!.suctionAlarm).toBe(true); expect(cr.con!.last!.suctionAlarm).toBe(false);
    expect(dp.flow).toBeLessThan(cr.flow);
  });
});

describe("numerics", () => {
  it("halving dt changes flow, MAP and LVEDP by < 0.5 %; the volume is conserved", () => {
    const a = cp(8), b = run(SHOCK, { model: "CP", level: 8 }, { dt: SOLVER.dt / 2 });
    log("dt:", [a.flow, b.flow], [a.MAP, b.MAP], [a.LVEDP, b.LVEDP]);
    for (const k of ["flow", "MAP", "LVEDP"] as const) expect(Math.abs(a[k] - b[k]) / Math.abs(b[k])).toBeLessThan(0.005);
    expect(Math.abs(a.blood - a.start)).toBeLessThan(1e-6 * a.start);
  });
  it("with the device in the aorta the volume is conserved too", () => {
    const a = cp(8, SHOCK, { position: "aortic" });
    expect(Math.abs(a.blood - a.start)).toBeLessThan(1e-6 * a.start);
  });
});

describe("live use", () => {
  it("is a LiveHeart extra element and P-level changes live through set", () => {
    const h = new LiveHeart(SHOCK, { extra: [(m) => Impella.forModel(m, { model: "CP", level: 2 })] });
    h.warm(72);
    const imp = h.engine.element<Impella>("impella");
    const flowAt = () => { for (let i = 0; i < 4000; i++) h.step(0.0005); let q = 0; for (let i = 0; i < 1600; i++) { h.step(0.0005); q += h.engine.sample().taps.impella.flow; } return q / 1600; };
    const lo = flowAt(); imp.set({ level: 8 }); const hi = flowAt();
    log("live P2 / P8 flow:", lo.toFixed(2), hi.toFixed(2));
    expect(hi).toBeGreaterThan(lo + 1);
    expect(imp.level).toBe(8);
  }, 120_000);
});

describe("performance", () => {
  it("the core with an Impella (fromModel + periodic) runs at least 20x real time", () => {
    const m = buildModel(SHOCK, volumeOffsetFor(SHOCK));
    const go = () => { const g = fromModel(m, { impella: { model: "CP", level: 8 } }); return createEngine(g.nodes, g.elements, g.options).periodic(m.hr).beats; };
    go();
    const t0 = performance.now(), beats = go(), wall = (performance.now() - t0) / 1000, x = (beats * 60) / m.hr / wall;
    console.log(`core + Impella CP P8 (shock): ${beats} beats in ${wall.toFixed(2)} s wall = ${x.toFixed(0)}x real time`);
    expect(x).toBeGreaterThanOrEqual(20);
  }, 120_000);
});
