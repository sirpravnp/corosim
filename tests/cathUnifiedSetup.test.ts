import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { OLD_PRESETS, segmentChoices } from "../src/lab/lesions";
import {
  createUnified, setLesions, loadPreset, setStep, newLesion, clampSlider, sliderRanges, lesionSummary, hasProcedure, STEPS, slidersFromScenario,
} from "../src/cath/unified/model";

const html = readFileSync("cath/index.html", "utf8");

describe("unified cath page: shell and Set up", () => {
  it("shows the three-step bar and starts on Set up", () => {
    expect(STEPS.map((s) => s.label)).toEqual(["Set up", "Diagnose", "Treat"]);
    const s = createUnified();
    expect(s.step).toBe(1);
    expect(html).toMatch(/data-step="1" aria-current="step"/);
    for (const label of ["Set up", "Diagnose", "Treat"]) expect(html).toContain(`</span>${label}</button>`);
  });

  it("selecting a preset fills the sliders; changing a slider updates the plaque and the angiogram model", () => {
    const s = createUnified("normal");
    expect(s.lesions).toEqual([]);
    expect(loadPreset(s, "rcaocc")).toBe(true);
    expect(s.lesions).toHaveLength(1);
    expect(s.lesions[0].segId).toBe("RCA");
    expect(s.lesions[0].ds).toBe(1);
    expect(s.engine.plaques()[0].segId).toBe("RCA");
    expect(s.sim.n.lesionSpecs[0]).toMatchObject({ artery: "RCA", occluded: true });
    const before = s.generation;
    const edited = [{ ...s.lesions[0], ds: 0.5 }];
    expect(setLesions(s, edited, false)).toBe(true);
    expect(s.engine.plaques()[0].ds).toBeCloseTo(0.5, 6);
    expect(s.sim.n.lesionSpecs[0]).toMatchObject({ artery: "RCA", occluded: false });
    expect(s.sim.n.lesionSpecs[0].stenosis).toBeCloseTo(0.5, 6);
    expect(s.generation).toBe(before + 1);
  });

  it("rest/exertion toggle changes the scenario; the 75 percent preset loads with exertion on", () => {
    const s = createUnified("lad75");
    expect(s.exertion).toBe(true);
    expect(s.sim.scenario().exertion).toBe(true);
    setLesions(s, s.lesions, false);
    expect(s.exertion).toBe(false);
    expect(!!s.sim.scenario().exertion).toBe(false);
    for (const p of OLD_PRESETS) expect(p.exertion).toBe(p.id === "lad75");
  });

  it("editing lesions after treatment asks first, and cancel keeps the stent", () => {
    const s = createUnified("lad75");
    const e = s.engine;
    e.apply({ t: "access", site: "femoral-R" });
    expect(hasProcedure(s)).toBe(true);
    let asked = 0;
    expect(setLesions(s, [{ ...s.lesions[0], ds: 0.3 }], s.exertion, () => { asked++; return false; })).toBe(false);
    expect(asked).toBe(1);
    expect(s.engine).toBe(e);
    expect(s.engine.state().access).toBe("femoral-R");
    expect(s.lesions[0].ds).toBeCloseTo(0.75, 6);
    expect(setLesions(s, [{ ...s.lesions[0], ds: 0.3 }], s.exertion, () => { asked++; return true; })).toBe(true);
    expect(asked).toBe(2);
    expect(s.engine.state().access).toBeNull();
    expect(s.engine.state().log).toEqual([]);
  });

  it("does not ask before any procedure step, and turning the C-arm is not one", () => {
    const s = createUnified("lad75");
    s.engine.apply({ t: "carm", rot: 10, tilt: 5 });
    expect(hasProcedure(s)).toBe(false);
    let asked = 0;
    expect(setLesions(s, [], false, () => { asked++; return false; })).toBe(true);
    expect(asked).toBe(0);
  });

  it("moving between steps never resets the engine", () => {
    const s = createUnified("lad75");
    const e = s.engine;
    e.apply({ t: "access", site: "femoral-R" }); e.apply({ t: "sheath", french: 6 });
    for (const step of [3, 2, 1, 2, 3] as const) setStep(s, step);
    expect(s.engine).toBe(e);
    expect(s.engine.state().log).toHaveLength(2);
  });

  it("clamps slider extremes instead of producing a NaN: zero, occlusion, too long, off the end", () => {
    const lad = segmentChoices().find((c) => c.segId === "LAD")!;
    for (const raw of [
      { segId: "LAD", centerMm: -50, lengthMm: 999, ds: 1.4 },
      { segId: "LAD", centerMm: 1e6, lengthMm: 0, ds: -1 },
      { segId: "LM", centerMm: 3, lengthMm: 40, ds: 0.9 },
    ]) {
      const c = clampSlider(raw);
      for (const v of [c.centerMm, c.lengthMm, c.ds]) expect(Number.isFinite(v)).toBe(true);
      expect(c.ds).toBeGreaterThanOrEqual(0); expect(c.ds).toBeLessThanOrEqual(1);
      const L = segmentChoices().find((x) => x.segId === raw.segId)!.lengthMm;
      expect(c.centerMm - c.lengthMm / 2).toBeGreaterThanOrEqual(-1e-9);
      expect(c.centerMm + c.lengthMm / 2).toBeLessThanOrEqual(L + 1e-9);
    }
    expect(sliderRanges("LAD").position[1]).toBe(Math.round(lad.lengthMm));
    const s = createUnified("normal");
    expect(setLesions(s, [{ segId: "LAD", centerMm: 40, lengthMm: 10, ds: 0 }], false)).toBe(true);
    expect(s.sim.n.lesionSpecs).toEqual([]);
  });

  it("places a new lesion mid-segment and summarizes the patient in one line", () => {
    const l = newLesion("OM1");
    expect(l.segId).toBe("OM1");
    expect(l.ds).toBeCloseTo(0.7, 6);
    expect(lesionSummary([l, { segId: "RCA", centerMm: 20, lengthMm: 10, ds: 1 }], true)).toBe("OM1 70%, RCA occluded, on exertion");
    expect(lesionSummary([], false)).toBe("No coronary lesions");
  });

  it("brings a simulator patient (#s= link) across as sliders", () => {
    const r = slidersFromScenario({ lesions: [{ artery: "RCA", occluded: true, position: 0.25 }, { artery: "LAD", stenosis: 0.6, position: 0.5 }] });
    expect(r.lesions.map((l) => l.segId).sort()).toEqual(["LAD", "RCA"]);
    expect(r.dropped).toEqual([]);
  });

  it("every figure and table on the page has a caption", () => {
    const figures = [...html.matchAll(/<b>Figure (\d+)\.<\/b>/g)].map((m) => +m[1]);
    const tables = [...html.matchAll(/<b>Table (\d+)\.<\/b>/g)].map((m) => +m[1]);
    expect(figures).toEqual([...new Set(figures)]);
    expect(tables).toEqual([...new Set(tables)]);
    // every drawn picture (not the overlays stacked on Figure 1) and every tile grid
    const canvases = [...html.matchAll(/<canvas id="(\w+)"(?![^>]*class="overlay")/g)].map((m) => m[1]);
    expect(canvases.sort()).toEqual(["ang", "ecgFull", "pull"]);
    expect(figures.length).toBeGreaterThanOrEqual(canvases.length);
    for (const t of html.matchAll(/<table>[\s\S]*?<\/table>/g)) expect(t[0]).toMatch(/<caption><b>Table \d+\.<\/b>/);
    const grids = [...html.matchAll(/class="tiles"/g)].length;
    expect(tables.length).toBeGreaterThanOrEqual(grids + 1); // the tile grids plus the keyboard table
  });

  it("/cath/lab/ and /cath/lab/play/ redirect to /cath/", () => {
    expect(readFileSync("cath/lab/index.html", "utf8")).toMatch(/location\.replace\("\.\.\/" \+ location\.hash\)/);
    expect(readFileSync("cath/lab/play/index.html", "utf8")).toMatch(/location\.replace\("\.\.\/\.\.\/" \+ location\.hash\)/);
    const vite = readFileSync("vite.config.ts", "utf8");
    expect(vite).toMatch(/cathlab: "cath\/lab\/index\.html"/);
    expect(vite).toMatch(/cathlabplay: "cath\/lab\/play\/index\.html"/);
    expect(readFileSync("cath/index.html", "utf8")).toContain("src/cath/unified/page.ts");
  });
});
