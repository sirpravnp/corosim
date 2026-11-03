// E6: time-stepped oxygen transport — steady match, lactate under low DO₂, demand ischemia / reperfusion debt, Simulation wiring.
import { describe, it, expect } from "vitest";
import { buildModel, simulate, solveOxygen } from "../src/physics/structural";
import {
  OxygenTransport, debtInjury, estimateMvo2MlMin, mvo2DemandScale, scaiStage, steadyMatchError, stepLactate, stepMyocardialDebt,
} from "../src/physics/core/oxygen";
import { OXYGEN } from "../src/config/oxygen";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";

describe("oxygen helpers", () => {
  it("SCAI rises with lactate and low MAP", () => {
    expect(scaiStage(1.0, 90)).toBe("A");
    expect(scaiStage(2.5, 90)).toBe("B");
    expect(scaiStage(4.5, 65)).toBe("C");
    expect(scaiStage(9, 50)).toBe("D");
    expect(scaiStage(1, 35)).toBe("E");
  });
  it("MVO2 demand scale blends and falls back to 1", () => {
    expect(mvo2DemandScale(null)).toBe(1);
    expect(mvo2DemandScale(OXYGEN.restingMvo2MlMin)).toBeCloseTo(1, 9);
    expect(mvo2DemandScale(OXYGEN.restingMvo2MlMin * 2)).toBeGreaterThan(1);
    expect(mvo2DemandScale(OXYGEN.restingMvo2MlMin * 0.5)).toBeLessThan(1);
  });
  it("debtInjury is a soft max overlay; gain 0 leaves severity alone", () => {
    expect(debtInjury(0.4, 1, 0)).toBeCloseTo(0.4, 12);
    expect(debtInjury(0.4, 1, 0.2)).toBeCloseTo(0.4, 12); // gain·debt = 0.2 < sev
    expect(debtInjury(0.1, 1, 0.2)).toBeCloseTo(0.2, 12);
  });
  it("estimateMvo2 rises with pressure-work and rate", () => {
    const a = estimateMvo2MlMin(90, 70, 72), b = estimateMvo2MlMin(90, 70, 120);
    expect(a).toBeGreaterThan(5);
    expect(b).toBeGreaterThan(a);
  });
});

describe("lactate and myocardial debt ODEs", () => {
  it("low DO2 raises lactate over clinical minutes; recovery clears toward rest", () => {
    let L: number = OXYGEN.lactateRest;
    for (let i = 0; i < 20; i++) L = stepLactate(L, OXYGEN.criticalDo2MlMin * 0.25, 1);
    expect(L).toBeGreaterThan(3);
    const peaked = L;
    for (let i = 0; i < 40; i++) L = stepLactate(L, OXYGEN.criticalDo2MlMin * 1.5, 1);
    expect(L).toBeLessThan(peaked);
    expect(L).toBeLessThan(2.5);
  });
  it("myocardial debt rises in demand ischemia and falls on reperfusion", () => {
    let d = 0;
    for (let i = 0; i < 10; i++) d = stepMyocardialDebt(d, 0.2, 1); // supply << demand
    expect(d).toBeGreaterThan(0.5);
    const ischemic = d;
    for (let i = 0; i < 20; i++) d = stepMyocardialDebt(d, 1.2, 1); // reperfused
    expect(d).toBeLessThan(ischemic * 0.3);
  });
});

describe("time-stepped transport vs steady solve", () => {
  it("settles within 1% of solveOxygen on a normal adult beat", () => {
    const m = buildModel({});
    const h = simulate(m, { waveform: false });
    const flows = { fwd: h.fwd, bwd: h.bwd };
    const ox0 = solveOxygen(m, flows);
    expect(ox0.converged).toBe(true);

    const transport = new OxygenTransport(m);
    // Deliberately start away from equilibrium, then relax with many identical beats.
    transport.content.fill(0.4 * transport.capacity);
    const V = Float64Array.from(m.start.map((v, i) => Math.max(v, m.vu[i] + 20)));
    for (let i = 0; i < 300; i++) transport.advanceBeat(flows, V, m.T);
    const err = steadyMatchError(transport, m, flows);
    expect(err).toBeLessThan(0.01);
  });
});

describe("Simulation oxygenState (core)", () => {
  it("seeds lactate near rest and exposes SCAI A on a healthy adult", () => {
    const sim = new Simulation({}, { engine: "core" });
    sim.reset({ seed: 1 }, { settled: true });
    sim.warmup(20);
    sim.run(8);
    const ox = sim.oxygenState();
    expect(ox).not.toBeNull();
    expect(ox!.lactate).toBeGreaterThan(0.5);
    expect(ox!.lactate).toBeLessThan(2.0);
    expect(ox!.scai).toBe("A");
    expect(ox!.spo2).toBeGreaterThan(0.9);
    expect(Number.isFinite(ox!.do2)).toBe(true);
  });

  it("demand ischemia accumulates myocardial debt; reperfusion clears it", () => {
    const sim = new Simulation({}, { engine: "core" });
    // Mid-LAD stenosis + exertion → subendocardial supply/demand mismatch.
    sim.reset({ seed: 2, lesions: [{ artery: "LAD", stenosis: 0.85, position: 0.3 }], exertion: true }, { settled: true });
    sim.warmup(20);
    // Advance clinical time so debt / severity evolve (minutesPerSecond on the clinical clock).
    for (let i = 0; i < 40; i++) sim.step(0.5, { minutes: 0.5 });
    const mid = sim.oxygenState()!;
    const ladKeys = Object.keys(mid.myocardialDebt).filter((k) => k.startsWith("LAD"));
    expect(ladKeys.length).toBeGreaterThan(0);
    const debtMid = Math.max(...ladKeys.map((k) => mid.myocardialDebt[k]));
    expect(debtMid).toBeGreaterThan(0.05);

    // Reperfusion: clear the lesion and stop exertion; debt should fall.
    sim.apply({ lesions: [], exertion: false });
    for (let i = 0; i < 40; i++) sim.step(0.5, { minutes: 0.5 });
    const after = sim.oxygenState()!;
    const debtAfter = Math.max(0, ...Object.keys(after.myocardialDebt).filter((k) => k.startsWith("LAD")).map((k) => after.myocardialDebt[k]));
    expect(debtAfter).toBeLessThan(debtMid);
  });

  it("LiveSource surfaces E6 lactate once the core heart is warm", () => {
    const sim = new Simulation({}, { engine: "core" });
    const src = new LiveSource(sim);
    sim.reset({ seed: 3 }, { settled: true });
    sim.warmup(20);
    sim.run(6);
    const s = src.saturations();
    expect(Number.isFinite(s.lactate)).toBe(true);
    expect(s.lactate).toBeGreaterThan(0.4);
    src.dispose();
  });
});
