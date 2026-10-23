// B1: the pericardial sac on the full adult model (core/pericardium.ts). Set CORE_VERBOSE=1 to print the tables.
import { describe, it, expect } from "vitest";
import { buildModel, volumeOffsetFor } from "../src/physics/structural";
import { createEngine } from "../src/physics/core/engine";
import { fromModel, type FromModelOptions } from "../src/physics/core/fromModel";
import { BeatRecorder } from "../src/physics/core/recorder";
import { Pericardium } from "../src/physics/core/pericardium";
import { SOLVER } from "../src/config/structural";

type PeriOpt = NonNullable<FromModelOptions["pericardium"]>;
const HR = 72;
const log = (...a: unknown[]) => { if (process.env.CORE_VERBOSE) console.log(...a); };

/** Steady state of the adult model with the sac (or none), summarised over the last beat. */
function run(peri: PeriOpt | null, o: { dt?: number; beats?: { min: number; max: number }; wave?: boolean; setup?: (p: Pericardium) => void } = {}) {
  const m = buildModel({}, volumeOffsetFor({}));
  const g = fromModel(m, peri ? { pericardium: peri } : {});
  const eng = createEngine(g.nodes, g.elements, g.options);
  const dt = o.dt ?? SOLVER.dt, nSteps = Math.max(50, Math.round(m.T / dt));
  const rec = new BeatRecorder(eng, m.T, ["MV", "AV"], o.wave ? { dt: m.T / nSteps, every: 0.01, flows: [] } : undefined);
  const el = peri ? eng.element<Pericardium>("pericardium") : null;
  if (el) o.setup?.(el);
  // peak P_peri of the last complete beat
  let ppMax = 0, cur = 0, idx = 0; const off = eng.onSample((s) => {
    const k = Math.floor((s.t - 1e-9) / m.T); if (k !== idx) { ppMax = cur; cur = 0; idx = k; }
    const t = s.taps.pericardium; if (t) cur = Math.max(cur, t.pericardialPressure);
  });
  const old = SOLVER.dt; SOLVER.dt = dt;
  let r; try { r = eng.periodic(HR, o.beats ? { minBeats: o.beats.min, maxBeats: o.beats.max } : {}); } finally { SOLVER.dt = old; }
  off(); ppMax = el ? ppMax : 0;
  const b = rec.beat(), fv = eng.flowVolumes(); rec.dispose();
  const SV = fv.fwd.AV - fv.bwd.AV;
  return {
    eng, el, b, r, SV, CO: (SV * HR) / 1000, MAP: b.p.AO.mean, RA: b.p.RA.mean, RVEDP: b.p.RV.end, LA: b.p.LA.mean, LVEDP: b.p.LV.end, ppMax,
    spread: Math.max(b.p.RA.mean, b.p.RV.end, b.p.LA.mean, b.p.LV.end) - Math.min(b.p.RA.mean, b.p.RV.end, b.p.LA.mean, b.p.LV.end),
    blood: Array.from(eng.sample().V).reduce((a, x) => a + x, 0),
  };
}
type Run = ReturnType<typeof run>;
const f = (x: number) => x.toFixed(1);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const row = (x: Run) => [x.RA, x.RVEDP, x.LA, x.LVEDP, x.SV, x.CO, x.MAP].map(f).join("  ");

const base = run(null);

describe("pericardium: normal heart", () => {
  const n = run({});
  it("P_peri is small (0-3 mmHg) and the normal numbers barely change", () => {
    log(`normal: P_peri max ${n.ppMax.toFixed(2)} mmHg; base MAP ${f(base.MAP)} CO ${base.CO.toFixed(2)} RA ${f(base.RA)} LA ${f(base.LA)} -> MAP ${f(n.MAP)} CO ${n.CO.toFixed(2)} RA ${f(n.RA)} LA ${f(n.LA)}`);
    expect(n.ppMax).toBeGreaterThanOrEqual(0); expect(n.ppMax).toBeLessThan(3);
    for (const k of ["MAP", "CO", "RA", "LA"] as const) expect(rel(n[k], base[k])).toBeLessThan(0.03);
  });
  it("without the option there is no pericardium element", () => {
    expect(() => base.eng.element("pericardium")).toThrow();
  });
});

describe("pericardium: tamponade", () => {
  const steps = [0, 100, 200, 300].map((e) => ({ e, x: run({ effusionMl: e }) }));
  it("diastolic pressures rise and equalise, stroke volume and CO fall (table)", () => {
    log("effusion  RA  RVEDP  LA  LVEDP  SV  CO  MAP  P_peri(max)");
    for (const { e, x } of steps) log(`${e}  ${row(x)}  ${x.ppMax.toFixed(1)}`);
    for (let i = 1; i < steps.length; i++) {
      const a = steps[i - 1].x, b = steps[i].x;
      expect(b.RA).toBeGreaterThan(a.RA); expect(b.RVEDP).toBeGreaterThan(a.RVEDP); expect(b.LA).toBeGreaterThan(a.LA);
      expect(b.SV).toBeLessThan(a.SV); expect(b.CO).toBeLessThan(a.CO);
    }
    const t = steps[3].x;
    expect(t.spread).toBeLessThan(5); // equalisation of diastolic pressures
    expect(t.spread).toBeLessThan(steps[0].x.spread / 2);
    expect(t.SV).toBeLessThan(0.3 * steps[0].x.SV); expect(t.CO).toBeLessThan(0.3 * steps[0].x.CO);
    expect(t.MAP).toBeLessThan(0.5 * steps[0].x.MAP);
  });
  it("a rapid 200 ml effusion already cuts CO by more than a third", () => {
    expect(steps[2].x.CO).toBeLessThan(0.66 * steps[0].x.CO);
  });
  it("draining 200 ml (pericardiocentesis) restores most of the CO", () => {
    const out: Record<number, Run> = {};
    for (const d of [100, 150, 200]) out[d] = run({ effusionMl: 300 }, { setup: (p) => p.drain(d) });
    log("drain  effusion  CO  (tamponade CO " + steps[3].x.CO.toFixed(2) + ", normal " + base.CO.toFixed(2) + ")");
    for (const d of [100, 150, 200]) log(`${d}  ${f(out[d].el!.effusionMl)}  ${out[d].CO.toFixed(2)}`);
    expect(out[200].el!.effusionMl).toBeCloseTo(100, 6);
    expect(out[200].CO).toBeGreaterThan(0.75 * base.CO);
    expect(out[200].CO).toBeGreaterThan(out[150].CO); expect(out[150].CO).toBeGreaterThan(out[100].CO);
    expect(out[100].CO).toBeGreaterThan(2 * steps[3].x.CO);
  });
  it("drain removes at most what is there", () => {
    const x = run({ effusionMl: 50 }, { setup: (p) => p.drain(500) });
    expect(x.el!.effusionMl).toBe(0);
    expect(rel(x.CO, run({ effusionMl: 0 }).CO)).toBeLessThan(0.005);
  });
});

describe("pericardium: slow versus fast", () => {
  it("the same effusion added slowly with adaptation gives lower P_peri and higher CO than added at once", () => {
    const slow = run({ effusionMl: 0, effusionRateMlS: 3, adaptTauS: 20 }, { beats: { min: 90, max: 90 } });
    const final = slow.el!.effusionMl;
    const fast = run({ effusionMl: final, adaptTauS: 20 }, { beats: { min: 6, max: 6 } });
    log(`slow: effusion ${f(final)} ml; P_peri ${slow.ppMax.toFixed(1)} CO ${slow.CO.toFixed(2)} | fast: P_peri ${fast.ppMax.toFixed(1)} CO ${fast.CO.toFixed(2)}`);
    expect(final).toBeGreaterThan(200);
    expect(slow.ppMax).toBeLessThan(fast.ppMax);
    expect(slow.CO).toBeGreaterThan(fast.CO);
  });
});

describe("pericardium: constriction", () => {
  const c = run({ stiffness: 4 }, { wave: true });
  it("stiffness x4 with no effusion raises diastolic pressures and moves RV and LV together", () => {
    log(`constriction x4: ${row(c)} (normal ${row(base)}), RVEDP/LVEDP ${f(c.RVEDP / c.LVEDP)} vs ${f(base.RVEDP / base.LVEDP)}`);
    expect(c.RVEDP).toBeGreaterThan(base.RVEDP + 2); expect(c.LVEDP).toBeGreaterThan(base.LVEDP + 2);
    expect(c.RVEDP / c.LVEDP).toBeGreaterThan(base.RVEDP / base.LVEDP);
    expect(c.CO).toBeGreaterThan(0.9 * base.CO);
  });
  it("stiffness 4 narrows the RV-LV end-diastolic gap, and 10 nearly closes it", () => {
    const gap = (x: Run) => x.LVEDP - x.RVEDP, c10 = run({ stiffness: 10 });
    log(`EDP gap (LVEDP-RVEDP): normal ${f(gap(base))}, x4 ${f(gap(c))}, x10 ${f(gap(c10))}`);
    expect(gap(c)).toBeLessThan(gap(base)); expect(gap(c)).toBeLessThan(5);
    expect(gap(c10)).toBeLessThan(2.5);
  });
  it("RV pressure waveform (reported): early-diastolic dip then rise to a plateau", () => {
    const w = c.b.wave!, pv = w.p.RV, t = w.t;
    const sys = pv.indexOf(Math.max(...pv)), early = pv.slice(sys, sys + Math.floor(pv.length * 0.4));
    const dip = Math.min(...early), end = pv[pv.length - 1];
    log(`RV: peak ${f(pv[sys])}, early-diastolic min ${f(dip)}, end-diastolic ${f(end)} (beat ${t.length} points)`);
    expect(Number.isFinite(dip)).toBe(true);
  });
});

describe("pericardium: stiffness sweep", () => {
  it("is stable from 1 to 10: finite, bounded, converged, CO falls smoothly", () => {
    const sweep = [1, 2, 4, 6, 8, 10].map((s) => ({ s, x: run({ stiffness: s }) }));
    log("stiffness  RA RVEDP LA LVEDP SV CO MAP");
    for (const { s, x } of sweep) log(`${s}  ${row(x)}  P_peri ${x.ppMax.toFixed(1)}`);
    for (const { x } of sweep) { for (const v of [x.MAP, x.CO, x.RA, x.RVEDP, x.LA, x.LVEDP, x.ppMax]) expect(Number.isFinite(v)).toBe(true); expect(x.r.converged).toBe(true); expect(x.ppMax).toBeLessThan(60); }
    for (let i = 1; i < sweep.length; i++) expect(sweep[i].x.CO).toBeLessThanOrEqual(sweep[i - 1].x.CO + 0.01);
    expect(sweep[0].x.CO).toBeCloseTo(base.CO, 1);
  });
  it("halving dt at stiffness 10 (and 6) changes MAP, CO and the end-diastolic pressures by less than 0.5 %", () => {
    for (const s of [6, 10]) {
      const a = run({ stiffness: s }), b = run({ stiffness: s }, { dt: SOLVER.dt / 2 });
      for (const k of ["MAP", "CO", "RA", "LA", "LVEDP", "RVEDP"] as const) expect(rel(a[k], b[k]), `${k} at ${s}`).toBeLessThan(0.005);
    }
  });
});

describe("pericardium: open and numerics", () => {
  it("open removes the effect of a large effusion", () => {
    const o = run({ effusionMl: 300, open: true });
    for (const k of ["MAP", "CO", "RA", "LA"] as const) expect(rel(o[k], base[k])).toBeLessThan(0.03);
    expect(o.ppMax).toBe(0);
  });
  it("blood volume is conserved (the effusion is not blood)", () => {
    expect(rel(run({ effusionMl: 200 }).blood, base.blood)).toBeLessThan(1e-6);
  });
  it("halving dt changes MAP, CO and the tamponade pressures by less than 0.5 %", () => {
    const a = run({ effusionMl: 150 }), b = run({ effusionMl: 150 }, { dt: SOLVER.dt / 2 });
    for (const k of ["MAP", "CO", "RA", "LA", "LVEDP"] as const) expect(rel(a[k], b[k]), k).toBeLessThan(0.005);
  });
  it("no NaN up to 600 ml, and with stiffness 4 and 300 ml", () => {
    for (const p of [{ effusionMl: 600 }, { effusionMl: 300, stiffness: 4 }]) {
      const x = run(p);
      for (const v of [x.MAP, x.CO, x.RA, x.RVEDP, x.LA, x.LVEDP, x.ppMax]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
