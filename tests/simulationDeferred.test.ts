import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";

// The page builds the core engine in chunks between frames (task P16b): the result must be the one the synchronous build gives.
describe("deferred core build", () => {
  it("settles in many small chunks to exactly the state of the synchronous build", () => {
    const a = new Simulation({ seed: 1 }, { engine: "core" });
    a.warmup(20); a.step(5);
    const d = new Simulation({ seed: 1 }, { engine: "core", deferCore: true });
    expect(d.settling).toBe(true);
    expect(d.live).toBeUndefined();
    d.warmup(20); // follows the build
    expect(d.step(1)).toBe(0); // the clock holds while the engine is built
    expect(d.t).toBe(0);
    let chunks = 0;
    while (!d.settleStep(0)) chunks++; // budget 0: one chunk per call
    expect(chunks).toBeGreaterThan(30); // a beat of the heart's warm-up, or a quarter second of reflex warm-up, each
    expect(d.settling).toBe(false);
    expect(d.live).toBeDefined();
    d.step(5);
    expect(d.t).toBeCloseTo(a.t, 9);
    expect(d.circ.map).toBeCloseTo(a.circ.map, 9);
    expect(d.history.length).toBe(a.history.length);
    expect(d.circ).toEqual(a.circ);
  }, 60000);

  it("a patient change rebuilds in chunks, and an edit made meanwhile is applied when it is done", () => {
    const d = new Simulation({ seed: 1 }, { engine: "core", deferCore: true });
    d.settleNow();
    d.step(3);
    const t = d.t;
    d.setPatient({ heart: { lvEes: 0.6 } });
    expect(d.settling).toBe(true);
    expect(d.step(1)).toBe(0);
    expect(d.t).toBe(t);
    d.setPatient({ heart: { lvEes: 0.6 }, pericardium: { effusionMl: 0 } }); // the sac is added: a second request replaces the first
    d.settleNow();
    expect(d.settling).toBe(false);
    d.step(3);
    expect(d.t).toBeCloseTo(t + 3, 9);
    expect(Number.isFinite(d.circ.map)).toBe(true);
  }, 60000);

  it("a reset while building starts over and is not left pending twice", () => {
    const d = new Simulation({ seed: 1 }, { engine: "core", deferCore: true });
    d.settleStep(0);
    d.reset({}, { warmup: 2 });
    d.settleNow();
    expect(d.settling).toBe(false);
    expect(d.live).toBeDefined();
    expect(d.t).toBeCloseTo(2, 9);
  }, 60000);
});
