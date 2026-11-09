import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { TOOLS } from "../src/mcp/tools";
import { COROPUMP_HEMOLYSIS, COROPUMP_PURGE } from "../src/config/devices";
import { PRESET_BY_ID } from "../src/sim/presets";
import { normalizePatient } from "../src/sim/patient";

const runAdjust = (sim: Simulation, patch: Record<string, unknown>, runSeconds = 5) =>
  TOOLS.find((t) => t.name === "corosim_adjust")!.run({ sim, appUrl: "https://x/sim/" }, { patch, runSeconds }) as { warnings?: string[] };

describe("CoroPump simulation wiring", () => {
  it("devices().coroPump.purge responds to a live patch of devices.coroPump.purge.line = blocked", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ devices: { coroPump: { level: 6 } } }, { settled: true });
    s.warmup(10);
    expect(s.devices()!.coroPump!.purge.pressureMmHg).toBeLessThan(COROPUMP_PURGE.alarmPressureHigh);
    s.apply({ devices: { coroPump: { purge: { line: "blocked" } } } });
    expect(s.devices()!.coroPump!.purge.pressureMmHg).toBe(COROPUMP_PURGE.pressureCap);
    expect(s.devices()!.coroPump!.alarms).toContain("PURGE PRESSURE HIGH");
  });

  it("live patch heparinUml 0 raises thrombusBurden over clinical time", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ devices: { coroPump: { level: 6, purge: { heparinUml: 25 } } } }, { settled: true });
    s.warmup(10);
    s.apply({ devices: { coroPump: { purge: { heparinUml: 0 } } } });
    s.step(400, { minutes: 600 });
    expect(s.devices()!.coroPump!.thrombusBurden).toBeGreaterThan(0.15);
  });

  it("corosim_adjust accepts devices.coroPump.purge and exchange; unknown keys warn", () => {
    const sim = new Simulation({ seed: 1 }, { engine: "core" });
    TOOLS.find((t) => t.name === "corosim_set_scenario")!.run({ sim, appUrl: "x" }, { scenario: { devices: { coroPump: { level: 6 } } }, warmupSeconds: 5 });
    runAdjust(sim, { devices: { coroPump: { purge: { heparinUml: 20 }, exchange: true } } }, 0);
    expect(sim.devices()?.coroPump?.purge.heparinUml).toBe(20);
    expect(sim.devices()?.coroPump?.thrombusBurden).toBe(0);
    expect(normalizePatient({ devices: { coroPump: { purge: { solution: "gold" as never } } } }).warnings.join(" ")).toMatch(/solution/i);
  });

  it("a reset zeroes thrombus and pfHb", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ devices: { coroPump: { level: 6, purge: { heparinUml: 0 }, initial: { thrombusBurden: 0.4, plasmaFreeHbMgDl: 80 } } } }, { settled: true });
    s.warmup(10);
    s.step(400, { minutes: 500 });
    expect(s.devices()!.coroPump!.thrombusBurden).toBeGreaterThan(0.35);
    s.reset({ devices: { coroPump: { level: 6 } } });
    s.warmup(5);
    expect(s.devices()!.coroPump!.thrombusBurden).toBe(0);
    expect(s.devices()!.coroPump!.hemolysis.plasmaFreeHbMgDl).toBeCloseTo(COROPUMP_HEMOLYSIS.baselineMgDl, 0);
  });

  it("pump off then on: new pump, thrombus 0, pfHb continued", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ devices: { coroPump: { level: 6, initial: { plasmaFreeHbMgDl: 55 } } } }, { settled: true });
    s.warmup(10);
    const pf = s.devices()!.coroPump!.hemolysis.plasmaFreeHbMgDl;
    s.setCoroPumpLevel(0);
    const pfOff = s.devices()!.coroPump!.hemolysis.plasmaFreeHbMgDl;
    expect(pfOff).toBeCloseTo(pf, 0);
    s.setCoroPumpLevel(6);
    expect(s.devices()!.coroPump!.thrombusBurden).toBeLessThan(0.02);
    expect(s.devices()!.coroPump!.hemolysis.plasmaFreeHbMgDl).toBeCloseTo(pfOff, 0);
  });

  it("presets purge-rising and coropump-hemolysis normalize", () => {
    expect(PRESET_BY_ID["purge-rising"]).toBeTruthy();
    expect(PRESET_BY_ID["coropump-hemolysis"]).toBeTruthy();
    const s = new Simulation({}, { engine: "core" });
    s.reset(PRESET_BY_ID["purge-rising"]!.spec, { settled: true });
    s.warmup(5);
    expect(s.devices()!.coroPump!.thrombusBurden).toBeCloseTo(0.45, 2);
    s.reset(PRESET_BY_ID["coropump-hemolysis"]!.spec, { settled: true });
    s.warmup(5);
    expect(s.devices()!.coroPump!.hemolysis.plasmaFreeHbMgDl).toBeCloseTo(60, 0);
  });
});
