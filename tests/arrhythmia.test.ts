// The VT/VF model of the core engine (task B3b): hazard pieces, initiation on a premature beat against the T wave, the runs as beats in
// the stream, the course of each sustained rhythm, AIVR, scar VT, electrolytes, and the scenario fields. Fast: a few seeds on the rig
// (tests/arrhythmiaRig.ts, no hemodynamics). The population rates against the literature are in arrhythmiaRates.test.ts (slow), the
// full Simulation in arrhythmiaSim.test.ts (slow). Targets and sources: docs/ARRHYTHMIA.md, config/arrhythmia.ts.
import { describe, it, expect } from "vitest";
import { ArrhythmiaRig } from "./arrhythmiaRig";
import { LESIONS } from "./ectopyRig";
import { Arrhythmia, substrateEffect, arrhythmiaCourse, potassiumFactor, magnesiumFactor } from "../src/physics/arrhythmia";
import { Ectopy, couplingVsT } from "../src/physics/ectopy";
import { ARRHYTHMIA } from "../src/config/arrhythmia";
import { normalizeScenario, toScenario } from "../src/sim/scenario";
import { Simulation } from "../src/sim/simulation";
import { Beat } from "../src/physics/ecg";

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const ventricular = (b: Beat[]) => b.filter((x) => !x.silent);
/** A healthy heart running `warm` s, then `kind` induced and `sec` s more; the beats after the induction. */
function induced(seed: number, kind: Parameters<Arrhythmia["induce"]>[0], sec: number, map = 85) {
  const r = new ArrhythmiaRig(seed);
  r.map = map;
  r.run(5);
  const n0 = r.beats.length, t0 = r.t;
  expect(r.arrhythmia.induce(kind)).toBe(true);
  r.run(sec);
  return { r, beats: r.beats.slice(n0), t0 };
}

describe("hazard pieces", () => {
  it("substrate: nothing below 1% of the myocardium, steeper than the PVC curve, large infarcts far above small ones", () => {
    expect(substrateEffect(0)).toBe(0);
    expect(substrateEffect(ARRHYTHMIA.floor)).toBe(0);
    expect(substrateEffect(0.43)).toBeGreaterThan(0.75); // proximal LAD
    expect(substrateEffect(0.43) / substrateEffect(0.1)).toBeGreaterThan(12); // against a distal LAD
    expect(substrateEffect(0.08)).toBeLessThan(0.03); // first diagonal
  });
  it("time course: a hyperacute peak, about 50 x the hourly hazard in the first 4 h against hours 4-48 (GISSI-2)", () => {
    const avg = (a: number, b: number) => mean(Array.from({ length: b - a }, (_, i) => arrhythmiaCourse(a + i + 0.5)));
    expect(arrhythmiaCourse(0)).toBe(0);
    const ratio = avg(0, 240) / avg(240, 2880);
    expect(ratio).toBeGreaterThan(30); expect(ratio).toBeLessThan(80);
    expect(avg(0, 60) * 60 / (avg(0, 240) * 240)).toBeGreaterThan(0.5); // most of the early events in the first hour
  });
  it("potassium: 1 when normal, about 1.9 at 3.2 and 3.4 at 5.5 mmol/l; magnesium: 1 when normal, higher when low", () => {
    expect(potassiumFactor(4.2)).toBe(1);
    expect(potassiumFactor(3.2)).toBeCloseTo(1.9, 1);
    expect(potassiumFactor(5.5)).toBeCloseTo(3.36, 1);
    expect(magnesiumFactor(0.9)).toBe(1);
    expect(magnesiumFactor(0.5)).toBeGreaterThan(1.4);
  });
  it("the hazard follows burden, phase, tone, beta-blockade and electrolytes; tendency 0 makes it zero", () => {
    const at = (opts: { burden?: number; age?: number; sym?: number; bb?: number; k?: number; tendency?: number } = {}) => {
      const e = new Ectopy(5), a = new Arrhythmia(5, e, opts.tendency ?? 1);
      e.update(opts.age ?? 30, opts.burden ?? 0.43, { sympathetic: opts.sym ?? 0.3, betaBlock: opts.bb ?? 0, drugDrive: 0 });
      if (opts.k) a.potassium = opts.k;
      return a.hazards().ischemia;
    };
    const base = at();
    expect(base).toBeGreaterThan(0);
    expect(at({ burden: 0 })).toBe(0);
    expect(at({ burden: 0.1 })).toBeLessThan(base / 10);
    expect(at({ age: 600 })).toBeLessThan(base / 10);
    expect(at({ sym: 0.6 })).toBeGreaterThan(1.8 * base);
    expect(at({ sym: 0.6, bb: 0.8 })).toBeLessThan(base);
    expect(at({ k: 3.2 })).toBeCloseTo(base * potassiumFactor(3.2), 9);
    expect(at({ tendency: 0 })).toBe(0);
  });
  it("susceptibility is fixed per seed, spread lognormally, and correlated with the ectopy susceptibility", () => {
    const pairs = Array.from({ length: 400 }, (_, i) => { const e = new Ectopy(i + 1); return [Math.log(e.susceptibility), Math.log(new Arrhythmia(i + 1, e).susceptibility)]; });
    const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
    const cov = mean(pairs.map(([x, y]) => (x - mx) * (y - my))), sx = Math.sqrt(mean(pairs.map(([x]) => (x - mx) ** 2))), sy = Math.sqrt(mean(pairs.map(([, y]) => (y - my) ** 2)));
    expect(cov / sx / sy).toBeGreaterThan(0.3); expect(cov / sx / sy).toBeLessThan(0.7);
    expect(sy).toBeGreaterThan(0.6); expect(sy).toBeLessThan(1.0);
    expect(new Arrhythmia(9, new Ectopy(9)).susceptibility).toBe(new Arrhythmia(9, new Ectopy(9)).susceptibility);
  });
  it("scar VT: no hazard before the scar has healed, some once it has; none without scar", () => {
    const e = new Ectopy(4), a = new Arrhythmia(4, e);
    a.update(60, 0.05, 0, { scar: 0.3 });
    const early = a.hazards().scar;
    a.update(10 * 24 * 60, 0.05, 1, { scar: 0.3 });
    expect(a.hazards().scar).toBeGreaterThan(5 * early);
    const b = new Arrhythmia(4, new Ectopy(4));
    b.update(10 * 24 * 60, 0.05, 1, { scar: 0 });
    expect(b.hazards().scar).toBe(0);
  });
});

describe("runs on the beat stream", () => {
  it("non-sustained VT: three or more wide beats at a tachycardic rate, then the sinus rhythm returns", () => {
    for (const seed of [1, 2, 3]) {
      const { r, beats } = induced(seed, "nsvt", 15);
      const ev = r.arrhythmia.log[0];
      expect(ev.kind).toBe("nsvt");
      expect(ev.beats!).toBeGreaterThanOrEqual(3);
      const run = beats.filter((b) => b.pvc);
      expect(run.length).toBeGreaterThanOrEqual(ev.beats!);
      const gaps = run.slice(1, ev.beats).map((b, i) => b.t - run[i].t);
      for (const g of gaps) expect(60 / g).toBeGreaterThan(120);
      expect(beats.slice(-5).every((b) => !b.pvc && b.origin === undefined)).toBe(true); // sinus again
      expect(r.arrhythmia.current).toBeNull();
    }
  });
  it("the trigger beat's coupling is set against the live T wave: R on T in about 60% of initiating events", () => {
    let ront = 0, n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { r } = induced(seed, "nsvt", 2);
      const v = r.arrhythmia.log[0].couplingVsT!;
      expect(v).toBeGreaterThan(0.7);
      n++; if (v < 1) ront++;
    }
    expect(ront / n).toBeGreaterThan(0.4); expect(ront / n).toBeLessThan(0.8);
  });
  it("sustained monomorphic VT takes over at the trigger: regular wide beats at the episode's rate, P waves dissociated", () => {
    const { r, beats } = induced(1, "mono", 20);
    const cur = r.arrhythmia.current!;
    expect(cur.kind).toBe("mono");
    const vt = beats.filter((b) => b.origin === "ventricular" && !b.pvc && b.t > cur.since + 1);
    expect(vt.length).toBeGreaterThan(30);
    const rate = 60 / mean(vt.slice(1).map((b, i) => b.t - vt[i].t));
    expect(Math.abs(rate - cur.rate)).toBeLessThan(5);
    expect(rate).toBeGreaterThan(ARRHYTHMIA.monoRate[0] - 5);
    expect(beats.filter((b) => b.t > cur.since + 1).some((b) => b.origin === "sinus" || b.pr !== undefined)).toBe(false); // no conducted beat
    expect(r.stream.beats.some((b) => b.pOnly && b.t > cur.since + 1)).toBe(true); // the sinus P waves march through
    // the trigger is the last premature beat before the run, at the start of the episode
    const trig = beats.filter((b) => b.pvc).pop()!;
    expect(trig.t).toBeCloseTo(cur.since, 6);
  });
  it("a VT the circulation tolerates stays a VT; one that drops the pressure degenerates to VF", () => {
    let staysVt = 0, toVf = 0, vfAtGoodMap = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const ok = induced(seed, "mono", 60, 85).r.arrhythmia.current?.kind;
      if (ok === "mono") staysVt++; else if (ok === "vf") vfAtGoodMap++;
      if (induced(seed, "mono", 120, 38).r.arrhythmia.current?.kind === "vf") toVf++;
    }
    expect(vfAtGoodMap).toBe(0);
    expect(staysVt).toBeGreaterThanOrEqual(12); // a few stop by themselves (mean 4 min)
    expect(toVf).toBeGreaterThanOrEqual(13);
  });
  it("a VT on top of an occluded proximal LAD degenerates to VF even with a held pressure; the same VT in a healthy heart does not", () => {
    let ischemicVf = 0, healthyVf = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = new ArrhythmiaRig(seed, { tendency: 0 }).lesions(LESIONS.ladProx);
      r.map = 75;
      r.run(10);
      r.arrhythmia.tendency = 1;
      expect(r.arrhythmia.induce("mono")).toBe(true);
      r.run(300, 0); // 5 heartbeat minutes, the clinical clock stopped so the hazard of a new run does not mix in
      if (r.arrhythmia.log.some((e) => e.kind === "vf" && e.cause === "degeneration")) ischemicVf++;
      if (seed <= 8 && induced(seed, "mono", 120, 75).r.arrhythmia.log.some((e) => e.kind === "vf")) healthyVf++;
    }
    expect(healthyVf).toBe(0);
    expect(ischemicVf).toBeGreaterThanOrEqual(16); // expected about 24 of 40: mean 2.5 min to VF against a spontaneous end at mean 4 min
  });
  it("VF: after the trigger beat no ventricular complex at all, only silent ticks; it does not stop by itself", () => {
    const { r, beats } = induced(2, "vf", 30);
    const cur = r.arrhythmia.current!;
    expect(cur.kind).toBe("vf");
    const after = beats.filter((b) => b.t > cur.since + 0.01);
    expect(after.length).toBeGreaterThan(20);
    expect(ventricular(after).length).toBe(0);
    expect(r.stream.baseline(r.t - 1)).not.toBeNull(); // the fibrillatory signal on the strip
  });
  it("polymorphic VT stops by itself or degenerates to VF within a minute, mostly to VF", () => {
    let vf = 0, stopped = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { r } = induced(seed, "poly", 60);
      const k = r.arrhythmia.current?.kind;
      if (k === "vf") vf++; else if (!k) stopped++;
    }
    expect(vf + stopped).toBe(20);
    expect(vf).toBeGreaterThan(stopped * 0.6);
    expect(stopped).toBeGreaterThan(2);
  });
  it("AIVR: wide beats slightly faster than the sinus rate, P waves dissociated, ending by itself to sinus rhythm", () => {
    const { r, beats } = induced(4, "aivr", 150);
    const ev = r.arrhythmia.log.find((e) => e.kind === "aivr")!;
    expect(ev.rate).toBeGreaterThanOrEqual(ARRHYTHMIA.aivr.minRate); expect(ev.rate).toBeLessThanOrEqual(ARRHYTHMIA.aivr.maxRate);
    expect(ev.end).toBeDefined();
    const during = beats.filter((b) => b.t > ev.t + 1 && b.t < ev.end! - 0.5);
    expect(during.length).toBeGreaterThan(3);
    expect(during.every((b) => b.origin === "ventricular")).toBe(true);
    expect(beats.slice(-5).every((b) => b.origin === undefined)).toBe(true);
    expect(r.arrhythmia.current).toBeNull();
  });
  it("AIVR does not appear while the sinus node runs faster than it could", () => {
    const r = new ArrhythmiaRig(4);
    r.run(2);
    r.arrhythmia.update(0, 0, r.t, { sinusRate: 120 });
    expect(r.arrhythmia.induce("aivr")).toBe(false);
  });
  it("scar VT is monomorphic and slower than the VT of acute ischemia", () => {
    const rates: number[] = [];
    for (const seed of [1, 2, 3, 4, 5]) { const { r } = induced(seed, "scar", 5); expect(r.arrhythmia.current?.kind).toBe("mono"); expect(r.arrhythmia.current?.cause).toBe("scar"); rates.push(r.arrhythmia.current!.rate); }
    for (const x of rates) { expect(x).toBeGreaterThanOrEqual(ARRHYTHMIA.scarRate[0]); expect(x).toBeLessThanOrEqual(ARRHYTHMIA.scarRate[1]); }
  });
  it("terminate ends a sustained rhythm and the sinus rhythm resumes without a backlog of beats", () => {
    const { r } = induced(2, "vf", 5);
    r.arrhythmia.terminate(r.t);
    const n0 = r.beats.length;
    r.run(6);
    const back = r.beats.slice(n0).filter((b) => !b.silent);
    expect(back.length).toBeGreaterThan(4); expect(back.length).toBeLessThan(10);
    expect(back.every((b) => b.origin === undefined)).toBe(true);
  });
  it("is deterministic per seed", () => {
    const go = (seed: number) => { const r = new ArrhythmiaRig(seed, { tendency: 3 }).lesions(LESIONS.ladProx).run(40); return JSON.stringify(r.arrhythmia.log) + r.beats.length; };
    expect(go(17)).toBe(go(17));
  });
  it("no arrhythmia of any kind in a healthy heart or a stable 70% stenosis at rest, whatever the tendency", () => {
    for (const seed of [1, 2, 3, 4, 5]) for (const l of ["none", "lad70"] as const) {
      const r = new ArrhythmiaRig(seed, { tendency: 3 }).lesions(LESIONS[l]).run(90);
      expect(r.arrhythmia.log.length).toBe(0);
      expect(r.beats.some((b) => b.pvc)).toBe(false);
    }
  });
});

describe("scenario fields and engines", () => {
  it("arrhythmiaTendency and electrolytes are normalized with warnings, and round-trip only when set", () => {
    expect(normalizeScenario({}).scenario.arrhythmiaTendency).toBe(1);
    const n = normalizeScenario({ arrhythmiaTendency: 9, electrolytes: { potassium: 9, magnesium: 0.5 } });
    expect(n.scenario.arrhythmiaTendency).toBe(3);
    expect(n.scenario.electrolytes).toEqual({ potassium: ARRHYTHMIA.potassium.max, magnesium: 0.5 });
    expect(n.warnings.some((w) => w.includes("arrhythmiaTendency"))).toBe(true);
    expect(n.warnings.some((w) => w.includes("electrolytes.potassium"))).toBe(true);
    const plain = toScenario(normalizeScenario({}).scenario);
    expect("arrhythmiaTendency" in plain).toBe(false); expect("electrolytes" in plain).toBe(false);
    expect(toScenario(normalizeScenario({ arrhythmiaTendency: 0, electrolytes: { potassium: 3.1 } }).scenario)).toMatchObject({ arrhythmiaTendency: 0, electrolytes: { potassium: 3.1, magnesium: 0.9 } });
  });
  it("the legacy engine has no arrhythmia model; the core engine has one with the scenario's tendency and electrolytes", () => {
    expect(new Simulation({ seed: 3 }).arrhythmia).toBeUndefined();
    const s = new Simulation({ seed: 3, arrhythmiaTendency: 2, electrolytes: { potassium: 3.2 } }, { engine: "core", deferCore: true });
    expect(s.arrhythmia?.tendency).toBe(2);
    expect(s.arrhythmia?.potassium).toBe(3.2);
    expect(s.stream.ectopy!.potassium).toBeCloseTo(potassiumFactor(3.2), 9); // the PVCs feel it too
    s.apply({ arrhythmiaTendency: 0 });
    expect(s.arrhythmia?.tendency).toBe(0);
  });
  it("couplingVsT of the ectopy model is what the trigger reports", () => {
    expect(couplingVsT(0.3, 0.8)).toBeLessThan(1);
  });
});
