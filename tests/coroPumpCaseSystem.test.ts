import { describe, it, expect } from "vitest";
import {
  CATALOG, isDisplayId, itemById, effectiveDelayS, PatientNow,
} from "../src/cases/orders";
import { OrderBook } from "../src/cases/orderBook";
import { validateCase } from "../src/cases/spec";
import { setCaseLabs } from "../src/sim/labs";

const now = (o: Partial<PatientNow> = {}): PatientNow => ({
  respRateBase: 15, map: 90, spo2: 0.98, lactate: 1, congestion: 0, arrest: "none",
  hr: 75, sbp: 120, dbp: 70, urineMlHr: 60, lvIschemia: 0, rvIschemia: 0, rhythmLabel: "Sinus rhythm", tempC: 37, respRate: 15, ...o,
});

describe("CoroPump order catalog", () => {
  it("coropump is a panel item, so a case monitor may list it and isDisplayId is true", () => {
    const item = itemById("coropump");
    expect(item?.group).toBe("panel");
    expect(isDisplayId("coropump")).toBe(true);
  });

  it("hemolysis is a lab, so a monitor listing it is rejected by validateCase", () => {
    expect(itemById("hemolysis")?.group).toBe("lab");
    const errs = validateCase({
      id: "t", title: "t", tier: "easy", blurb: "b", card: { presents: "p", pmh: "h" }, start: {},
      points: { survive: 1, stable: 1, harm: 1 }, limitS: 600, checkpoints: [{ id: "e", outcome: { end: "success" } }],
      monitor: ["hr", "hemolysis"],
    });
    expect(errs.some((e) => /hemolysis/.test(e) && /order/.test(e))).toBe(true);
  });

  it("hemolysis result returns after effectiveDelayS and reads the live pfHb", () => {
    const book = new OrderBook();
    const limitS = 900;
    const delay = effectiveDelayS(itemById("hemolysis")!, limitS);
    expect(book.order("hemolysis", 0, limitS)).toBe("ok");
    const early = book.tick(delay - 1, now({ pfHbMgDl: 55 }));
    expect(early).toHaveLength(0);
    const back = book.tick(delay, now({ pfHbMgDl: 55 }));
    expect(back).toHaveLength(1);
    expect(back[0].reading.text).toMatch(/Plasma free hemoglobin 55 mg\/dL/);
  });

  it("a case author's labs override pfhb: 120 is shown", () => {
    setCaseLabs({ pfhb: 120 });
    const reading = itemById("hemolysis")!.read!(now({ pfHbMgDl: 5 }));
    expect(reading.text).toMatch(/120 mg\/dL/);
    expect(reading.estimate).toBe(false);
    setCaseLabs(undefined);
  });

  it("urine-color reads dark when pfHb is above 100", () => {
    const reading = itemById("urine-color")!.read!(now({ pfHbMgDl: 120 }));
    expect(reading.text).toBe("Dark");
  });

  it("every catalog id is unique including coropump, hemolysis and urine-color", () => {
    const ids = CATALOG.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["coropump", "hemolysis", "urine-color"]));
  });
});
