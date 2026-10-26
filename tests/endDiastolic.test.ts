/**
 * End-diastolic readings with ectopy. A beat's "end" is the moment the next beat starts; when that next beat is a premature one
 * (common after an occlusion) the ventricle is still relaxing or ejecting then, so its LVEDP read 70-90 mmHg and the panel's
 * LVEDP and EF jumped around. Those beats are left out of the end-diastolic averages.
 */
import { describe, it, expect } from "vitest";
import { endDiastolicBeats } from "../src/physics/core/live";
import { loopGap } from "../src/physics/loopMath";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";
import { CASE_BY_ID } from "../src/cath/cases";

describe("endDiastolicBeats", () => {
  const b = (pvc: boolean, id: number) => ({ pvc, id });
  it("drops the beat before a premature beat and the newest beat", () => {
    const beats = [b(false, 1), b(false, 2), b(true, 3), b(false, 4), b(false, 5)];
    expect(endDiastolicBeats(beats, (x) => x.pvc).map((x) => x.id)).toEqual([1, 3, 4]);
  });
  it("falls back to every beat when none qualifies", () => {
    expect(endDiastolicBeats([b(false, 1)], (x) => x.pvc).map((x) => x.id)).toEqual([1]);
  });
});

describe("anterior STEMI on the live page source", () => {
  it("LVEDP rises into the 18-30 mmHg range and stays there; EF stays in the ischemic range (no jumps from premature beats)", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 3 }, { settled: true }); s.warmup(20);
    const src = new LiveSource(s);
    s.apply({ lesions: CASE_BY_ID.ladocc.scenario.lesions });
    for (let i = 0; i < 400; i++) s.step(0.1); // 40 s: the ischemia has developed
    const lvedp: number[] = [], ef: number[] = [];
    for (let k = 0; k < 8; k++) { for (let i = 0; i < 50; i++) s.step(0.1); const n = src.numbers(); lvedp.push(n.lvedp); ef.push(n.lvEf); }
    for (const p of lvedp) { expect(p).toBeGreaterThan(18); expect(p).toBeLessThan(30); }
    expect(Math.max(...lvedp) - Math.min(...lvedp)).toBeLessThan(6);
    for (const e of ef) { expect(e).toBeGreaterThan(0.2); expect(e).toBeLessThan(0.5); }
    const h = s.hemo(8)!;
    expect(h.lvedp).toBeGreaterThan(18); expect(h.lvedp).toBeLessThan(30);
  }, 120_000);
});

describe("pressure-volume loops with premature beats (anterior STEMI, with and without an Impella)", () => {
  const run = (impella: boolean) => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 3, ...CASE_BY_ID.ladocc.scenario }, { settled: true }); s.warmup(25);
    const src = new LiveSource(s);
    if (impella) s.apply({ devices: { impella: { model: "CP", level: 8, position: "correct" } }, support: { impella: true } });
    s.step(100);
    return src.beats(60);
  };
  const gap = (b: ReturnType<typeof run>[number]) => loopGap(b.loops.LV.p, b.loops.LV.v);
  for (const impella of [false, true]) {
    it(`${impella ? "with" : "without"} an Impella: a beat before a premature beat is flagged; a beat between ordinary beats is a closed cycle`, () => {
      const beats = run(impella);
      // a beat settles back to a closed cycle about three beats after a premature one
      const steady = beats.filter((b, i) => !b.pvc && !b.prematureNext && i >= 3 && !beats[i - 1].pvc && !beats[i - 2].pvc && !beats[i - 3].pvc);
      expect(steady.length).toBeGreaterThan(0);
      for (const b of steady) expect(gap(b)).toBeLessThan(0.12); // closes: the panel joins its ends
      const cut = beats.filter((b) => b.prematureNext);
      expect(cut.length).toBeGreaterThan(0);
      for (const b of cut) expect(gap(b)).toBeGreaterThan(0.12); // cut short: the panel leaves it open
      for (let i = 0; i + 1 < beats.length; i++) expect(!!beats[i].prematureNext).toBe(beats[i + 1].pvc);
    }, 120_000);
  }
  it("loopGap is 0 for a closed cycle and large for an open arc", () => {
    const th = Array.from({ length: 40 }, (_, i) => (2 * Math.PI * i) / 40);
    const v = th.map((t) => 100 + 30 * Math.cos(t)), p = th.map((t) => 60 + 40 * Math.sin(t));
    expect(loopGap(p, v)).toBeLessThan(0.2); // 40 samples round a circle: the last is one step from the first
    expect(loopGap(p.slice(0, 20), v.slice(0, 20))).toBeGreaterThan(0.8); // half a circle
  });
  it("the Impella shifts the loop left and the aortic valve passes only part of what leaves the ventricle", () => {
    const base = run(false).filter((b) => !b.pvc && !b.prematureNext).slice(-1)[0], imp = run(true).filter((b) => !b.pvc && !b.prematureNext).slice(-1)[0];
    expect(imp.edv.LV).toBeLessThan(base.edv.LV - 10);
    const total = imp.edv.LV - imp.esv.LV, native = imp.valves.AV.forwardMl - imp.valves.AV.regurgMl;
    expect(total - native).toBeGreaterThan(10); // the pump's share, which the loops panel now reports
  }, 120_000);
});
