import { describe, it, expect } from "vitest";
import { CASES, caseById } from "../src/cases";
import { CATALOG, STANDARD_MONITOR, backBeforeEnd, effectiveDelayS, itemById, resolveMonitor, PatientNow } from "../src/cases/orders";
import { OrderBook } from "../src/cases/orderBook";
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
  it("rejects a lab or bedside id in the monitor, naming it and why", () => {
    expect(validateCase({ ...spec(), monitor: ["hr", "lactate"] })).toContain("The monitor lists 'lactate', which is a result to order, not a display.");
    expect(validateCase({ ...spec(), monitor: ["urine"] })).toContain("The monitor lists 'urine', which is a result to order, not a display.");
    expect(validateCase({ ...spec(), monitor: ["hr", "heart3d", "jvp"] })).toEqual([]);
  });
  it("resolveMonitor drops lab and bedside ids like unknown ones", () => {
    expect(resolveMonitor({ monitor: ["bp", "lactate", "urine", "hr"] })).toEqual(["bp", "hr"]);
    expect(resolveMonitor({ monitor: ["lactate"] })).toEqual([...STANDARD_MONITOR]);
  });
  it("accepts a case with no monitor or an empty one", () => {
    expect(validateCase(spec())).toEqual([]);
    expect(validateCase({ ...spec(), monitor: [] })).toEqual([]);
  });
});

describe("built-in cases", () => {
  const std = [...STANDARD_MONITOR];
  // The case's start spec needs the DOM-bound simulator to yield a PatientNow, so each case reads a representative patient instead:
  // the sickest plausible start for its story (rhythm, pressure and ischemia taken from the case card).
  const startPatient: Record<string, Partial<PatientNow>> = {
    "anterior-stemi": { hr: 102, sbp: 98, dbp: 77, map: 84, lvIschemia: 0.5, rhythmLabel: "Sinus tachycardia" },
    "af-rvr": { hr: 146, sbp: 98, dbp: 76, map: 83, rhythmLabel: "Atrial fibrillation" },
    "inferior-rv": { hr: 42, sbp: 88, dbp: 48, map: 61, rvIschemia: 0.6, rhythmLabel: "Complete heart block" },
    "af-hf": { hr: 158, sbp: 83, dbp: 69, map: 74, congestion: 0.7, lvIschemia: 0.2, rhythmLabel: "Atrial fibrillation", co: 3.2, lvEf: 25 },
    "lm-shock": { hr: 112, sbp: 77, dbp: 64, map: 68, lactate: 5, congestion: 0.8, lvIschemia: 0.8, urineMlHr: 8, rhythmLabel: "Sinus tachycardia", co: 2.4, lvEf: 15 },
    ecpella: { hr: 0, sbp: 0, dbp: 0, map: 0, arrest: "arrest", rhythmLabel: "Ventricular fibrillation", respRate: 0, spo2: 0, lvIschemia: 0.8 },
  };
  it("every built-in case resolves exactly the standard six, in order", () => {
    expect(CASES.length).toBe(6);
    for (const c of CASES) expect(resolveMonitor(c), c.id).toEqual(std);
  });
  it("every id on a built-in case's resolved monitor exists in the catalog", () => {
    expect(CASES.length).toBe(6);
    for (const c of CASES) for (const id of resolveMonitor(c)) expect(itemById(id), `${c.id}: ${id}`).toBeDefined();
  });
  it("every catalog item with a read returns finite non-NaN text on each built-in case's own start patient", () => {
    for (const c of CASES) {
      const p = now(startPatient[c.id]);
      for (const item of CATALOG) {
        if (!item.read) continue;
        const t = item.read(p).text;
        expect(typeof t, `${c.id}/${item.id}`).toBe("string");
        expect(t, `${c.id}/${item.id}`).not.toMatch(/NaN|Infinity|undefined/);
        expect(t.length, `${c.id}/${item.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("effective turnaround", () => {
  const lab = (delayS: number) => ({ delayS });
  it("compresses to a fifth of the limit, never under a minute, never above the item's own delay", () => {
    expect(effectiveDelayS(lab(3600), 600)).toBe(120);
    expect(effectiveDelayS(lab(3600), 900)).toBe(180);
    expect(effectiveDelayS(lab(3600), 2400)).toBe(480);
    expect(effectiveDelayS(lab(300), 2400)).toBe(300);
    expect(effectiveDelayS(lab(0), 600)).toBe(0);
    expect(effectiveDelayS(lab(3600), 100)).toBe(60);
  });
  it("every built-in lab can return in every built-in case when ordered at the start", () => {
    for (const c of CASES) for (const i of CATALOG) expect(backBeforeEnd(i, 0, c.limitS), `${c.id}: ${i.id}`).toBe(true);
  });
  it("refuses an order whose result cannot return before the limit", () => {
    expect(backBeforeEnd(lab(3600), 479, 600)).toBe(true);
    expect(backBeforeEnd(lab(3600), 481, 600)).toBe(false);
    expect(backBeforeEnd(lab(0), 600, 600)).toBe(true);
  });
  it("OrderBook.order uses the compressed delay and refuses a late one", () => {
    const b = new OrderBook();
    expect(b.order("tsh", 10, 600)).toBe("ok");
    expect(b.pending[0].readyAt).toBe(130);
    expect(b.order("bmp", 590, 600)).toBe("late");
    expect(b.ordered().has("bmp")).toBe(false);
  });
});
