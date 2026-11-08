import { describe, it, expect } from "vitest";
import { CaseRunner, CaseDef, Debrief } from "../src/cases/engine";
import { OrderBook, noteReturned, withOrderLines } from "../src/cases/orderBook";
import { buildPatientNow } from "../src/page/patientNow";

const none = { vitals: null, fallbackMap: NaN, fallbackHr: NaN, spo2: NaN, lactate: NaN, urineMlPerMin: NaN, lvIschemia: NaN, rvIschemia: NaN, congestion: NaN, arrest: "none" as const, rhythmLabel: "", respRateBase: NaN };
const patientNow = () => buildPatientNow(none);

const def: CaseDef = {
  id: "toy", title: "Toy", tier: "easy", blurb: "", card: { presents: "", pmh: "" }, start: {},
  points: { survive: 40, stable: 20, harm: 20 }, limitS: 100, checkpoints: [],
};

describe("cases page: pure parts", () => {
  it("patientNow returns finite numbers when the simulation has no beats yet", () => {
    const n = patientNow();
    for (const k of ["hr", "sbp", "dbp", "urineMlHr", "lvIschemia", "rvIschemia", "tempC", "respRate", "map", "spo2", "lactate", "congestion"] as const) {
      expect(Number.isFinite(n[k]), k).toBe(true);
    }
    expect(typeof n.rhythmLabel).toBe("string");
  });

  it("a returned result is appended to the case log so it survives a page redraw", () => {
    const r = new CaseRunner(def), book = new OrderBook();
    book.order("lactate", 0);
    const back = book.tick(700, { ...patientNow(), lactate: 2.4 });
    noteReturned(r, back);
    expect(r.log).toHaveLength(1);
    expect(r.log[0].text).toBe("Lactate: 2.4 mmol/L");
  });

  it("an estimate result says so in the log", () => {
    const r = new CaseRunner(def), book = new OrderBook();
    r.note("plain");
    expect(r.log[0]).toEqual({ t: 0, text: "plain" });
    book.order("rr", 0);
    noteReturned(r, book.tick(0, patientNow()));
    expect(r.log[1].text).toMatch(/^Respiratory rate: .*\(estimate\)$/);
  });

  it("the debrief includes an order line for each order", () => {
    const book = new OrderBook();
    book.order("lactate", 5); book.order("urine", 6);
    const d: Debrief = { result: "success", score: 1, max: 2, lines: ["base"] };
    const out = withOrderLines(d, book);
    expect(out.lines[0]).toBe("base");
    expect(out.lines.filter((l) => /^(Lactate|Urine output): ordered/.test(l))).toHaveLength(2);
  });
});

import { itemById } from "../src/cases/orders";
describe("order panels", () => {
  it("the 12-lead ECG opens the real ecg panel", () => {
    expect(itemById("twelvelead")?.panel).toBe("ecg");
  });
});
