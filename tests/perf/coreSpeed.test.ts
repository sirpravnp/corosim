/**
 * Speed of the core engine. Wall-clock benchmarks run after the rest of the suite and on their own (`npm test` runs this folder
 * separately), so other test files competing for the CPU do not decide the result.
 */
import { describe, it, expect } from "vitest";
import { Simulation } from "../../src/sim/simulation";

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2; };

/** Median of three cold-then-warm runs; avoids a single slow CI sample just under the budget (see scripts/bench-engine.ts). */
const coreSpeedX = (): number => {
  const s = new Simulation({}, { engine: "core" });
  s.reset({ seed: 3 }, { settled: true });
  s.warmup(5);
  s.history = [];
  const t0 = performance.now();
  s.step(60);
  const wall = (performance.now() - t0) / 1000;
  return 60 / wall;
};

describe("speed", () => {
  it("runs at least 20x real time with the whole ACS model on the core engine", () => {
    const xs = [coreSpeedX(), coreSpeedX(), coreSpeedX()];
    const x = median(xs);
    if (process.env.CORE_VERBOSE) console.log("60 s core speed (median of 3):", x, "x real time", xs);
    expect(x).toBeGreaterThan(20);
  }, 120_000);
});
