import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import type { PatientSpec } from "../src/sim/patient";
import { SOLVER } from "../src/config/structural";

const SIM_SEC = 40;

function endState(spec: PatientSpec, solverDt: number) {
  const prev = SOLVER.dt;
  SOLVER.dt = solverDt;
  try {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ seed: 3, ...spec }, { settled: true });
    s.warmup(8);
    s.run(SIM_SEC);
    const co = s.rolling(12).cardiacOutput;
    const dev = s.devices()?.coroPump?.flowLpm ?? 0;
    return { map: s.map, co, dev };
  } finally {
    SOLVER.dt = prev;
  }
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-6);

describe("CoroPump numerics with purge and hemolysis", () => {
  const scenarios: [string, PatientSpec][] = [
    ["P9 shock", { heart: { lvEes: 0.35 }, devices: { coroPump: { level: 9 } }, support: { coroPump: true } }],
    ["hypovolemic P9", { bloodLoss: 0.35, devices: { coroPump: { level: 9 } }, support: { coroPump: true } }],
    ["deep with thrombus", {
      devices: { coroPump: { level: 8, position: "deep", initial: { thrombusBurden: 0.65 } } },
      support: { coroPump: true },
    }],
  ];
  for (const [name, spec] of scenarios) {
    it(`${name}: halving dt changes MAP, CO and device flow under 0.5%`, () => {
      const a = endState(spec, SOLVER.dt);
      const b = endState(spec, SOLVER.dt / 2);
      expect(rel(a.map, b.map)).toBeLessThan(0.005);
      expect(rel(a.co, b.co)).toBeLessThan(0.005);
      if (a.dev > 0.1) expect(rel(a.dev, b.dev)).toBeLessThan(0.005);
    });
    it(`${name}: no NaN in readouts`, () => {
      const s = new Simulation({}, { engine: "core" });
      s.reset({ seed: 3, ...spec }, { settled: true });
      s.warmup(5);
      s.run(30);
      const d = s.devices()!.coroPump!;
      expect(Number.isFinite(d.flowLpm)).toBe(true);
      expect(Number.isFinite(d.purge.pressureMmHg)).toBe(true);
      expect(Number.isFinite(d.thrombusBurden)).toBe(true);
      expect(Number.isFinite(s.plasmaFreeHb())).toBe(true);
    });
  }
});
