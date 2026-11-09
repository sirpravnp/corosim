import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { normalizePatient } from "../src/sim/patient";

describe("CoroPump contract readout", () => {
  it("devices() reports purge, hemolysis, thrombusBurden and waveform keys for a placed pump", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ devices: { coroPump: { model: "CP", level: 6 } } }, { settled: true });
    s.warmup(10);
    s.step(30);
    const d = s.devices()?.coroPump;
    expect(d).toBeTruthy();
    expect(Number.isFinite(d!.purge.flowMlHr)).toBe(true);
    expect(Number.isFinite(d!.purge.pressureMmHg)).toBe(true);
    expect(d!.hemolysis.urineColor).toBe("clear");
    expect(d!.thrombusBurden).toBe(0);
    expect(d!.waveform).toBeTruthy();
    expect(d!.waveform!.inletMmHg.length).toBe(100);
    expect(d!.waveform!.currentMa.length).toBe(100);
  });

  it("normalizes coroPump.purge", () => {
    const a = normalizePatient({ devices: { coroPump: { purge: { heparinUml: 25, solution: "bicarbonate" } } } });
    expect(a.warnings).toEqual([]);
    expect(a.spec.devices?.coroPump?.purge?.heparinUml).toBe(25);
    expect(a.spec.devices?.coroPump?.purge?.solution).toBe("bicarbonate");
  });
});
