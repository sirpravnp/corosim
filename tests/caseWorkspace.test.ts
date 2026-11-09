import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LAYOUT_KEY, LayoutKeeper, defaultLayout, sessionLayout, type KV } from "../src/panels/layout";
import type { PanelDef } from "../src/panels/panel";
import { bedsideOverride, bodyTempC, setBedsideTemp, type BedsideInput } from "../src/sim/bedside";
import { monitorRowHidden } from "../src/panels/monitor";

const defs = ["ecg", "monitor", "oxygen", "jvp"].map((id, i) => ({ id, title: id, defaultOn: i < 2 }) as unknown as PanelDef);

function store(): KV & { writes: string[]; data: Map<string, string> } {
  const data = new Map<string, string>(), writes: string[] = [];
  return { data, writes, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { writes.push(k); data.set(k, v); } };
}

describe("case workspace", () => {
  it("sessionLayout turns on exactly the named panels and ignores unknown ids", () => {
    const s = sessionLayout(["oxygen", "nope", "ecg", "oxygen"], defs);
    expect(s.on).toEqual(["oxygen", "ecg"]);
    expect(s.active).toBe("oxygen");
    expect(sessionLayout([], defs)).toEqual({ on: [], active: null });
  });
  it("a session layout is not saved (storage stub sees no write)", () => {
    const st = store(), k = new LayoutKeeper(defs, st);
    k.setSession(["oxygen"]);
    k.set({ on: ["oxygen", "jvp"], active: "jvp" });
    expect(k.layout.on).toEqual(["oxygen", "jvp"]);
    expect(st.writes).toEqual([]);
  });
  it("clearing the session restores the saved layout", () => {
    const st = store(), k = new LayoutKeeper(defs, st);
    k.set({ on: ["jvp"], active: "jvp" }); // the viewer's own choice: saved
    expect(st.writes).toEqual([LAYOUT_KEY]);
    k.setSession(["oxygen"]);
    expect(k.layout.on).toEqual(["oxygen"]);
    k.setSession(null);
    expect(k.layout.on).toEqual(["jvp"]);
    expect(st.writes).toEqual([LAYOUT_KEY]); // clearing wrote nothing
    expect(defaultLayout(defs).on).toEqual(["ecg", "monitor"]);
  });
  it("monitor rows: for the standard six only hr, bp, spo2, rr, temp, circulation and rhythm remain; null shows everything", () => {
    const html = readFileSync("sim/index.html", "utf8");
    const table = html.slice(html.indexOf('<table class="readout">'), html.indexOf("</table>", html.indexOf('<table class="readout">')));
    const rowIds = [...table.matchAll(/<tr( data-row="([^"]+)")?>/g)].map((m) => m[2] ?? null);
    expect(rowIds.length).toBeGreaterThan(12);
    const std = new Set(["hr", "bp", "spo2", "rr", "temp"]); // the standard six minus ecg, which is a panel
    expect(rowIds.filter((id) => !monitorRowHidden(id, std)).sort()).toEqual(["bp", "circulation", "hr", "rhythm", "rr", "spo2", "temp"]);
    expect(rowIds.filter((id) => !monitorRowHidden(id, new Set(["hr"]))).sort()).toEqual(["circulation", "hr", "rhythm"]);
    expect(rowIds.filter((id) => monitorRowHidden(id, null))).toEqual([]);
  });
  it("setBedsideTemp changes the temperature the monitor uses, and undefined restores 37.0", () => {
    const base: BedsideInput = { respRateBase: 15, map: 80, spo2: 0.98, lactate: 1, congestion: 0, arrest: "none" };
    const shown = () => bodyTempC({ ...base, tempOverrideC: bedsideOverride.tempOverrideC });
    expect(shown()).toBe(37.0);
    setBedsideTemp(38.4);
    expect(shown()).toBe(38.4);
    setBedsideTemp(undefined);
    expect(shown()).toBe(37.0);
  });
});
