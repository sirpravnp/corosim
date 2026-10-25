import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { BridgeSource } from "../src/sim/bridgeSource";
import { createStubSource } from "../src/sim/stubSource";
import { OXYGEN_PANEL } from "../src/config/oxygenPanel";
import { patientFromLesionHash } from "../src/sim/structural";
import type { PatientSpec } from "../src/sim/patient";
import type { Scenario } from "../src/sim/scenario";
import { oxygenRows } from "../src/panels/oxygen";
import { ductalDifference, ecmoReturnSat, extractionRatio, oxygenReadout, plethFromPressure, teachingCues } from "../src/sim/oxygenReadout";

/** A bridge over a settled patient with the synchronous solver, run long enough for a solve to land. */
function bridge(patient?: PatientSpec, sc: Scenario = {}) {
  const sim = new Simulation(); sim.reset({ seed: 3, ...sc }, { settled: true }); sim.warmup(40); sim.history = [];
  const b = new BridgeSource(sim, { patient }); sim.run(10); b.refresh();
  return b;
}
const read = (b: BridgeSource) => oxygenReadout(b.saturations(), b.numbers(), b.devices());

describe("pure derivations", () => {
  it("extraction is VO2/DO2 and NaN when undefined", () => {
    expect(extractionRatio(250, 1000)).toBeCloseTo(0.25, 9);
    expect(extractionRatio(250, 0)).toBeNaN();
    expect(extractionRatio(NaN, 1000)).toBeNaN();
  });
  it("calls a pre/post difference only above 3 points and only when post is lower", () => {
    expect(ductalDifference(0.98, 0.96).significant).toBe(false);
    expect(ductalDifference(0.98, 0.95 - 1e-9).significant).toBe(true);
    expect(ductalDifference(0.98, 0.90).points).toBeCloseTo(8, 6);
    expect(ductalDifference(0.98, 0.90).explanation).toMatch(/ductal/);
    expect(ductalDifference(0.90, 0.98).significant).toBe(false);
    expect(ductalDifference(NaN, 0.9).points).toBeNaN();
  });
  it("raises each cue at its threshold", () => {
    const ok = { spo2: 0.98, svo2: 0.7, do2: 1000, vo2: 250 };
    expect(teachingCues(ok)).toEqual([]);
    expect(teachingCues({ ...ok, svo2: 0.59 })[0]).toMatch(/low mixed venous saturation: delivery not meeting demand/i);
    expect(teachingCues({ ...ok, svo2: OXYGEN_PANEL.svo2Low })).toEqual([]);
    expect(teachingCues({ ...ok, vo2: 360 })).toHaveLength(1);
    expect(teachingCues({ ...ok, vo2: 340 })).toEqual([]);
    expect(teachingCues({ ...ok, spo2: 0.89 })[0]).toMatch(/SpO/);
    expect(teachingCues({ spo2: NaN, svo2: NaN, do2: NaN, vo2: NaN })).toEqual([]);
  });
  it("normalises the pleth to 0..1 and keeps its shape", () => {
    expect(Array.from(plethFromPressure([80, 100, 120, 100, 80]))).toEqual([0, 0.5, 1, 0.5, 0]);
    expect(Array.from(plethFromPressure([90, 90, 90]))).toEqual([0.5, 0.5, 0.5]);
    expect(plethFromPressure([1, NaN, 3])[1]).toBeNaN();
    expect(plethFromPressure([]).length).toBe(0);
  });
  it("reads the ECMO return saturation only from an ecmo console", () => {
    expect(ecmoReturnSat([])).toBeNaN();
    expect(ecmoReturnSat([{ id: "impella", label: "", readings: { returnSat: 1 }, alarms: [] }])).toBeNaN();
    const e = [{ id: "ecmo", label: "", readings: { returnSat: 0.99 }, alarms: [] }];
    expect(ecmoReturnSat(e)).toBe(0.99);
    expect(oxygenReadout(createStubSource().saturations(), { qpQs: 1 }, e).hasEcmo).toBe(true);
  });
  it("stub source: values pass through and there are no cues", () => {
    const s = createStubSource(), r = oxygenReadout(s.saturations(), s.numbers(), s.devices());
    expect(r.ready).toBe(true);
    expect(r.extraction).toBeCloseTo(0.25, 9);
    expect(r.cues).toEqual([]);
    expect(r.diff.significant).toBe(false);
    expect(r.lactate).toBeNaN();
    expect(r.hasEcmo).toBe(false);
  });
  it("rows: lactate pending note, ductal row only when significant, ECMO row only with a console", () => {
    const st = createStubSource();
    const rows = oxygenRows(oxygenReadout(st.saturations(), st.numbers(), []));
    expect(rows.find(r => r.label === "Lactate")).toMatchObject({ value: "–", note: "available with oxygen-in-time (E6)" });
    expect(rows.some(r => r.label === "Pre − post" || r.label.startsWith("ECMO"))).toBe(false);
    const e = [{ id: "ecmo", label: "", readings: { returnSat: 0.99 }, alarms: [] }];
    const sat = { ...st.saturations(), postductal: 0.9, lactate: 2.1 };
    const rows2 = oxygenRows(oxygenReadout(sat, st.numbers(), e));
    expect(rows2.find(r => r.label === "Pre − post")!.value).toBe("8.0 points");
    expect(rows2.find(r => r.label === "ECMO return SaO₂")!.value).toBe("99%");
    expect(rows2.find(r => r.label === "Lactate")!.value).toBe("2.1 mmol/L");
  });
  it("is not ready before the first solve", () => {
    const sim = new Simulation(); sim.reset({ seed: 3 }, { settled: true }); sim.run(3);
    const r = read(new BridgeSource(sim, { solver: { solve: () => new Promise(() => {}) } }));
    expect(r.ready).toBe(false);
    expect(r.cues).toEqual([]);
  });
});

describe("through the bridge's sync solver", () => {
  it("normal patient: no cues, no differential, values equal the source's", () => {
    const b = bridge(), r = read(b), s = b.saturations();
    expect(r.ready).toBe(true);
    expect(r.cues).toEqual([]);
    expect(r.diff.significant).toBe(false);
    expect(r.svo2).toBe(s.svo2); expect(r.do2).toBe(s.do2); expect(r.vo2).toBe(s.vo2);
    expect(r.extraction).toBeCloseTo(s.vo2 / s.do2, 9);
    expect(r.extraction).toBeLessThan(OXYGEN_PANEL.extractionHigh);
    expect(r.lactate).toBeNaN();
    console.log("normal", { spo2: r.spo2, post: r.post, svo2: r.svo2, do2: r.do2, vo2: r.vo2, ext: r.extraction, qpqs: r.qpQs });
  });
  it("low cardiac output (hemorrhage with an LAD occlusion) gives a low SvO2 cue", { timeout: 60_000 }, () => {
    const b = bridge(undefined, { bloodLoss: 0.5, lesions: [{ artery: "LAD", occluded: true, position: 0.1 }] });
    const r = read(b);
    console.log("lowCO", { co: b.numbers().co, svo2: r.svo2, ext: r.extraction, cues: r.cues });
    expect(b.numbers().co).toBeLessThan(4);
    expect(r.svo2).toBeLessThan(OXYGEN_PANEL.svo2Low);
    expect(r.cues.some(c => /low mixed venous saturation: delivery not meeting demand/i.test(c))).toBe(true);
  });
  it("PDA with high pulmonary resistance: post-ductal below pre-ductal, with the explanation", () => {
    const r = read(bridge(patientFromLesionHash("#lesion=pda&diameter=6&pvri=25")));
    console.log("pda", { pre: r.pre, post: r.post, diff: r.diff.points, svo2: r.svo2, spo2: r.spo2, cues: r.cues });
    expect(r.diff.significant).toBe(true);
    expect(r.post).toBeLessThan(r.pre);
    expect(r.diff.explanation).toMatch(/ductal/);
  });
});
