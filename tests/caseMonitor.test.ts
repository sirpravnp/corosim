import { describe, expect, it } from "vitest";
import { monitorTiles, type MonitorInput } from "../src/page/caseMonitor";

const ALL = ["hr", "bp", "ecg", "spo2", "rr", "temp"];
const base: MonitorInput = { hr: 96.4, sbp: 118.2, dbp: 71.6, map: 87.3, spo2: 0.974, respRate: 17.2, tempC: 37.04, arrest: "none" };
const by = (ts: ReturnType<typeof monitorTiles>, id: string) => ts.find((t) => t.id === id)!;

describe("monitorTiles", () => {
  it("makes tiles in the order HR, BP, SpO2, RR, Temp (the ecg id is the strip, not a tile)", () => {
    expect(monitorTiles(base, ALL).map((t) => t.id)).toEqual(["hr", "bp", "spo2", "rr", "temp"]);
  });
  it("makes only the tiles that are shown", () => {
    expect(monitorTiles(base, ["temp", "hr"]).map((t) => t.id)).toEqual(["hr", "temp"]);
    expect(monitorTiles(base, ["ecg"])).toEqual([]);
  });
  it("rounds values and keeps units apart, BP carries the MAP", () => {
    const ts = monitorTiles(base, ALL);
    expect(by(ts, "hr")).toMatchObject({ value: "96", unit: "bpm" });
    expect(by(ts, "bp")).toMatchObject({ value: "118/72 (87)", unit: "mmHg" });
    expect(by(ts, "spo2")).toMatchObject({ value: "97", unit: "%" });
    expect(by(ts, "rr")).toMatchObject({ value: "17", unit: "/min" });
    expect(by(ts, "temp")).toMatchObject({ value: "37.0", unit: "°C" });
  });
  it("a missing or non-finite value gives a dash, never NaN", () => {
    const ts = monitorTiles({ hr: NaN, sbp: NaN, dbp: 70, map: Infinity, spo2: NaN, respRate: NaN, tempC: NaN, arrest: "none" }, ALL);
    for (const t of ts) { expect(t.value).toBe("—"); expect(t.abnormal).toBe(false); }
    expect(JSON.stringify(ts)).not.toMatch(/NaN|undefined|Infinity/);
    expect(JSON.stringify(monitorTiles({} as MonitorInput, ALL))).not.toMatch(/NaN|undefined/);
  });
  it("no beats yet (rate 0) is a dash for the rate", () => {
    expect(by(monitorTiles({ ...base, hr: 0 }, ALL), "hr").value).toBe("—");
  });
  it("arrest or death gives no pulse for HR and BP", () => {
    for (const arrest of ["arrest", "dead"] as const) {
      const ts = monitorTiles({ ...base, arrest }, ALL);
      expect(by(ts, "hr").value).toBe("no pulse");
      expect(by(ts, "bp").value).toBe("no pulse");
      expect(by(ts, "hr").abnormal).toBe(true);
    }
    expect(by(monitorTiles({ ...base, arrest: "rosc" }, ALL), "hr").value).toBe("96");
  });
  it("rr and temp are estimates, the rest are not", () => {
    const ts = monitorTiles(base, ALL);
    expect(ts.filter((t) => t.estimate).map((t) => t.id)).toEqual(["rr", "temp"]);
  });
  it("flags abnormal values: HR outside 50 to 110, MAP below 65, SpO2 below 90, RR outside 8 to 22, temp outside 36 to 38", () => {
    const ab = (o: Partial<MonitorInput>, id: string) => by(monitorTiles({ ...base, ...o }, ALL), id).abnormal;
    expect(ab({}, "hr")).toBe(false); expect(ab({ hr: 49 }, "hr")).toBe(true); expect(ab({ hr: 111 }, "hr")).toBe(true); expect(ab({ hr: 110 }, "hr")).toBe(false);
    expect(ab({ map: 64 }, "bp")).toBe(true); expect(ab({ map: 65 }, "bp")).toBe(false);
    expect(ab({ spo2: 0.89 }, "spo2")).toBe(true); expect(ab({ spo2: 0.9 }, "spo2")).toBe(false);
    expect(ab({ respRate: 23 }, "rr")).toBe(true); expect(ab({ respRate: 7 }, "rr")).toBe(true); expect(ab({ respRate: 22 }, "rr")).toBe(false);
    expect(ab({ tempC: 38.4 }, "temp")).toBe(true); expect(ab({ tempC: 35.5 }, "temp")).toBe(true); expect(ab({ tempC: 37 }, "temp")).toBe(false);
  });
  it("no tile gives the rhythm away", () => {
    const sick = monitorTiles({ ...base, map: 40, hr: 150, arrest: "none", rhythmLabel: "Atrial fibrillation with rapid ventricular response" } as MonitorInput, ALL);
    const text = JSON.stringify(sick);
    expect(text).not.toMatch(/fibrillation|tachycardia|bradycardia|sinus|rhythm|stable|shock|hypotension|STEMI|block/i);
  });
});

import { casePanels } from "../src/page/caseMonitor";
import { itemById, STANDARD_MONITOR } from "../src/cases/orders";
describe("casePanels", () => {
  const of = (id: string) => itemById(id)?.panel;
  it("the standard monitor opens no workspace panel at all", () => {
    expect(casePanels(STANDARD_MONITOR, of)).toEqual([]);
  });
  it("a 12-lead order opens the ECG figure; other displays open their own panels; the Monitor panel never opens", () => {
    expect(casePanels([...STANDARD_MONITOR, "twelvelead", "jvp"], of)).toEqual(["ecg", "jvp"]);
    expect(casePanels(["numbers", "monitor"], (id) => (id === "monitor" ? "monitor" : of(id)))).toEqual(["numbers"]);
  });
});

import { due, tileLabel } from "../src/page/caseMonitor";
import { resizeRing } from "../src/ecgStrip";
describe("tileLabel (state not by color alone)", () => {
  const ts = monitorTiles({ hr: 117, sbp: 95, dbp: 69, map: 60, spo2: 0.96, respRate: 17, tempC: 37, arrest: "none" }, ALL);
  it("says abnormal in words", () => {
    expect(tileLabel(by(ts, "hr"))).toBe("Heart rate 117 bpm, abnormal");
    expect(tileLabel(by(ts, "bp"))).toBe("Blood pressure 95/69 (60) mmHg, abnormal");
    expect(tileLabel(by(ts, "spo2"))).toBe("SpO2 96 %");
  });
  it("marks estimates, and says no reading for a dash", () => {
    expect(tileLabel(by(ts, "rr"))).toBe("Respiratory rate 17 /min, estimate");
    expect(tileLabel(by(monitorTiles({} as MonitorInput, ALL), "hr"))).toBe("Heart rate no reading");
  });
});
describe("due (the tile refresh throttle)", () => {
  it("refreshes first, then only after the period, and after a clock reset", () => {
    expect(due(-Infinity, 0, 125)).toBe(true);
    expect(due(1000, 1100, 125)).toBe(false);
    expect(due(1000, 1125, 125)).toBe(true);
    expect(due(1000, 500, 125)).toBe(true);
  });
});
describe("resizeRing (the strip keeps its trace across a resize)", () => {
  const ring = Float32Array.from([6, 7, 8, 9, 5]); // written 5..9 with 9 the newest at idx 4 (idx % 5 === 4 means 5 is the oldest? idx=9 total writes)
  it("grows: the same samples in order, blank after them", () => {
    const r = resizeRing(ring, 9, 8);
    expect([...r.ring.slice(0, 5)]).toEqual([5, 6, 7, 8, 9]);
    expect(Number.isNaN(r.ring[5])).toBe(true);
    expect(r.idx).toBe(5);
  });
  it("shrinks: the newest samples survive", () => {
    const r = resizeRing(ring, 9, 3);
    expect([...r.ring]).toEqual([7, 8, 9]);
    expect(r.idx % 3).toBe(0);
  });
});
