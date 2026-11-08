import { describe, it, expect, vi } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LabEngine } from "../src/lab/engine";
import { attachLabKeyboard, labKeyAction } from "../src/lab/controls";
import type { Action } from "../src/lab/types";

type FakeKey = Pick<KeyboardEvent, "key" | "code" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "target">;

const fakeKey = (key: string, extra: Partial<FakeKey> = {}): KeyboardEvent =>
  ({
    key, code: `Key${key.toUpperCase()}`, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, target: null,
    preventDefault: () => {}, ...extra,
  } as KeyboardEvent);

describe("lab keyboard controls", () => {
  it("maps movement keys to advance and torque", () => {
    expect(labKeyAction(fakeKey("w"))).toEqual({ t: "advance", mm: 2 });
    expect(labKeyAction(fakeKey("s"))).toEqual({ t: "advance", mm: -2 });
    expect(labKeyAction(fakeKey("ArrowUp", { shiftKey: true }))).toEqual({ t: "advance", mm: 10 });
    expect(labKeyAction(fakeKey("ArrowDown", { ctrlKey: true }))).toEqual({ t: "advance", mm: -0.5 });
    expect(labKeyAction(fakeKey("a"))).toEqual({ t: "torque", deg: -15 });
    expect(labKeyAction(fakeKey("d"))).toEqual({ t: "torque", deg: 15 });
    expect(labKeyAction(fakeKey("["))).toEqual({ t: "shape", tipBendDeg: -8 });
  });

  it("hold-to-repeat advances the wire through the engine", () => {
    vi.useFakeTimers();
    const sim = new Simulation({ seed: 1 });
    sim.warmup(20);
    const e = new LabEngine(sim, {
      seed: 2,
      access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false },
      plaques: [],
    });
    e.apply({ t: "access", site: "femoral-R" });
    e.apply({ t: "sheath", french: 6 });
    e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    for (let i = 0; i < 50; i++) e.apply({ t: "advance", mm: 80 });
    e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
    const applied: Action[] = [];
    const bus: Record<string, Array<(ev: KeyboardEvent) => void>> = {};
    const root: import("../src/lab/controls").LabKeyboardRoot = {
      addEventListener: (t, fn) => { (bus[t] ??= []).push(fn); },
      removeEventListener: (t, fn) => { bus[t] = (bus[t] ?? []).filter((f) => f !== fn); },
    };
    const detach = attachLabKeyboard(root, {
      apply: (a) => { applied.push(a); return e.apply(a); },
    }, { bindings: { repeatMs: 40 } });
    for (const fn of bus.keydown ?? []) fn(fakeKey("w", { code: "KeyW" }));
    vi.advanceTimersByTime(120);
    for (const fn of bus.keyup ?? []) fn({ code: "KeyW" } as KeyboardEvent);
    detach();
    vi.useRealTimers();
    expect(applied.length).toBeGreaterThan(2);
    expect(applied.every((a) => a.t === "advance" && a.mm > 0)).toBe(true);
    const pushed = applied.reduce((s, a) => s + (a.t === "advance" ? a.mm : 0), 0);
    expect(pushed).toBeGreaterThan(6);
  });
});
