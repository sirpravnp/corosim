import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAdopter, type Slot } from "../src/panels/adopt";
import { LAYOUT_KEY, LAYOUT_VERSION, defaultLayout, loadLayout, migrateLayout, saveLayout, type KV } from "../src/panels/layout";
import type { Panel, PanelDef } from "../src/panels/panel";
import { ecgPanel } from "../src/panels/ecg";
import { monitorPanel } from "../src/panels/monitor";

/** A minimal parent: tracks which nodes it holds, and takes a node from its previous parent like the DOM does. */
class FakeSlot implements Slot {
  kids: object[] = [];
  static owner = new Map<object, FakeSlot>();
  append(n: object) {
    const from = FakeSlot.owner.get(n);
    if (from) from.kids = from.kids.filter(k => k !== n);
    this.kids.push(n);
    FakeSlot.owner.set(n, this);
  }
}

describe("adopting page elements", () => {
  it("moves the very same element into the panel (so the page keeps writing to it) and parks it on release", () => {
    const el = {} as Node, panel = new FakeSlot(), park = new FakeSlot();
    let finds = 0;
    const a = createAdopter(() => (finds++, el), () => park);
    expect(a.attach(panel as unknown as Slot)).toBe(true);
    expect(panel.kids).toEqual([el]);
    a.release();
    expect(panel.kids).toEqual([]);
    expect(park.kids).toEqual([el]);
    a.attach(panel as unknown as Slot); // reopened from the picker: the same element comes back
    expect(panel.kids).toEqual([el]);
    expect(park.kids).toEqual([]);
    expect(finds).toBe(1);
  });
  it("reports a page without the element, and releasing then does nothing", () => {
    const a = createAdopter(() => null, () => { throw new Error("nothing to park"); });
    expect(a.attach(new FakeSlot() as unknown as Slot)).toBe(false);
    expect(() => a.release()).not.toThrow();
  });
});

describe("monitor and ECG panels", () => {
  const html = readFileSync("sim/index.html", "utf8");
  it("are on by default, and the ECG spans the row", () => {
    expect(monitorPanel.defaultOn && ecgPanel.defaultOn).toBe(true);
    expect(ecgPanel.wide).toBe(true);
    expect(monitorPanel.create().id).toBe(monitorPanel.id);
    expect(ecgPanel.create().id).toBe(ecgPanel.id);
  });
  it("adopt elements that exist in the Simulator page, the ones app.ts writes by id", () => {
    // The monitor is the section holding the readout cells; the ECG the figure holding the canvas and the ST map.
    const monitor = html.slice(html.indexOf("<h2>Monitor</h2>"), html.indexOf("</section>", html.indexOf("<h2>Monitor</h2>")));
    for (const id of ["circ", "bp", "co", "rhythm", "hr", "arate", "pr", "stup", "stdown"]) expect(monitor).toContain(`id="${id}"`);
    const fig = html.slice(html.indexOf('<canvas id="ecg">'), html.indexOf("</figure>", html.indexOf('<canvas id="ecg">')));
    expect(fig).toContain('id="stmap"');
  });
  it("draw nothing themselves: the page's frame loop owns their updates", () => {
    const p: Panel = ecgPanel.create();
    expect(() => p.draw(0)).not.toThrow();
  });
});

describe("layout migration (v1 to v2)", () => {
  const def = (id: string, defaultOn = true): PanelDef => ({ id, title: id, defaultOn, create: () => ({}) as Panel });
  const defs = [def("monitor"), def("ecg"), def("numbers"), def("traces", false)];
  it("gives a layout saved before P3b the monitor and ECG, first, and keeps the rest as it was", () => {
    expect(migrateLayout({ on: ["traces", "numbers"], active: "traces" }, defs)).toEqual({ on: ["monitor", "ecg", "traces", "numbers"], active: "traces" });
  });
  it("leaves a current layout alone, so closing the monitor sticks", () => {
    expect(migrateLayout({ v: LAYOUT_VERSION, on: ["numbers"], active: "numbers" }, defs)).toEqual({ on: ["numbers"], active: "numbers" });
  });
  it("does not duplicate them, and ignores them where the page has no such panels", () => {
    expect(migrateLayout({ on: ["ecg", "numbers"] }, defs).on).toEqual(["monitor", "ecg", "numbers"]);
    expect(migrateLayout({ on: ["numbers"] }, [def("numbers")]).on).toEqual(["numbers"]);
  });
  it("still falls back to the default for junk", () => {
    expect(migrateLayout(null, defs)).toEqual(defaultLayout(defs));
    expect(migrateLayout({ on: "x" }, defs)).toEqual(defaultLayout(defs));
  });
  it("loads a stored v1 blob migrated, and saves as v2 so it migrates once", () => {
    const m = new Map<string, string>([[LAYOUT_KEY, JSON.stringify({ on: ["numbers"], active: "numbers" })]]);
    const kv: KV = { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
    const first = loadLayout(defs, kv);
    expect(first.on).toEqual(["monitor", "ecg", "numbers"]);
    saveLayout({ on: ["numbers"], active: "numbers" }, kv); // the user then closes both
    expect(JSON.parse(m.get(LAYOUT_KEY)!).v).toBe(LAYOUT_VERSION);
    expect(loadLayout(defs, kv).on).toEqual(["numbers"]);
  });
});
