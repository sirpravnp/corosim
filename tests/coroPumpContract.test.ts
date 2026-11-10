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
    expect(d!.thrombusBurden).toBeLessThan(0.01);
    expect(d!.waveform).toBeTruthy();
    expect(d!.waveform!.inletMmHg.length).toBe(100);
    expect(d!.waveform!.currentMa.length).toBe(100);
    expect(d!.waveform!.aorticMmHg.length).toBe(100);
  });

  it("the aortic trace is the aorta in every position; the inlet trace is the LV only when correct", () => {
    const run = (position: "correct" | "aortic") => {
      const s = new Simulation({}, { engine: "core" });
      s.reset({ devices: { coroPump: { model: "CP", level: 6, position } } }, { settled: true });
      s.warmup(10);
      s.step(30);
      const w = s.devices()!.coroPump!.waveform!;
      const lo = (a: number[]) => Math.min(...a);
      return { inletMin: lo(w.inletMmHg), aorticMin: lo(w.aorticMmHg), aorticMax: Math.max(...w.aorticMmHg), finite: w.aorticMmHg.every(Number.isFinite) };
    };
    const ok = run("correct"), ao = run("aortic");
    expect(ok.finite && ao.finite).toBe(true);
    expect(ok.inletMin).toBeLessThan(ok.aorticMin - 20);       // the LV falls well below the aortic diastolic pressure
    expect(Math.abs(ao.inletMin - ao.aorticMin)).toBeLessThan(5); // pushed out: both are the aorta
    expect(ok.aorticMax).toBeGreaterThan(ok.aorticMin + 15);
  });

  it("normalizes coroPump.purge", () => {
    const a = normalizePatient({ devices: { coroPump: { purge: { heparinUml: 25, solution: "bicarbonate" } } } });
    expect(a.warnings).toEqual([]);
    expect(a.spec.devices?.coroPump?.purge?.heparinUml).toBe(25);
    expect(a.spec.devices?.coroPump?.purge?.solution).toBe("bicarbonate");
  });
});
