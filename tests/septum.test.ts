// B2: septal interaction on the full adult model (core/septum.ts). Set CORE_VERBOSE=1 to print the tables.
import { describe, it, expect } from "vitest";
import { buildModel, volumeOffsetFor, type StructuralSpec } from "../src/physics/structural";
import { createEngine } from "../src/physics/core/engine";
import { fromModel, type FromModelOptions } from "../src/physics/core/fromModel";
import { BeatRecorder } from "../src/physics/core/recorder";
import type { ElastanceChamber } from "../src/physics/core/chamber";
import { Septum } from "../src/physics/core/septum";
import { SOLVER } from "../src/config/structural";
import { SEPTUM } from "../src/config/septum";

type PeriOpt = NonNullable<FromModelOptions["pericardium"]>;
const HR = 72;
const log = (...a: unknown[]) => { if (process.env.CORE_VERBOSE) console.log(...a); };

interface RunOpt { septum?: boolean; peri?: PeriOpt; dt?: number; wave?: boolean }
/** Steady state of the adult model with or without the septum (and the sac), summarised over the last beat. */
function run(spec: StructuralSpec, o: RunOpt = {}) {
  const core: FromModelOptions = { ...(o.septum ? { septum: true } : {}), ...(o.peri ? { pericardium: o.peri } : {}) };
  const m = buildModel(spec, volumeOffsetFor(spec, core));
  const g = fromModel(m, core);
  const eng = createEngine(g.nodes, g.elements, g.options);
  const dt = o.dt ?? SOLVER.dt, nSteps = Math.max(50, Math.round(m.T / dt));
  const rec = new BeatRecorder(eng, m.T, ["MV", "AV"], o.wave ? { dt: m.T / nSteps, every: 0.01, flows: [] } : undefined);
  const sep = o.septum ? eng.element<Septum>("septum") : null;
  // V_spt of the last complete beat: mean and end-diastolic value (the last sample before the next beat)
  let sum = 0, n = 0, mean = 0, end = 0, last = 0, idx = 0;
  const off = eng.onSample((s) => {
    const k = Math.floor((s.t - 1e-9) / m.T);
    if (k !== idx) { mean = n ? sum / n : 0; end = last; sum = 0; n = 0; idx = k; }
    if (sep) { last = sep.volumeMl; sum += last; n++; }
  });
  const blood0 = Array.from(eng.sample().V).reduce((a, v) => a + v, 0);
  const old = SOLVER.dt; SOLVER.dt = dt;
  let r; try { r = eng.periodic(HR); } finally { SOLVER.dt = old; }
  off();
  sep?.resetStats();
  const b = rec.beat(), fv = eng.flowVolumes(); rec.dispose();
  const SV = fv.fwd.AV - fv.bwd.AV;
  return {
    eng, sep, b, r, SV, blood0, CO: (SV * HR) / 1000, MAP: b.p.AO.mean, CVP: b.p.RA.mean, PCWP: b.p.LA.mean, LVEDP: b.p.LV.end, RVEDP: b.p.RV.end,
    LVEDV: b.v.LV.max, RVEDV: b.v.RV.max, LVsys: b.p.LV.max, RVsys: b.p.RV.max, vSptMean: mean, vSptEnd: end,
  };
}
type Run = ReturnType<typeof run>;
const f = (x: number, d = 1) => x.toFixed(d);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const row = (x: Run) => `MAP ${f(x.MAP)} CO ${f(x.CO, 2)} CVP ${f(x.CVP)} PCWP ${f(x.PCWP)} LVEDP ${f(x.LVEDP)} RVEDP ${f(x.RVEDP)} LVEDV ${f(x.LVEDV)} RVEDV ${f(x.RVEDV)} LVsys ${f(x.LVsys)} RVsys ${f(x.RVsys)}`;

/** Solver statistics accumulated over every run of this file (solves counted while the engine ran, before `resetStats`). */
const iter = { solves: 0, iterations: 0, max: 0, failed: 0 };
function runCounted(spec: StructuralSpec, o: RunOpt = {}) {
  const core: FromModelOptions = { septum: true, ...(o.peri ? { pericardium: o.peri } : {}) };
  const m = buildModel(spec, volumeOffsetFor(spec, core));
  const g = fromModel(m, core);
  const eng = createEngine(g.nodes, g.elements, g.options);
  const r = eng.periodic(HR);
  const sep = eng.element<Septum>("septum"), s = sep.stats;
  iter.solves += s.solves; iter.iterations += s.iterations; iter.max = Math.max(iter.max, s.maxIterations); iter.failed += s.failed;
  return { r, eng, sample: eng.sample() };
}

const base = run({});
const baseOn = run({}, { septum: true });

describe("septum: normal heart", () => {
  it("the numbers barely change with the septum on (MAP, CO, CVP, PCWP, EDVs within 3 %)", () => {
    log(`normal off: ${row(base)}\nnormal on : ${row(baseOn)} | V_spt mean ${f(baseOn.vSptMean)} end-diastolic ${f(baseOn.vSptEnd)} ml`);
    for (const k of ["MAP", "CO", "CVP", "PCWP", "LVEDV", "RVEDV"] as const) expect(rel(baseOn[k], base[k]), k).toBeLessThan(0.03);
    expect(baseOn.r.converged).toBe(true);
  });
  it("normal septal displacement is toward the RV (LV pressure exceeds RV pressure)", () => {
    expect(baseOn.vSptMean).toBeGreaterThan(0);
  });
  it("without the option there is no septum element", () => {
    expect(() => base.eng.element("septum")).toThrow();
  });
  it("`off: true` reproduces the septum-free run in the sense of zero displacement", () => {
    const m = buildModel({}, volumeOffsetFor({}));
    const g = fromModel(m, { septum: { off: true } });
    const eng = createEngine(g.nodes, g.elements, g.options);
    eng.periodic(HR);
    expect(eng.element<Septum>("septum").volumeMl).toBe(0);
  });
});

describe("septum: RV pressure load", () => {
  /** LV pressure of the passive heart at a given LV and RV volume (no events yet: all chambers passive). */
  function passiveLV(septum: boolean, vLV: number, vRV: number) {
    const m = buildModel({}, volumeOffsetFor({}));
    const g = fromModel(m, septum ? { septum: true } : {});
    const nodes = g.nodes.map((n) => (n.name === "LV" ? { ...n, start: vLV } : n.name === "RV" ? { ...n, start: vRV } : n));
    const eng = createEngine(nodes, g.elements, g.options), s = eng.sample();
    return { P: s.P[eng.node("LV")], vSpt: septum ? eng.element<Septum>("septum").volumeMl : 0 };
  }
  it("static: a dilated, loaded RV raises LV filling pressure at the same LV volume (leftward shift); off it does not", () => {
    const rows = [100, 140, 180].map((vr) => ({ vr, off: passiveLV(false, 110, vr), on: passiveLV(true, 110, vr) }));
    log("RV volume  P_LV(off)  P_LV(on)  V_spt(on)");
    for (const x of rows) log(`${x.vr}  ${f(x.off.P, 2)}  ${f(x.on.P, 2)}  ${f(x.on.vSpt, 2)}`);
    expect(rows[2].off.P).toBeCloseTo(rows[0].off.P, 9);
    expect(rows[1].on.P).toBeGreaterThan(rows[0].on.P); expect(rows[2].on.P).toBeGreaterThan(rows[1].on.P);
    expect(rows[2].on.P).toBeGreaterThan(rows[2].off.P);
    expect(rows[2].on.vSpt).toBeLessThan(rows[0].on.vSpt);
  });
  it("dynamic: with a high pulmonary resistance LV EDV falls and the LV filling pressure rises with the septum on (leftward shift)", () => {
    const tab = [12, 30].map((pvri) => ({ pvri, off: run({ pvri }), on: run({ pvri }, { septum: true }) }));
    log("pvri  | off | on");
    for (const x of tab) log(`${x.pvri}\n  off ${row(x.off)}\n  on  ${row(x.on)} | V_spt end-diastolic ${f(x.on.vSptEnd)} (normal ${f(baseOn.vSptEnd)})`);
    for (const { off, on } of tab) {
      expect(on.LVEDV).toBeLessThan(off.LVEDV); // smaller LV at ...
      expect(on.PCWP).toBeGreaterThan(off.PCWP); // ... a higher filling pressure
      expect(on.LVEDP).toBeGreaterThan(off.LVEDP);
      expect(on.vSptEnd).toBeLessThan(baseOn.vSptEnd); // septum displaced leftward relative to normal
    }
    // the effect grows with the load
    expect(tab[1].off.LVEDV - tab[1].on.LVEDV).toBeGreaterThan(tab[0].off.LVEDV - tab[0].on.LVEDV);
  });
});

describe("septum: RV infarct (rvEes 0.3, rvStiffness 2.5)", () => {
  const spec: StructuralSpec = { rvEes: 0.3, rvStiffness: 2.5 };
  const off = run(spec), on = run(spec, { septum: true });
  it("LV filling and CO are lower with the septum on", () => {
    log(`RV infarct off: ${row(off)}\nRV infarct on : ${row(on)}\nCO off ${f(off.CO, 3)} on ${f(on.CO, 3)}`);
    expect(on.LVEDV).toBeLessThan(off.LVEDV);
    expect(on.PCWP).toBeGreaterThan(off.PCWP); // a smaller LV at a higher filling pressure
    expect(on.CO).toBeLessThan(off.CO);
    expect(on.MAP).toBeLessThan(off.MAP);
  });
  it("the septum supports RV systolic pressure, which then depends partly on LV contraction", () => {
    expect(on.RVsys).toBeGreaterThan(off.RVsys);
    expect(on.RVsys - off.RVsys).toBeGreaterThan(0.5);
  });
  it("RV systolic pressure follows LV contraction through the septum, and not without it (isovolumic, infarcted RV)", () => {
    const m = buildModel({ rvEes: 0.3, rvStiffness: 2.5 }, volumeOffsetFor({}));
    const g = fromModel(m, { septum: true });
    const eng = createEngine(g.nodes, g.elements, g.options);
    const sep = eng.element<Septum>("septum"), lv = eng.nodes[eng.node("LV")].model as ElastanceChamber, rv = eng.nodes[eng.node("RV")].model as ElastanceChamber;
    eng.schedule({ kind: "ventricular", t: 0 }); eng.step(1e-6);
    const t = lv.peakTime, e = rv.activation(t), ees0 = lv.params.ees, vl = 80, vr = 100;
    const pRV = (scale: number) => { lv.set({ ees: ees0 * scale }); const u = sep.solve(vl, vr, t); return { u, p: rv.pressureAt(vr + u, e) }; };
    const strong = pRV(1.5), normal = pRV(1), weak = pRV(0.5), none = rv.pressureAt(vr, e);
    log(`peak systole, V_LV ${vl} V_RV ${vr}: P_RV with LV Ees x1.5 ${f(strong.p, 2)}, x1 ${f(normal.p, 2)}, x0.5 ${f(weak.p, 2)} mmHg (V_spt ${f(strong.u, 2)}, ${f(normal.u, 2)}, ${f(weak.u, 2)}); septum off ${f(none, 2)}`);
    expect(strong.p).toBeGreaterThan(normal.p); expect(normal.p).toBeGreaterThan(weak.p);
    expect(normal.p).toBeGreaterThan(none); // the septum bows into the RV and adds to its pressure
  });
});

describe("septum: constriction and tamponade", () => {
  it("constriction (stiffness 6): RV and LV end-diastolic pressures within 3 mmHg; stiffness 4 and 5 reported and narrowing", () => {
    const gap = (x: Run) => x.LVEDP - x.RVEDP;
    const tab = [1, 4, 5, 6].map((s) => ({ s, off: run({}, { peri: { stiffness: s } }), on: run({}, { septum: true, peri: { stiffness: s } }) }));
    log("stiffness  gap(off)  gap(on)  CO(on)");
    for (const x of tab) log(`${x.s}  ${f(gap(x.off), 2)}  ${f(gap(x.on), 2)}  ${f(x.on.CO, 2)}  RVEDP ${f(x.on.RVEDP)} LVEDP ${f(x.on.LVEDP)} PCWP ${f(x.on.PCWP)} CVP ${f(x.on.CVP)}`);
    expect(Math.abs(gap(tab[3].on))).toBeLessThan(3);
    expect(gap(tab[1].on)).toBeLessThan(gap(tab[0].on)); // stiffness 4 already narrows it
    expect(gap(tab[2].on)).toBeLessThan(gap(tab[1].on)); expect(gap(tab[3].on)).toBeLessThan(gap(tab[2].on));
    expect(gap(tab[2].on)).toBeLessThan(3.5);
  });
  it("constriction waveform (reported): RV pressure early-diastolic dip then plateau", () => {
    const c = run({}, { septum: true, peri: { stiffness: 6 }, wave: true });
    const w = c.b.wave!, pv = w.p.RV, sys = pv.indexOf(Math.max(...pv)), early = pv.slice(sys, sys + Math.floor(pv.length * 0.4));
    const dip = Math.min(...early), end = pv[pv.length - 1], plateau = pv.slice(Math.floor(pv.length * 0.7)).reduce((a, x) => Math.max(a, x), -Infinity);
    log(`RV (stiffness 6): peak ${f(pv[sys])}, early-diastolic min ${f(dip)}, late plateau max ${f(plateau)}, end-diastolic ${f(end)}; dip depth below the end-diastolic level ${f(end - dip, 2)}`);
    expect(Number.isFinite(dip)).toBe(true);
    expect(dip).toBeLessThanOrEqual(end + 1e-9);
  });
  it("tamponade still equalises with the septum on as well as off (B1 acceptance)", () => {
    for (const septum of [false, true]) {
      const n = run({}, { septum, peri: { effusionMl: 0 } }), t = run({}, { septum, peri: { effusionMl: 300 } });
      const spread = Math.max(t.CVP, t.RVEDP, t.PCWP, t.LVEDP) - Math.min(t.CVP, t.RVEDP, t.PCWP, t.LVEDP);
      log(`tamponade 300 ml septum ${septum}: ${row(t)} spread ${f(spread, 2)}`);
      expect(spread).toBeLessThan(5);
      expect(t.CO).toBeLessThan(0.3 * n.CO);
      expect(t.MAP).toBeLessThan(0.5 * n.MAP);
    }
  });
});

describe("septum: neonate", () => {
  it("the neonate with the septum on stays close to the septum-free numbers (MAP, CVP, PCWP, CO within 3 %)", () => {
    const one = (septum: boolean) => {
      const spec: StructuralSpec = { patient: "neonate" }, core: FromModelOptions = septum ? { septum: true } : {};
      const m = buildModel(spec, volumeOffsetFor(spec, core)), g = fromModel(m, core), eng = createEngine(g.nodes, g.elements, g.options);
      const rec = new BeatRecorder(eng, m.T, ["MV", "AV"]), r = eng.periodic(m.hr), b = rec.beat(), fv = eng.flowVolumes(); rec.dispose();
      const sample = eng.sample();
      return { r, MAP: b.p.AO.mean, CVP: b.p.RA.mean, PCWP: b.p.LA.mean, CO: ((fv.fwd.AV - fv.bwd.AV) * m.hr) / 60, finite: Array.from(sample.P).every(Number.isFinite) };
    };
    const off = one(false), on = one(true);
    log(`neonate off: MAP ${f(off.MAP)} CVP ${f(off.CVP)} PCWP ${f(off.PCWP)} CO ${f(off.CO, 1)} ml/s\nneonate on : MAP ${f(on.MAP)} CVP ${f(on.CVP)} PCWP ${f(on.PCWP)} CO ${f(on.CO, 1)} ml/s`);
    expect(on.finite).toBe(true); expect(on.r.converged).toBe(true);
    for (const k of ["MAP", "CVP", "PCWP", "CO"] as const) expect(rel(on[k], off[k]), k).toBeLessThan(0.03);
  });
});

describe("septum: stability and the implicit solve", () => {
  const grid: { pvri: number; stiffness: number; eff: number }[] = [
    ...[1, 2, 5, 10, 20, 30].map((pvri) => ({ pvri, stiffness: 1, eff: 0 })),
    ...[1, 2, 4, 6, 8, 10].map((stiffness) => ({ pvri: 1, stiffness, eff: 0 })),
    ...[0, 100, 200, 300, 400].map((eff) => ({ pvri: 1, stiffness: 1, eff })),
    { pvri: 30, stiffness: 10, eff: 0 }, { pvri: 30, stiffness: 1, eff: 400 }, { pvri: 30, stiffness: 10, eff: 400 }, { pvri: 1, stiffness: 10, eff: 400 },
  ];
  it("no NaN across pvri 1-30, pericardial stiffness 1-10, effusion 0-400 ml; the solve always converges", () => {
    for (const g of grid) {
      const { r, sample } = runCounted({ pvri: g.pvri }, { peri: { stiffness: g.stiffness, effusionMl: g.eff } });
      for (const v of [...sample.P, ...sample.V]) expect(Number.isFinite(v), JSON.stringify(g)).toBe(true);
      expect(r.beats).toBeGreaterThan(0);
    }
    const mean = iter.iterations / iter.solves;
    log(`septal solves ${iter.solves}: mean ${mean.toFixed(2)} iterations, max ${iter.max}, failed ${iter.failed}`);
    expect(iter.failed).toBe(0);
    expect(iter.max).toBeLessThan(SEPTUM.maxIter);
    expect(mean).toBeLessThan(3);
  });
  it("the solver returns a finite, bounded root for extreme volumes and survives bad input", () => {
    const m = buildModel({}, volumeOffsetFor({}));
    const g = fromModel(m, { septum: true });
    const eng = createEngine(g.nodes, g.elements, g.options);
    const sep = eng.element<Septum>("septum");
    for (const [a, b, t] of [[0, 0, 0], [400, 1, 0.3], [1, 400, 0.3], [1e6, 1e6, 0.2], [-50, 500, 1], [Number.NaN, 100, 0.1], [100, Infinity, 0.1]] as const) {
      const u = sep.solve(a, b, t);
      expect(Number.isFinite(u)).toBe(true);
      expect(Math.abs(u)).toBeLessThanOrEqual(SEPTUM.uMax);
    }
  });
  it("halving dt changes MAP, CO, CVP, PCWP and V_spt by less than 0.5 % (normal, RV load, RV infarct, constriction)", () => {
    const cases: [string, StructuralSpec, PeriOpt | undefined][] = [["normal", {}, undefined], ["pvri 12", { pvri: 12 }, undefined], ["RV infarct", { rvEes: 0.3, rvStiffness: 2.5 }, undefined], ["constriction 6", {}, { stiffness: 6 }]];
    for (const [name, spec, peri] of cases) {
      const a = run(spec, { septum: true, peri }), b = run(spec, { septum: true, peri, dt: SOLVER.dt / 2 });
      log(`${name}: V_spt mean ${f(a.vSptMean, 3)} vs ${f(b.vSptMean, 3)}, end ${f(a.vSptEnd, 3)} vs ${f(b.vSptEnd, 3)}`);
      for (const k of ["MAP", "CO", "CVP", "PCWP", "vSptMean"] as const) expect(rel(a[k], b[k]), `${name} ${k}`).toBeLessThan(0.005);
    }
  });
  it("blood is conserved: the septum moves no blood", () => {
    const sum = (x: Run) => Array.from(x.eng.sample().V).reduce((a, v) => a + v, 0);
    expect(rel(sum(baseOn), baseOn.blood0)).toBeLessThan(1e-6);
  });
});
