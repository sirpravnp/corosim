// Additions to the live heart for the ACS simulation on the core engine (A7): per-ventricle Ees and stiffness factors that multiply the
// autonomic contractility, beat strength above 1 scaling Ees (not activation), and an atrial kick that needs an atrial event.
import { describe, it, expect } from "vitest";
import { LiveHeart } from "../src/physics/core/live";
import { ElastanceChamber } from "../src/physics/core/chamber";
import { defaultPr } from "../src/physics/core/fromModel";
import type { Beat } from "../src/physics/ecg";
import { ISCHEMIA, ischemiaFactors } from "../src/config/ischemia";
import { BRIDGE } from "../src/config/bridge";

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
function sinus(hr: number, t0: number, t1: number): Beat[] {
  const T = 60 / hr, out: Beat[] = [];
  for (let t = t0; t < t1; t += T) out.push({ t, rr: T, pvc: false, pr: defaultPr(T) });
  return out;
}
function drive(h: LiveHeart, beats: Beat[], until: number, tick = 0.01) {
  let i = 0;
  const next = () => { while (i < beats.length && beats[i].t < h.time + 0.5) h.onBeat(beats[i++]); };
  while (h.time < until - 1e-9) { next(); h.step(Math.min(tick, until - h.time)); }
}
const steady = (setup: (h: LiveHeart) => void, secs = 25) => {
  const h = new LiveHeart(); setup(h); h.warm(72); drive(h, sinus(72, 0, secs + 2), secs);
  const rs = h.records.slice(-8);
  return { h, sv: mean(rs.map((b) => b.strokeVolume)), lvedp: mean(rs.map((b) => b.p.LV.end)), map: mean(rs.map((b) => b.map)), edv: mean(rs.map((b) => b.edv.LV)), rvedp: mean(rs.map((b) => b.p.RV.end)) };
};

describe("ischemia constants", () => {
  it("are shared and unchanged from the bridge's validated values", () => {
    expect(ISCHEMIA).toMatchObject({ lvEesLoss: 1.25, rvEesLoss: 0.8, lvStiffGain: 1.5, rvStiffGain: 2 });
    expect(Object.keys(BRIDGE)).not.toContain("lvEesLoss");
    expect(ischemiaFactors(0, 0)).toEqual({ lvEes: 1, rvEes: 1, lvStiffness: 1, rvStiffness: 1 });
    const f = ischemiaFactors(0.4, 0.5);
    expect(f.lvEes).toBeCloseTo(0.5, 12); expect(f.rvEes).toBeCloseTo(0.6, 12); expect(f.lvStiffness).toBeCloseTo(1.6, 12); expect(f.rvStiffness).toBeCloseTo(2, 12);
    expect(ischemiaFactors(1, 1).lvEes).toBe(0.2); // the floor
  });
});

describe("beat strength above 1", () => {
  const mk = () => { const c = new ElastanceChamber("LV", { v0: 10, ees: 2, a: 0.5, b: 0.04 }, "ventricular", 0.83); c.onEvent({ kind: "ventricular", t: 0, strength: 1 }); return c; };
  it("scales Ees, not activation: the activation stays within 0..1 and the passive term never goes negative", () => {
    const c = mk(), d = new ElastanceChamber("LV", { v0: 10, ees: 2, a: 0.5, b: 0.04 }, "ventricular", 0.83);
    d.onEvent({ kind: "ventricular", t: 0, strength: 1.3 });
    let top = 0;
    for (let t = 0; t < 0.8; t += 0.002) {
      expect(d.activation(t)).toBeLessThanOrEqual(1.001); // 1 within the sampling of the curve's peak
      expect(d.activation(t)).toBeCloseTo(c.activation(t), 12); // same time course
      top = Math.max(top, d.activation(t));
    }
    expect(top).toBeGreaterThan(0.99);
    expect(d.eesGain).toBe(1.3); expect(c.eesGain).toBe(1);
    // at the activation peak the pressure is 1.3 x the Ees term, and at rest (no activation) the same passive curve
    const tp = c.peakTime, v = 60;
    expect(d.pressure(v, tp)).toBeCloseTo(c.pressure(v, tp) + 0.3 * c.activation(tp) * 2 * (v - 10), 9);
    expect(d.pressure(v, 5)).toBeCloseTo(c.pressure(v, 5), 9);
  });
  it("a weak beat (below 1) still scales the activation", () => {
    const d = new ElastanceChamber("LV", { v0: 10, ees: 2, a: 0.5, b: 0.04 }, "ventricular", 0.83);
    d.onEvent({ kind: "ventricular", t: 0, strength: 0.6 });
    expect(d.eesGain).toBe(1);
    expect(Math.max(...Array.from({ length: 400 }, (_, i) => d.activation(i * 0.002)))).toBeCloseTo(0.6, 3);
  });
});

describe("per-ventricle factors", () => {
  const base = steady(() => {});
  it("set the design point's Ees and stiffness of each ventricle and multiply the autonomic contractility", () => {
    const h = new LiveHeart(), lv = h.engine.element<ElastanceChamber>("LV"), rv = h.engine.element<ElastanceChamber>("RV");
    const ees = [lv.params.ees, rv.params.ees], a = [lv.params.a, rv.params.a];
    h.setVentricleFactors({ lvEes: 0.5, rvEes: 0.7, lvStiffness: 2, rvStiffness: 3 });
    h.setModifiers({ contractility: 1.2 });
    expect(lv.params.ees).toBeCloseTo(ees[0] * 0.5 * 1.2, 12); expect(rv.params.ees).toBeCloseTo(ees[1] * 0.7 * 1.2, 12);
    expect(lv.params.a).toBeCloseTo(a[0] * 2, 12); expect(rv.params.a).toBeCloseTo(a[1] * 3, 12);
    // neither call undoes the other, and repeating them does not compound
    h.setModifiers({ contractility: 1.2 }); h.setVentricleFactors({ lvEes: 0.5, rvEes: 0.7, lvStiffness: 2, rvStiffness: 3 });
    expect(lv.params.ees).toBeCloseTo(ees[0] * 0.5 * 1.2, 12);
    h.setModifiers({}); expect(lv.params.ees).toBeCloseTo(ees[0] * 0.5, 12);
    h.setVentricleFactors({}); expect(lv.params.ees).toBeCloseTo(ees[0], 12); expect(lv.params.a).toBeCloseTo(a[0], 12);
    expect(h.ventricleFactors).toEqual({ lvEes: 1, rvEes: 1, lvStiffness: 1, rvStiffness: 1 });
  });
  it("a weaker left ventricle ejects less and a stiffer one has a higher end-diastolic pressure", () => {
    const weak = steady((h) => h.setVentricleFactors({ lvEes: 0.5 })), stiff = steady((h) => h.setVentricleFactors({ lvStiffness: 2.5 }));
    expect(weak.sv).toBeLessThan(0.93 * base.sv); expect(weak.map).toBeLessThan(base.map - 3);
    expect(weak.sv / weak.edv).toBeLessThan(base.sv / base.edv - 0.05); // lower ejection fraction
    expect(stiff.lvedp).toBeGreaterThan(base.lvedp + 2);
    expect(stiff.edv).toBeLessThan(base.edv); // and it fills less
  });
  it("act on the named ventricle only", () => {
    const rv = steady((h) => h.setVentricleFactors({ rvStiffness: 3 }));
    expect(rv.rvedp).toBeGreaterThan(base.rvedp + 1);
    expect(Math.abs(rv.lvedp - base.lvedp)).toBeLessThan(2.5);
  });
});

describe("atrial kick from an atrial event", () => {
  it("is true in sinus rhythm, false without a P wave, and false when the P wave was not delivered", () => {
    const h = new LiveHeart(); h.warm(72);
    const T = 60 / 72, beats: Beat[] = sinus(72, 0, 12);
    for (const b of beats) if (b.t > 4 && b.t < 5.5) b.noP = true; // junctional beats: no atrial event
    const dropped = beats.find((b) => b.t > 8)!; dropped.pOnly = false; dropped.noP = true;
    drive(h, beats, 11);
    const at = (t: number) => h.records.find((r) => Math.abs(r.t - t) < 0.01)!;
    expect(at(T * 3).atrialKick).toBe(true);
    for (const b of beats.filter((x) => x.noP)) expect(at(b.t).atrialKick, `t=${b.t.toFixed(2)}`).toBe(false);
    expect(at(T * 12).atrialKick).toBe(true);
  }, 60_000);
  it("is true for an escape beat that happens to follow a dissociated P wave within the PR window, false for one that does not", () => {
    const h = new LiveHeart(); h.warm(72);
    const beats: Beat[] = [];
    // ventricles every 1.5 s (noP), atria every 0.9 s (pOnly); P at 1.40 precedes the QRS at 1.5 by 0.10 s, P at 2.3 precedes 3.0 by 0.7 s
    for (let t = 0; t < 14; t += 1.5) beats.push({ t, rr: 1.5, pvc: false, noP: true });
    for (let t = 0.5; t < 14; t += 0.9) beats.push({ t: t + 0.16, rr: 1.5, pvc: false, pr: 0.16, pOnly: true });
    beats.sort((a, b) => a.t - b.t);
    drive(h, beats, 12);
    const vent = beats.filter((b) => b.noP), pt = beats.filter((b) => b.pOnly).map((b) => b.t - 0.16);
    let yes = 0, no = 0;
    for (const v of vent) {
      const r = h.records.find((x) => Math.abs(x.t - v.t) < 0.01);
      if (!r) continue;
      const lead = pt.filter((p) => p <= v.t).map((p) => v.t - p).sort((a, b) => a - b)[0];
      if (lead === undefined || v.t < 3) continue; // before the first P wave / the first beats the warm-up decides
      const want = lead >= 0.04 && lead <= 0.35;
      expect(r.atrialKick, `QRS ${v.t.toFixed(2)}, nearest P ${lead.toFixed(2)} s before`).toBe(want);
      if (want) yes++; else no++;
    }
    expect(yes).toBeGreaterThan(0); expect(no).toBeGreaterThan(0);
  }, 60_000);
});
