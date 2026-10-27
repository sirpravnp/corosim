import { describe, it, expect } from "vitest";
import { assess, gradeValves, lesionHash, LESIONS, LESION_BY_ID, LesionId, parseLesionHash } from "../src/sim/structural";
import { analyze, buildModel } from "../src/physics/structural";
import { PATIENTS } from "../src/config/structural";

const valve = (a: ReturnType<typeof assess>, id: string) => a.valves.find((v) => v.valve === id)!;

describe("every lesion", () => {
  for (const l of LESIONS) it(`${l.label}: settles, has no warnings at its defaults and a murmur description`, () => {
    const a = assess(l.id);
    expect(a.report.converged).toBe(true);
    expect(a.report.warnings).toEqual([]);
    expect(a.murmur.length).toBeGreaterThan(5);
    expect(Number.isFinite(a.report.pressure.AO.mean)).toBe(true);
  });
  it("each lesion's default is graded where a cardiologist would put it, and valves it does not touch are graded none", () => {
    const expected: Record<LesionId, Record<string, [string, string]>> = {
      normal: {}, pda: {}, asd: {}, vsd: {}, "vsd-eisenmenger": {}, "pda-adult": {},
      "tof-repaired": { PVL: ["none", "severe"] },
      as: { AV: ["severe", "none"] }, ar: { AV: ["none", "severe"] }, ms: { MV: ["severe", "none"] }, mr: { MV: ["none", "moderate"] },
      ts: { TV: ["moderate", "none"] }, tr: { TV: ["none", "severe"] }, ps: { PVL: ["moderate", "none"] }, pr: { PVL: ["none", "severe"] },
      tof: { PVL: ["severe", "none"] }, "pa-vsd": { PVL: ["atretic", "none"] }, "pa-ivs": { PVL: ["atretic", "none"], TV: ["none", "severe"] },
      "tri-atresia": { TV: ["atretic", "none"] }, ebstein: { TV: ["none", "severe"] },
    };
    for (const l of LESIONS) {
      const a = assess(l.id, {}, { waveform: false });
      for (const v of a.valves) {
        const [st, rg] = expected[l.id][v.valve] ?? ["none", "none"];
        expect([l.id, v.valve, v.stenosis, v.regurgitation]).toEqual([l.id, v.valve, st, rg]);
      }
    }
  });
  it("the overriding aorta does not make a Fallot's aortic valve look stenotic", () => {
    expect(assess("tof").valves.find((v) => v.valve === "AV")!.stenosis).toBe("none");
  });
});

describe("aortic stenosis", () => {
  it("grows its gradient as the area falls, and Gorlin recovers the area the lesion was built with", () => {
    const g = (s: number) => assess("as", { severity: s });
    expect(valve(g(0.9), "AV").meanGradient).toBeGreaterThan(valve(g(0.6), "AV").meanGradient);
    const rank = ["none", "mild", "moderate", "severe"];
    const grades = [0.1, 0.3, 0.5, 0.7, 0.95].map((s) => rank.indexOf(valve(g(s), "AV").stenosis));
    expect(grades).toEqual([...grades].sort((a, b) => a - b)); // never gets milder as the valve tightens
    expect(new Set(grades).size).toBeGreaterThanOrEqual(3);
    expect(valve(g(0.6), "AV").meanGradient).toBeGreaterThan(valve(g(0.2), "AV").meanGradient);
    for (const s of [0.5, 0.7, 0.9]) {
      const built = PATIENTS.adult.valveAreas.av * (1 - 0.85 * s), got = valve(g(s), "AV").gorlinArea!;
      expect(Math.abs(got - built) / built).toBeLessThan(0.2);
    }
  });
  it("is graded none, then moderate, then severe, and severe means a mean gradient near 40 and a left ventricle well above the aorta", () => {
    expect(valve(assess("as", { severity: 0.2 }), "AV").grade).toBe("none");
    expect(valve(assess("as", { severity: 0.55 }), "AV").grade).toBe("mild");
    expect(valve(assess("as", { severity: 0.75 }), "AV").grade).toBe("moderate");
    const sev = assess("as", { severity: 0.95 });
    expect(valve(sev, "AV").grade).toBe("severe");
    expect(valve(sev, "AV").meanGradient).toBeGreaterThan(30);
    expect(sev.report.pressure.LV.max - sev.report.pressure.AO.max).toBeGreaterThan(30);
  });
});

describe("regurgitation", () => {
  it("aortic: wide pulse pressure and low diastolic pressure, a regurgitant fraction that grows with severity", () => {
    const n = assess("normal").report, a = assess("ar", { severity: 0.6 }), b = assess("ar", { severity: 0.3 });
    expect(a.report.pressure.AO.min).toBeLessThan(n.pressure.AO.min - 15);
    expect(a.report.pressure.AO.max - a.report.pressure.AO.min).toBeGreaterThan(n.pressure.AO.max - n.pressure.AO.min);
    expect(valve(a, "AV").regurgFraction!).toBeGreaterThan(valve(b, "AV").regurgFraction!);
    expect(valve(a, "AV").regurgitation).not.toBe("none");
    expect(a.report.lvStrokeMl).toBeGreaterThan(a.report.lvForwardMl * 1.4); // the ventricle moves more than reaches the body: it carries the leak too
  });
  it("mitral: part of every stroke goes backward, the forward output falls and the left atrium gets a big v wave", () => {
    const n = assess("normal").report, a = assess("mr", { severity: 0.7 });
    expect(valve(a, "MV").regurgFraction!).toBeGreaterThan(0.3);
    expect(a.report.lvOutput).toBeLessThan(n.lvOutput);
    expect(a.report.pressure.LA.max - a.report.pressure.LA.min).toBeGreaterThan(n.pressure.LA.max - n.pressure.LA.min + 3);
    expect(a.report.pressure.LA.mean).toBeGreaterThan(n.pressure.LA.mean + 2);
  });
  it("tricuspid and pulmonary: the right-sided pressures follow", () => {
    const n = assess("normal").report, t = assess("tr", { severity: 0.8 }), p = assess("pr", { severity: 0.8 });
    expect(valve(t, "TV").regurgFraction!).toBeGreaterThan(0.25);
    expect(t.report.pressure.RA.max - t.report.pressure.RA.min).toBeGreaterThan(n.pressure.RA.max - n.pressure.RA.min);
    expect(valve(p, "PVL").regurgFraction!).toBeGreaterThan(0.2);
  });
});

describe("stenoses of the inflow and the outflow", () => {
  it("mitral stenosis raises the left atrial and pulmonary artery pressures and is graded by area", () => {
    const n = assess("normal").report, a = assess("ms", { severity: 0.9 });
    expect(valve(a, "MV").grade).toBe("severe");
    expect(a.report.pressure.LA.mean).toBeGreaterThan(n.pressure.LA.mean + 4);
    expect(a.report.pressure.PA.mean).toBeGreaterThan(n.pressure.PA.mean + 3);
  });
  it("pulmonary stenosis loads the right ventricle but not the pulmonary artery", () => {
    const n = assess("normal").report, a = assess("ps", { severity: 0.9 });
    expect(a.report.pressure.RV.max).toBeGreaterThan(n.pressure.RV.max + 10);
    expect(a.report.pressure.PA.max).toBeLessThan(n.pressure.PA.max + 2);
    expect(valve(a, "PVL").grade).not.toBe("none");
  });
  it("tricuspid stenosis raises the right atrial pressure", () => {
    expect(assess("ts", { severity: 0.9 }).report.pressure.RA.mean).toBeGreaterThan(assess("normal").report.pressure.RA.mean + 1);
  });
});

describe("shunts", () => {
  it("a larger VSD shunts more, and at low pulmonary resistance floods the lungs", () => {
    const a = assess("vsd", { diameter: 3 }).report, b = assess("vsd", { diameter: 7 }).report;
    expect(b.qpQs).toBeGreaterThan(a.qpQs); expect(b.qpQs).toBeGreaterThan(2);
    expect(b.pressure.RV.max).toBeGreaterThan(a.pressure.RV.max);
  });
  it("a PDA at the default setting is a left-to-right shunt with an early-diastolic run-off", () => {
    const r = assess("pda").report;
    expect(r.shunt.pda).toBeGreaterThan(0); expect(r.pressure.AO.min).toBeLessThan(30);
  });
});

describe("duct-dependent lesions", () => {
  it("pulmonary atresia with a VSD: closing the duct leaves the lungs without a route and says so; a smaller duct is bluer", () => {
    const closed = assess("pa-vsd", { duct: 0 }), small = assess("pa-vsd", { duct: 1.5 }), open = assess("pa-vsd", { duct: 3 });
    expect(closed.report.warnings.join(" ")).toMatch(/reaches the lungs/);
    expect(open.report.warnings).toEqual([]);
    expect(small.report.saturation.AO).toBeLessThan(open.report.saturation.AO - 0.03);
  });
  it("pulmonary atresia with an intact septum: the right ventricle pressure exceeds the aorta's, and the atrial defect carries the right atrium's blood across", () => {
    const a = assess("pa-ivs").report;
    expect(a.pressure.RV.max).toBeGreaterThan(a.pressure.AO.max);
    expect(a.shunt.asd).toBeLessThan(0);
    expect(assess("pa-ivs", { duct: 0 }).report.warnings.join(" ")).toMatch(/reaches the lungs/);
  });
  it("a smaller atrial defect traps blood in the right atrium of pulmonary atresia with intact septum", () => {
    expect(assess("pa-ivs", { asd: 1.5 }).report.pressure.RA.mean).toBeGreaterThan(assess("pa-ivs", { asd: 6 }).report.pressure.RA.mean + 2);
  });
  it("tricuspid atresia: more VSD, more lung flow and more saturation; too little VSD and the lungs starve", () => {
    const t = (vsd: number) => assess("tri-atresia", { vsd }).report;
    expect(t(5).qp).toBeGreaterThan(t(2).qp); expect(t(5).saturation.AO).toBeGreaterThan(t(2).saturation.AO);
    expect(assess("tri-atresia", { vsd: 0 }).report.warnings.join(" ")).toMatch(/reaches the lungs/);
    expect(t(3).shunt.asd).toBeLessThan(0); // all the venous return crosses the atria
  });
});

describe("Ebstein anomaly", () => {
  it("a big right atrium with severe tricuspid regurgitation, a small functional right ventricle and a right-to-left atrial shunt", () => {
    const a = assess("ebstein", { severity: 0.8 }), n = assess("normal").report;
    expect(valve(a, "TV").regurgFraction!).toBeGreaterThan(0.3);
    const frac = a.report.rvEdv / analyze({ patient: "neonate" }).rvEdv;
    expect(frac).toBeGreaterThan(0.4); expect(frac).toBeLessThan(0.8); // the functional right ventricle is a fraction of normal
    expect(a.report.pressure.RA.mean).toBeGreaterThan(n.pressure.RA.mean);
    expect(a.report.shunt.asd).toBeLessThan(0);
    expect(a.report.saturation.AO).toBeLessThan(0.85);
  });
  it("is worse the more severe the displacement, and improves as the newborn's pulmonary resistance falls", () => {
    expect(assess("ebstein", { severity: 0.9 }).report.saturation.AO).toBeLessThan(assess("ebstein", { severity: 0.4 }).report.saturation.AO);
    expect(assess("ebstein", { severity: 0.8, pvri: 2 }).report.saturation.AO).toBeGreaterThan(assess("ebstein", { severity: 0.8, pvri: 10 }).report.saturation.AO + 0.03);
  });
  it("functional pulmonary atresia: at high pulmonary resistance the valve passes nothing and the duct feeds the lungs; as resistance falls the valve opens and the saturation rises", () => {
    const hi = assess("ebstein", { pvri: 15 }, { waveform: false }).report, lo = assess("ebstein", { pvri: 3 }, { waveform: false }).report;
    expect(hi.valves.PVL.forwardMl).toBeLessThan(0.1);
    expect(lo.valves.PVL.forwardMl).toBeGreaterThan(0.5);
    expect(lo.saturation.AO).toBeGreaterThan(hi.saturation.AO + 0.15);
  });
  it("closing the atrial defect trades the cyanosis for a higher right atrial pressure", () => {
    const open = assess("ebstein", { severity: 0.8, pfo: 4 }).report, shut = assess("ebstein", { severity: 0.8, pfo: 0 }).report;
    expect(shut.saturation.AO).toBeGreaterThan(open.saturation.AO + 0.05);
    expect(shut.pressure.RA.mean).toBeGreaterThan(open.pressure.RA.mean);
  });
});

describe("tetralogy of Fallot at its preset", () => {
  it("is a cyanotic tet, deepens with a spell, and a lower systemic resistance widens the right-to-left shunt", () => {
    const base = assess("tof").report, spell = assess("tof", { spasm: 0.8 }).report, low = assess("tof", { svr: 0.5 }).report;
    expect(base.saturation.AO).toBeGreaterThan(0.8); expect(base.saturation.AO).toBeLessThan(0.92);
    expect(base.qpQs).toBeLessThan(1.1);
    expect(spell.saturation.AO).toBeLessThan(base.saturation.AO - 0.1);
    expect(low.rightToLeft).toBeGreaterThan(base.rightToLeft * 1.3);
  });
});

describe("BT shunt", () => {
  it("feeds the lungs of pulmonary atresia when the duct is closed", () => {
    const r = assess("pa-vsd", { duct: 0, bt: 3.5 }).report;
    expect(r.warnings).toEqual([]);
    expect(r.shunt.bt).toBeGreaterThan(0);
    expect(r.qp).toBeGreaterThan(0.2);
  });
});

describe("chamber sizes", () => {
  it("conserve the patient's blood volume and stay finite however they are set", () => {
    const base = analyze({ patient: "neonate" }).bloodVolume;
    for (const s of [{ rvSize: 0.5 }, { raSize: 3 }, { lvSize: 0.6 }, { laSize: 2 }, { rvSize: 0.5, raSize: 3, lvSize: 0.6, laSize: 2 }])
      expect(analyze({ patient: "neonate", ...s }).bloodVolume).toBeCloseTo(base, 3);
    const wild = analyze({ patient: "neonate", rvSize: 0, raSize: -3, hr: 0, svrScale: 100, pvri: 0 });
    expect(Number.isFinite(wild.pressure.RV.max)).toBe(true); expect(Number.isFinite(wild.pressure.AO.mean)).toBe(true);
  });
});

describe("waveform", () => {
  const r = assess("tof").report, w = r.waveform!;
  it("covers one whole beat, closes the loop and agrees with the beat's statistics", () => {
    const T = 60 / r.hr;
    expect(w.t[0]).toBeLessThan(0.001); expect(Math.abs(w.t[w.t.length - 1] - T)).toBeLessThan(0.0006); expect(w.t[1] - w.t[0]).toBeCloseTo(0.002, 3);
    expect(Math.max(...w.p.LV)).toBeCloseTo(r.pressure.LV.max, 1);
    expect(Math.min(...w.p.AO)).toBeCloseTo(r.pressure.AO.min, 1);
    expect(Math.max(...w.vLV) - Math.min(...w.vLV)).toBeCloseTo(r.lvStrokeMl, 1);
  });
  it("carries flows that integrate to the valve volumes, and can be left out", () => {
    const dt = w.t[1] - w.t[0], fwd = w.q.AV.reduce((a, q) => a + Math.max(q, 0) * dt, 0);
    expect(Math.abs(fwd - r.valves.AV.forwardMl)).toBeLessThan(0.15);
    expect(assess("tof", {}, { waveform: false }).report.waveform).toBeUndefined();
  });
});

describe("grading logic", () => {
  it("takes the worse of stenosis and regurgitation", () => {
    const spec = { valves: { av: { open: 0.2, reg: 0.4 } } }, v = gradeValves(spec, analyze(spec, { waveform: false })).find((x) => x.valve === "AV")!;
    expect(v.stenosis).toBe("severe"); expect(v.regurgitation).toBe("severe"); expect(v.grade).toBe("severe");
    const mild = { valves: { av: { open: 0.2, reg: 0.02 } } }, m = gradeValves(mild, analyze(mild, { waveform: false })).find((x) => x.valve === "AV")!;
    expect(m.stenosis).toBe("severe"); expect(m.regurgitation).not.toBe("severe"); expect(m.grade).toBe("severe"); // the lesser one cannot hide the greater
  });
  it("an atretic valve has no regurgitant fraction (nothing passes forward to compare with) and an empty valve entry for the overriding aorta is left out", () => {
    const a = assess("pa-vsd", {}, { waveform: false });
    expect(a.valves.find((v) => v.valve === "PVL")!.regurgFraction).toBeNull();
    expect(Object.keys(assess("normal", {}, { waveform: false }).report.valves)).not.toContain("RVAO");
    expect(Object.keys(assess("tof", {}, { waveform: false }).report.valves)).toContain("RVAO");
  });
  it("reports the peak regurgitant gradient (the jet's driving pressure)", () => {
    expect(assess("tr", { severity: 0.8 }).valves.find((v) => v.valve === "TV")!.regurgPeakGradient).toBeGreaterThan(5);
  });
});

describe("what the page shows", () => {
  it("ventricular pressure is reported as peak and end-diastolic, and a leaky aortic valve raises the end-diastolic pressure", () => {
    const n = assess("normal", {}, { waveform: false }).report, ar = assess("ar", { severity: 1 }, { waveform: false }).report;
    expect(n.pressure.LV.end).toBeGreaterThan(3); expect(n.pressure.LV.end).toBeLessThan(12);
    expect(ar.pressure.LV.end).toBeGreaterThan(n.pressure.LV.end + 8);
    expect(ar.pressure.LV.end).toBeGreaterThan(ar.pressure.LV.min + 5); // the minimum is not the end-diastolic pressure
  });
  it("a Fallot's right-to-left route is the overriding aorta, reported as such", () => {
    const t = assess("tof", {}, { waveform: false }).report;
    expect(t.shunt.rvao).toBeGreaterThan(1);
    expect(assess("normal", {}, { waveform: false }).report.shunt.rvao).toBe(0);
  });
  it("warnings about an empty circuit do not pile up a spurious Fick mismatch", () => {
    const w = assess("pa-vsd", { duct: 0 }, { waveform: false }).report.warnings.join(" ");
    expect(w).toMatch(/reaches the lungs/); expect(w).not.toMatch(/Qp:Qs by oxygen/);
  });
});

describe("hash and input handling", () => {
  it("round-trips a lesion and its sliders, and leaves out defaults", () => {
    const h = lesionHash("tof", { obstruction: 0.8, spasm: 0.5, vsd: 8, svr: 1, pvri: 5 });
    expect(h).toBe("#lesion=tof&obstruction=0.8&spasm=0.5");
    expect(parseLesionHash(h)).toEqual({ id: "tof", values: { obstruction: 0.8, spasm: 0.5 } });
  });
  it("falls back for anything unknown, including names every object inherits, and ignores bad values", () => {
    for (const bad of ["#lesion=constructor", "#lesion=toString", "#lesion=__proto__", "#lesion=", "#", "", "#lesion=nope"]) expect(parseLesionHash(bad).id).toBe("normal");
    expect(parseLesionHash("#lesion=as&severity=").values).toEqual({}); // empty is not zero
    expect(parseLesionHash("#lesion=as&severity=abc").values).toEqual({});
    expect(parseLesionHash("#lesion=as&severity=7").values.severity).toBe(1);
    expect(parseLesionHash("#lesion=tof&spasm=0.333").values.spasm).toBeCloseTo(0.35, 6); // snapped to the slider's step
    expect(() => assess("toString" as never)).toThrow(/Unknown lesion/);
  });
  it("clamps out-of-range values instead of solving nonsense", () => {
    const a = assess("as", { severity: 2 }, { waveform: false }).report, b = assess("as", { severity: 1 }, { waveform: false }).report;
    expect(a.pressure.AO.mean).toBeCloseTo(b.pressure.AO.mean, 6);
    expect(Number.isFinite(assess("tof", { obstruction: 9, spasm: -3 }, { waveform: false }).report.pressure.RV.max)).toBe(true);
    const nan = analyze({ hr: NaN, pvri: Infinity, valves: { av: { open: -5, reg: NaN } }, pda: { diameterMm: -5 } });
    expect(Number.isFinite(nan.pressure.AO.mean)).toBe(true);
    expect(nan.shunt.pda).toBe(0); // a negative diameter is no duct, not a 5 mm one
  });
  it("every slider of every lesion settles at its minimum, middle and maximum", () => {
    for (const l of LESIONS) for (const p of l.params) for (const x of [p.min, (p.min + p.max) / 2, p.max]) {
      const r = assess(l.id, { [p.key]: x }, { waveform: false }).report;
      expect([l.id, p.key, x, r.converged]).toEqual([l.id, p.key, x, true]);
      expect(Number.isFinite(r.pressure.AO.mean)).toBe(true);
    }
  });
});

describe("lesion definitions", () => {
  it("every slider has a default inside its own range, and unknown lesions throw", () => {
    for (const l of LESIONS) for (const p of l.params) { expect(p.default).toBeGreaterThanOrEqual(p.min); expect(p.default).toBeLessThanOrEqual(p.max); }
    expect(() => assess("nope" as never)).toThrow();
    expect(Object.keys(LESION_BY_ID).length).toBe(LESIONS.length);
  });
});
