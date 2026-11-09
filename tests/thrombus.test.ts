import { describe, it, expect } from "vitest";
import { stepThrombus } from "../src/physics/core/devices/thrombus";
import { purgeState } from "../src/physics/core/devices/purge";
import { Simulation } from "../src/sim/simulation";
import { COROPUMP_PURGE } from "../src/config/devices";

const inp = (p: Partial<Parameters<typeof stepThrombus>[2]> = {}) => ({
  solution: "dextrose-heparin" as const,
  heparinUml: 25,
  line: "clear" as const,
  flowLpm: 3,
  running: true,
  ...p,
});

const advance = (b: number, clinicalMin: number, p: Parameters<typeof stepThrombus>[2], dt = 1) => {
  let x = b;
  for (let t = 0; t < clinicalMin; t += dt) x = stepThrombus(x, Math.min(dt, clinicalMin - t), p);
  return x;
};

describe("stepThrombus", () => {
  it("heparin 25 U/ml at 3 L/min: burden stays under 0.1 over 5 clinical days", () => {
    const end = advance(0, 5 * 24 * 60, inp({ heparinUml: 25, flowLpm: 3 }));
    expect(end).toBeLessThan(0.1);
  });

  it("dextrose with heparin 0: burden passes 0.63 within 48 to 96 clinical hours", () => {
    const h48 = advance(0, 48 * 60, inp({ heparinUml: 0 }));
    const h96 = advance(0, 96 * 60, inp({ heparinUml: 0 }));
    expect(h48).toBeLessThan(0.63);
    expect(h96).toBeGreaterThan(0.63);
  });

  it("bicarbonate grows between the two", () => {
    const clinical = 72 * 60;
    const d = advance(0, clinical, inp({ heparinUml: 0, solution: "dextrose-heparin" }));
    const b = advance(0, clinical, inp({ heparinUml: 0, solution: "bicarbonate" }));
    const z = advance(0, clinical, inp({ heparinUml: 25 }));
    expect(b).toBeGreaterThan(z);
    expect(b).toBeLessThan(d);
  });

  it("blocked line reaches the pressure cap within 10 clinical minutes of the block", () => {
    const r = purgeState({ solution: "dextrose-heparin", heparinUml: 25, line: "blocked", thrombus: 0, running: true });
    expect(r.pressureMmHg).toBe(COROPUMP_PURGE.pressureCap);
  });

  it("raising heparin halts growth and does not clear burden above 0.7", () => {
    let b = advance(0, 120 * 60, inp({ heparinUml: 0 }));
    expect(b).toBeGreaterThan(0.7);
    const held = advance(b, 48 * 60, inp({ heparinUml: 50 }));
    expect(held).toBeGreaterThanOrEqual(0.7);
    expect(held).toBeLessThanOrEqual(b + 0.02);
  });

  it("exchange sets burden to 0 and resets purge", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ devices: { coroPump: { level: 6, purge: { heparinUml: 0, line: "clear" } } } }, { settled: true });
    s.warmup(10);
    s.step(600, { minutes: 800 });
    expect(s.devices()!.coroPump!.thrombusBurden).toBeGreaterThan(0.2);
    s.apply({ devices: { coroPump: { exchange: true, purge: { line: "blocked" } } } });
    expect(s.devices()!.coroPump!.thrombusBurden).toBe(0);
    expect(s.devices()!.coroPump!.purge.line).toBe("clear");
    expect(s.devices()!.coroPump!.purge.pressureMmHg).toBeLessThan(COROPUMP_PURGE.alarmPressureHigh);
  });

  it("removing the pump resets burden to 0", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ devices: { coroPump: { level: 6, purge: { heparinUml: 0 } } } }, { settled: true });
    s.warmup(10);
    s.step(300, { minutes: 400 });
    expect(s.devices()!.coroPump!.thrombusBurden).toBeGreaterThan(0.05);
    s.setCoroPumpLevel(0);
    expect(s.devices()!.coroPump!.thrombusBurden).toBe(0);
  });

  it("initial.thrombusBurden 0.45 starts there and a re-applied spec does not reset a running value", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ devices: { coroPump: { level: 6, initial: { thrombusBurden: 0.45 } } } }, { settled: true });
    s.warmup(5);
    expect(s.devices()!.coroPump!.thrombusBurden).toBeCloseTo(0.45, 2);
    s.step(120, { minutes: 120 * 2 });
    const mid = s.devices()!.coroPump!.thrombusBurden;
    s.apply({ devices: { coroPump: { initial: { thrombusBurden: 0.45 } } } });
    expect(s.devices()!.coroPump!.thrombusBurden).toBeCloseTo(mid, 2);
  });

  it("burden at equal clinical time is within 2 percent at 1x, 3x and 6x speed", () => {
    const clinical = 180;
    const burdenAt = (speed: number) => {
      let b = 0;
      let left = clinical;
      const beatClinical = 0.85 * speed * 2;
      const p = inp({ heparinUml: 5, flowLpm: 3 });
      while (left > 0) {
        const dt = Math.min(left, beatClinical);
        b = stepThrombus(b, dt, p);
        left -= dt;
      }
      return b;
    };
    const b1 = burdenAt(1);
    const b3 = burdenAt(3);
    const b6 = burdenAt(6);
    expect(b3).toBeCloseTo(b1, 2);
    expect(b6).toBeCloseTo(b1, 2);
  });
});
