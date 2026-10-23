// The core engine against the structural solver it replaced (A1, A2). The reference is tests/fixtures/core-reference.json, the
// output of the old hand-written RK4 loop, frozen by tests/fixtures/core-reference.ts. simulate() itself now runs on the core.
import { describe, it, expect } from "vitest";
import { buildModel, simulate, volumeOffsetFor, LEGACY_BUILD, NODES, type StructuralSpec } from "../src/physics/structural";
import { createEngine } from "../src/physics/core/engine";
import { atrialDuration, Compliance, ElastanceChamber } from "../src/physics/core/chamber";
import { InertialResistor, InertialValve, inertance, OneWayValve, Resistor } from "../src/physics/core/valves";
import { defaultPr as defaultPrFor, engineFromModel, fromModel, type FromModelOptions } from "../src/physics/core/fromModel";
import { BeatRecorder, relaxationTau } from "../src/physics/core/recorder";
import { GORLIN, SOLVER } from "../src/config/structural";
import type { Element, Engine, ExternalGroup, HeartEvent, Rates, Ctx } from "../src/physics/core/types";
import { REFERENCE_CASES } from "./fixtures/core-reference";
import reference from "./fixtures/core-reference.json";

const REL = 0.005, FLOOR = 0.05; // 0.5 % relative, 0.05 mmHg / ml absolute
type Stat = Record<"min" | "max" | "mean" | "end", number>;
type Ref = { beats: number; converged: boolean; p: Record<string, Stat>; vol: Record<string, Stat>; fwd: Record<string, number>; bwd: Record<string, number>; valves: Record<string, Record<string, number>>; volume: number; wave?: { t: number[]; p: Record<string, number[]>; vLV: number[]; vRV: number[]; vLA: number[]; vRA: number[]; q: Record<string, number[]> } };
const REF = reference as unknown as Record<string, Ref>;

/**
 * The activation of the old loop that produced the frozen reference: plain ventricular curve (relaxScale 1), the atrium as
 * `buildModel` designed it (atrial drive factor 1), and the atrial event leading the ventricular one by ta + 0.06 + 0.08·T. A4 and A5
 * changed the defaults (relaxation, atrial drive, PR, impedance Zc, unstressed volume, the splanchnic node, atrial pressures); the
 * reference cannot be regenerated, so it is compared on this pinned configuration: `LEGACY` for the engine, `LEGACY_BUILD` for the model.
 */
const LEGACY: FromModelOptions = { relaxScale: 1, pr: (T) => atrialDuration(T) + 0.06 + 0.08 * T };

/** simulate() on one case against the frozen reference. Returns the mismatches and the largest relative difference seen. */
function compare(id: string, spec: StructuralSpec) {
  const m = buildModel(spec, volumeOffsetFor(spec, LEGACY, LEGACY_BUILD), LEGACY_BUILD), got = simulate(m, { core: LEGACY }), want = REF[id];
  const NODES_REF = NODES.filter((n) => n in want.p); // the reference predates the splanchnic node (SPL); in the pinned model it is empty and unconnected
  const bad: string[] = []; let worst = { rel: 0, where: "" };
  const cmp = (label: string, w: number, g: number) => {
    const rel = Math.abs(g - w) / Math.max(Math.abs(w), 1e-12);
    if (!(Math.abs(g - w) <= Math.max(REL * Math.abs(w), FLOOR))) bad.push(`${label}: reference ${w}, core ${g}`);
    if (Math.abs(g - w) > 1e-9 && rel > worst.rel) worst = { rel, where: label };
  };
  expect(got.beats, "beats").toBe(want.beats);
  expect(got.converged, "converged").toBe(want.converged);
  for (const n of NODES_REF) for (const f of ["min", "max", "mean", "end"] as const) cmp(`p.${n}.${f}`, want.p[n][f], got.p[n][f]);
  for (const n of ["RA", "RV", "LA", "LV"] as const) for (const f of ["min", "max", "mean", "end"] as const) cmp(`vol.${n}.${f}`, want.vol[n][f], got.vol[n][f]);
  for (const e of m.edges) { cmp(`fwd.${e.name}`, want.fwd[e.name], got.fwd[e.name]); cmp(`bwd.${e.name}`, want.bwd[e.name], got.bwd[e.name]); }
  for (const [name, w] of Object.entries(want.valves)) for (const f of Object.keys(w)) cmp(`valve.${name}.${f}`, w[f], (got.valves[name] as unknown as Record<string, number>)[f]);
  expect(Object.keys(got.valves).sort()).toEqual(Object.keys(want.valves).sort());
  cmp("volume", want.volume, got.volume);
  if (want.wave) {
    const w = want.wave, g = got.wave;
    expect(g.t.length, "wave samples").toBe(w.t.length);
    expect(Math.max(...g.t.map((t, i) => Math.abs(t - w.t[i]))), "wave time grid").toBeLessThan(1e-3);
    // compare waveforms by their largest excursion from the reference, against the signal's range
    const series: [string, number[], number[]][] = [...NODES_REF.map((n) => [`p.${n}`, w.p[n], g.p[n]] as [string, number[], number[]]),
      ["vLV", w.vLV, g.vLV], ["vRV", w.vRV, g.vRV], ["vLA", w.vLA, g.vLA], ["vRA", w.vRA, g.vRA], ...Object.keys(w.q).map((k) => [`q.${k}`, w.q[k], g.q[k]] as [string, number[], number[]])];
    for (const [label, a, b] of series) {
      const range = Math.max(...a) - Math.min(...a), err = Math.max(...a.map((x, i) => Math.abs(x - b[i])));
      if (!(err <= Math.max(0.01 * range, FLOOR))) bad.push(`wave ${label}: max difference ${err} on a range of ${range}`);
    }
  }
  return { bad, worst };
}

describe("simulate() on the core reproduces the old structural solver (pinned legacy activation)", () => {
  for (const [id, spec] of REFERENCE_CASES) {
    it(`${id}: pressures, volumes, edge volumes, valve stats and waveform within 0.5 %`, () => {
      const { bad, worst } = compare(id, spec);
      if (process.env.CORE_VERBOSE) console.log(`${id}: worst ${worst.rel.toExponential(2)} at ${worst.where}`);
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }
});

describe("core engine mechanics", () => {
  /** Two compliances joined by a resistor: ΔP decays with τ = R·C1·C2/(C1+C2). */
  const pair = (V1: number, C1: number, C2: number, R: number): Engine => createEngine(
    [{ name: "a", model: new Compliance("a", C1), group: "none", start: V1 }, { name: "b", model: new Compliance("b", C2), group: "none", start: 0 }],
    [new Resistor("r", 0, 1, R)]);

  it("equalises with the analytical time constant", () => {
    const C1 = 2, C2 = 3, R = 0.5, tau = (R * C1 * C2) / (C1 + C2), V1 = 100, eng = pair(V1, C1, C2, R);
    const dP0 = V1 / C1;
    for (let i = 0; i < 400; i++) {
      eng.step(0.005);
      const s = eng.sample(), want = dP0 * Math.exp(-eng.t / tau);
      expect(Math.abs(s.P[0] - s.P[1])).toBeCloseTo(want, 6);
    }
  });

  it("conserves volume to 1e-9 relative", () => {
    const eng = pair(100, 2, 3, 0.5);
    for (let i = 0; i < 300; i++) { eng.step(0.01); const s = eng.sample(); expect(Math.abs(s.V[0] + s.V[1] - 100) / 100).toBeLessThan(1e-9); }
  });

  it("delivers an event scheduled mid-step exactly at its time, and never steps across it", () => {
    const seen: { at: number; ev: HeartEvent }[] = []; const stops: number[] = [];
    const probe: Element = { name: "probe", onEvent: (ev) => seen.push({ at: eng.t, ev }) };
    const eng = createEngine([{ name: "a", model: new Compliance("a", 1), group: "none", start: 10 }], [probe]);
    eng.onSample((s) => stops.push(s.t));
    eng.schedule({ kind: "atrial", t: 0.0371 }); eng.schedule({ kind: "ventricular", t: 0.0123 });
    eng.step(0.05);
    expect(seen.map((x) => x.ev.kind)).toEqual(["ventricular", "atrial"]);
    expect(seen[0].at).toBeCloseTo(0.0123, 12); expect(seen[1].at).toBeCloseTo(0.0371, 12);
    expect(stops.map((t) => +t.toFixed(12))).toEqual([0.0123, 0.0371, 0.05]);
    expect(eng.t).toBeCloseTo(0.05, 12);
  });

  it("keeps a later event pending when the step ends before it", () => {
    const seen: number[] = [];
    const eng = createEngine([{ name: "a", model: new Compliance("a", 1), group: "none", start: 10 }], [{ name: "probe", onEvent: () => seen.push(eng.t) }]);
    eng.schedule({ kind: "ventricular", t: 0.1 });
    eng.step(0.05); expect(seen).toEqual([]);
    eng.step(0.06); expect(seen[0]).toBeCloseTo(0.1, 12);
  });
});

// ---- A3: external pressure, volume shift, inertance -------------------------------------------------------------------

/** A field that adds a constant external pressure to the given nodes (what the pericardium will do with a real law). */
const constantPressure = (name: string, p: number, ids: number[]): Element => ({ name, field: (_c: Ctx, out: Rates) => { for (const i of ids) out.addExternal(i, p); } });
const idsOf = (nodes: readonly { group: ExternalGroup }[], group: ExternalGroup) => nodes.map((n, i) => (n.group === group ? i : -1)).filter((i) => i >= 0);
const adult = () => buildModel({}, volumeOffsetFor({}));
const GROUP_OF = { SVC: "thoracic", IVC: "abdominal", RA: "pericardial", RV: "pericardial", PA: "thoracic", PV: "thoracic", LA: "pericardial", LV: "pericardial", AO: "thoracic", DAO: "abdominal", SPL: "abdominal" } as const;

/** Last beat of a periodic run on the adult model (optionally at another rate, step, or with inertance), with extra elements added to the graph. */
function lastBeat(extra: (nodes: { group: ExternalGroup }[]) => Element[], opts: { inertance?: boolean; dt?: number; hr?: number; relaxScale?: number; pr?: number; tol?: number } = {}) {
  const m = opts.hr ? buildModel({ hr: opts.hr }, volumeOffsetFor({})) : adult(), g = fromModel(m, { inertance: opts.inertance, relaxScale: opts.relaxScale });
  const eng = createEngine(g.nodes, [...g.elements, ...extra(g.nodes)], g.options);
  const dt = opts.dt ?? SOLVER.dt, nSteps = Math.max(50, Math.round(m.T / dt));
  const rec = new BeatRecorder(eng, m.T, ["MV", "AV"], { dt: m.T / nSteps, every: 0.002, flows: ["MV", "AV"] });
  const old = SOLVER.dt; SOLVER.dt = dt;
  let run; try { run = eng.periodic(m.hr, { pr: opts.pr, tol: opts.tol }); } finally { SOLVER.dt = old; }
  const b = rec.beat(); rec.dispose();
  return { m, eng, b, run, fv: eng.flowVolumes() };
}

/** Local maxima of a flow trace that stand out from the trough between them by at least `prom` ml/s. */
const peaks = (a: number[], prom: number) => {
  const out: number[] = []; let lo = a[0], hi = a[0], hiAt = 0, rising = true;
  for (let i = 1; i < a.length; i++) {
    if (rising) { if (a[i] > hi) { hi = a[i]; hiAt = i; } else if (hi - a[i] > prom) { out.push(hiAt); rising = false; lo = a[i]; } }
    else if (a[i] < lo) lo = a[i]; else if (a[i] - lo > prom) { rising = true; hi = a[i]; hiAt = i; }
  }
  if (rising && hi - lo > prom) out.push(hiAt);
  return out;
};

describe("external pressure and volume shift", () => {
  it("fromModel puts the four chambers in the pericardial group and the vessels in thoracic or abdominal groups", () => {
    const g = fromModel(adult());
    for (const n of g.nodes) expect(n.group, n.name).toBe(GROUP_OF[n.name as keyof typeof GROUP_OF]);
  });

  it("a constant external pressure on the pericardial group raises every chamber's pressure by exactly that amount at equal volume", () => {
    const g = fromModel(adult()), ids = idsOf(g.nodes, "pericardial");
    const base = createEngine(g.nodes, g.elements, g.options).sample();
    const g2 = fromModel(adult());
    const s = createEngine(g2.nodes, [...g2.elements, constantPressure("pericardium", 4, idsOf(g2.nodes, "pericardial"))], g2.options).sample();
    expect(ids).toHaveLength(4);
    g.nodes.forEach((n, i) => {
      expect(s.V[i]).toBe(base.V[i]);
      expect(s.P[i] - base.P[i], n.name).toBeCloseTo(ids.includes(i) ? 4 : 0, 9);
      expect(s.Pext[i]).toBe(ids.includes(i) ? 4 : 0);
    });
  });

  it("on the full adult model, pericardial pressure lowers ventricular filling and stroke volume", () => {
    const base = lastBeat(() => []), sq = lastBeat((nodes) => [constantPressure("pericardium", 6, idsOf(nodes, "pericardial"))]);
    expect(base.run.converged && sq.run.converged).toBe(true);
    if (process.env.CORE_VERBOSE) console.log(`pericardium +6: LVEDV ${base.b.v.LV.max.toFixed(1)} -> ${sq.b.v.LV.max.toFixed(1)}, SV ${(base.fv.fwd.AV - base.fv.bwd.AV).toFixed(1)} -> ${(sq.fv.fwd.AV - sq.fv.bwd.AV).toFixed(1)}`);
    expect(sq.b.v.LV.max, "LV end-diastolic volume").toBeLessThan(base.b.v.LV.max - 3);
    expect(sq.b.v.RV.max, "RV end-diastolic volume").toBeLessThan(base.b.v.RV.max - 3);
    expect(sq.fv.fwd.AV - sq.fv.bwd.AV, "stroke volume").toBeLessThan(base.fv.fwd.AV - base.fv.bwd.AV - 2);
  });

  it("shiftVolume of +dV on a linear compliance raises its pressure by dV/C and leaves the blood volume unchanged", () => {
    const C = 2.5, dV = 12, shifter: Element = { name: "shift", field: (_c, out) => out.shiftVolume(0, dV) };
    const mk = (extra: Element[]) => createEngine([{ name: "a", model: new Compliance("a", C), group: "none", start: 50 }], extra);
    const s0 = mk([]).sample(), eng = mk([shifter]), s1 = eng.sample();
    expect(s1.P[0] - s0.P[0]).toBeCloseTo(dV / C, 12);
    expect(s1.V[0]).toBe(50);
    eng.step(0.1); // nothing flows out of a lone node: the volume stays put
    expect(eng.sample().V[0]).toBe(50);
  });
});

describe("inertial edge", () => {
  /** Two compliances so large that the pressure difference stays at dP. */
  const hold = (dP: number, edge: (a: number, b: number) => Element) => {
    const C = 1e6;
    return createEngine([{ name: "a", model: new Compliance("a", C), group: "none", start: dP * C }, { name: "b", model: new Compliance("b", C), group: "none", start: 0 }], [edge(0, 1)]);
  };

  /** Advance in steps of 0.5 ms (one `step` is one RK4 step). */
  const run = (eng: Engine, seconds: number) => { for (let i = 0; i < Math.round(seconds / 0.0005); i++) eng.step(0.0005); };

  it("InertialResistor follows L dQ/dt = dP - R Q: Q(t) = dP/R (1 - exp(-R t / L))", () => {
    const R = 0.05, L = 0.01, dP = 10, eng = hold(dP, (a, b) => new InertialResistor("ir", a, b, R, L));
    for (let i = 0; i < 100; i++) {
      eng.step(0.002);
      expect(eng.sample().q.ir / ((dP / R) * (1 - Math.exp((-R * eng.t) / L)))).toBeCloseTo(1, 5);
    }
  });

  it("inertance(l, A) = rho l / A / 1333.2 mmHg s^2/ml", () => {
    expect(inertance(3, 5)).toBeCloseTo((1.06 * 3) / 5 / 1333.2, 12);
  });

  it("InertialValve settles on the Gorlin law forward and through the regurgitant area backward, and stays closed without one", () => {
    const A = 4, reg = 0.2;
    for (const dP of [4, 25]) {
      const eng = hold(dP, (a, b) => new InertialValve("v", a, b, A, reg, inertance(3, A)));
      run(eng, 0.5);
      expect(eng.sample().q.v / (GORLIN * A * Math.sqrt(dP))).toBeCloseTo(1, 3);
      const back = hold(-dP, (a, b) => new InertialValve("v", a, b, A, reg, inertance(3, A)));
      run(back, 0.5);
      expect(back.sample().q.v / (-GORLIN * reg * Math.sqrt(dP))).toBeCloseTo(1, 3);
    }
    const closed = hold(-30, (a, b) => new InertialValve("v", a, b, A, 0, inertance(3, A)));
    for (let i = 0; i < 400; i++) { closed.step(0.0005); const s = closed.sample(); expect(s.q.v).toBe(0); expect(s.taps.v.Q).toBe(0); }
  });

  it("InertialValve without regurgitation opens again when the pressure turns", () => {
    const A = 3, L = inertance(2, A), C = 1e6, dP = 9;
    const eng = createEngine([{ name: "a", model: new Compliance("a", C), group: "none", start: -dP * C }, { name: "b", model: new Compliance("b", C), group: "none", start: 0 }], [new InertialValve("v", 0, 1, A, 0, L)]);
    run(eng, 0.2); expect(eng.sample().q.v).toBe(0);
    const flipped = createEngine([{ name: "a", model: new Compliance("a", C), group: "none", start: dP * C }, { name: "b", model: new Compliance("b", C), group: "none", start: 0 }], [new InertialValve("v", 0, 1, A, 0, L)]);
    run(flipped, 0.5); expect(flipped.sample().q.v / (GORLIN * A * Math.sqrt(dP))).toBeCloseTo(1, 3);
  });
});

describe("valve inertance in the adult model", () => {
  it("is off by default: the four cardiac valves are plain Gorlin valves with no extra states", () => {
    const g = fromModel(adult());
    for (const e of g.elements) expect(e.states, e.name).toBeUndefined();
    for (const n of ["TV", "PVL", "MV", "AV"]) expect(g.elements.find((e) => e.name === n)).toBeInstanceOf(OneWayValve);
    const on = fromModel(adult(), { inertance: true });
    for (const n of ["TV", "PVL", "MV", "AV"]) expect(on.elements.find((e) => e.name === n)).toBeInstanceOf(InertialValve);
    expect(on.elements.find((e) => e.name === "RVAO")).toBeInstanceOf(OneWayValve);
    expect(engineFromModel(adult()).sample().V.length).toBe(NODES.length);
  });

  const withI = lastBeat(() => [], { inertance: true });
  const wave = withI.b.wave!, t = wave.t, q = wave.q.MV, dp = wave.p.LA.map((x, i) => x - wave.p.LV[i]);
  const argmax = (a: number[]) => a.reduce((k, x, i) => (x > a[k] ? i : k), 0);

  it("converges to a periodic state near the usual pressures", () => {
    expect(withI.run.converged).toBe(true);
    expect(withI.b.p.AO.mean).toBeGreaterThan(85);
    expect(withI.b.p.AO.mean).toBeLessThan(100);
  });

  it("mitral flow lags the LA-LV gradient: it peaks after the gradient and continues after the gradient reverses", () => {
    const late = dp.map((x, i) => (t[i] > 0.3 ? x : -Infinity)); // diastole of the beat (the ventricle ejects before 0.3 s)
    const iD = argmax(late), iQ = argmax(q), lagMs = (t[iQ] - t[iD]) * 1000;
    let iR = iD; while (iR < dp.length && dp[iR] > 0) iR++; // the gradient reverses
    let iC = iR; while (iC < q.length && t[iC] < t[iR] + 0.04) iC++; // 40 ms after the reversal
    if (process.env.CORE_VERBOSE) console.log(`MV: peak gradient ${dp[iD].toFixed(2)} mmHg at ${(t[iD] * 1000).toFixed(0)} ms, peak flow ${q[iQ].toFixed(0)} ml/s at ${(t[iQ] * 1000).toFixed(0)} ms (lag ${lagMs.toFixed(0)} ms); gradient reverses at ${(t[iR] * 1000).toFixed(0)} ms, ${q[iR].toFixed(0)} ml/s at reversal, ${q[iC].toFixed(0)} ml/s 40 ms later`);
    expect(lagMs).toBeGreaterThan(10);
    expect(q[iR]).toBeGreaterThan(20); // still flowing against a reversed gradient
    expect(q[iC]).toBeGreaterThan(20); // and for at least 40 ms
    // without inertance flow follows the gradient at once: no flow once the gradient is clearly reversed
    const plain = lastBeat(() => []).b.wave!, pq = plain.q.MV, pd = plain.p.LA.map((x, i) => x - plain.p.LV[i]);
    for (let i = 0; i < pq.length; i++) if (pd[i] < -0.05) expect(pq[i], `plain valve at ${plain.t[i]}`).toBe(0);
  });

  it("at 72 bpm mitral inflow has a distinct E and A wave, E > A, E/A between 1 and 2, and a normal tau", () => {
    const ps = peaks(q, 15).filter((i) => t[i] > 0.05); // a peak in the first ms is the tail of the previous beat's A wave
    if (process.env.CORE_VERBOSE) console.log(`72 bpm: MV peaks at ${ps.map((i) => `${(t[i] * 1000).toFixed(0)} ms ${q[i].toFixed(0)} ml/s`).join(", ")}; tau LV ${withI.b.tauMs.LV.toFixed(1)} ms, RV ${withI.b.tauMs.RV.toFixed(1)} ms`);
    expect(ps).toHaveLength(2);
    const [E, A] = ps.map((i) => q[i]), trough = Math.min(...q.slice(ps[0], ps[1] + 1));
    expect(E).toBeGreaterThan(A);
    expect(E / A).toBeGreaterThan(1); expect(E / A).toBeLessThan(2);
    expect(trough, "flow dips between the waves").toBeLessThan(0.85 * A);
    expect(withI.b.tauMs.LV).toBeGreaterThan(30); expect(withI.b.tauMs.LV).toBeLessThan(50);
  });

  it("at 60 bpm mitral inflow has an early (E) and an atrial (A) wave, E > A", () => {
    const slow = lastBeat(() => [], { inertance: true, hr: 60 }), w = slow.b.wave!, ps = peaks(w.q.MV, 15);
    if (process.env.CORE_VERBOSE) console.log(`60 bpm: MV peaks at ${ps.map((i) => `${(w.t[i] * 1000).toFixed(0)} ms ${w.q.MV[i].toFixed(0)} ml/s`).join(", ")}`);
    expect(slow.run.converged).toBe(true);
    expect(ps).toHaveLength(2);
    const [E, A] = ps.map((i) => w.q.MV[i]);
    expect(E).toBeGreaterThan(A);
    expect(A).toBeGreaterThan(20);
  });

  it("halving dt changes mean AO pressure, cardiac output, LVEDP and tau by less than 0.5 %", () => {
    const a = lastBeat(() => [], { inertance: true, dt: SOLVER.dt }), b = lastBeat(() => [], { inertance: true, dt: SOLVER.dt / 2 });
    const co = (r: typeof a) => (r.fv.fwd.AV - r.fv.bwd.AV) * r.m.hr;
    const rel = (x: number, y: number) => Math.abs(x - y) / Math.abs(y);
    if (process.env.CORE_VERBOSE) console.log(`dt halving: AO ${rel(a.b.p.AO.mean, b.b.p.AO.mean).toExponential(2)}, CO ${rel(co(a), co(b)).toExponential(2)}, LVEDP ${rel(a.b.p.LV.end, b.b.p.LV.end).toExponential(2)}`);
    expect(rel(a.b.p.AO.mean, b.b.p.AO.mean)).toBeLessThan(0.005);
    expect(rel(co(a), co(b))).toBeLessThan(0.005);
    expect(rel(a.b.p.LV.end, b.b.p.LV.end)).toBeLessThan(0.005);
    if (process.env.CORE_VERBOSE) console.log(`dt halving: tau ${rel(a.b.tauMs.LV, b.b.tauMs.LV).toExponential(2)}`);
    expect(rel(a.b.tauMs.LV, b.b.tauMs.LV)).toBeLessThan(0.005);
  });
});

describe("simulate() waveform option", () => {
  it("waveform: false skips the capture, returns empty arrays in the same shape and leaves the numbers unchanged", () => {
    const m = adult(), full = simulate(m), lean = simulate(m, { waveform: false });
    expect(lean.wave.t).toEqual([]);
    expect(Object.keys(lean.wave.p).sort()).toEqual([...NODES].sort());
    expect(lean.wave.q.MV).toEqual([]);
    expect(lean.p.AO).toEqual(full.p.AO);
    expect(lean.volume).toBe(full.volume);
  });
});

// ---- A4: activation driven by beats, relaxation -----------------------------------------------------------------------

const VENT = { v0: 10, ees: 2, a: 0.5, b: 0.04 };
const ventricle = (relaxScale = 1, T = 0.833) => new ElastanceChamber("v", { ...VENT, relaxScale }, "ventricular", T);

describe("chamber activation from events", () => {
  it("depends on the time since the event only: the same events at any absolute time give the same curve", () => {
    const a = ventricle(), b = ventricle();
    a.onEvent({ kind: "ventricular", t: 0 }); b.onEvent({ kind: "ventricular", t: 17.3 });
    for (const dt of [0.05, 0.2, 0.4, 0.6, 0.8]) expect(b.activation(17.3 + dt)).toBeCloseTo(a.activation(dt), 12);
  });

  it("at a steady rate a later beat equals the first (the default interval is the steady RR), with peak 1", () => {
    const c = ventricle(); c.onEvent({ kind: "ventricular", t: 0 });
    const first = [0.1, 0.3, 0.5].map((x) => c.activation(x)); c.onEvent({ kind: "ventricular", t: 0.833 });
    [0.1, 0.3, 0.5].forEach((x, i) => expect(c.activation(0.833 + x)).toBeCloseTo(first[i], 9));
    let top = 0; for (let x = 0; x < 0.833; x += 0.001) top = Math.max(top, c.activation(0.833 + x));
    expect(top).toBeCloseTo(1, 3);
  });

  it("a shorter preceding RR gives a shorter contraction (QT-like rate rule)", () => {
    const slow = ventricle(), fast = ventricle();
    slow.onEvent({ kind: "ventricular", t: 0 }); slow.onEvent({ kind: "ventricular", t: 1.0 });
    fast.onEvent({ kind: "ventricular", t: 0 }); fast.onEvent({ kind: "ventricular", t: 0.5 });
    // 0.45 s after the event the short-RR beat has relaxed, the long-RR one is still contracting
    expect(fast.activation(0.5 + 0.45)).toBeLessThan(0.1);
    expect(slow.activation(1.0 + 0.45)).toBeGreaterThan(0.5);
  });

  it("atrial duration follows the preceding atrial interval", () => {
    const c = new ElastanceChamber("a", VENT, "atrial", 0.833);
    c.onEvent({ kind: "atrial", t: 0 }); c.onEvent({ kind: "atrial", t: 0.5 });
    const ta = atrialDuration(0.5);
    expect(ta).toBeLessThan(atrialDuration(0.833));
    expect(c.activation(0.5 + ta / 2)).toBeCloseTo(1, 9);
    expect(c.activation(0.5 + ta + 1e-3)).toBe(0);
  });

  it("relaxScale stretches only the falling limb: same rise and peak, the fall is the plain one stretched in time; 1 is the plain curve", () => {
    const plain = ventricle(1), slow = ventricle(1.5);
    plain.onEvent({ kind: "ventricular", t: 0 }); slow.onEvent({ kind: "ventricular", t: 0 });
    const tPeak = plain.peakTime;
    expect(tPeak).toBeGreaterThan(0.2); expect(tPeak).toBeLessThan(0.4);
    for (let x = 0; x <= tPeak; x += 0.01) expect(slow.activation(x)).toBeCloseTo(plain.activation(x), 12);
    for (const x of [0.05, 0.1, 0.15]) {
      expect(slow.activation(tPeak + 1.5 * x)).toBeCloseTo(plain.activation(tPeak + x), 9);
      expect(slow.activation(tPeak + x)).toBeGreaterThan(plain.activation(tPeak + x));
    }
  });
});

describe("relaxation time constant", () => {
  it("recovers tau from an exponential pressure fall between dP/dt min and valve opening", () => {
    const tau = 0.04, n = 600, t = Array.from({ length: n }, (_, i) => i * 0.0005);
    const pv = t.map((x) => (x < 0.05 ? 120 - 800 * x * x : 118 * Math.exp(-(x - 0.05) / tau)));
    const pa = t.map(() => 6);
    const got = relaxationTau(t, pv, pa) * 1000;
    expect(got).toBeGreaterThan(0.9 * tau * 1000);
    expect(got).toBeLessThan(1.1 * tau * 1000);
  });
});

describe("events drive the engine", () => {
  const T = 60 / 72;
  const fresh = () => {
    const g = fromModel(adult(), { inertance: true }), eng = createEngine(g.nodes, g.elements, g.options);
    return { eng, rec: new BeatRecorder(eng, T, ["MV", "AV"]) };
  };
  /** Advance to absolute time `to` in solver steps. */
  const advanceTo = (eng: Engine, to: number) => { while (to - eng.t > 1e-9) eng.step(Math.min(SOLVER.dt, to - eng.t)); };
  /** Stroke volume (AV forward minus backward) after each ventricular event, running the given events from the start. */
  function strokeVolumes(ventTimes: number[], atrialTimes: number[], end: number) {
    const { eng } = fresh();
    for (const t of ventTimes) eng.schedule({ kind: "ventricular", t });
    for (const t of atrialTimes) eng.schedule({ kind: "atrial", t });
    const sv: number[] = [];
    for (let i = 0; i < ventTimes.length; i++) {
      advanceTo(eng, ventTimes[i]); eng.resetFlowVolumes();
      advanceTo(eng, i + 1 < ventTimes.length ? ventTimes[i + 1] : end);
      const fv = eng.flowVolumes(); sv.push(fv.fwd.AV - fv.bwd.AV);
    }
    return sv;
  }
  const pr = defaultPrFor(T);

  it("regular events driven by hand reproduce periodic(): same beat means and tau as the converged steady state", () => {
    const n = 40, vt = Array.from({ length: n }, (_, i) => i * T);
    const { eng, rec } = fresh();
    for (const t of vt) eng.schedule({ kind: "ventricular", t });
    for (const t of [...vt.slice(1), n * T]) eng.schedule({ kind: "atrial", t: t - pr }); // the last beat has its atrial event too, as in periodic()
    advanceTo(eng, (n - 1) * T + T - 1e-6);
    const manual = rec.beat(); rec.dispose();
    const ref = lastBeat(() => [], { inertance: true });
    for (const node of ["AO", "LA", "PA"]) expect(Math.abs(manual.p[node].mean - ref.b.p[node].mean) / ref.b.p[node].mean, node).toBeLessThan(0.005);
    expect(Math.abs(manual.tauMs.LV - ref.b.tauMs.LV) / ref.b.tauMs.LV).toBeLessThan(0.01);
  });

  it("a premature ventricular event gives a smaller stroke volume, and the beat after the compensatory pause a larger one", () => {
    const n = 24, base = Array.from({ length: n }, (_, i) => i * T);
    // regular run, a PVC at 60 % of the RR after the last regular beat, then the next sinus beats on schedule (full compensatory pause)
    const tPvc = (n - 1) * T + 0.6 * T, post = [(n + 1) * T, (n + 2) * T];
    const sinus = [...base.slice(1), n * T, ...post].map((t) => t - pr);
    const sv = strokeVolumes([...base, tPvc, ...post], sinus, post[1] + T);
    const normal = sv[n - 2], pvc = sv[n], after = sv[n + 1];
    if (process.env.CORE_VERBOSE) console.log(`PVC: SV normal ${normal.toFixed(1)}, premature ${pvc.toFixed(1)}, post-pause ${after.toFixed(1)} ml`);
    expect(pvc).toBeLessThan(0.8 * normal);
    expect(after).toBeGreaterThan(normal + 2);
  });

  it("a ventricular event with no atrial event before it has no A wave and fills less", () => {
    const sinus = lastBeat(() => [], { inertance: true }), junctional = lastBeat(() => [], { inertance: true, pr: Infinity });
    const wj = junctional.b.wave!, ps = peaks(wj.q.MV, 15).filter((i) => wj.t[i] > 0.05);
    if (process.env.CORE_VERBOSE) console.log(`no atrial event: MV peaks ${ps.map((i) => `${(wj.t[i] * 1000).toFixed(0)} ms ${wj.q.MV[i].toFixed(0)}`).join(", ")}; LVEDV ${sinus.b.v.LV.max.toFixed(1)} -> ${junctional.b.v.LV.max.toFixed(1)}`);
    expect(junctional.run.converged).toBe(true);
    expect(ps).toHaveLength(1); // the E wave alone
    expect(junctional.b.v.LV.max).toBeLessThan(sinus.b.v.LV.max - 2);
  });

  it("relaxScale 1.5 raises early-diastolic LV pressure, lowers E and raises A (E/A falls), and lengthens tau", () => {
    const base = lastBeat(() => [], { inertance: true, relaxScale: 1 }), slow = lastBeat(() => [], { inertance: true, relaxScale: 1.5 });
    const waves = (r: typeof base) => { const w = r.b.wave!, ps = peaks(w.q.MV, 15).filter((i) => w.t[i] > 0.05); return { E: w.q.MV[ps[0]], A: w.q.MV[ps[1]], n: ps.length }; };
    const b = waves(base), s = waves(slow);
    const lvAt = (r: typeof base, time: number) => { const w = r.b.wave!; return w.p.LV[w.t.findIndex((x) => x >= time)]; };
    if (process.env.CORE_VERBOSE) console.log(`relaxScale 1 -> 1.5: tau ${base.b.tauMs.LV.toFixed(1)} -> ${slow.b.tauMs.LV.toFixed(1)} ms; E ${b.E.toFixed(0)} -> ${s.E.toFixed(0)}, A ${b.A.toFixed(0)} -> ${s.A.toFixed(0)}, E/A ${(b.E / b.A).toFixed(2)} -> ${(s.E / s.A).toFixed(2)}; LV at 450 ms ${lvAt(base, 0.45).toFixed(1)} -> ${lvAt(slow, 0.45).toFixed(1)}`);
    expect(b.n).toBe(2); expect(s.n).toBe(2);
    expect(lvAt(slow, 0.45)).toBeGreaterThan(lvAt(base, 0.45) + 1);
    expect(s.E).toBeLessThan(b.E);
    expect(s.A).toBeGreaterThan(b.A);
    expect(s.E / s.A).toBeLessThan(b.E / b.A);
    expect(slow.b.tauMs.LV).toBeGreaterThan(base.b.tauMs.LV * 1.15);
    expect(slow.run.converged).toBe(true);
  });

  it("periodic converges at 72 bpm with and without inertance, and at 140 bpm", () => {
    for (const o of [{ inertance: true }, {}, { inertance: true, hr: 140 }]) expect(lastBeat(() => [], o).run.converged, JSON.stringify(o)).toBe(true);
  });
});
