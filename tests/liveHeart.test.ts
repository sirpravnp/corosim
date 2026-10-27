// The core engine driven live by beats (A6): sinus against periodic(), PVC, complete heart block, AF, modifiers, rate change, speed.
// Beats are fed by hand (the engine, not the rhythm model, is under test). Set LIVE_VERBOSE=1 to print the numbers.
import { describe, it, expect } from "vitest";
import { LiveHeart, type LiveBeat, type LiveModifiers } from "../src/physics/core/live";
import { defaultPr } from "../src/physics/core/fromModel";
import { buildModel, simulate, volumeOffsetFor } from "../src/physics/structural";
import type { Beat } from "../src/physics/ecg";
import { LIVE } from "../src/config/live";
import { ElastanceChamber } from "../src/physics/core/chamber";

const say = (...a: unknown[]) => { if (process.env.LIVE_VERBOSE) console.log(...a); };
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const corr = (x: number[], y: number[]) => {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

/** Feed `beats` (as the stream would, 0.5 s ahead of the clock) and step the heart in 10 ms ticks to stream time `until`. */
function drive(h: LiveHeart, beats: Beat[], until: number, tick = 0.01) {
  let i = 0;
  while (i < beats.length && beats[i].t < h.time) i++; // already past
  const next = () => { while (i < beats.length && beats[i].t < h.time + 0.5) h.onBeat(beats[i++]); };
  while (h.time < until - 1e-9) { next(); h.step(Math.min(tick, until - h.time)); }
}

/** Regular sinus beats at `hr` from stream time `t0` to `t1`, as the rhythm model would give them. */
function sinus(hr: number, t0: number, t1: number, pr = defaultPr(60 / hr)): Beat[] {
  const T = 60 / hr, out: Beat[] = [];
  for (let t = t0; t < t1; t += T) out.push({ t, rr: T, pvc: false, pr });
  return out;
}

const avg = (rs: LiveBeat[], f: (b: LiveBeat) => number) => mean(rs.map(f));
const co = (rs: LiveBeat[]) => (rs.reduce((s, b) => s + b.strokeVolume, 0) / rs.reduce((s, b) => s + b.interval, 0)) * 0.06; // L/min

/** The steady state periodic(72) finds, for the same model. */
function reference(hr = 72) {
  const m = buildModel({}, volumeOffsetFor({})), T = 60 / hr;
  const r = simulate(buildModel({ hr }, volumeOffsetFor({})), { waveform: false });
  return { map: r.p.AO.mean, cvp: r.p.RA.mean, pcwp: r.p.LA.mean, sv: r.fwd.AV - r.bwd.AV, T, co: ((r.fwd.AV - r.bwd.AV) / T) * 0.06, _m: m };
}

function warmed(hr = 72, spec = {}) { const h = new LiveHeart(spec); h.warm(hr); return h; }

describe("LiveHeart", () => {
  it("steady sinus at 72 bpm reproduces periodic(72): MAP, SV, CVP and PCWP within 1 %", () => {
    const h = warmed(), ref = reference();
    drive(h, sinus(72, 0, 40), 30);
    const rs = h.records.slice(-8);
    const got = { map: avg(rs, (b) => b.map), sv: avg(rs, (b) => b.strokeVolume), cvp: avg(rs, (b) => b.p.RA.mean), pcwp: avg(rs, (b) => b.p.LA.mean) };
    say("sinus 72: live", got, "periodic", ref);
    expect(h.records.length).toBeGreaterThan(30);
    expect(rel(got.map, ref.map)).toBeLessThan(0.01);
    expect(rel(got.sv, ref.sv)).toBeLessThan(0.01);
    expect(rel(got.cvp, ref.cvp)).toBeLessThan(0.01);
    expect(rel(got.pcwp, ref.pcwp)).toBeLessThan(0.01);
    // the record carries the BeatHemo fields and more
    const b = rs[rs.length - 1];
    expect(b.interval).toBeCloseTo(60 / 72, 3);
    expect(b.atrialKick).toBe(true);
    expect(b.pvc).toBe(false);
    expect(b.systolic).toBeGreaterThan(b.diastolic + 25);
    expect(b.edv.LV).toBeGreaterThan(b.esv.LV + 40);
    expect(b.tauMs.LV).toBeGreaterThan(25);
    expect(b.tauMs.LV).toBeLessThan(55);
    expect(b.valves.AV.forwardMl).toBeGreaterThan(50);
    expect(b.p.AO.max).toBe(b.systolic);
  }, 120_000);

  it("a PVC at 60 % of the RR gives a small stroke and low systolic pressure; the beat after the compensatory pause is larger with a wider pulse pressure", () => {
    const h = warmed(), T = 60 / 72, pr = defaultPr(T);
    const n = 20, beats: Beat[] = sinus(72, 0, n * T);
    const tPvc = (n - 1) * T + 0.6 * T;
    beats.push({ t: tPvc, rr: 0.6 * T, pvc: true });
    beats.push({ t: (n + 0) * T + 0 * T, rr: T, pvc: false, pr, pOnly: true }); // the sinus P that falls inside the PVC cannot conduct
    for (let k = n + 1; k < n + 8; k++) beats.push({ t: k * T, rr: T, pvc: false, pr });
    beats.sort((a, b) => a.t - b.t);
    drive(h, beats, (n + 7) * T);
    const i = h.records.findIndex((b) => b.pvc);
    expect(i).toBeGreaterThan(3);
    const normal = h.records[i - 1], pvc = h.records[i], after = h.records[i + 1];
    say("PVC: SV", normal.strokeVolume, pvc.strokeVolume, after.strokeVolume, "sys", normal.systolic, pvc.systolic, after.systolic, "PP", normal.systolic - normal.diastolic, after.systolic - after.diastolic, "interval", pvc.interval, after.interval);
    expect(pvc.interval).toBeCloseTo(0.6 * T, 2);
    expect(pvc.atrialKick).toBe(false);
    expect(pvc.strokeVolume).toBeLessThan(0.5 * normal.strokeVolume);
    expect(pvc.systolic).toBeLessThan(normal.systolic - 15);
    expect(after.strength).toBe(LIVE.potentiatedStrength);
    expect(after.strokeVolume).toBeGreaterThan(normal.strokeVolume + 3);
    expect(after.systolic - after.diastolic).toBeGreaterThan(normal.systolic - normal.diastolic + 3);
  }, 120_000);

  /** Complete heart block (atria 80/min, ventricles 41/min, independent): CO, and the RA rise after each atrial event by where it falls. */
  const runChb = () => {
    const h = warmed(), ref = reference();
    const beats: Beat[] = [], pr = 0.16, Tv = 1.46, Ta = 0.75; // 41 per minute: not a multiple of the atrial period, so P waves drift through the cycle
    for (let t = 0; t < 70; t += Tv) beats.push({ t, rr: Tv, pvc: false, noP: true });
    const atrialT: number[] = [];
    for (let t = 0.31; t < 70; t += Ta) { beats.push({ t: t + pr, rr: Tv, pvc: false, pr, pOnly: true }); atrialT.push(t); }
    beats.sort((a, b) => a.t - b.t);
    drive(h, beats, 60);
    const rs = h.records.filter((b) => b.t > 20);
    const cb = co(rs);
    say("CHB: CO", cb, "sinus CO", ref.co, "SV", mean(rs.map((b) => b.strokeVolume)), "kick", rs.some((b) => b.atrialKick));
    // RA pressure rise after each atrial event, by where it falls in the ventricular cycle
    const tr = h.trace(), ra = tr.p.RA, vent = beats.filter((b) => b.noP).map((b) => b.t);
    const at = (t: number) => { let lo = 0, hi = tr.t.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (tr.t[m] < t) lo = m + 1; else hi = m; } return lo; };
    const sys: number[] = [], dia: number[] = [];
    for (const ta of atrialT) {
      if (ta < 32 || ta > 58) continue;
      const since = ta - Math.max(...vent.filter((v) => v <= ta));
      const i0 = at(ta), i1 = at(ta + 0.12);
      let top = -Infinity; for (let i = i0; i <= i1; i++) top = Math.max(top, ra[i]);
      const rise = top - ra[i0];
      (since < 0.25 ? sys : since > 0.55 && since < Tv - 0.25 ? dia : []).push(rise);
    }
    say("CHB RA rise: systolic atrial events", sys.map((x) => x.toFixed(1)), "diastolic", dia.map((x) => x.toFixed(1)));
    return { cb, ref, sys, dia };
  };

  it("complete heart block (atria 80/min, ventricles 40/min, independent): CO falls and cannon waves appear on the RA trace when an atrial event falls in systole", () => {
    const { cb, ref, sys, dia } = runChb();
    expect(cb).toBeLessThan(0.8 * ref.co);
    expect(sys.length).toBeGreaterThan(2);
    expect(dia.length).toBeGreaterThan(2);
    expect(mean(sys)).toBeGreaterThan(1.2 * mean(dia));
    expect(mean(sys)).toBeGreaterThan(3);
  }, 120_000);

  // Known gap (review of A5b): with valve inertance the ordinary a wave grows, and the cannon wave is only ~1.4x it; clinically
  // cannon waves are often 2-3x. RA waveform amplitudes (cannon a, TR v wave) are a physics follow-up; this flags itself when met.
  it.fails("cannon a waves are at least 1.5x the ordinary a wave (RA waveform amplitude follow-up)", () => {
    const { sys, dia } = runChb();
    expect(mean(sys)).toBeGreaterThan(1.5 * mean(dia));
  }, 120_000);

  it("atrial fibrillation: stroke volume follows the preceding RR (positive correlation) and there are no A waves", () => {
    const h = warmed();
    let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const beats: Beat[] = []; let t = 0;
    while (t < 140) { const rr = 0.4 + 0.7 * rnd(); beats.push({ t, rr, pvc: false, noP: true }); t += rr; }
    drive(h, beats, 120);
    const rs = h.records.filter((b) => b.t > 15);
    const r = corr(rs.map((b) => b.interval), rs.map((b) => b.strokeVolume));
    say("AF: n", rs.length, "corr(RR, SV)", r, "SV range", Math.min(...rs.map((b) => b.strokeVolume)), Math.max(...rs.map((b) => b.strokeVolume)));
    expect(rs.length).toBeGreaterThan(80);
    expect(rs.every((b) => !b.atrialKick)).toBe(true);
    expect(r).toBeGreaterThan(0.5);
    // no atrial activation at all, and no late-diastolic RA rise before the ventricular event (a sinus run has one)
    for (const n of ["RA", "LA"]) expect(h.engine.element<ElastanceChamber>(n).activation(h.engine.t)).toBe(0);
    const bump = (hh: LiveHeart, from: number) => {
      const tr = hh.trace(from), ra = tr.p.RA, out: number[] = [];
      for (const b of hh.records.filter((x) => x.t > from + 1)) {
        const ev = b.t; let lo = -1, hi = -1;
        for (let i = 0; i < tr.t.length; i++) { if (lo < 0 && tr.t[i] >= ev - 0.2) lo = i; if (tr.t[i] <= ev - 0.01) hi = i; }
        if (lo < 0 || hi <= lo) continue;
        let top = -Infinity; for (let i = lo; i <= hi; i++) top = Math.max(top, ra[i]);
        out.push(top - ra[lo]);
      }
      return mean(out);
    };
    const s = warmed(); drive(s, sinus(72, 0, 40), 30);
    const bumpAf = bump(h, 100), bumpSinus = bump(s, 20);
    say("late-diastolic RA rise: AF", bumpAf, "sinus", bumpSinus);
    expect(bumpSinus).toBeGreaterThan(1.5);
    expect(bumpAf).toBeLessThan(0.5 * bumpSinus);
  }, 120_000);

  describe("modifiers", () => {
    /** Steady sinus 72 for 45 s with the modifiers set at 5 s; mean of the last 8 beats. */
    function steady(m: LiveModifiers, hr = 72) {
      const h = warmed(hr);
      drive(h, sinus(hr, 0, 60), 5);
      h.setModifiers(m);
      drive(h, sinus(hr, 0, 60), 50);
      const rs = h.records.slice(-8);
      return { h, map: avg(rs, (b) => b.map), sv: avg(rs, (b) => b.strokeVolume), cvp: avg(rs, (b) => b.p.RA.mean), co: co(rs) };
    }
    const base = steady({});

    it("contractility x1.3 raises SV and MAP", () => {
      const r = steady({ contractility: 1.3 });
      say("contractility 1.3:", r.sv, r.map, "base", base.sv, base.map);
      expect(r.sv).toBeGreaterThan(base.sv * 1.03);
      expect(r.map).toBeGreaterThan(base.map + 1);
    }, 120_000);

    it("resistance x1.5 raises MAP and lowers SV", () => {
      const r = steady({ resistance: 1.5 });
      say("resistance 1.5:", r.sv, r.map, "base", base.sv, base.map);
      expect(r.map).toBeGreaterThan(base.map * 1.1);
      expect(r.sv).toBeLessThan(base.sv);
    }, 120_000);

    it("more venous tone raises CVP and CO", () => {
      const r = steady({ venousTone: 1.5 });
      say("venous tone 1.5: CVP", r.cvp, "CO", r.co, "MAP", r.map, "base", base.cvp, base.co, base.map);
      expect(r.cvp).toBeGreaterThan(base.cvp + 0.5);
      expect(r.co).toBeGreaterThan(base.co * 1.02);
      const lower = steady({ venousTone: 0.7 });
      expect(lower.cvp).toBeLessThan(base.cvp);
      expect(lower.co).toBeLessThan(base.co);
    }, 120_000);

    it("relax x1.5 lengthens the LV relaxation time constant", () => {
      const r = steady({ relax: 1.5 });
      expect(avg(r.h.records.slice(-8), (b) => b.tauMs.LV)).toBeGreaterThan(avg(base.h.records.slice(-8), (b) => b.tauMs.LV) * 1.1);
    }, 120_000);

    it("patches do not compound: the same patch twice gives the same parameters and the same state; an empty set restores the design point", () => {
      const m: LiveModifiers = { contractility: 1.3, resistance: 1.5, venousTone: 1.4, relax: 1.2 };
      const a = new LiveHeart(), b = new LiveHeart();
      const design = () => ({ lv: a.engine.element<ElastanceChamber>("LV").params.ees, bed: (a.engine.element("BEDU") as unknown as { params: { R: number } }).params.R, spl: (a.engine.element("SPL") as unknown as { params: { Vu: number } }).params.Vu });
      const d0 = design();
      a.setModifiers(m);
      b.setModifiers(m); b.setModifiers(m); b.setModifiers({ ...m, preload: 1.4 }); b.setModifiers(m);
      expect(a.engine.element<ElastanceChamber>("LV").params.ees).toBeCloseTo(d0.lv * 1.3, 12);
      expect(design().bed).toBeCloseTo(d0.bed * 1.5, 12);
      expect(design().spl).toBeCloseTo(d0.spl * (1 - 0.8 * 0.4), 12);
      for (const hh of [a, b]) { hh.warm(72); }
      drive(a, sinus(72, 0, 30), 12); drive(b, sinus(72, 0, 30), 12);
      expect(b.last!.map).toBe(a.last!.map);
      expect(b.engine.element<ElastanceChamber>("LV").params.ees).toBe(a.engine.element<ElastanceChamber>("LV").params.ees);
      a.setModifiers({});
      expect(design()).toEqual(d0);
    }, 120_000);
  });

  it("a rate change from 60 to 120 bpm: no NaN, diastolic filling shortens, and the engine settles", () => {
    const h = warmed(60);
    drive(h, [...sinus(60, 0, 25), ...sinus(120, 25, 60)], 55);
    const finite = (x: number) => Number.isFinite(x);
    expect(h.records.every((b) => finite(b.map) && finite(b.strokeVolume) && finite(b.systolic) && finite(b.diastolic) && finite(b.edv.LV))).toBe(true);
    const tr = h.trace();
    expect(tr.p.AO.every(finite) && tr.p.RA.every(finite) && tr.v.LV.every(finite)).toBe(true);
    for (let i = 1; i < tr.t.length; i++) if (!(tr.t[i] > tr.t[i - 1])) throw new Error(`trace time not increasing at ${i}`);
    const slow = h.records.filter((b) => b.t > 15 && b.t < 24), fast = h.records.filter((b) => b.t > 48);
    say("60 -> 120: EDV", avg(slow, (b) => b.edv.LV), avg(fast, (b) => b.edv.LV), "SV", avg(slow, (b) => b.strokeVolume), avg(fast, (b) => b.strokeVolume), "MAP", avg(slow, (b) => b.map), avg(fast, (b) => b.map));
    expect(avg(fast, (b) => b.interval)).toBeCloseTo(0.5, 2);
    expect(avg(fast, (b) => b.edv.LV)).toBeLessThan(avg(slow, (b) => b.edv.LV));
    expect(avg(fast, (b) => b.valves.MV.openMs)).toBeLessThan(avg(slow, (b) => b.valves.MV.openMs));
    const last = fast.slice(-6).map((b) => b.map);
    expect((Math.max(...last) - Math.min(...last)) / mean(last)).toBeLessThan(0.015);
  }, 120_000);

  it("the trace ring buffer holds at most LIVE.traceSeconds (60 s since C7, as long as the beat ring) at 2 ms with strictly increasing time", () => {
    const h = warmed();
    drive(h, sinus(72, 0, 90), 70);
    const tr = h.trace();
    expect(tr.t.length).toBeLessThanOrEqual(Math.ceil(LIVE.traceSeconds / LIVE.traceEvery) + 2);
    expect(tr.t[tr.t.length - 1] - tr.t[0]).toBeGreaterThan(LIVE.traceSeconds - 1);
    expect(tr.t[tr.t.length - 1] - tr.t[0]).toBeLessThan(LIVE.traceSeconds + 0.1);
    for (let i = 1; i < tr.t.length; i++) expect(tr.t[i]).toBeGreaterThan(tr.t[i - 1]);
    expect(Object.keys(tr.p)).toContain("SPL");
    expect(tr.v.LV.length).toBe(tr.t.length);
  }, 120_000);

  it("performance: 60 s of live sinus at 72 bpm runs at least 20x real time", () => {
    const h = warmed();
    const beats = sinus(72, 0, 62);
    const t0 = performance.now();
    drive(h, beats, 60);
    const wall = (performance.now() - t0) / 1000;
    console.log(`LiveHeart: 60 s of sinus at 72 bpm in ${wall.toFixed(2)} s wall = ${(60 / wall).toFixed(0)}x real time`);
    expect(60 / wall).toBeGreaterThanOrEqual(20);
  }, 120_000);
});
