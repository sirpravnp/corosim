import { describe, it, expect } from "vitest";
import { StubLabEngine } from "../src/lab/stub";
import type { LabEngineLike, Action } from "../src/lab/types";

const setup = (e: LabEngineLike) => {
  e.apply({ t: "access", site: "femoral-R" });
  e.apply({ t: "sheath", french: 6 });
  e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
  e.apply({ t: "select", slot: "wire", id: "wire-workhorse" });
};

/** Advance in 40 mm steps until the tip is 20 mm into the LAD; calls `each` after every step. */
const toLad = (e: LabEngineLike, each: () => void = () => {}) => {
  for (let i = 0; i < 80; i++) {
    e.apply({ t: "advance", mm: 40 }); each();
    const w = e.state().wire!;
    if (w.tipSeg === "LAD" && w.tipMm >= 20) return;
  }
  throw new Error("the wire never reached the LAD");
};

describe("StubLabEngine", () => {
  it("refuses a device before access", () => {
    const e = new StubLabEngine();
    const ev = e.apply({ t: "select", slot: "guide", id: "guide-jl4" });
    expect(ev[0].severity).toBe("bad");
    expect(e.state().guide).toBeNull();
  });
  it("advances a wire along the LAD and reports tipMm increasing", () => {
    const e = new StubLabEngine(); setup(e);
    let last = -1;
    toLad(e, () => {
      const w = e.state().wire!;
      const along = w.route.indexOf(w.tipSeg) * 1e4 + w.tipMm; // later segment or further along counts as progress
      expect(along).toBeGreaterThan(last); last = along;
    });
    expect(e.state().wire!.tipSeg).toBe("LAD");
  });
  it("inflating flags an occluding balloon and deflating releases it", () => {
    const e = new StubLabEngine(); setup(e);
    toLad(e);
    e.apply({ t: "select", slot: "balloon", id: "bal-semi-3.00-12" });
    const ev = e.apply({ t: "inflate", atm: 10, seconds: 10 });
    expect(ev.some((x) => x.data?.occludesFlow === true)).toBe(true);
    expect(e.state().balloon!.inflatedAtm).toBe(10);
    e.apply({ t: "deflate" });
    expect(e.state().balloon!.inflatedAtm).toBe(0);
  });
  it("deploying a stent records it on the plaque and clears the stenosis", () => {
    const e = new StubLabEngine(); setup(e);
    toLad(e);
    const before = e.plaques()[0].ds;
    e.apply({ t: "select", slot: "stent", id: "stent-des-3.00-24" });
    e.apply({ t: "deploy", atm: 14, seconds: 10 });
    expect(e.plaques()[0].stents.length).toBe(1);
    expect(e.plaques()[0].ds).toBeLessThan(before);
  });
  it("draws a graph whose coronary and access segments connect", () => {
    const g = new StubLabEngine().graph();
    for (const s of g.segs) { expect(s.samples.length).toBeGreaterThan(1); if (s.parent) expect(g.byId[s.parent]).toBeDefined(); }
    expect(g.byId.LAD).toBeDefined();
  });
  it("logs every action and reset empties the log", () => {
    const e = new StubLabEngine(); setup(e);
    expect(e.state().log.length).toBe(4);
    e.reset();
    expect(e.state().log).toEqual([]);
    expect(e.state().wire).toBeNull();
  });
  it("replay gives the same state as applying the actions one by one", () => {
    const acts: Action[] = [{ t: "access", site: "radial-R" }, { t: "sheath", french: 6 }, { t: "select", slot: "guide", id: "guide-jl4" }];
    const a = new StubLabEngine(); acts.forEach((x) => a.apply(x));
    const b = new StubLabEngine(); b.replay(acts);
    expect(b.state()).toEqual(a.state());
  });
  it("satisfies LabEngineLike", () => { const e: LabEngineLike = new StubLabEngine(); expect(typeof e.apply).toBe("function"); });
});
