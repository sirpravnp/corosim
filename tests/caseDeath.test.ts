import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { ARREST } from "../src/config/arrest";
import { shockDeathStep } from "../src/sim/arrest";
import { ECPELLA } from "../src/cases/ecpella";

const core = (spec = {}) => { const s = new Simulation({ seed: 7 }, { engine: "core" }); s.reset(spec, { settled: true }); s.warmup(5); return s; };

describe("how a patient dies", () => {
  it("CPR alone holds VF for a while but no longer for twenty minutes", () => {
    const s = core(ECPELLA.start);
    s.apply({ patient: { rhythm: "vf-coarse" } }); s.step(1); s.startCpr();
    let t = 0; while (!s.dead && t < 1500) { s.step(30); t += 30; }
    expect(s.dead).toBe(true); expect(s.deathCause).toBe("noFlow");
    expect(t).toBeGreaterThan(ARREST.deathAfterNoFlowS); // CPR still buys time over no CPR
    expect(t).toBeLessThan(1200);
  }, 120000);
  it("refractory shock: pressure held under the line for long enough kills, and a recovery runs the count back down", () => {
    const K = ARREST.shockDeath;
    let acc = 0, dead = false;
    for (let s = 0; s < K.seconds - 1; s++) ({ acc, dead } = shockDeathStep(acc, K.map - 5, 1));
    expect(dead).toBe(false); // not yet
    ({ acc, dead } = shockDeathStep(acc, K.map - 5, 2)); expect(dead).toBe(true);
    let r = { acc: 10, dead: false };
    for (let s = 0; s < 20; s++) r = shockDeathStep(r.acc, K.map + 20, 1); // pressure back above the line
    expect(r.acc).toBe(0); expect(r.dead).toBe(false);
  });
  it("a patient with a pulse and a normal pressure does not die", () => {
    const fine = core({}); for (let i = 0; i < 30; i++) fine.step(10);
    expect(fine.dead).toBe(false); expect(fine.deathCause).toBeNull();
  }, 60000);
});

describe("what the no-flow clock credits", () => {
  const rate = (setup: (s: Simulation) => void, cpr = {}) => {
    const s = core(ECPELLA.start);
    s.apply({ patient: { rhythm: "vf-coarse" } }); s.step(1); s.startCpr(cpr); setup(s); s.step(30);
    const a0 = s.arrestState().noFlowS; s.step(90);
    return (s.arrestState().noFlowS - a0) / 90;
  };
  it("poor compressions run the clock faster than good ones (low perfusion pressure earns less credit)", () => {
    expect(rate(() => {}, { quality: 0.5 })).toBeGreaterThan(rate(() => {}) + 0.1);
  }, 120000);
  it("a heavy bleed does not make CPR flow read as many times normal, so it still runs the clock", () => {
    const s = core({ ...ECPELLA.start, bloodLoss: 0.3 });
    s.apply({ patient: { rhythm: "vf-coarse" } }); s.step(1); s.startCpr(); s.step(30);
    const out = (s as unknown as { outputFraction(): number }).outputFraction();
    expect(out).toBeLessThan(1.5);
  }, 120000);
});
