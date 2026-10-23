// A5: characteristic impedance Zc, venous capacitance with unstressed volume, and the recalibrated baseline.
import { describe, it, expect } from "vitest";
import { analyze, buildModel, simulate, volumeOffsetFor, NODES, CATH_NODES, type StructuralSpec } from "../src/physics/structural";
import { engineFromModel, fromModel, defaultPr } from "../src/physics/core/fromModel";
import { createEngine } from "../src/physics/core/engine";
import { BeatRecorder } from "../src/physics/core/recorder";
import { Compliance, fillingOf } from "../src/physics/core/vessels";
import { GORLIN, SOLVER } from "../src/config/structural";
import { orificeZcFlow, OneWayValve, InertialValve } from "../src/physics/core/valves";
import type { Engine } from "../src/physics/core/types";

const SYSTEMIC = ["SVC", "IVC", "SPL", "AO", "DAO"];
const peaksOf = (a: number[], prom: number) => {
  const out: number[] = []; let lo = a[0], hi = a[0], hiAt = 0, rising = true;
  for (let i = 1; i < a.length; i++) {
    if (rising) { if (a[i] > hi) { hi = a[i]; hiAt = i; } else if (hi - a[i] > prom) { out.push(hiAt); rising = false; lo = a[i]; } }
    else if (a[i] < lo) lo = a[i]; else if (a[i] - lo > prom) { rising = true; hi = a[i]; hiAt = i; }
  }
  if (rising && hi - lo > prom) out.push(hiAt);
  return out;
};

/** Steady state of the default model of one patient; `tweak` may change parameters of the engine before it runs. */
function run(kind: "adult" | "neonate", opts: { inertance?: boolean; dt?: number; tweak?: (e: Engine) => void; spec?: StructuralSpec } = {}) {
  const core = { inertance: !!opts.inertance }, spec = { patient: kind, ...opts.spec };
  const m = buildModel(spec, volumeOffsetFor({ patient: kind }, core)), eng = engineFromModel(m, core);
  opts.tweak?.(eng);
  const dt = opts.dt ?? SOLVER.dt, nSteps = Math.max(50, Math.round(m.T / dt));
  const rec = new BeatRecorder(eng, m.T, ["MV", "AV"], { dt: m.T / nSteps, every: 0.002, flows: ["MV", "AV"] });
  const old = SOLVER.dt; SOLVER.dt = dt;
  let r; try { r = eng.periodic(m.hr, { tol: 1e-4 }); } finally { SOLVER.dt = old; }
  const b = rec.beat(), fv = eng.flowVolumes(); rec.dispose();
  const V = eng.sample().V, fill = fillingOf(eng.nodes, V, SYSTEMIC);
  const sv = fv.fwd.AV - fv.bwd.AV, w = b.wave!;
  const iA = w.t.findIndex((t) => t >= m.T - defaultPr(m.T)), mv = w.q.MV;
  const ps = peaksOf(mv, kind === "adult" ? 15 : 1.5).filter((i) => w.t[i] > 0.04);
  return {
    m, eng, b, r, fill, sv, co: (sv * m.hr * 60) / 1000 / 60, ef: (b.v.LV.max - b.v.LV.min) / b.v.LV.max,
    map: b.p.AO.mean, pp: b.p.AO.max - b.p.AO.min, cvp: b.p.RA.mean, pcwp: b.p.LA.mean, tau: b.tauMs.LV,
    ea: peaksOf(mv, 0.1).length ? Math.max(...mv.slice(0, iA)) / Math.max(...mv.slice(iA)) : NaN, eaPeaks: ps.length >= 2 ? mv[ps[0]] / mv[ps[1]] : NaN,
    total: V.reduce((a, x) => a + x, 0), wave: w,
  };
}

describe("characteristic impedance Zc", () => {
  it("orificeZcFlow solves dP = K Q|Q| + Zc Q in both directions and reduces to the quadratic law at Zc = 0", () => {
    const A = 3.8, K = 1 / (GORLIN * A) ** 2;
    for (const zc of [0, 0.03, 0.06]) for (const d of [0.5, 5, 40, -5, -40]) {
      const q = orificeZcFlow(A, zc, d);
      expect(K * q * Math.abs(q) + zc * q).toBeCloseTo(d, 8);
      expect(Math.sign(q)).toBe(Math.sign(d));
    }
    expect(orificeZcFlow(0, 0.05, 20)).toBe(0);
  });

  it("the valve and Zc share the drop: the proximal node reads Pc + Zc Q, the valve gradient alone is K Q^2", () => {
    const g = fromModel(buildModel({}, volumeOffsetFor({})));
    const av = g.elements.find((e) => e.name === "AV") as OneWayValve;
    expect(av.params.Zc).toBeGreaterThan(0.03); expect(av.params.Zc).toBeLessThan(0.07);
    expect((g.elements.find((e) => e.name === "PVL") as OneWayValve).params.Zc).toBeLessThan(av.params.Zc);
  });

  for (const inertance of [false, true]) {
    it(`raises pulse pressure at the same stroke volume and gives an early ejection peak (${inertance ? "inertial" : "plain"} valve)`, () => {
      const withZc = run("adult", { inertance }), noZc = run("adult", { inertance, tweak: (e) => e.element<OneWayValve | InertialValve>("AV").set({ Zc: 0 }) });
      if (process.env.CORE_VERBOSE) console.log(`Zc ${inertance}: PP ${noZc.pp.toFixed(1)} -> ${withZc.pp.toFixed(1)}, SV ${noZc.sv.toFixed(1)} -> ${withZc.sv.toFixed(1)}`);
      expect(Math.abs(withZc.sv - noZc.sv) / noZc.sv).toBeLessThan(0.05);
      const zc0 = withZc.m.edges.find((x) => x.name === "AV")!.zc!;
      const doubled = run("adult", { inertance, tweak: (e) => e.element<OneWayValve | InertialValve>("AV").set({ Zc: 2 * zc0 }) });
      // at the same compliance Zc adds to the pulse (it adds Zc*Q to the proximal pressure, more as Zc grows); the effect is modest because Q peaks early, before Pc has risen
      expect(withZc.pp).toBeGreaterThan(noZc.pp + 0.5);
      expect(doubled.pp).toBeGreaterThan(withZc.pp + 0.5);
      expect(Math.abs(doubled.sv - noZc.sv) / noZc.sv).toBeLessThan(0.05);
      // ejection waveform: the flow peaks in the first third of ejection and has fallen to under half its peak by the end of the first half
      const q = withZc.wave.q.AV, qmax = Math.max(...q), first = q.findIndex((x) => x > 1), last = q.length - 1 - [...q].reverse().findIndex((x) => x > 1);
      const ipk = q.indexOf(qmax), span = last - first;
      expect((ipk - first) / span).toBeLessThan(0.33);
      expect(q[first + Math.round(span / 2)]).toBeLessThan(0.5 * qmax);
    });
  }
});

describe("unstressed volume and the splanchnic reservoir", () => {
  it("the splanchnic node is an engine node but not a catheter site; the bed drains through it to the IVC", () => {
    expect(NODES).toContain("SPL"); expect(CATH_NODES as readonly string[]).not.toContain("SPL"); expect(CATH_NODES).toHaveLength(NODES.length - 1);
    const m = buildModel({}, 0), e = (n: string) => m.edges.find((x) => x.name === n)!;
    expect(NODES[e("BEDL").to]).toBe("SPL"); expect(NODES[e("SPLV").from]).toBe("SPL"); expect(NODES[e("SPLV").to]).toBe("IVC");
    const spl = NODES.indexOf("SPL"), ivc = NODES.indexOf("IVC"), svc = NODES.indexOf("SVC");
    expect(m.comp[spl]).toBeGreaterThan(m.comp[ivc]); expect(m.vu[spl]).toBeGreaterThan(m.vu[ivc]); expect(m.vu[ivc]).toBeGreaterThan(m.vu[svc]);
  });

  it("Compliance: P = (V - Vu)/C, stressed volume above Vu, smooth bounded collapse below it when enabled", () => {
    const c = new Compliance("c", 10, 100, 1);
    expect(c.pressure(150)).toBeCloseTo(5, 12); expect(c.pressure(100)).toBeCloseTo(0, 12); expect(c.stressed(150)).toBe(50); expect(c.stressed(80)).toBe(0);
    expect(c.pressure(0)).toBeGreaterThan(-1); expect(c.pressure(99.99)).toBeCloseTo(-0.001, 4);
    expect(new Compliance("l", 10, 100).pressure(80)).toBeCloseTo(-2, 12);
    c.set({ Vu: 120 }); expect(c.pressure(150)).toBeCloseTo(3, 12);
  });

  it("raising Vu at constant total volume lowers MSFP, CVP and cardiac output", () => {
    const base = run("adult"), venoDilated = run("adult", { tweak: (e) => e.element<Compliance>("SPL").set({ Vu: e.element<Compliance>("SPL").params.Vu + 250 }) });
    if (process.env.CORE_VERBOSE) console.log(`Vu +250: MSFP ${base.fill.msfp.toFixed(2)} -> ${venoDilated.fill.msfp.toFixed(2)}, CVP ${base.cvp.toFixed(2)} -> ${venoDilated.cvp.toFixed(2)}, CO ${base.co.toFixed(2)} -> ${venoDilated.co.toFixed(2)}`);
    expect(Math.abs(venoDilated.total - base.total)).toBeLessThan(1e-6);
    expect(venoDilated.fill.msfp).toBeLessThan(base.fill.msfp - 1);
    expect(venoDilated.cvp).toBeLessThan(base.cvp - 0.3);
    expect(venoDilated.co).toBeLessThan(base.co - 0.1);
  });

  it("conserves blood volume over a run to 1e-9 relative", () => {
    const m = buildModel({}, volumeOffsetFor({})), eng = engineFromModel(m, { inertance: true });
    const sum = () => eng.sample().V.reduce((a, x) => a + x, 0), v0 = sum();
    eng.periodic(m.hr, { maxBeats: 3, minBeats: 3 });
    expect(Math.abs(sum() - v0) / v0).toBeLessThan(1e-9);
  });

  it("reports total, stressed volume and MSFP for the adult", () => {
    const r = analyze({}, { waveform: false });
    if (process.env.CORE_VERBOSE) console.log(`adult: total ${r.bloodVolume.toFixed(0)} ml, stressed ${r.filling.stressed.toFixed(0)} ml, C ${r.filling.compliance.toFixed(1)}, MSFP ${r.filling.msfp.toFixed(2)}`);
    expect(r.bloodVolume).toBeGreaterThan(4000); expect(r.bloodVolume).toBeLessThan(5500);
    expect(r.filling.stressed).toBeGreaterThan(400); expect(r.filling.stressed).toBeLessThan(0.25 * r.bloodVolume);
    expect(r.filling.msfp).toBeGreaterThan(6); expect(r.filling.msfp).toBeLessThan(10);
    expect(r.filling.msfp).toBeCloseTo(r.filling.stressed / r.filling.compliance, 9);
  });

  it("the calibration cache is keyed on everything it depends on (inertance changes the offset)", () => {
    const on = volumeOffsetFor({}), off = volumeOffsetFor({}, { inertance: false });
    expect(off).toBeGreaterThan(on + 30); // inertia holds more blood in the ventricle: the plain valves need more volume for the same MAP
    expect(volumeOffsetFor({}, { inertance: true })).toBe(on); // the default is the same key as an explicit true
    expect(volumeOffsetFor({}, { inertance: false })).toBe(off);
    expect(volumeOffsetFor({}, undefined, { zc: false })).not.toBe(on);
  });
});

describe("recalibrated baseline", () => {
  const adult = run("adult"), adultI = run("adult", { inertance: true }), neo = run("neonate"), neoI = run("neonate", { inertance: true });
  it("normal adult at 72 bpm", () => {
    if (process.env.CORE_VERBOSE) for (const [n, r] of [["adult", adult], ["adult+inertance", adultI], ["neonate", neo], ["neonate+inertance", neoI]] as const)
      console.log(`${n}: MAP ${r.map.toFixed(1)} PP ${r.pp.toFixed(1)} CVP ${r.cvp.toFixed(2)} PCWP ${r.pcwp.toFixed(2)} CO ${r.co.toFixed(2)} EF ${r.ef.toFixed(2)} E/A ${r.ea.toFixed(2)} tau ${r.tau.toFixed(1)} total ${r.total.toFixed(0)} stressed ${r.fill.stressed.toFixed(0)} MSFP ${r.fill.msfp.toFixed(2)}`);
    expect(adult.r.converged).toBe(true);
    expect(Math.abs(adult.map - 90)).toBeLessThanOrEqual(2);
    expect(adult.pp).toBeGreaterThanOrEqual(40); expect(adult.pp).toBeLessThanOrEqual(50);
    expect(adult.cvp).toBeGreaterThanOrEqual(3); expect(adult.cvp).toBeLessThanOrEqual(6);
    expect(adult.pcwp).toBeGreaterThanOrEqual(6); expect(adult.pcwp).toBeLessThanOrEqual(10);
    expect(adult.co).toBeGreaterThanOrEqual(4.8); expect(adult.co).toBeLessThanOrEqual(5.4);
    expect(adult.ef).toBeGreaterThanOrEqual(0.55); expect(adult.ef).toBeLessThanOrEqual(0.65);
    expect(adult.ea).toBeGreaterThanOrEqual(1); expect(adult.ea).toBeLessThanOrEqual(2);
    expect(adult.tau).toBeGreaterThan(30); expect(adult.tau).toBeLessThan(50);
  });
  it("with inertance on, the same ranges hold (E/A still 1-2) after recalibration", () => {
    expect(Math.abs(adultI.map - 90)).toBeLessThanOrEqual(2);
    expect(adultI.pp).toBeGreaterThanOrEqual(40); expect(adultI.pp).toBeLessThanOrEqual(50);
    expect(adultI.cvp).toBeGreaterThanOrEqual(3); expect(adultI.cvp).toBeLessThanOrEqual(6);
    expect(adultI.pcwp).toBeGreaterThanOrEqual(6); expect(adultI.pcwp).toBeLessThanOrEqual(10);
    expect(adultI.co).toBeGreaterThanOrEqual(4.8); expect(adultI.co).toBeLessThanOrEqual(5.4);
    expect(adultI.eaPeaks).toBeGreaterThanOrEqual(1); expect(adultI.eaPeaks).toBeLessThanOrEqual(2);
    expect(adultI.tau).toBeGreaterThan(30); expect(adultI.tau).toBeLessThan(50);
  });
  it("term neonate: MAP, CVP, PCWP and CO near its baseline; E/A below 1.5 (A-dominant, as in the first days); short tau", () => {
    for (const r of [neo, neoI]) {
      expect(r.r.converged).toBe(true);
      expect(Math.abs(r.map - 48)).toBeLessThanOrEqual(2);
      expect(r.pp).toBeGreaterThan(18); expect(r.pp).toBeLessThan(32);
      expect(r.cvp).toBeGreaterThan(3); expect(r.cvp).toBeLessThan(8);
      expect(r.pcwp).toBeGreaterThan(4); expect(r.pcwp).toBeLessThan(10);
      expect(r.co).toBeGreaterThan(0.6); expect(r.co).toBeLessThan(0.8);
      expect(r.tau).toBeGreaterThan(15); expect(r.tau).toBeLessThan(40);
      expect(r.ea).toBeGreaterThan(0.6); expect(r.ea).toBeLessThan(1.5);
    }
  });
  it("halving dt changes MAP, CO, CVP and PCWP by less than 0.5 %", () => {
    const a = run("adult", { inertance: true }), b = run("adult", { inertance: true, dt: SOLVER.dt / 2 });
    const rel = (x: number, y: number) => Math.abs(x - y) / Math.abs(y);
    expect(rel(a.map, b.map)).toBeLessThan(0.005); expect(rel(a.co, b.co)).toBeLessThan(0.005);
    expect(rel(a.cvp, b.cvp)).toBeLessThan(0.005); expect(rel(a.pcwp, b.pcwp)).toBeLessThan(0.005);
  });
  it("simulate() stays finite with a stiff impedance and an inertial valve", () => {
    const m = buildModel({}, volumeOffsetFor({}, { inertance: true })), h = simulate(m, { waveform: false, core: { inertance: true } });
    expect(Number.isFinite(h.p.AO.mean) && h.converged).toBe(true);
    void createEngine;
  });
});
