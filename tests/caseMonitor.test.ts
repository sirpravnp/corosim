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
