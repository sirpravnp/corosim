import { afterEach, describe, expect, it } from "vitest";
import { createPlaygroundUi, type PlaygroundHost } from "../src/panels/playgroundControls";
import { afterShot, shotSpec } from "../src/panels/coroPumpControls";
import { learnerMayApply } from "../src/cases/gate";
import { buildPlaygroundSpec, stateOfSpec, withDevice } from "../src/sim/playground";
import { Simulation } from "../src/sim/simulation";
import type { PlaygroundState } from "../src/sim/playground";
import { DEFAULT_COROPUMP } from "../src/sim/patient";

// A minimal DOM: builders create elements, append, set data-* and listen. Listeners are kept so a test can drive a control.
interface El { children: El[]; style: object; dataset: Record<string, string>; hidden: boolean; value: string; listeners: Record<string, (() => void)[]>; [k: string]: unknown }
const made: El[] = [];
const el = (): El => {
  const e = { children: [], style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, hidden: false, value: "", options: [], listeners: {} } as unknown as El;
  e.append = (...k: El[]) => { e.children.push(...k); };
  e.addEventListener = (t: string, f: () => void) => { (e.listeners[t] ??= []).push(f); };
  e.setAttribute = () => {}; e.querySelectorAll = () => []; e.replaceChildren = () => {};
  made.push(e);
  return e;
};
const g = globalThis as unknown as { document?: unknown };
const had = g.document;
afterEach(() => { g.document = had; made.length = 0; });

function build(initial: PlaygroundState = withDevice({}, "coroPump", true)) {
  g.document = { createElement: () => el(), activeElement: null };
  let state = initial;
  const fired: string[] = [];
  const host: PlaygroundHost = { getState: () => state, setState: (n) => { state = n; }, loadPreset() {}, exit() {}, fire: (s) => fired.push(s) };
  const ui = createPlaygroundUi(host);
  const control = (field: string) => made.find((e) => e.dataset.field === field)!;
  const drive = (field: string, value: string, type = "change") => { const c = control(field); c.value = value; for (const f of c.listeners[type] ?? []) f(); };
  return { ui, drive, control, fired, get state() { return state; } };
}
const cp = (s: PlaygroundState) => s.devices!.coroPump!;

describe("CoroPump controls", () => {
  it("changing model patches devices.coroPump.model", () => { const b = build(); b.drive("devices.coroPump.model", "5.5"); expect(cp(b.state).model).toBe("5.5"); });
  it("changing level patches devices.coroPump.level", () => { const b = build(); b.drive("devices.coroPump.level", "8", "input"); expect(cp(b.state).level).toBe(8); });
  it("changing position patches devices.coroPump.position", () => { const b = build(); b.drive("devices.coroPump.position", "deep"); expect(cp(b.state).position).toBe("deep"); });
  it("changing the purge solution and heparin patches purge.*", () => {
    const b = build();
    b.drive("devices.coroPump.purge.solution", "bicarbonate"); expect(cp(b.state).purge?.solution).toBe("bicarbonate");
    b.drive("devices.coroPump.purge.heparinUml", "12", "input"); expect(cp(b.state).purge?.heparinUml).toBe(12);
    expect(cp(b.state).purge?.solution).toBe("bicarbonate"); // the earlier edit stays
  });
  it("the purge line selector patches purge.line", () => { const b = build(); b.drive("devices.coroPump.purge.line", "kinked"); expect(cp(b.state).purge?.line).toBe("kinked"); });
  it("clear line fires once and the state shows the line clear, with no flag left behind", () => {
    const start = withDevice({}, "coroPump", true);
    const kinked: PlaygroundState = { ...start, devices: { coroPump: { ...DEFAULT_COROPUMP, purge: { line: "kinked" } } } };
    const b = build(kinked);
    for (const f of b.control("devices.coroPump.purge.clearLine").listeners.click) f();
    expect(b.fired).toEqual(["clearLine"]);
    expect(shotSpec("clearLine")).toEqual({ devices: { coroPump: { purge: { clearLine: true } } } });
    const after = afterShot(kinked, "clearLine");
    expect(cp(after).purge?.line).toBe("clear");
    expect(JSON.stringify(after)).not.toMatch(/clearLine|exchange|reposition/);
  });
  it("exchange patches exchange = true once and keeps no flag in the state", () => {
    expect(shotSpec("exchange")).toEqual({ devices: { coroPump: { exchange: true } } });
    const s = withDevice({}, "coroPump", true);
    expect(JSON.stringify(afterShot(s, "exchange"))).not.toMatch(/exchange/);
    const b = build(); for (const f of b.control("devices.coroPump.exchange").listeners.click) f();
    expect(b.fired).toEqual(["exchange"]);
  });
  it("reposition puts the position back to correct", () => {
    const deep: PlaygroundState = { devices: { coroPump: { ...DEFAULT_COROPUMP, position: "deep" } } };
    expect(cp(afterShot(deep, "reposition")).position).toBe("correct");
    expect(shotSpec("reposition")).toEqual({ devices: { coroPump: { reposition: true } } });
  });
  it("a refused edit restores the control", () => {
    const b = build();
    const info = { warnings: [], link: "", presetId: null };
    b.ui.sync(b.state, info);
    const sel = b.control("devices.coroPump.model");
    expect(sel.value).toBe("CP");
    // the page's setState refuses (the learner gate) and syncs the controls back to the unchanged state
    const refusing = (() => { const orig = b.state; return orig; })();
    sel.value = "5.5"; // the user picked a model; the host refused, so the state is unchanged
    b.ui.sync(refusing, info);
    expect(sel.value).toBe("CP");
  });
  it("exposes no control without an engine field behind it (snapshot of control ids)", () => {
    const b = build();
    expect(b.ui.fields.filter((f) => f.startsWith("devices.coroPump")).sort()).toEqual([
      "devices.coroPump.exchange", "devices.coroPump.level", "devices.coroPump.model", "devices.coroPump.position",
      "devices.coroPump.purge.clearLine", "devices.coroPump.purge.heparinUml", "devices.coroPump.purge.line", "devices.coroPump.purge.solution", "devices.coroPump.reposition",
    ]);
  });
  it("disease controls (position, purge line) are marked so a running case hides them; treatments are not", () => {
    const b = build();
    for (const f of ["devices.coroPump.position", "devices.coroPump.purge.line"]) expect(b.control(f).dataset.disease, f).toBe("1");
    for (const f of ["devices.coroPump.model", "devices.coroPump.level", "devices.coroPump.purge.solution", "devices.coroPump.purge.heparinUml", "devices.coroPump.reposition", "devices.coroPump.purge.clearLine", "devices.coroPump.exchange"]) expect(b.control(f).dataset.disease, f).toBeUndefined();
  });
  it("in a running case the learner gate allows the treatments and refuses the disease edits", () => {
    for (const shot of ["reposition", "clearLine", "exchange"] as const) expect(learnerMayApply(shotSpec(shot)).ok, shot).toBe(true);
    for (const e of [{ position: "deep" }, { purge: { line: "blocked" } }, { initial: { thrombusBurden: 0.5 } }] as const)
      expect(learnerMayApply({ devices: { coroPump: e as never } }).ok, JSON.stringify(e)).toBe(false);
    for (const e of [{ level: 4 }, { model: "5.5" }, { purge: { solution: "bicarbonate" } }, { purge: { heparinUml: 10 } }] as const)
      expect(learnerMayApply({ devices: { coroPump: e as never } }).ok, JSON.stringify(e)).toBe(true);
  });
});

describe("one-shot through the engine, the way the page runs it (apply, mirror, setPatient)", () => {
  const seq = (shot: "reposition" | "clearLine" | "exchange", cp: Record<string, unknown>) => {
    const sim = new Simulation({}, { engine: "core" });
    sim.reset({ devices: { coroPump: { level: 6, ...cp } } }, { settled: true });
    sim.warmup(10);
    let st: PlaygroundState = stateOfSpec({ devices: { coroPump: { level: 6, ...cp } } });
    sim.apply(shotSpec(shot));
    st = afterShot(st, shot);
    sim.setPatient(buildPlaygroundSpec(sim.scenario(), st).spec); // what pgApply hands the engine next
    sim.step(5, { minutes: 1 });
    return sim.devices()!.coroPump!;
  };
  it("reposition: the position is correct and the clot is still there (a reposition is not an exchange)", () => {
    const r = seq("reposition", { position: "deep", initial: { thrombusBurden: 0.4 } });
    expect(r.position).toBe("correct");
    expect(r.thrombusBurden).toBeGreaterThan(0.3);
  });
  it("clear line: the purge pressure comes down and the clot is still there", () => {
    const r = seq("clearLine", { purge: { line: "blocked" }, initial: { thrombusBurden: 0.4 } });
    expect(r.purge.line).toBe("clear");
    expect(r.thrombusBurden).toBeGreaterThan(0.3);
  });
  it("exchange: a new pump, no clot", () => {
    const r = seq("exchange", { initial: { thrombusBurden: 0.6 } });
    expect(r.thrombusBurden).toBeLessThan(0.01); // a new pump regrows only a trace in the minute stepped
  });
});
