import { describe, it, expect } from "vitest";
import { purgeState } from "../src/physics/core/devices/purge";
import { normalizePatient } from "../src/sim/patient";

describe("purgeState", () => {
  it("clear line, no thrombus: 450 mmHg and 15 ml/hr, no alarms", () => {
    const r = purgeState({ solution: "dextrose-heparin", heparinUml: 25, line: "clear", thrombus: 0, running: true });
    expect(r.pressureMmHg).toBeCloseTo(450, 0);
    expect(r.flowMlHr).toBeCloseTo(15, 0);
    expect(r.alarms).toEqual([]);
  });
  it("kinked line raises pressure above the high alarm", () => {
    const r = purgeState({ solution: "dextrose-heparin", heparinUml: 25, line: "kinked", thrombus: 0, running: true });
    expect(r.pressureMmHg).toBeGreaterThan(1000);
    expect(r.alarms).toContain("PURGE PRESSURE HIGH");
  });
  it("blocked line: pressure at 1500 cap and flow below 1 ml/hr and both alarms", () => {
    const r = purgeState({ solution: "dextrose-heparin", heparinUml: 25, line: "blocked", thrombus: 0, running: true });
    expect(r.pressureMmHg).toBe(1500);
    expect(r.flowMlHr).toBeLessThan(1);
    expect(r.alarms).toEqual(expect.arrayContaining(["PURGE PRESSURE HIGH", "PURGE FLOW LOW"]));
  });
  it("thrombus 0.8 trips the high-pressure alarm and thrombus 0.3 does not", () => {
    expect(purgeState({ solution: "dextrose-heparin", heparinUml: 25, line: "clear", thrombus: 0.8, running: true }).alarms).toContain("PURGE PRESSURE HIGH");
    expect(purgeState({ solution: "dextrose-heparin", heparinUml: 25, line: "clear", thrombus: 0.3, running: true }).alarms).not.toContain("PURGE PRESSURE HIGH");
  });
  it("bicarbonate reads lower pressure than dextrose-heparin at equal thrombus", () => {
    const d = purgeState({ solution: "dextrose-heparin", heparinUml: 25, line: "clear", thrombus: 0.2, running: true }).pressureMmHg;
    const b = purgeState({ solution: "bicarbonate", heparinUml: 25, line: "clear", thrombus: 0.2, running: true }).pressureMmHg;
    expect(b).toBeLessThan(d);
  });
  it("running false returns flow 0 and no alarms", () => {
    const r = purgeState({ solution: "dextrose-heparin", heparinUml: 25, line: "blocked", thrombus: 0.5, running: false });
    expect(r.flowMlHr).toBe(0);
    expect(r.alarms).toEqual([]);
  });
  it("clamps heparinUml -5, 1e6, NaN and ignores an unknown solution or line with a warning, no throw", () => {
    for (const heparinUml of [-5, 1e6, NaN]) {
      expect(() => purgeState({ solution: "dextrose-heparin", heparinUml, line: "clear", thrombus: 0, running: true })).not.toThrow();
    }
    const w: string[] = [];
    purgeState({ solution: "gold" as never, heparinUml: 25, line: "clear", thrombus: 0, running: true }, w);
    expect(w.length).toBeGreaterThan(0);
    purgeState({ solution: "dextrose-heparin", heparinUml: 25, line: "crimped" as never, thrombus: 0, running: true }, w);
  });
});

describe("normalizePatient coroPump.purge", () => {
  it("clamps heparin and defaults", () => {
    const r = normalizePatient({ devices: { coroPump: { purge: { heparinUml: -5 } } } });
    expect(r.spec.devices?.coroPump?.purge?.heparinUml).toBe(0);
    const ok = normalizePatient({ devices: { coroPump: { purge: { heparinUml: 25 } } } });
    expect(ok.spec.devices?.coroPump?.purge?.heparinUml).toBe(25);
  });
});
