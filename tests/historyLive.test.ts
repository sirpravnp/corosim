// C7 on the live engine: the source's history feeds the loops panel (whole steady beats only) and the paused-traces review (a minute of trace).
import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";
import type { PatientSpec } from "../src/sim/patient";
import { loopHistory } from "../src/panels/loopHistory";
import { REVIEW_SECONDS, windowSeries } from "../src/panels/traceMath";

function patient(spec: PatientSpec = {}) {
  const sim = new Simulation({}, { engine: "core" });
  const src = new LiveSource(sim);
  sim.reset({ seed: 3, ...spec }, { settled: true });
  sim.warmup(20); sim.run(70);
  return { sim, src };
}

describe("history of a normal patient", () => {
  const { src } = patient();
  it("shows about 30 s of loops", () => {
    const h = loopHistory(src.beats(200), src.now(), 30);
    expect(h.used).toBe("steady");
    expect(h.beats.length).toBeGreaterThan(28); expect(h.beats.length).toBeLessThan(50);
    expect(h.beats[0].t + h.beats[0].rr).toBeGreaterThanOrEqual(src.now() - 30);
  });
  it("keeps a minute of trace for the paused review, and a 30 s window cut from it matches the live 30 s", () => {
    const kept = src.trace("AO", REVIEW_SECONDS, { maxPoints: 40000 });
    expect(kept.t[kept.t.length - 1] - kept.t[0]).toBeGreaterThan(REVIEW_SECONDS - 1);
    const now = src.now(), win = windowSeries(kept, now - 30, now);
    const live = src.trace("AO", 30, { maxPoints: 40000 });
    expect(Math.abs(win.t.length - live.t.length)).toBeLessThan(10);
    const back = windowSeries(kept, now - 50, now - 20);
    expect(back.t[0]).toBeGreaterThanOrEqual(now - 50 - 0.01);
    expect(back.t[back.t.length - 1]).toBeLessThanOrEqual(now - 20 + 0.01);
    expect(back.t.length).toBeGreaterThan(10000);
  });
});

describe("history in an anterior STEMI", () => {
  // seed 9 is the most ectopy-prone patient of ectopySim.test.ts: a proximal LAD occlusion gives it plenty of premature beats
  const sim = new Simulation({}, { engine: "core" });
  const src = new LiveSource(sim);
  sim.reset({ seed: 9 });
  sim.warmup(10);
  sim.apply({ lesions: [{ artery: "LAD", occluded: true, position: 0.1 }] });
  sim.run(70);
  it("draws no premature, cut-short or settling beats", () => {
    const all = src.beats(200);
    expect(all.some((b) => b.pvc)).toBe(true); // the scenario has ectopy, so the check below is not vacuous
    const h = loopHistory(all, src.now(), 30);
    expect(h.beats.length).toBeGreaterThan(0);
    for (const b of h.beats) {
      const i = all.indexOf(b);
      expect(b.pvc).toBe(false); expect(b.prematureNext).toBeFalsy();
      for (let k = Math.max(0, i - 3); k < i; k++) expect(all[k].pvc).toBe(false);
    }
  });
});
