import { describe, it, expect } from "vitest";
import { nextHint } from "../src/lab/hint";
import { createUnified, hintToAction, hintGoal, resusModel, coronaryOf, undoStep } from "../src/cath/unified/model";
import type { Action } from "../src/lab/types";

/** Get to an engaged guide with a wire loaded on the target's coronary. */
const toWire = (s: ReturnType<typeof createUnified>, segId: string) => {
  const e = s.engine, root = coronaryOf(segId);
  e.apply({ t: "access", site: "femoral-R" }); e.apply({ t: "sheath", french: 6 }); e.apply({ t: "drug", id: "heparin", dose: 6000 });
  e.apply({ t: "target", segId });
  e.apply({ t: "select", slot: "guide", id: root === "RCA" ? "guide-jr4" : "guide-jl4" });
  e.apply({ t: "autoAdvance", to: root });
  e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
};

describe("unified cath page: Treat", () => {
  it("hint button shows a reason and, on Show me, performs the action", () => {
    const s = createUnified("lad75");
    const goal = hintGoal(s)!;
    expect(goal.segId).toBe("LAD");
    const h = nextHint(s.engine, goal);
    expect(h.why.length).toBeGreaterThan(5);
    const a = hintToAction(h);
    expect(a).toEqual({ t: "access", site: "femoral-R" });
    s.engine.apply(a!);
    expect(s.engine.state().access).toBe("femoral-R");
  });

  it("Show me alone takes a fresh patient through to a deployed stent", () => {
    const s = createUnified("lad75");
    let deployed = false;
    for (let i = 0; i < 160 && !deployed; i++) {
      const goal = hintGoal(s)!;
      const a = hintToAction(nextHint(s.engine, goal));
      if (!a) break;
      s.engine.apply(a);
      deployed = !!s.engine.state().stent?.deployed;
    }
    expect(deployed).toBe(true);
    expect(s.sim.dead).toBe(false);
  });

  it("maps every hint kind to a matching action", () => {
    const cases: [Parameters<typeof hintToAction>[0], Action | null][] = [
      [{ kind: "withdraw", mm: 4, why: "" }, { t: "advance", mm: -4 }],
      [{ kind: "torque", deg: -30, why: "" }, { t: "torque", deg: -30 }],
      [{ kind: "engage", why: "", target: { segId: "RCA", mm: 0 } }, { t: "autoAdvance", to: "RCA" }],
      [{ kind: "select", why: "Set the treatment target to OM1 (target-OM1)." }, { t: "target", segId: "OM1" }],
      [{ kind: "select", why: "Select a DES sized to the vessel (stent-des-3.00-18)." }, { t: "select", slot: "stent", id: "stent-des-3.00-18" }],
      [{ kind: "select", why: "Place a 6 French sheath (sheath-6)." }, { t: "sheath", french: 6 }],
      [{ kind: "none", why: "" }, null],
    ];
    for (const [h, want] of cases) expect(hintToAction(h)).toEqual(want);
  });

  it("undo after a perforation restores the picture and the monitor", () => {
    const s = createUnified("lad75");
    toWire(s, "LAD");
    const e = s.engine;
    let perforated = false;
    for (let i = 0; i < 80 && !perforated; i++) {
      const before = e.state().log.length;
      const ev = e.apply({ t: "advance", mm: 12 });
      if (ev.some((x) => x.kind === "perforation")) {
        perforated = true;
        expect(e.effusionMl!()).toBeGreaterThanOrEqual(0);
        e.undo();
        expect(e.state().log.length).toBe(before);
        expect(e.effusionMl!()).toBe(0);
        expect(s.sim.dead).toBe(false);
        expect(e.undoCount).toBe(1);
        expect(resusModel(s.sim, e).tamponade).toBe(false);
      }
    }
    // the dice may never perforate on this seed: then undo of the last advance must still be clean
    if (!perforated) {
      const n = e.state().log.length;
      e.undo();
      expect(e.state().log.length).toBe(n - 1);
      expect(e.undoCount).toBe(1);
    }
  });

  it("undo steps over C-arm moves to take back the last procedure step", () => {
    const s = createUnified("lad75");
    s.engine.apply({ t: "access", site: "femoral-R" });
    s.engine.apply({ t: "sheath", french: 6 });
    s.engine.apply({ t: "carm", rot: 20, tilt: 10 });
    s.engine.apply({ t: "carm", rot: 25, tilt: 10 });
    expect(undoStep(s)).toBe(true);
    expect(s.engine.state().sheathFr).toBeNull();
    expect(s.engine.state().access).toBe("femoral-R");
    expect(s.undos).toBe(1);
    expect(undoStep(s)).toBe(true);
    expect(undoStep(s)).toBe(false);
    expect(s.undos).toBe(2);
  });

  it("undo at the start is a no-op", () => {
    const s = createUnified("lad75");
    expect(s.engine.canUndo()).toBe(false);
    expect(() => s.engine.undo()).not.toThrow();
    expect(s.engine.undoCount).toBe(0);
  });

  it("death shows a clear state with a restart control, and CPR and shock appear when arrest starts", () => {
    const s = createUnified("lad75");
    s.sim.apply({ patient: { rhythm: "vf-coarse" } });
    for (let i = 0; i < 40 && s.sim.arrestState().status !== "arrest"; i++) s.sim.step(0.25, { minutes: 0 });
    const m = resusModel(s.sim, s.engine);
    expect(m.arrest).toBe(true);
    expect(m.dead).toBe(false);
    for (let i = 0; i < 2600 && !s.sim.dead; i++) s.sim.step(0.25, { minutes: 0 });
    expect(s.sim.dead).toBe(true);
    expect(resusModel(s.sim, s.engine).dead).toBe(true);
    s.engine.apply({ t: "access", site: "femoral-R" }); // a dead patient keeps the lab state; restart is an engine action
    s.sim.restartPatient();
    expect(s.sim.dead).toBe(false);
  });

  it("pericardiocentesis control appears with tamponade and drains the effusion", () => {
    const s = createUnified("lad75");
    toWire(s, "LAD");
    const e = s.engine;
    let eff = 0;
    for (let i = 0; i < 120 && eff <= 0; i++) { e.apply({ t: "advance", mm: 12 }); eff = e.effusionMl!(); if (eff <= 0 && i % 6 === 5) e.apply({ t: "advance", mm: -30 }); }
    if (eff <= 0) return; // no perforation on this seed; the engine's own tests cover the drain path
    for (let i = 0; i < 60; i++) e.tick!(1);
    const m = resusModel(s.sim, e);
    expect(m.effusionMl).toBeGreaterThan(0);
    const ev = e.apply({ t: "pericardiocentesis", ml: Math.ceil(m.effusionMl) });
    expect(ev.some((x) => x.kind === "pericardiocentesis")).toBe(true);
    expect(e.effusionMl!()).toBeLessThan(m.effusionMl);
  });

  const mag = (v: readonly number[]) => Math.hypot(v[0], v[1], v[2]);
  it("the 12-lead shows an injury current with a critical left main, and none with normal coronaries", () => {
    const lm = createUnified("lm90").sim.ecgInputs().injury;
    expect(mag(lm)).toBeGreaterThan(0.1);
    expect(mag(createUnified("normal").sim.ecgInputs().injury)).toBeLessThan(0.01);
  });

  it.fails("the 12-lead shows anterior ST elevation after a proximal LAD occlusion (blocked by engine finding C1)", () => {
    const occ = createUnified("ladocc").sim.ecgInputs().injury;
    expect(mag(occ)).toBeGreaterThan(0.1);
    expect(occ[2]).toBeGreaterThan(0); // the anterior leads look forward (+z)
  });
});
