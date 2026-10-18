import { describe, it, expect } from "vitest";
import { assess, LESIONS } from "../src/sim/structural";
import { buildProps, defectRadius, openFractions, Props, Tri } from "../src/structural/props";
import { morphFor } from "../src/structural/morph";
import { heartSdfMorph, HeartMorph, MorphPart, partsMorph } from "../src/anatomy/heartSurface";
import { V3 } from "../src/anatomy/curve";

const props = (id: Parameters<typeof assess>[0], v: Record<string, number> = {}): { p: Props; a: ReturnType<typeof assess> } => {
  const a = assess(id, v, { waveform: false }), m = morphFor(a.spec, a.report);
  return { p: buildProps(a.spec, a.report, m, a.valves), a };
};
const tris = (t: Tri) => t.indices.length / 3;
const finite = (t: Tri) => t.positions.every(Number.isFinite) && t.indices.every((i) => i >= 0 && i < t.positions.length / 3);
const pointsOf = (t: Tri): V3[] => Array.from({ length: t.positions.length / 3 }, (_, i) => [t.positions[3 * i], t.positions[3 * i + 1], t.positions[3 * i + 2]]);

describe("cutaway props", () => {
  it("every lesion's props are finite, and the septa and valve frames lie inside the heart that is drawn", () => {
    for (const l of LESIONS) {
      const a = assess(l.id, {}, { waveform: false }), m = morphFor(a.spec, a.report), p = buildProps(a.spec, a.report, m, a.valves);
      for (const t of [p.septum, p.atrialSeptum, ...p.valves.map((v) => v.tri)]) expect([l.id, finite(t)]).toEqual([l.id, true]);
      expect(tris(p.septum)).toBeGreaterThan(100); expect(tris(p.atrialSeptum)).toBeGreaterThan(8);
      for (const q of pointsOf(p.septum).filter((_, i) => i % 7 === 0)) expect(heartSdfMorph(q, m)).toBeLessThan(0.5);
      for (const j of p.jets) { expect(Number.isFinite(j.length) && j.length > 0 && Number.isFinite(j.radius)).toBe(true); expect(Math.hypot(...j.dir)).toBeCloseTo(1, 3); }
    }
  });
  it("a VSD or an ASD cuts a hole in its septum, bigger for a bigger defect, and none without one", () => {
    const none = tris(props("normal").p.septum), small = tris(props("vsd", { diameter: 3 }).p.septum), big = tris(props("vsd", { diameter: 9 }).p.septum);
    expect(small).toBeLessThan(none); expect(big).toBeLessThan(small);
    expect(tris(props("tof").p.septum)).toBeLessThan(none); // the Fallot VSD
    expect(tris(props("asd", { diameter: 14 }).p.atrialSeptum)).toBeLessThan(tris(props("normal").p.atrialSeptum));
    expect(defectRadius(0)).toBe(0); expect(defectRadius(100)).toBeLessThanOrEqual(18);
  });
  it("a valve's opening follows its area: normal is open with no leaflets, stenosis narrows it, atresia closes it", () => {
    const n = props("normal").p.valves, as = props("as").p.valves, pa = props("pa-vsd").p.valves, ta = props("tri-atresia").p.valves;
    const get = (v: Props["valves"], name: string) => v.find((x) => x.name === name)!;
    expect(get(n, "AV").open).toBe(1);
    expect(get(as, "AV").open).toBeLessThan(0.45); expect(tris(get(as, "AV").tri)).toBeGreaterThan(tris(get(n, "AV").tri));
    expect(get(pa, "PVL").open).toBe(0); expect(get(ta, "TV").open).toBe(0);
    const f = openFractions(props("ps").a.valves);
    expect(f.PVL).toBeLessThan(0.5); expect(f.AV).toBeCloseTo(1, 0);
  });
  it("jets appear where the lesion makes them, run the way the blood runs, and not in a normal heart", () => {
    expect(props("normal").p.jets).toEqual([]);
    const label = (id: Parameters<typeof assess>[0], v: Record<string, number> = {}) => props(id, v).p.jets.map((j) => j.label);
    expect(label("as")).toContain("Aortic stenosis jet"); expect(label("ar")).toContain("Aortic regurgitation jet"); expect(label("mr")).toContain("Mitral regurgitation jet");
    expect(label("vsd")).toContain("VSD jet"); expect(label("asd")).toContain("ASD jet"); expect(label("pda")).toContain("Ductal flow");
    expect(label("tof")).toContain("Right ventricle to aorta"); expect(label("pa-vsd", { duct: 0, bt: 3.5 })).toContain("BT shunt flow");
    const as = props("as").p.jets.find((j) => j.label === "Aortic stenosis jet")!, ar = props("ar").p.jets.find((j) => j.label === "Aortic regurgitation jet")!;
    expect(as.dir[1]).toBeGreaterThan(0.9); expect(ar.dir[1]).toBeLessThan(-0.9); // forward up the aorta, backward down into the ventricle
    expect(as.node).toBe("LV"); expect(ar.node).toBe("AO"); // each carries the blood it came from
    expect(props("vsd").p.jets.find((j) => j.label === "VSD jet")!.length).toBeGreaterThan(props("vsd", { diameter: 1.5 }).p.jets.find((j) => j.label === "VSD jet")?.length ?? 0);
  });
  it("a VSD jet runs from the left ventricle toward the right when the shunt is left to right, and starts on the left side of the septum", () => {
    const a = assess("vsd", {}, { waveform: false }), m = morphFor(a.spec, a.report), j = buildProps(a.spec, a.report, m, a.valves).jets.find((x) => x.label === "VSD jet")!;
    const septal = (p: V3) => 0.979 * p[0] - 0.204 * p[2] - 6.5; // the heart's own septal distance: positive on the left-ventricular side
    expect(septal(j.from)).toBeCloseTo(0, 0); // at the defect
    expect(septal([j.from[0] + j.dir[0] * j.length, j.from[1] + j.dir[1] * j.length, j.from[2] + j.dir[2] * j.length])).toBeLessThan(-3); // ends in the right ventricle
    expect(j.node).toBe("LV");
  });
  it("the atrial septum lies between the atria, not in the aorta or pulmonary artery, and a bigger ASD takes more of it", () => {
    const parts = (id: Parameters<typeof assess>[0], v: Record<string, number> = {}) => {
      const a = assess(id, v, { waveform: false }), m = morphFor(a.spec, a.report), t = buildProps(a.spec, a.report, m, a.valves).atrialSeptum;
      const count: Record<string, number> = { atria: 0, other: 0 };
      for (const q of pointsOf(t)) { const d = partsMorph(q, m); const best = Math.min(...Object.values({ RA: d[MorphPart.RA], LA: d[MorphPart.LA], Ao: d[MorphPart.Aorta], PA: d[MorphPart.PA], PV: d[MorphPart.PV] })); count[best === Math.min(d[MorphPart.RA], d[MorphPart.LA]) ? "atria" : "other"]++; }
      return { count, tris: tris(t) };
    };
    const n = parts("normal"), small = parts("asd", { diameter: 4 }), big = parts("asd", { diameter: 12 });
    expect(n.count.other).toBeLessThan(0.1 * n.count.atria); expect(n.tris).toBeGreaterThan(10);
    expect(small.tris).toBeLessThan(n.tris); expect(big.tris).toBeLessThan(small.tris);
  });
  it("the aortic valve is on the left-ventricular side of the septum, and no ring or jet leaves the heart, whatever its size", () => {
    const septal = (p: V3) => 0.979 * p[0] - 0.204 * p[2] - 6.5;
    for (const [id, cfg] of [["normal", {}], ["as", {}], ["ar", {}], ["tof", {}], ["pa-ivs", {}], ["ebstein", {}], ["vsd", { diameter: 10 }], ["tri-atresia", {}]] as [Parameters<typeof assess>[0], Record<string, number>][]) {
      const a = assess(id, cfg, { waveform: false }), m = morphFor(a.spec, a.report), p = buildProps(a.spec, a.report, m, a.valves);
      const av = p.valves.find((v) => v.name === "AV")!;
      expect(septal(av.center)).toBeGreaterThan(0);
      for (const v of p.valves) for (const q of pointsOf(v.tri)) expect([id, v.name, heartSdfMorph(q, m) < 1.5]).toEqual([id, v.name, true]);
      for (const j of p.jets) {
        const tip: V3 = [j.from[0] + j.dir[0] * j.length, j.from[1] + j.dir[1] * j.length, j.from[2] + j.dir[2] * j.length];
        expect([id, j.label, heartSdfMorph(tip, m) < 0]).toEqual([id, j.label, true]);
      }
    }
  });
  it("rings follow the heart when it is much larger or smaller than normal", () => {
    for (const ventricleScale of [0.7, 1.6]) {
      const a = assess("normal", {}, { waveform: false }), m: HeartMorph = { ...morphFor(a.spec, a.report), ventricleScale }, p = buildProps(a.spec, a.report, m, a.valves);
      for (const v of p.valves) for (const q of pointsOf(v.tri)) expect(heartSdfMorph(q, m)).toBeLessThan(1.5);
    }
  });
});
