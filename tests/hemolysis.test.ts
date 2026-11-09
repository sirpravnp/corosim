import { describe, it, expect } from "vitest";
import { stepHemolysis, urineColor } from "../src/physics/core/devices/hemolysis";
import { Simulation } from "../src/sim/simulation";
import { COROPUMP_HEMOLYSIS } from "../src/config/devices";

const inp = (p: Partial<Parameters<typeof stepHemolysis>[2]> = {}) => ({
  level: 6,
  speedKrpm: 46,
  flowLpm: 3.5,
  suctionFraction: 0,
  position: "correct" as const,
  thrombus: 0,
  running: true,
  ...p,
});

const advancePf = (start: number, clinicalMin: number, p: Parameters<typeof stepHemolysis>[2]) => {
  let pf = start;
  let left = clinicalMin;
  while (left > 0) {
    const dt = Math.min(1, left);
    pf = stepHemolysis(pf, dt, p);
    left -= dt;
  }
  return pf;
};

describe("stepHemolysis", () => {
  it("CP at P6, correct position, normal volume: pfHb under 10 over 24 clinical hours", () => {
    const pf = advancePf(COROPUMP_HEMOLYSIS.baselineMgDl, 24 * 60, inp());
    expect(pf).toBeLessThan(10);
  });

  it("sustained suction fraction above 0.2 crosses 40 mg/dL within 6 clinical hours", () => {
    const pf = advancePf(COROPUMP_HEMOLYSIS.baselineMgDl, 6 * 60, inp({ suctionFraction: 0.35, flowLpm: 1.2 }));
    expect(pf).toBeGreaterThan(40);
  });

  it("deep position crosses 40 within 12 hours without a suction alarm", () => {
    const pf = advancePf(COROPUMP_HEMOLYSIS.baselineMgDl, 12 * 60, inp({ position: "deep", suctionFraction: 0, level: 6 }));
    expect(pf).toBeGreaterThan(40);
  });

  it("thrombus above 0.6 crosses 40", () => {
    const pf = advancePf(COROPUMP_HEMOLYSIS.baselineMgDl, 8 * 60, inp({ thrombus: 0.7, flowLpm: 2 }));
    expect(pf).toBeGreaterThan(40);
  });

  it("with the cause removed pfHb halves in 6 hours, 2 percent tolerance", () => {
    let pf = 80;
    pf = advancePf(pf, 6 * 60, inp({ running: false }));
    expect(pf).toBeGreaterThan(38);
    expect(pf).toBeLessThan(43);
  });

  it("pump removal does not reset pfHb", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ devices: { coroPump: { level: 6, initial: { plasmaFreeHbMgDl: 55 } } } }, { settled: true });
    s.warmup(5);
    const before = s.devices()!.coroPump!.hemolysis.plasmaFreeHbMgDl;
    s.setCoroPumpLevel(0);
    expect(s.devices()!.coroPump!.hemolysis.plasmaFreeHbMgDl).toBeCloseTo(before, 0);
  });

  it("initial.plasmaFreeHbMgDl 60 starts there", () => {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ devices: { coroPump: { level: 6, initial: { plasmaFreeHbMgDl: 60 } } } }, { settled: true });
    s.warmup(5);
    expect(s.devices()!.coroPump!.hemolysis.plasmaFreeHbMgDl).toBeCloseTo(60, 0);
  });

  it("urineColor thresholds", () => {
    expect(urineColor(10)).toBe("clear");
    expect(urineColor(39)).toBe("clear");
    expect(urineColor(40)).toBe("tea");
    expect(urineColor(100)).toBe("dark");
    expect(urineColor(101)).toBe("dark");
  });

  it("same trajectory at 1x, 3x and 6x", () => {
    const clinical = 120;
    const pfAt = (speed: number) => {
      let pf: number = COROPUMP_HEMOLYSIS.baselineMgDl;
      let left = clinical;
      const beatClinical = 0.85 * speed * 2;
      const p = inp({ suctionFraction: 0.25, flowLpm: 1.5 });
      while (left > 0) {
        const dt = Math.min(left, beatClinical);
        pf = stepHemolysis(pf, dt, p);
        left -= dt;
      }
      return pf;
    };
    expect(pfAt(3)).toBeCloseTo(pfAt(1), 0);
    expect(pfAt(6)).toBeCloseTo(pfAt(1), 0);
  });
});
