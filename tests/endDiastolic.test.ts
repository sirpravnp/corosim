/**
 * End-diastolic readings with ectopy. A beat's "end" is the moment the next beat starts; when that next beat is a premature one
 * (common after an occlusion) the ventricle is still relaxing or ejecting then, so its LVEDP read 70-90 mmHg and the panel's
 * LVEDP and EF jumped around. Those beats are left out of the end-diastolic averages.
 */
import { describe, it, expect } from "vitest";
import { endDiastolicBeats } from "../src/physics/core/live";
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
