import { describe, expect, it } from "vitest";
import { buildPatientNow, type PatientSource } from "../src/page/patientNow";
import { itemById } from "../src/cases/orders";
import { Simulation } from "../src/sim/simulation";

const src = (o: Partial<PatientSource> = {}): PatientSource => ({
  vitals: { hr: 80, sbp: 120, dbp: 70, map: 87 }, fallbackMap: 87, fallbackHr: 80, spo2: 0.97, lactate: 1, urineMlPerMin: 1,
  lvIschemia: 0, rvIschemia: 0, congestion: 0, arrest: "none", rhythmLabel: "Sinus rhythm", respRateBase: 15, ...o,
});

describe("patient snapshot carries the live free hemoglobin", () => {
  it("the hemolysis lab and the urine-color item read the live value, not the baseline", () => {
    const n = buildPatientNow(src({ pfHbMgDl: 130 }));
    expect(n.pfHbMgDl).toBe(130);
    expect(itemById("hemolysis")!.read!(n).text).toMatch(/130 mg\/dL/);
    expect(itemById("urine-color")!.read!(n).text).toBe("Dark");
    const mid = buildPatientNow(src({ pfHbMgDl: 60 }));
    expect(itemById("urine-color")!.read!(mid).text).toBe("Tea-colored");
  });
  it("no live value leaves the snapshot without one (the item then says it is an estimate)", () => {
    const n = buildPatientNow(src({ pfHbMgDl: NaN }));
    expect(n.pfHbMgDl).toBeUndefined();
    expect(itemById("urine-color")!.read!(n).estimate).toBe(true);
  });
  it("Simulation.plasmaFreeHb() is the number the page passes", () => {
    const sim = new Simulation({ devices: { coroPump: { initial: { plasmaFreeHbMgDl: 77 } } } } as never);
    expect(buildPatientNow(src({ pfHbMgDl: sim.plasmaFreeHb() })).pfHbMgDl).toBe(77);
  });
});
