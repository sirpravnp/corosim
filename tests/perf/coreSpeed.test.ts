/**
 * Speed of the core engine. Wall-clock benchmarks run after the rest of the suite and on their own (`npm test` runs this folder
 * separately), so other test files competing for the CPU do not decide the result.
 */
import { describe, it, expect } from "vitest";
import { Simulation } from "../../src/sim/simulation";

describe("speed", () => {
  it("runs at least 20x real time with the whole ACS model on the core engine", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 3 }, { settled: true });
    s.warmup(5); s.history = [];
    const t0 = performance.now(); s.step(60); const wall = (performance.now() - t0) / 1000;
    if (process.env.CORE_VERBOSE) console.log("60 s of core mode took", wall, "s =", 60 / wall, "x real time");
    expect(60 / wall).toBeGreaterThan(20);
  }, 60_000);
});
