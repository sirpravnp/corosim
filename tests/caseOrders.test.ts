import { describe, it, expect } from "vitest";
import { CATALOG, STANDARD_MONITOR, itemById, resolveMonitor, PatientNow } from "../src/cases/orders";
import { CaseSpec, validateCase } from "../src/cases/spec";

const now = (o: Partial<PatientNow> = {}): PatientNow => ({
  respRateBase: 15, map: 90, spo2: 0.98, lactate: 1, congestion: 0, arrest: "none",
  hr: 75, sbp: 120, dbp: 70, urineMlHr: 60, lvIschemia: 0, rvIschemia: 0, rhythmLabel: "Sinus rhythm", tempC: 37, respRate: 15, ...o,
});

const spec = (): CaseSpec => ({
  id: "toy-case", title: "Toy", tier: "easy", blurb: "b", card: { presents: "A patient.", pmh: "None." }, start: {},
  points: { survive: 40, stable: 20, harm: 20 }, limitS: 120,
  checkpoints: [{ id: "e", atS: 5, outcome: { end: "success" } }],
});

describe("order catalog", () => {
  it("STANDARD_MONITOR is exactly hr,bp,ecg,spo2,rr,temp", () => {
    expect([...STANDARD_MONITOR]).toEqual(["hr", "bp", "ecg", "spo2", "rr", "temp"]);
  });
  it("resolveMonitor of a case with no monitor returns the standard six", () => {
    expect(resolveMonitor({})).toEqual([...STANDARD_MONITOR]);
  });
  it("resolveMonitor returns the standard six for an empty or all-unknown monitor", () => {
    expect(resolveMonitor({ monitor: [] })).toEqual([...STANDARD_MONITOR]);
    expect(resolveMonitor({ monitor: ["zzz"] })).toEqual([...STANDARD_MONITOR]);
  });
  it("resolveMonitor drops unknown ids and keeps order", () => {
    expect(resolveMonitor({ monitor: ["bp", "nope", "hr"] })).toEqual(["bp", "hr"]);
  });
  it("every item with read gives finite text for normal, shock and arrested patients", () => {
    const pts = [
      now(),
      now({ map: 45, sbp: 70, dbp: 40, hr: 130, lactate: 7, urineMlHr: 5, spo2: 0.88, respRate: 28, lvIschemia: 0.6 }),
      now({ map: 0, sbp: 0, dbp: 0, hr: 0, arrest: "arrest", rhythmLabel: "Ventricular fibrillation", respRate: 0, spo2: 0 }),
      now({ map: NaN, sbp: NaN, dbp: NaN, hr: NaN, lactate: NaN, urineMlHr: NaN, spo2: NaN, tempC: NaN, respRate: NaN }),
    ];
    const readable = CATALOG.filter((i) => i.read);
    expect(readable.length).toBeGreaterThan(0);
    for (const it of readable) for (const p of pts) expect(it.read!(p).text, it.id).not.toMatch(/NaN|Infinity/);
  });
  it("non-finite inputs read as not measurable", () => {
    expect(itemById("lactate")!.read!(now({ lactate: NaN })).text).toBe("not measurable");
  });
  it("lactate is not labeled estimate", () => {
    const lactate = itemById("lactate");
    expect(lactate?.read).toBeDefined();
    expect(lactate!.read!(now()).estimate).toBeFalsy();
  });
  it("delays and ids", () => {
    expect(itemById("twelvelead")!.delayS).toBe(120);
    expect(itemById("lactate")!.delayS).toBe(600);
    expect(itemById("urine")!.group).toBe("bedside");
    expect(new Set(CATALOG.map((i) => i.id)).size).toBe(CATALOG.length);
  });
});

describe("case monitor validation", () => {
  it("reports an unknown monitor id", () => {
    const errs = validateCase({ ...spec(), monitor: ["hr", "foo"] });
    expect(errs).toContain("The monitor lists 'foo', which is not an orderable item.");
  });
  it("accepts a case with no monitor or an empty one", () => {
    expect(validateCase(spec())).toEqual([]);
    expect(validateCase({ ...spec(), monitor: [] })).toEqual([]);
  });
});
