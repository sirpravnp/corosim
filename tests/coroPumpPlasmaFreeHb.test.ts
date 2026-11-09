import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";

describe("plasmaFreeHb()", () => {
  it("persists after the pump is removed", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset(
      { bloodLoss: 0.2, devices: { coroPump: { level: 9, position: "deep" } }, support: { coroPump: true } },
      { settled: true },
    );
    s.warmup(15);
    s.step(600);
    const pf = s.plasmaFreeHb();
    expect(pf).toBeGreaterThan(40);
    s.apply({ support: { coroPump: false }, devices: { coroPump: { level: 0 } } });
    expect(s.plasmaFreeHb()).toBe(pf);
    expect(s.devices()?.coroPump?.on).toBe(false);
  });
});
