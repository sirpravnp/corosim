// D5: intra-aortic balloon pump on the adult model (core/devices/iabp.ts, physics/iabpWaveform.ts). Set CORE_VERBOSE=1 to print the numbers.
import { describe, it, expect } from "vitest";
import { buildModel, volumeOffsetFor, type StructuralSpec } from "../src/physics/structural";
import { createEngine } from "../src/physics/core/engine";
import { defaultPr, fromModel } from "../src/physics/core/fromModel";
import { Iabp, type IabpParams } from "../src/physics/core/devices/iabp";
import { LiveHeart } from "../src/physics/core/live";
import { augmentationSpan, avClosureTime, iabpBeats, summarizeIabp, type IabpBeat } from "../src/physics/iabpWaveform";
import { NODES } from "../src/physics/structuralGraph";
import type { Beat } from "../src/physics/ecg";

const HR = 72;
const log = (...a: unknown[]) => { if (process.env.CORE_VERBOSE) console.log(...a); };
const SHOCK: StructuralSpec = { lvEes: 0.35, lvStiffness: 1.6 };
const LV = NODES.indexOf("LV");

/** PVA of an LV loop: stroke work |∮P dV| plus PE = ½·P_es·(V_es − V0) at the maximum of P/(V − V0). mmHg·ml. */
function pva(P: number[], V: number[], v0: number) {
  let sw = 0; for (let i = 1; i < P.length; i++) sw += 0.5 * (P[i] + P[i - 1]) * (V[i] - V[i - 1]);
  let k = 0, best = -Infinity; for (let i = 0; i < P.length; i++) { const e = P[i] / Math.max(V[i] - v0, 1e-6); if (e > best) { best = e; k = i; } }
  return { sw: Math.abs(sw), pva: Math.abs(sw) + 0.5 * P[k] * (V[k] - v0) };
}

interface Opts { n?: number; dt?: number; hr?: number }
/**
 * The adult model (or a spec) warmed to the unassisted steady state with the balloon empty, then `n` beats with the balloon at its volume
 * and the given settings, stepped at `dt`. Beats are scheduled events; a beat is ASSISTED if the balloon's cycle starts at its R wave.
 */
function run(spec: StructuralSpec, cfg: Partial<IabpParams> | null, o: Opts = {}) {
  const n = o.n ?? 24, hr = o.hr ?? HR, dt = o.dt ?? 0.0005;
  const m = buildModel(spec, volumeOffsetFor(spec));
  const g = fromModel(m, { iabp: { ...cfg, volumeMl: 0 } });
  const eng = createEngine(g.nodes, g.elements, g.options);
  const el = eng.element<Iabp>("iabp");
  eng.periodic(hr);
  const T = 60 / hr, pr = defaultPr(T), vol = cfg ? cfg.volumeMl ?? 40 : 0;
  el.set({ volumeMl: vol });
  const blood0 = Array.from(eng.sample().V).reduce((a, x) => a + x, 0);
  const t0 = eng.t, ev: number[] = [];
  const S = { t: [] as number[], p: [] as number[], q: [] as number[], vb: [] as number[], asg: [] as number[], lvP: [] as number[], lvV: [] as number[], dao: [] as number[], bad: false };
  const ao = eng.node("AO"), dao = eng.node("DAO");
  eng.onSample((s) => {
    S.t.push(s.t); S.p.push(s.P[ao]); S.q.push(s.q.AV); S.vb.push(s.taps.iabp.vb); S.asg.push(s.taps.iabp.assisted); S.lvP.push(s.P[LV]); S.lvV.push(s.V[LV]); S.dao.push(s.P[dao]);
    if (!Number.isFinite(s.P[ao]) || !Number.isFinite(s.P[LV])) S.bad = true;
  });
  for (let k = 0; k <= n; k++) { ev.push(t0 + k * T); eng.schedule({ kind: "ventricular", t: t0 + k * T }); eng.schedule({ kind: "atrial", t: t0 + k * T - pr }); }
  const steps = Math.round((n * T) / dt);
  for (let i = 0; i < steps; i++) eng.step(dt);
  const assisted = ev.map((e) => { const i = S.t.findIndex((x) => x > e + 0.001); return i >= 0 && S.asg[i] === 1; });
  const beats = iabpBeats({ t: S.t, p: S.p }, ev.slice(0, n + 1), assisted, (_k, a, b) => avClosureTime(S.t, S.q, a, b));
  // forward AV volume, LV loops, per beat
  const idx = (x: number) => { let lo = 0, hi = S.t.length - 1; while (lo < hi) { const mm = (lo + hi) >> 1; if (S.t[mm] < x) lo = mm + 1; else hi = mm; } return lo; };
  const per = beats.map((b) => {
    const i0 = idx(b.t0), i1 = idx(b.t1);
    let fwd = 0, net = 0; for (let i = i0 + 1; i <= i1; i++) { const h = S.t[i] - S.t[i - 1], q = 0.5 * (S.q[i] + S.q[i - 1]); net += q * h; if (q > 0) fwd += q * h; }
    let io = i0; while (io < i1 && S.q[io] <= 5) io++;
    return { ...b, avFwd: fwd, sv: net, avOpen: S.t[io] - b.t0, ...pva(S.lvP.slice(i0, i1 + 1), S.lvV.slice(i0, i1 + 1), m.chambers[LV]!.v0) };
  });
  const blood = Array.from(eng.sample().V).reduce((a, x) => a + x, 0);
  return { eng, el, m, ev, S, beats: per, summary: summarizeIabp(per, 6), blood, blood0, T, hr };
}
type Run = ReturnType<typeof run>;
const avg = (r: Run, pick: (b: Run["beats"][number]) => number, assisted: boolean) => { const x = r.beats.slice(6).filter((b) => b.assisted === assisted).map(pick); return x.reduce((a, b) => a + b, 0) / x.length; };
const f = (x: number, d = 1) => x.toFixed(d);

const half = run({}, { ratio: 2 });
const s = half.summary;
log("1:2 correct", Object.fromEntries(Object.entries(s).map(([k, v]) => [k, +v.toFixed(2)])));

describe("IABP correct timing, 1:2 on the adult model", () => {
  it("balloon is filled and emptied, not a source of blood, and inflates after the notch", () => {
    expect(Math.max(...half.S.vb)).toBeGreaterThan(38);
    expect(Math.max(...half.S.vb)).toBeLessThanOrEqual(40.2);
    expect(Math.min(...half.S.vb)).toBeGreaterThanOrEqual(0);
    expect(half.S.bad).toBe(false);
    expect(Math.abs(half.blood - half.blood0)).toBeLessThan(0.1 * (half.beats.length * half.T) / 60 + 0.1);
  });
  it("diastolic augmentation: the assisted beat's diastolic peak is above its own systole and well above unassisted diastole", () => {
    log("peak diastolic assisted", f(s.peakDiastolicAssisted), "unassisted", f(s.peakDiastolicUnassisted), "systole", f(s.systolicOfAssistedBeat), "aug", f(s.augmentation));
    expect(s.augmentation).toBeGreaterThan(8);
    expect(s.peakDiastolicAssisted).toBeGreaterThan(s.systolicOfUnassistedBeat + 8);
    expect(s.peakDiastolicAssisted - s.peakDiastolicUnassisted).toBeGreaterThan(20);
    // the peak sits in diastole, after the notch
    const b = half.beats.filter((x) => x.assisted)[8];
    expect(b.tPeakDiastolic).toBeGreaterThan(b.notchT + 0.03);
  });
  it("assisted end-diastolic pressure is lower than unassisted", () => {
    log("EDP assisted", f(s.edpAssisted), "unassisted", f(s.edpUnassisted));
    expect(s.edpAssisted).toBeLessThan(s.edpUnassisted - 3);
  });
  it("the systolic pressure after an assisted beat is lower (unloading)", () => {
    log("systolic after assisted", f(s.nextSystolicAfterAssisted), "after unassisted", f(s.nextSystolicAfterUnassisted), "unloading", f(100 * s.systolicUnloading));
    expect(s.systolicUnloading).toBeGreaterThan(0.03);
    expect(s.systolicUnloading).toBeLessThan(0.10);
  });
  it("coronary perfusion proxy (diastolic pressure-time integral) rises on assisted beats", () => {
    log("DPTI assisted", f(s.dptiAssisted), "unassisted", f(s.dptiUnassisted));
    expect(s.dptiAssisted).toBeGreaterThan(1.15 * s.dptiUnassisted);
  });
  it("inflation follows the measured valve closure: the augmentation starts within 40 ms of the notch", () => {
    const b = half.beats.filter((x) => x.assisted).slice(3);
    for (const x of b) expect(Math.abs(x.augOnsetT - x.notchT)).toBeLessThan(0.04);
    expect(Math.abs(half.el.closureDelay - (half.beats[10].notchT - half.beats[10].t0))).toBeLessThan(0.02);
  });
});

describe("IABP in cardiogenic shock, 1:1", () => {
  const none = run(SHOCK, null, { n: 20 }), one = run(SHOCK, { ratio: 1 }, { n: 20 });
  const mean = (r: Run, k: "pva" | "sw" | "sv") => { const x = r.beats.slice(10).map((b) => b[k]); return x.reduce((a, b) => a + b, 0) / x.length; };
  it("lowers LV stroke work and PVA and raises cardiac output a little", () => {
    const co = (r: Run) => (mean(r, "sv") * r.hr) / 1000;
    log("shock PVA", f(mean(none, "pva")), "->", f(mean(one, "pva")), "SW", f(mean(none, "sw")), "->", f(mean(one, "sw")), "CO", f(co(none), 2), "->", f(co(one), 2));
    expect(mean(one, "pva")).toBeLessThan(mean(none, "pva"));
    expect(mean(one, "sw")).toBeLessThan(mean(none, "sw"));
    expect(co(one)).toBeGreaterThan(co(none));
    expect(co(one)).toBeLessThan(1.25 * co(none));
  });
  it("raises the diastolic pressure-time integral", () => {
    const d = (r: Run) => r.beats.slice(10).reduce((a, b) => a + b.dpti, 0) / (r.beats.length - 10);
    log("shock DPTI", f(d(none)), "->", f(d(one)));
    expect(d(one)).toBeGreaterThan(1.1 * d(none));
  });
});

describe("IABP timing errors, read off the waveform (1:2)", () => {
  const correct = half;
  const early = run({}, { ratio: 2, inflateMs: -80 }), late = run({}, { ratio: 2, inflateMs: 100 });
  const earlyD = run({}, { ratio: 2, deflateMs: -110 }), lateD = run({}, { ratio: 2, deflateMs: 100 });
  type K = keyof (IabpBeat & { avFwd: number; avOpen: number });
  const A = (r: Run, k: K, a = true) => avg(r, (b) => b[k] as number, a);
  /** Mean time since the R wave of a feature of the assisted (or unassisted) beats. */
  const rel = (r: Run, k: "augOnsetT" | "notchT", a = true) => avg(r, (b) => b[k] - b.t0, a);
  /** Augmentation span (since the R wave) from the last assisted beat and the unassisted beat after it. */
  const span = (r: Run) => { const i = r.beats.map((b, k) => (b.assisted && k + 1 < r.beats.length - 1 ? k : -1)).filter((k) => k >= 0).pop()!; return augmentationSpan({ t: r.S.t, p: r.S.p }, r.beats[i].t0, r.beats[i + 1].t0, r.T); };
  it("early inflation: augmentation starts before the patient's dicrotic notch and the ejection is cut short", () => {
    const notchU = rel(early, "notchT", false);
    log("early: onset", f(1000 * rel(early, "augOnsetT"), 0), "ms vs unassisted notch", f(1000 * notchU, 0), "ms; AV fwd", f(A(early, "avFwd")), "vs unassisted", f(A(early, "avFwd", false)), "correct", f(A(correct, "avFwd")));
    expect(rel(early, "augOnsetT")).toBeLessThan(notchU - 0.03);
    expect(A(early, "avFwd")).toBeLessThan(A(early, "avFwd", false) - 3);
    expect(A(early, "avFwd")).toBeLessThan(A(correct, "avFwd") - 3);
  });
  it("correct inflation does not cut the ejection and starts at the notch", () => {
    expect(Math.abs(rel(correct, "augOnsetT") - rel(correct, "notchT", false))).toBeLessThan(0.04);
    expect(A(correct, "avFwd")).toBeGreaterThan(A(correct, "avFwd", false) - 3);
  });
  it("late inflation: augmentation starts well after the notch and its peak is lower", () => {
    const notchU = rel(late, "notchT", false);
    log("late: onset", f(1000 * rel(late, "augOnsetT"), 0), "ms vs notch", f(1000 * notchU, 0), "; peak", f(A(late, "peakDiastolic")), "correct", f(A(correct, "peakDiastolic")));
    expect(rel(late, "augOnsetT")).toBeGreaterThan(notchU + 0.07);
    expect(A(late, "peakDiastolic")).toBeLessThan(A(correct, "peakDiastolic") - 1);
  });
  it("early deflation: the augmentation ends well before systole, the assisted end-diastolic pressure is higher than with correct timing and the next systole is less unloaded", () => {
    const sp = span(earlyD), sc = span(correct), se = summarizeIabp(earlyD.beats, 6), sk = summarizeIabp(correct.beats, 6);
    log("early deflation: aug span ends", f(1000 * sp.end, 0), "ms vs correct", f(1000 * sc.end, 0), "(RR", f(1000 * earlyD.T, 0), "); undershoot", f(sp.minGap), "vs", f(sc.minGap), "; edp", f(se.edpAssisted), "correct", f(sk.edpAssisted), "next sys", f(se.nextSystolicAfterAssisted), "correct", f(sk.nextSystolicAfterAssisted));
    expect(sp.end).toBeLessThan(sc.end - 0.06);
    expect(se.edpAssisted).toBeGreaterThan(sk.edpAssisted + 1);
    expect(se.nextSystolicAfterAssisted).toBeGreaterThan(sk.nextSystolicAfterAssisted + 0.5);
  });
  it("late deflation: the assisted end-diastolic pressure stays high into systole and the valve opens later", () => {
    const sl = summarizeIabp(lateD.beats, 6), sk = summarizeIabp(correct.beats, 6);
    log("late deflation: edp", f(sl.edpAssisted), "unassisted", f(sl.edpUnassisted), "correct", f(sk.edpAssisted), "; AV opens (assisted next beat)", f(1000 * A(lateD, "avOpen", false), 0), "ms vs correct", f(1000 * A(correct, "avOpen", false), 0), "unloading", f(100 * sl.systolicUnloading), "%");
    expect(sl.edpAssisted).toBeGreaterThan(sl.edpUnassisted + 5);
    expect(sl.edpAssisted).toBeGreaterThan(sk.edpAssisted + 10);
    expect(A(lateD, "avOpen", false)).toBeGreaterThan(A(correct, "avOpen", false) + 0.002);
  });
});

describe("IABP ratio and numerics", () => {
  it("1:3 assists one beat in three", () => {
    const r = run({}, { ratio: 3 }, { n: 18 });
    const flags = r.beats.slice(3).map((b) => (b.assisted ? 1 : 0));
    log("1:3 flags", flags.join(""));
    expect(flags.reduce((a: number, b: number) => a + b, 0)).toBe(Math.floor(flags.length / 3));
    expect(r.beats.filter((b) => b.assisted).every((b, i, a) => i === 0 || Math.abs(b.t0 - a[i - 1].t0 - 3 * r.T) < 1e-6)).toBe(true);
    expect(r.beats.slice(3).filter((b) => b.assisted).every((b) => b.peakDiastolic > b.systolic)).toBe(true);
  });
  it("1:1 assists every beat", () => {
    const r = run({}, { ratio: 1 }, { n: 10 });
    expect(r.beats.every((b) => b.assisted)).toBe(true);
  });
  it("halving dt changes the key outputs by less than 0.5 %", () => {
    const a = run({}, { ratio: 2 }, { n: 14, dt: 0.001 }), b = run({}, { ratio: 2 }, { n: 14, dt: 0.0005 });
    const sa = a.summary, sb = b.summary;
    for (const k of ["peakDiastolicAssisted", "edpAssisted", "edpUnassisted", "systolicOfUnassistedBeat", "dptiAssisted"] as const) {
      log("dt", k, f(sa[k], 2), f(sb[k], 2));
      expect(Math.abs(sa[k] - sb[k]) / Math.abs(sb[k])).toBeLessThan(0.005);
    }
  });
  it("no NaN across timing offsets, ratios and volumes; the blood volume is unchanged", () => {
    for (const cfg of [{ ratio: 1, inflateMs: -100, deflateMs: 100 }, { ratio: 3, inflateMs: 100, deflateMs: -100 }, { ratio: 2, volumeMl: 50 }, { ratio: 1, volumeMl: 0 }]) {
      const r = run(SHOCK, cfg, { n: 8 });
      expect(r.S.bad).toBe(false);
      expect(Math.abs(r.blood - r.blood0)).toBeLessThan(0.1);
    }
  });
  it("set() clamps its parameters", () => {
    const e = new Iabp("x", NODES.indexOf("DAO"));
    e.set({ ratio: 7, volumeMl: 99, inflateMs: -1e6, deflateMs: NaN });
    expect(e.params).toMatchObject({ ratio: 3, volumeMl: 50, inflateMs: -150, deflateMs: 0 });
  });
});

describe("IABP in LiveHeart", () => {
  it("works as an extra: the balloon cycles every second beat and the taps report it", () => {
    const h = new LiveHeart({}, { extra: [(m) => Iabp.forModel(m, { ratio: 2 })] });
    h.warm(HR);
    const T = 60 / HR, pr = defaultPr(T), beats: Beat[] = [];
    for (let k = 1; k <= 16; k++) beats.push({ t: k * T, rr: T, pvc: false, pr });
    let bi = 0, vbMax: number[] = [], cur = 0;
    const seen: number[] = [];
    while (h.time < 15 * T) {
      while (bi < beats.length && beats[bi].t < h.time + 0.5) h.onBeat(beats[bi++]);
      h.step(0.005);
      const tap = h.engine.sample().taps.iabp;
      cur = Math.max(cur, tap.vb);
      if (tap.beat > seen.length) { seen.push(tap.assisted); vbMax.push(cur); cur = 0; }
    }
    log("live: assisted flags", seen.join(""), "vb max per beat", vbMax.map((x) => x.toFixed(0)).join(","));
    expect(seen.slice(-6).reduce((a, b) => a + b, 0)).toBe(3);
    expect(Math.max(...vbMax)).toBeGreaterThan(38);
  }, 120_000);
});
