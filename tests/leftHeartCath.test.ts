import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { BridgeSource } from "../src/sim/bridgeSource";
import { analyze, buildModel } from "../src/physics/structural";
import type { StructuralReport, StructuralSpec } from "../src/physics/structural";
import { LESIONS } from "../src/sim/structural";
import { LHC } from "../src/config/cath";
import { leftHeartCath } from "../src/sim/leftHeartCath";
import type { BeatSummary, HemoNode, HemoNumbers } from "../src/sim/hemoSource";

/** A StructuralReport and its waveform as the snapshot a HemoSource gives: numbers() and one beat. */
function snapshot(r: StructuralReport): { n: HemoNumbers; beat: BeatSummary } {
  const w = r.waveform!, time = Float32Array.from(w.t);
  const pressure = {} as Record<HemoNode, Float32Array>;
  for (const k of Object.keys(w.p) as HemoNode[]) pressure[k] = Float32Array.from(w.p[k]);
  const v = (k: string) => { const s = r.valves[k]; return s ? { forwardMl: s.forwardMl, regurgMl: s.regurgMl, openMs: s.openMs } : { forwardMl: 0, regurgMl: 0, openMs: 0 }; };
  const p = r.pressure;
  const n: HemoNumbers = {
    hr: r.hr, map: p.AO.mean, systolic: p.AO.max, diastolic: p.AO.min, cvp: p.RA.mean, pa: { systolic: p.PA.max, diastolic: p.PA.min, mean: p.PA.mean },
    pcwp: p.LA.mean, lvedp: p.LV.end, rvedp: p.RV.end, co: r.lvOutput, ci: NaN, svr: r.svr, pvr: r.pvr, lvEf: r.lvEf, rvEf: r.rvEf, qpQs: r.qpQs,
  };
  const beat = { t: 0, rr: 60 / r.hr, pvc: false, time, pressure, loops: {}, atrial: new Float32Array(0), edv: {}, esv: {}, strokeVolume: r.lvStrokeMl,
    valves: { AV: v("AV"), MV: v("MV"), TV: v("TV"), PV: v("PVL") } } as unknown as BeatSummary;
  return { n, beat };
}
const lesion = (id: string): StructuralSpec => { const d = LESIONS.find((l) => l.id === id)!; return d.build(Object.fromEntries(d.params.map((p) => [p.key, p.default]))); };
const cathOf = (spec: StructuralSpec) => { const r = analyze(spec), s = snapshot(r); return { r, c: leftHeartCath(s.n, s.beat)! }; };

const AREA_FROM_MODEL = (spec: StructuralSpec, edge: string) => buildModel(spec).edges.find((e) => e.name === edge)!.area!;
const GORLIN_RATIO = 44.3 / 37.7;

describe("normal heart", () => {
  const { r, c } = cathOf({});
  it("has small aortic gradients and no stenosis label", () => {
    expect(c.gradient.mean).toBeLessThan(10);
    expect(Math.abs(c.gradient.peakToPeak)).toBeLessThan(10);
    expect(c.severity.aortic).toBe("none"); expect(c.severity.mitral).toBe("none");
  });
  it("reads LVEDP at the onset of systole and the aortic pressures from the trace", () => {
    expect(Math.abs(c.lv.lvedp - r.pressure.LV.end)).toBeLessThan(1.5);
    expect(c.lv.systolic).toBeCloseTo(r.pressure.LV.max, 0);
    expect(c.ao.systolic).toBeCloseTo(r.pressure.AO.max, 0); expect(c.ao.diastolic).toBeCloseTo(r.pressure.AO.min, 0);
    expect(c.ao.mean).toBeCloseTo(r.pressure.AO.mean, 0);
  });
  it("sees a wedge-LV gradient of a few mmHg at most", () => { expect(c.mitral.meanGradient).toBeLessThan(4); });
});

describe("severe aortic stenosis", () => {
  const spec = lesion("as"), { r, c } = cathOf(spec), model = AREA_FROM_MODEL(spec, "AV");
  it("Gorlin area is within 10% of the model's valve area", () => { expect(Math.abs(c.area.aorticGorlin - model) / model).toBeLessThan(0.1); });
  it("mean gradient equals the report's ValveStat within 5%", () => { expect(Math.abs(c.gradient.mean - r.valves.AV.meanGradient) / r.valves.AV.meanGradient).toBeLessThan(0.05); });
  it("peak instantaneous gradient equals the report's peak; peak-to-peak is lower; labelled severe", () => {
    expect(Math.abs(c.gradient.peakInstant - r.valves.AV.peakGradient) / r.valves.AV.peakGradient).toBeLessThan(0.05);
    expect(c.gradient.peakToPeak).toBeLessThan(c.gradient.peakInstant);
    expect(c.gradient.peakToPeak).toBeGreaterThan(40);
    expect(c.severity.aortic).toBe("severe");
  });
  it("Hakki is within 20% of Gorlin", () => { expect(Math.abs(c.area.aorticHakki - c.area.aorticGorlin) / c.area.aorticGorlin).toBeLessThan(0.2); });
});

describe("severe mitral stenosis", () => {
  const spec = lesion("ms"), { r, c } = cathOf(spec), model = AREA_FROM_MODEL(spec, "MV");
  it("clinical (37.7) Gorlin area is the model area x 44.3/37.7 within 10%; the 44.3 reading is the model area", () => {
    expect(Math.abs(c.area.mitralGorlin - model * GORLIN_RATIO) / (model * GORLIN_RATIO)).toBeLessThan(0.1);
    expect(Math.abs(c.area.mitralEngine - model) / model).toBeLessThan(0.1);
  });
  it("mean diastolic gradient equals the report's mitral mean gradient", () => { expect(Math.abs(c.mitral.meanGradient - r.valves.MV.meanGradient) / r.valves.MV.meanGradient).toBeLessThan(0.05); });
  it("is labelled severe at the mitral valve, and the aortic valve is normal", () => { expect(c.severity.mitral).toBe("severe"); expect(c.severity.aortic).toBe("none"); });
});

describe("regurgitation", () => {
  it("aortic regurgitation does not read as stenosis (its gradient is too small for an area, so none is shown)", () => {
    const { c } = cathOf(lesion("ar"));
    expect(c.gradient.mean).toBeLessThan(LHC.minAorticGradientMmHg);
    expect(Number.isNaN(c.area.aorticGorlin)).toBe(true);
    expect(c.severity.aortic).toBe("none");
  });
});

describe("areas at tiny gradients are not shown", () => {
  const { c: normal } = cathOf({}), as = cathOf(lesion("as")).c, ms = cathOf(lesion("ms")).c;
  it("normal heart: gradients under the thresholds give NaN areas and no stenosis, for both valves", () => {
    expect(normal.gradient.peakToPeak).toBeLessThan(LHC.minAorticGradientMmHg);
    expect(Number.isNaN(normal.area.aorticHakki)).toBe(true); expect(Number.isNaN(normal.area.aorticGorlin)).toBe(true);
    expect(normal.mitral.meanGradient).toBeLessThan(LHC.minMitralGradientMmHg);
    for (const k of ["mitralGorlin", "mitralEngine", "mitralHakki"] as const) expect(Number.isNaN(normal.area[k]), k).toBe(true);
    expect(normal.severity).toEqual({ aortic: "none", mitral: "none" });
  });
  it("a 1 mmHg peak-to-peak gradient gives no Hakki area, 10 mmHg or more does; mitral 1 vs 3 mmHg", () => {
    const { n, beat } = snapshot(analyze({}));
    const shift = (dp: number) => { const b = { ...beat, pressure: { ...beat.pressure, LV: beat.pressure.LV.map((x) => x + dp) } } as BeatSummary; return leftHeartCath(n, b)!; };
    const base = shift(0), p2p = base.gradient.peakToPeak;
    expect(Number.isNaN(shift(1 - p2p).area.aorticHakki)).toBe(true);
    expect(shift(LHC.minAorticGradientMmHg + 1 - p2p).area.aorticHakki).toBeGreaterThan(0);
    expect(Number.isNaN(base.area.mitralHakki)).toBe(true);
  });
  it("severe AS and MS keep their areas and labels", () => {
    expect(as.area.aorticHakki).toBeGreaterThan(0); expect(as.area.aorticGorlin).toBeGreaterThan(0); expect(as.severity.aortic).toBe("severe");
    for (const k of ["mitralGorlin", "mitralEngine", "mitralHakki"] as const) expect(ms.area[k], k).toBeGreaterThan(0);
    expect(ms.severity.mitral).toBe("severe");
  });
});

describe("Gorlin uses gross forward flow", () => {
  it("regurgitation on top of a real aortic gradient does not shrink the area; net flow would have", () => {
    const { n, beat } = snapshot(analyze(lesion("as")));
    const av = beat.valves.AV, regurg = 0.5 * av.forwardMl; // mixed AS + AR: a third of the gross flow comes back
    const mixed = { ...beat, valves: { ...beat.valves, AV: { ...av, regurgMl: regurg } } } as BeatSummary;
    const base = leftHeartCath(n, beat)!, c = leftHeartCath(n, mixed)!;
    expect(c.gradient.mean).toBeGreaterThan(LHC.minAorticGradientMmHg);
    expect(c.avForwardMl).toBe(av.forwardMl);
    expect(c.area.aorticGorlin).toBeCloseTo(base.area.aorticGorlin, 9); // regurgitant volume is ignored
    const net = ((av.forwardMl - regurg) / c.sep) / (44.3 * Math.sqrt(c.gradient.mean));
    expect(net).toBeLessThan(0.6 * c.area.aorticGorlin); // the net-flow area would read much more stenotic
  });
});

describe("waiting state", () => {
  it("returns null without a beat", () => { expect(leftHeartCath({} as HemoNumbers, undefined)).toBeNull(); });
});

describe("through the bridge", () => {
  const settled = (sc = {}) => { const s = new Simulation(); s.reset({ seed: 3, ...sc }, { settled: true }); s.warmup(40); s.history = []; return s; };
  const through = (sc = {}) => {
    const sim = settled(sc), bridge = new BridgeSource(sim);
    sim.run(20); bridge.refresh();
    return leftHeartCath(bridge.numbers(), bridge.beats(1)[0])!;
  };
  it("LVEDP rises after an LAD occlusion", () => {
    const normal = through(), lad = through({ lesions: [{ artery: "LAD", occluded: true, position: 0.2 }] });
    expect(normal).not.toBeNull();
    expect(lad.lv.lvedp).toBeGreaterThan(normal.lv.lvedp + 5);
  });
});
