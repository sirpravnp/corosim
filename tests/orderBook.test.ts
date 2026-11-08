import { describe, it, expect } from "vitest";
import { OrderBook, orderLines } from "../src/cases/orderBook";
import type { PatientNow } from "../src/cases/orders";
import type { Probe } from "../src/cases/engine";
import { GENERIC_HARMS } from "../src/cases/harms";

const N = (o: Partial<PatientNow> = {}): PatientNow => ({
  respRateBase: 15, map: 70, spo2: 0.98, lactate: 1.2, congestion: 0, arrest: "none",
  hr: 80, sbp: 110, dbp: 70, urineMlHr: 60, lvIschemia: 0, rvIschemia: 0,
  rhythmLabel: "sinus rhythm", tempC: 37, respRate: 16, ...o,
});
const P = (o: Partial<Probe> = {}): Probe => ({ map: 70, hr: 80, arrest: "none", rhythmClass: "perfusing", shocks: 0, epiDoses: 0, amioMg: 0, lidoDoses: 0, cpr: false, ecmo: false, impella: false, iabp: false, pci: false, pciPending: false, drugs: {}, ef: 0.6, lvIschemia: 0, rvIschemia: 0, congestion: 0, fluidsL: 0, dead: false, ...o });

describe("order book", () => {
  it("an item with delay 600 is pending until t reaches orderedAt+600", () => {
    const b = new OrderBook();
    expect(b.order("lactate", 100)).toBe("ok");
    expect(b.pending).toEqual([{ id: "lactate", readyAt: 700 }]);
    expect(b.tick(699, N())).toEqual([]);
    const back = b.tick(700, N());
    expect(back.map((r) => r.id)).toEqual(["lactate"]);
    expect(back[0].t).toBe(700);
    expect(b.pending).toEqual([]);
  });

  it("ordering a pending item again returns duplicate and adds no second entry", () => {
    const b = new OrderBook();
    expect(b.order("lactate", 0)).toBe("ok");
    expect(b.order("lactate", 5)).toBe("duplicate");
    expect(b.pending.length).toBe(1);
    expect(b.log.length).toBe(1);
  });

  it("the result is read at return time, from the patient at that tick", () => {
    const b = new OrderBook();
    b.order("lactate", 0);
    expect(b.tick(599, N({ lactate: 1 }))).toEqual([]);
    const back = b.tick(600, N({ lactate: 4.2 }));
    expect(back[0].reading.text).toBe("4.2 mmol/L");
  });

  it("zero-delay items return on the next tick", () => {
    const b = new OrderBook();
    expect(b.order("urine", 50)).toBe("ok");
    const back = b.tick(51, N({ urineMlHr: 35 }));
    expect(back.map((r) => [r.id, r.reading.text])).toEqual([["urine", "35 mL/h"]]);
  });

  it("a panel with no reading returns a ready line", () => {
    const b = new OrderBook();
    b.order("twelvelead", 0);
    expect(b.tick(119, N())).toEqual([]);
    expect(b.tick(120, N())[0].reading.text).toBe("result ready");
  });

  it("unknown ids return unknown and are not queued", () => {
    const b = new OrderBook();
    expect(b.order("nope", 0)).toBe("unknown");
    expect(b.pending.length).toBe(0);
    expect(b.log.length).toBe(0);
  });

  it("cancel removes a pending item and logs it as cancelled", () => {
    const b = new OrderBook();
    b.order("lactate", 0);
    b.cancel("lactate");
    expect(b.pending).toEqual([]);
    expect(b.tick(600, N())).toEqual([]);
    expect(b.log[0].cancelled).toBe(true);
  });

  it("ordered() lists the ids ordered and not cancelled", () => {
    const b = new OrderBook();
    b.order("lactate", 0);
    b.order("urine", 0);
    b.cancel("lactate");
    expect([...b.ordered()]).toEqual(["urine"]);
  });

  it("orderLines lists each order with its times", () => {
    const b = new OrderBook();
    b.order("urine", 10);
    b.tick(11, N({ urineMlHr: 35 }));
    b.order("lactate", 60);
    expect(orderLines(b)).toEqual([
      "Urine output: ordered 0:10, back 0:11, 35 mL/h",
      "Lactate: ordered 1:00, not back yet",
    ]);
  });
});

describe("debrief estimate label", () => {
  it("a respiratory-rate line carries the estimate label", () => {
    const b = new OrderBook();
    b.order("rr", 0);
    b.tick(1, N({ respRate: 16 }));
    const lines = orderLines(b);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("(estimate)");
  });
  it("a lactate line does not carry the estimate label", () => {
    const b = new OrderBook();
    b.order("lactate", 0);
    b.tick(600, N({ lactate: 3 }));
    expect(orderLines(b)[0]).not.toContain("(estimate)");
  });
});

describe("waiting while unstable harm", () => {
  const harm = GENERIC_HARMS.find((h) => h.tag === "waiting while unstable")!;

  it("fires while waiting on a result with low pressure", () => {
    expect(harm).toBeDefined();
    expect(harm.when(P({ waiting: true, map: 55 }))).toBe(true);
  });
  it("fires while waiting in arrest", () => {
    expect(harm.when(P({ waiting: true, arrest: "arrest", map: 0 }))).toBe(true);
  });
  it("does not fire with pressure held, or when not waiting", () => {
    expect(harm.when(P({ waiting: true, map: 80 }))).toBe(false);
    expect(harm.when(P({ waiting: false, map: 55 }))).toBe(false);
  });
});
