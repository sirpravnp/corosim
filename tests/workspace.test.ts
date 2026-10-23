import { describe, expect, it } from "vitest";
import type { Panel, PanelDef } from "../src/panels/panel";
import {
  LAYOUT_KEY, defaultLayout, loadLayout, pickerItems, sanitizeLayout, saveLayout, setActive, setPanelOn, visibleIds, type KV,
} from "../src/panels/layout";
import { DASH, badgeText, numberRows } from "../src/panels/numbers";
import { createStubSource } from "../src/sim/stubSource";

const def = (id: string, defaultOn: boolean): PanelDef => ({ id, title: id.toUpperCase(), defaultOn, create: () => ({}) as Panel });
const defs = [def("a", true), def("b", false), def("c", true)];

describe("layout", () => {
  it("defaults to the defaultOn panels in order", () => {
    expect(defaultLayout(defs)).toEqual({ on: ["a", "c"], active: "a" });
  });
  it("sanitizes junk, unknown ids and duplicates", () => {
    expect(sanitizeLayout(null, defs)).toEqual(defaultLayout(defs));
    expect(sanitizeLayout({ on: "x" }, defs)).toEqual(defaultLayout(defs));
    expect(sanitizeLayout({ on: ["c", "zz", "c", 4, "b"], active: "b" }, defs)).toEqual({ on: ["c", "b"], active: "b" });
    expect(sanitizeLayout({ on: ["c"], active: "a" }, defs).active).toBe("c");
    expect(sanitizeLayout({ on: [] }, defs)).toEqual({ on: [], active: null });
  });
  it("toggles panels, appending new ones and moving the active tab when it closes", () => {
    let s = defaultLayout(defs);
    s = setPanelOn(s, "b", true, defs);
    expect(s.on).toEqual(["a", "c", "b"]);
    s = setPanelOn(s, "a", false, defs);
    expect(s).toEqual({ on: ["c", "b"], active: "c" });
    expect(setPanelOn(s, "nope", true, defs)).toBe(s);
    expect(setPanelOn(s, "c", true, defs)).toBe(s);
    s = setPanelOn(setPanelOn(s, "c", false, defs), "b", false, defs);
    expect(s).toEqual({ on: [], active: null });
    expect(setPanelOn(s, "b", true, defs).active).toBe("b");
  });
  it("picker rows reflect the state", () => {
    const rows = pickerItems(defaultLayout(defs), defs);
    expect(rows.map(r => r.checked)).toEqual([true, false, true]);
    expect(rows[1].title).toBe("B");
  });
  it("shows everything on desktop and only the active tab on a phone", () => {
    const s = setActive(defaultLayout(defs), "c");
    expect(visibleIds(s, false)).toEqual(["a", "c"]);
    expect(visibleIds(s, true)).toEqual(["c"]);
    expect(setActive(s, "b")).toBe(s);
  });
  it("round-trips through storage and survives missing or throwing storage", () => {
    const m = new Map<string, string>();
    const kv: KV = { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
    saveLayout({ on: ["c", "a"], active: "a" }, kv);
    expect(loadLayout(defs, kv)).toEqual({ on: ["c", "a"], active: "a" });
    m.set(LAYOUT_KEY, "{not json");
    expect(loadLayout(defs, kv)).toEqual(defaultLayout(defs));
    const bad: KV = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadLayout(defs, bad)).toEqual(defaultLayout(defs));
    expect(() => saveLayout(defaultLayout(defs), bad)).not.toThrow();
    expect(loadLayout(defs, null)).toEqual(defaultLayout(defs));
  });
});

describe("stub source", () => {
  let t = 100;
  const src = createStubSource(() => t);
  it("is a bridge with plausible normal values", () => {
    expect(src.kind).toBe("bridge");
    const n = src.numbers();
    expect([n.map, n.co, n.cvp, n.pcwp]).toEqual([90, 5, 4, 8]);
    expect(n.diastolic).toBeLessThan(n.map);
    expect(n.map).toBeLessThan(n.systolic);
    expect(src.saturations().spo2).toBeGreaterThan(0.9);
  });
  it("advances its clock", () => {
    const a = src.now(); t += 2.5;
    expect(src.now() - a).toBeCloseTo(2.5);
  });
  it("returns shaped traces and a complete beat", () => {
    const tr = src.trace("AO", 4, { maxPoints: 100 });
    expect(tr.t.length).toBe(tr.v.length);
    expect(tr.t.length).toBeLessThanOrEqual(100);
    expect(Math.max(...tr.v)).toBeGreaterThan(Math.min(...tr.v));
    for (const n of src.nodes()) expect(src.trace(n, 2).v.every(Number.isFinite)).toBe(true);
    const b = src.beats(1)[0];
    for (const n of src.nodes()) expect(b.pressure[n as keyof typeof b.pressure].length).toBe(b.time.length);
    for (const c of ["RA", "RV", "LA", "LV"] as const) expect(b.loops[c].p.length).toBe(b.loops[c].v.length);
    expect(() => src.onBeat(() => {})()).not.toThrow();
  });
});

describe("numbers panel rows", () => {
  const src = createStubSource(() => 0);
  it("formats a catheter table and shows a dash for NaN", () => {
    const rows = Object.fromEntries(numberRows(src.numbers(), src.saturations()));
    expect(rows["BP s/d (mean)"]).toBe("120/70 (90)");
    expect(rows["PA s/d (mean)"]).toBe("25/10 (15)");
    expect(rows["CO / CI"]).toBe("5.0 / 2.7");
    expect(rows["SpO₂"]).toBe("98%");
    const n = { ...src.numbers(), pcwp: NaN, qpQs: NaN, pa: { systolic: NaN, diastolic: NaN, mean: NaN } };
    const r2 = Object.fromEntries(numberRows(n, src.saturations()));
    expect(r2["PCWP"]).toBe(DASH);
    expect(r2["Qp:Qs"]).toBe(DASH);
    expect(r2["PA s/d (mean)"]).toBe(DASH);
  });
  it("badge names the source kind", () => {
    expect(badgeText("bridge")).toBe("bridge");
    expect(badgeText("live")).toBe("live");
  });
});
