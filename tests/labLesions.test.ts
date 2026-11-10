import { describe, it, expect } from "vitest";
import { CASES } from "../src/cath/cases";
import { defaultUnifiedGraph } from "../src/lab/access";
import {
  OLD_PRESETS, plaquesToScenario, segmentChoices, sliderToPlaque,
} from "../src/lab/lesions";
import type { LesionSlider } from "../src/lab/types";

describe("lesion slider model", () => {
  it("clamps a lesion longer than the segment", () => {
    const p = sliderToPlaque({ segId: "LAD", centerMm: 5, lengthMm: 999, ds: 0.7 });
    const len = defaultUnifiedGraph().byId.LAD.length;
    expect(p.lengthMm).toBeLessThanOrEqual(len);
    expect(p.centerMm - p.lengthMm / 2).toBeGreaterThanOrEqual(0);
  });

  it("ds 0 yields no scenario lesion", () => {
    const plaque = sliderToPlaque({ segId: "LAD", centerMm: 50, lengthMm: 16, ds: 0 });
    expect(plaquesToScenario([plaque], false).lesions).toEqual([]);
  });

  it("occlusion at 100 percent sets occluded", () => {
    const plaque = sliderToPlaque({ segId: "LAD", centerMm: 24, lengthMm: 16, ds: 1 });
    const sc = plaquesToScenario([plaque], false);
    expect(sc.lesions).toHaveLength(1);
    expect(sc.lesions![0].occluded).toBe(true);
    expect(sc.lesions![0].artery).toBe("LAD");
  });

  it("presets reproduce the old cases", () => {
    expect(OLD_PRESETS).toHaveLength(7);
    const g = defaultUnifiedGraph();
    for (const preset of OLD_PRESETS) {
      const old = CASES.find((c) => c.id === preset.id);
      expect(old, preset.id).toBeTruthy();
      const sc = plaquesToScenario(preset.lesions.map(sliderToPlaque), preset.exertion);
      expect(!!sc.exertion).toBe(!!old!.scenario.exertion);
      const got = sc.lesions ?? [];
      const want = old!.scenario.lesions ?? [];
      expect(got.length).toBe(want.length);
      for (let i = 0; i < want.length; i++) {
        expect(got[i].artery).toBe(want[i].artery);
        expect(!!got[i].occluded).toBe(!!want[i].occluded);
        if (!want[i].occluded) expect(got[i].stenosis).toBeCloseTo(want[i].stenosis ?? 0, 5);
        const segLen = g.byId[want[i].artery!]?.length ?? 1;
        const gotMm = (got[i].position ?? 0) * segLen;
        const wantMm = (want[i].position ?? 0) * segLen;
        expect(Math.abs(gotMm - wantMm)).toBeLessThanOrEqual(1);
      }
      expect(preset.title).toBe(old!.title);
      expect(preset.blurb).toBe(old!.blurb);
    }
  });

  it("two lesions on one segment both reach the solver", () => {
    const a: LesionSlider = { segId: "LAD", centerMm: 30, lengthMm: 12, ds: 0.5 };
    const b: LesionSlider = { segId: "LAD", centerMm: 70, lengthMm: 14, ds: 0.7 };
    const sc = plaquesToScenario([sliderToPlaque(a), sliderToPlaque(b)], false);
    expect(sc.lesions).toHaveLength(2);
    expect(sc.lesions!.map((l) => l.stenosis).sort()).toEqual([0.5, 0.7]);
  });

  it("segmentChoices lists the main coronaries and named branches", () => {
    const ids = segmentChoices().map((s) => s.segId);
    for (const id of ["LM", "LAD", "LCX", "RCA", "D1", "OM1", "OM2", "PDA_R", "PLV_R"]) {
      expect(ids).toContain(id);
    }
  });
});
