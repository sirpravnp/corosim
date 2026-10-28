// The shown mean arterial pressure lies between the diastolic and the systolic, also while the pressure is falling fast (a hemorrhage with
// ectopy): the 30 s flow window used to give a mean above the systolic of the last steady beats (a crash read 34/28 with a mean of 65).
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";
import { CASE_BY_ID } from "../src/cath/cases";

describe("mean arterial pressure during a crash", () => {
  it("never reads outside [diastolic, systolic]", () => {
    const sim = new Simulation({}, { engine: "core" });
    const src = new LiveSource(sim);
    sim.reset({ seed: 3, ...CASE_BY_ID.ladocc.scenario, ectopyTendency: 3, fluids: { hemorrhageMlMin: 200 } }, { settled: true });
    sim.warmup(10);
    let samples = 0;
    for (let s = 0; s < 40; s += 0.25) {
      sim.step(0.25, { minutes: 0.25 * 6 });
      if (Math.round(s * 4) % 8 !== 0) continue; // every 2 s
      const n = src.numbers();
      if (!Number.isFinite(n.systolic) || !Number.isFinite(n.diastolic) || !Number.isFinite(n.map)) continue;
      samples++;
      expect(n.map).toBeLessThanOrEqual(n.systolic + 1e-9);
      expect(n.map).toBeGreaterThanOrEqual(n.diastolic - 1e-9);
    }
    expect(samples).toBeGreaterThan(10);
  });
});
