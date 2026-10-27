// The ectopy model inside the full Simulation on the core engine (task B3a): an occluded proximal LAD in a few patients, then
// Reperfuse (the lesion removed, as the page's button does). Slow (the core engine): listed in tests/slow.json. The rate model
// itself is tested over many seeds, without hemodynamics, in ectopy.test.ts.
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { explain } from "../src/sim/explain";
import { susceptibility } from "../src/physics/ectopy";

const LAD = [{ artery: "LAD", occluded: true, position: 0.1 }];
// Seeds picked for their susceptibility: 11 (0.10), 2 (1.0), 19 (2.6), 9 (5.1).
const SEEDS = [11, 2, 19, 9];

function course(seed: number) {
  const s = new Simulation({}, { engine: "core" });
  s.reset({ seed, arrhythmiaTendency: 0 }); // B3b's VT runs are held out: this measures the PVC model (runs of VT are themselves premature beats)
  s.warmup(10);
  let n = 0, p = 0;
  s.onBeat = (b) => { n++; if (b.pvc) p++; };
  const take = () => { const r = { n, p, share: n ? p / n : 0 }; n = p = 0; return r; };
  s.apply({ lesions: LAD });
  s.run(60); // the first 2 clinical hours of the occlusion
  const occluded = take(), rateBefore = s.stream.ectopy!.rate(), text = explain(s).mechanisms.join(" ");
  s.apply({ lesions: [] }); // Reperfuse
  s.run(30);
  const reperfused = take();
  return { seed, occluded, reperfused, rateBefore, rateAfter: s.stream.ectopy!.rate(), phase: s.stream.ectopy!.phase(), text, state: s.state().rhythm };
}

describe("core engine: ischemic PVCs in the Simulation", () => {
  const runs = SEEDS.map(course);
  it("the PVC share over the first clinical hours of a proximal LAD occlusion differs a lot between patients", () => {
    const sh = runs.map((r) => r.occluded.share);
    expect(susceptibility(9)).toBeGreaterThan(10 * susceptibility(11));
    expect(Math.max(...sh)).toBeGreaterThan(0.04);
    expect(Math.min(...sh)).toBeLessThan(0.01);
    expect(Math.max(...sh)).toBeLessThan(0.3); // not the old flat 25% of beats for every patient
    expect(runs.find((r) => r.seed === 9)!.occluded.share).toBeGreaterThan(runs.find((r) => r.seed === 11)!.occluded.share);
  });
  it("after Reperfuse the expected rate rises (a reperfusion burst) and the share follows it", () => {
    for (const r of runs) {
      expect(r.phase, `seed ${r.seed}`).toBe("reperfusion");
      expect(r.rateAfter, `seed ${r.seed}`).toBeGreaterThan(r.rateBefore);
    }
    const pooled = (k: "occluded" | "reperfused") => runs.reduce((a, r) => a + r[k].p, 0) / runs.reduce((a, r) => a + r[k].n, 0);
    expect(pooled("reperfused")).toBeGreaterThan(pooled("occluded"));
  });
  it("the explanation reports the measured ectopy, not the old threshold sentence; the state carries it", () => {
    for (const r of runs) {
      expect(r.text).toMatch(/(Frequent|Occasional|No) premature ventricular beats/);
      expect(r.text).not.toMatch(/ectopy threshold/);
      expect(r.state.ectopy?.phase).toBe("reperfusion");
    }
  });
  it("the legacy engine keeps the old sentence", () => {
    const s = new Simulation({ seed: 3, lesions: LAD });
    s.reset({ seed: 3, lesions: LAD }, { settled: true });
    s.run(5);
    expect(explain(s).mechanisms.join(" ")).toMatch(/ectopy threshold/);
    expect(s.state().rhythm.ectopy).toBeUndefined();
  });
});
