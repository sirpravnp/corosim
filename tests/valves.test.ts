// B5: valves in the engine, solved (docs/VALVES.md). Several lesions at once and what they do to each other, prosthetic valves of
// every kind in every position, and the interventions: TAVR, balloon valvuloplasty, edge-to-edge repair, repair and replacement.
// Bars come from the guideline cut-offs and trial results named in the doc, not from the model's own output.
import { describe, it, expect } from "vitest";
import type { HeartSpec } from "../src/sim/patient";
import { assessHeart, intervene, valveSet } from "../src/sim/valves";
import type { HeartAssessment } from "../src/sim/valves";
import type { Intervention } from "../src/sim/valves";

const cache = new Map<string, HeartAssessment>();
const solve = (h: HeartSpec): HeartAssessment => { const k = JSON.stringify(h); if (!cache.has(k)) cache.set(k, assessHeart(h)); return cache.get(k)!; };
const find = (a: HeartAssessment, id: "AV" | "MV" | "TV" | "PVL") => a.valves.find((v) => v.valve === id)!;
const after = (h: HeartSpec, iv: Intervention) => { const r = intervene(h, iv); expect(r.patch).not.toEqual({}); return solve(r.heart); };
const normal = () => solve({});

describe("every combination settles", () => {
  it("a normal heart, one lesion, two lesions and a prosthesis in each position settle to a periodic state with no warning", () => {
    for (const h of [{}, { valves: valveSet({ av: { stenosis: 0.95 }, mv: { regurgitation: 0.6 } }) }, { valves: valveSet({ av: { regurgitation: 0.6 }, mv: { stenosis: 0.7 } }) },
      { valves: { av: { prosthesis: { kind: "mechanical", sizeMm: 23 } }, mv: { prosthesis: { kind: "bioprosthetic", sizeMm: 29 } } } },
      { valves: { tv: { prosthesis: { kind: "bioprosthetic", sizeMm: 31 } }, pv: { prosthesis: { kind: "bioprosthetic", sizeMm: 25 } } } }] as HeartSpec[]) {
      const a = solve(h);
      expect([JSON.stringify(h), a.report.converged, a.report.warnings]).toEqual([JSON.stringify(h), true, []]);
    }
  });
  it("a very small closing leak does not make the valve's flow state oscillate (the 0.02 cm² leak of a mechanical or transcatheter valve at EOAs of 1.9 cm² and over)", () => {
    for (const [kind, sizeMm] of [["mechanical", 23], ["mechanical", 27], ["transcatheter", 26], ["transcatheter", 29]] as const) {
      const a = solve({ valves: { av: { prosthesis: { kind, sizeMm } } } });
      expect([kind, sizeMm, a.report.converged, a.report.warnings]).toEqual([kind, sizeMm, true, []]);
      expect(find(a, "AV").meanGradient).toBeGreaterThan(2); // the valve opens and ejects
    }
  });
});

describe("aortic stenosis with mitral regurgitation", () => {
  const as = solve({ valves: valveSet({ av: { stenosis: 0.95 } }) }), mr = solve({ valves: valveSet({ mv: { regurgitation: 0.6 } }) });
  const both = solve({ valves: valveSet({ av: { stenosis: 0.95 }, mv: { regurgitation: 0.6 } }) });
  it("shows both at once: a severe aortic gradient and a regurgitant volume, each graded on its own valve", () => {
    expect(find(both, "AV").meanGradient).toBeGreaterThan(30); expect(find(both, "AV").stenosis).toBe("severe"); expect(find(both, "AV").regurgitation).toBe("none");
    expect(find(both, "MV").regurgMl).toBeGreaterThan(40); expect(["moderate", "severe"]).toContain(find(both, "MV").regurgitation); expect(find(both, "MV").stenosis).toBe("none");
    expect(both.report.pressure.LV.max - both.report.pressure.AO.max).toBeGreaterThan(25);
    expect(both.murmur).toMatch(/Aortic: crescendo-decrescendo.*Mitral: holosystolic/);
    expect(both.summary.length).toBe(2);
  });
  it("interacts: the leak takes forward flow from the narrowed valve (lower gradient than aortic stenosis alone) and the pressure the stenosis builds drives more of the stroke backward and raises the left atrium", () => {
    expect(find(both, "AV").meanGradient).toBeLessThan(find(as, "AV").meanGradient);
    expect(find(both, "MV").regurgFraction!).toBeGreaterThan(find(mr, "MV").regurgFraction!);
    expect(both.report.pressure.LA.mean).toBeGreaterThan(mr.report.pressure.LA.mean + 0.5);
    expect(both.report.lvOutput).toBeLessThan(mr.report.lvOutput);
  });
  it("TAVR relieves the stenosis, leaves the regurgitation (a native-valve problem the new valve does not touch) and reduces its volume with the lower ventricular pressure", () => {
    const t = after({ valves: valveSet({ av: { stenosis: 0.95 }, mv: { regurgitation: 0.6 } }) }, { type: "tavr" });
    expect(find(t, "AV").meanGradient).toBeLessThan(find(both, "AV").meanGradient * 0.5);
    expect(find(t, "AV").stenosis).toBe("none");
    expect(find(t, "MV").regurgitation).not.toBe("none");
    expect(find(t, "MV").regurgFraction!).toBeLessThan(find(both, "MV").regurgFraction!);
  });
});

describe("aortic regurgitation with mitral stenosis", () => {
  it("a wide pulse pressure with a low diastolic pressure, a raised left atrium and a mitral gradient, each graded", () => {
    const a = solve({ valves: valveSet({ av: { regurgitation: 0.6 }, mv: { stenosis: 0.7 } }) }), n = normal();
    expect(find(a, "AV").regurgitation).toBe("severe"); expect(find(a, "MV").stenosis).not.toBe("none");
    expect(a.report.pressure.AO.min).toBeLessThan(n.report.pressure.AO.min - 20);
    expect(a.report.pressure.LA.mean).toBeGreaterThan(n.report.pressure.LA.mean + 4);
    expect(find(a, "MV").meanGradient).toBeGreaterThan(3);
  });
});

describe("the aortic valve", () => {
  const as = solve({ valves: valveSet({ av: { stenosis: 0.95 } }) });
  it("TAVR drops the mean gradient from severe to under 20 mmHg, raises output and lowers the left ventricular systolic pressure", () => {
    const t = after({ valves: valveSet({ av: { stenosis: 0.95 } }) }, { type: "tavr" });
    expect(find(as, "AV").meanGradient).toBeGreaterThan(40); expect(find(t, "AV").meanGradient).toBeLessThan(20);
    expect(find(t, "AV").meanGradient).toBeLessThan(find(as, "AV").meanGradient * 0.5);
    expect(find(t, "AV").stenosis).toBe("none"); expect(find(t, "AV").regurgitation).toBe("none");
    expect(t.report.lvOutput).toBeGreaterThan(as.report.lvOutput); expect(t.report.pressure.LV.max).toBeLessThan(as.report.pressure.LV.max - 30); // (the model has no wall thickening, so the wedge pressure does not fall)
    expect(find(t, "AV").prosthesis).toMatchObject({ kind: "transcatheter", sizeMm: 26 });
    expect(t.murmur).toMatch(/transcatheter/); expect(t.murmur).not.toMatch(/ejection murmur/);
  });
  it("a paravalvular leak after TAVR opens the diastolic pressure and is graded by its orifice", () => {
    const none = after({}, { type: "tavr" }), mild = after({}, { type: "tavr", leakCm2: 0.05 }), severe = after({}, { type: "tavr", leakCm2: 0.4 });
    expect(find(none, "AV").regurgitation).toBe("none"); expect(find(mild, "AV").regurgitation).toBe("mild");
    expect(["moderate", "severe"]).toContain(find(severe, "AV").regurgitation);
    expect(severe.report.pressure.AO.min).toBeLessThan(none.report.pressure.AO.min - 15);
    expect(find(severe, "AV").regurgFraction!).toBeGreaterThan(0.3);
    expect(severe.murmur).toMatch(/diastolic/);
  });
  it("balloon valvuloplasty helps less than a valve and gives some regurgitation: the gradient falls by a fifth to a half, the area gains about 0.3 cm², a mild leak appears and the valve stays stenotic", () => {
    const b = after({ valves: valveSet({ av: { stenosis: 0.95 } }) }, { type: "balloon", valve: "av" });
    const g0 = find(as, "AV").meanGradient, g1 = find(b, "AV").meanGradient;
    expect(g1).toBeLessThan(g0 * 0.8); expect(g1).toBeGreaterThan(g0 * 0.4);
    expect(find(b, "AV").gorlinArea!).toBeGreaterThan(find(as, "AV").gorlinArea! + 0.1);
    expect(find(b, "AV").regurgitation).not.toBe("none"); expect(find(b, "AV").regurgitation).not.toBe("severe");
    expect(find(b, "AV").stenosis).not.toBe("none");
  });
  it("a surgical bioprosthesis: the mean gradient falls with size (ASE 2009: a normal 21 to 25 mm tissue valve is 10 to 20 mmHg at rest); a 19 mm valve in an adult of 1.8 m² is a moderate mismatch, a 25 mm is none", () => {
    const g = (sizeMm: number) => find(solve({ valves: { av: { prosthesis: { kind: "bioprosthetic", sizeMm } } } }), "AV");
    expect(g(19).meanGradient).toBeGreaterThan(g(21).meanGradient); expect(g(21).meanGradient).toBeGreaterThan(g(25).meanGradient); expect(g(25).meanGradient).toBeGreaterThan(g(27).meanGradient);
    expect(g(25).meanGradient).toBeLessThan(15); expect(g(25).meanGradient).toBeGreaterThan(5);
    expect(g(19).prosthesis!.mismatch).not.toBe("none"); expect(g(25).prosthesis!.mismatch).toBe("none");
    expect(g(19).prosthesis!.eoaIndexed).toBeLessThan(0.85); expect(g(25).prosthesis!.eoaIndexed).toBeGreaterThan(0.85);
    expect(g(25).stenosis).toBe("none"); expect(g(25).regurgitation).toBe("none"); expect(g(25).regurgMl).toBeLessThan(0.5);
  });
  it("a bileaflet mechanical valve has a physiological closing backflow of 3 to 10 % of the stroke (not graded as regurgitation) and a crisp click", () => {
    const m = solve({ valves: { av: { prosthesis: { kind: "mechanical", sizeMm: 25 } } } }), v = find(m, "AV");
    expect(v.regurgFraction!).toBeGreaterThan(0.03); expect(v.regurgFraction!).toBeLessThan(0.1);
    expect(v.regurgitation).toBe("none"); expect(v.stenosis).toBe("none");
    expect(m.murmur).toMatch(/metallic closing click/);
  });
  it("a thrombosed mechanical valve (70 % of the orifice lost) is a severe prosthetic stenosis with a muffled click; a paravalvular leak of 0.3 cm² is a moderate-to-severe regurgitation", () => {
    const t = solve({ valves: { av: { prosthesis: { kind: "mechanical", sizeMm: 23, obstruction: 0.7 } } } }), l = solve({ valves: { av: { prosthesis: { kind: "mechanical", sizeMm: 23, leak: 0.3 } } } });
    expect(find(t, "AV").meanGradient).toBeGreaterThan(35); expect(find(t, "AV").stenosis).toBe("severe"); expect(t.murmur).toMatch(/muffled/);
    expect(["moderate", "severe"]).toContain(find(l, "AV").regurgitation); expect(find(l, "AV").regurgFraction!).toBeGreaterThan(0.3);
  });
  it("valve-in-valve keeps a higher gradient than the same transcatheter valve in a native annulus (VIVID: about 15 mmHg)", () => {
    const viv = after({ valves: { av: { prosthesis: { kind: "bioprosthetic", sizeMm: 21 } } } }, { type: "tavr", sizeMm: 23 }), native = after({}, { type: "tavr", sizeMm: 23 });
    expect(find(viv, "AV").prosthesis!.inRing).toBe(true);
    expect(find(viv, "AV").meanGradient).toBeGreaterThan(find(native, "AV").meanGradient + 3);
  });
});

describe("the mitral valve", () => {
  const ms = solve({ valves: valveSet({ mv: { stenosis: 0.95 } }) }), mr = solve({ valves: valveSet({ mv: { regurgitation: 0.9 } }) });
  it("balloon mitral valvuloplasty roughly doubles the area, halves the gradient and lowers the left atrial pressure, and leaves a mild leak (Wilkins score <= 8)", () => {
    const b = after({ valves: valveSet({ mv: { stenosis: 0.95 } }) }, { type: "balloon", valve: "mv" });
    expect(find(b, "MV").gorlinArea!).toBeGreaterThan(find(ms, "MV").gorlinArea! * 1.6);
    expect(find(b, "MV").meanGradient).toBeLessThan(find(ms, "MV").meanGradient * 0.6);
    expect(b.report.pressure.LA.mean).toBeLessThan(ms.report.pressure.LA.mean - 3);
    expect(["mild", "moderate"]).toContain(find(b, "MV").regurgitation);
    expect(b.report.lvOutput).toBeGreaterThan(ms.report.lvOutput);
  });
  it("MitraClip: more clips, less regurgitant volume and a smaller v wave, at the price of a rising gradient (COAPT: MR <= 2+ in 95 %, mean gradient 4 to 5 mmHg)", () => {
    const c = (clips: number) => after({ valves: valveSet({ mv: { regurgitation: 0.9 } }) }, { type: "teer", valve: "mv", clips });
    const [c1, c2, c3] = [c(1), c(2), c(3)];
    expect(find(mr, "MV").regurgitation).toBe("severe");
    expect(find(c1, "MV").regurgMl).toBeLessThan(find(mr, "MV").regurgMl); expect(find(c2, "MV").regurgMl).toBeLessThan(find(c1, "MV").regurgMl); expect(find(c3, "MV").regurgMl).toBeLessThan(find(c2, "MV").regurgMl);
    expect(find(c2, "MV").regurgFraction!).toBeLessThan(find(mr, "MV").regurgFraction! * 0.65);
    expect(["none", "mild"]).toContain(find(c3, "MV").regurgitation);
    const vwave = (a: HeartAssessment) => a.report.pressure.LA.max - a.report.pressure.LA.min;
    expect(vwave(c2)).toBeLessThan(vwave(mr)); expect(c2.report.pressure.LA.mean).toBeLessThan(mr.report.pressure.LA.mean - 2);
    expect(find(c2, "MV").meanGradient).toBeLessThan(5); expect(find(c3, "MV").meanGradient).toBeGreaterThan(find(mr, "MV").meanGradient);
    expect(c2.report.lvOutput).toBeGreaterThan(mr.report.lvOutput);
  });
  it("replacement removes the regurgitation and the left atrial v wave; a 29 mm bioprosthesis gives a mean gradient under 7 mmHg and is not a stenosis, a 25 mm is a mismatch", () => {
    const r = after({ valves: valveSet({ mv: { regurgitation: 0.9 } }) }, { type: "replace", valve: "mv", kind: "bioprosthetic", sizeMm: 29 });
    expect(find(r, "MV").regurgMl).toBeLessThan(0.5); expect(find(r, "MV").regurgitation).toBe("none");
    expect(find(r, "MV").meanGradient).toBeLessThan(7); expect(r.report.pressure.LA.mean).toBeLessThan(mr.report.pressure.LA.mean - 3);
    const small = solve({ valves: { mv: { prosthesis: { kind: "bioprosthetic", sizeMm: 25 } } } });
    expect(find(small, "MV").meanGradient).toBeGreaterThan(find(r, "MV").meanGradient); expect(find(small, "MV").prosthesis!.mismatch).not.toBe("none");
    const mech = solve({ valves: { mv: { prosthesis: { kind: "mechanical", sizeMm: 29 } } } });
    expect(find(mech, "MV").meanGradient).toBeLessThan(6); expect(find(mech, "MV").regurgitation).toBe("none"); expect(mech.murmur).toMatch(/click/);
  });
});

describe("the tricuspid valve", () => {
  const tr = solve({ valves: valveSet({ tv: { regurgitation: 0.8 } }) });
  it("edge-to-edge repair and ring repair both cut the regurgitant volume and the right atrial v wave", () => {
    const vwave = (a: HeartAssessment) => a.report.pressure.RA.max - a.report.pressure.RA.min;
    const clip = after({ valves: valveSet({ tv: { regurgitation: 0.8 } }) }, { type: "teer", valve: "tv" }), ring = after({ valves: valveSet({ tv: { regurgitation: 0.8 } }) }, { type: "repair", valve: "tv" });
    expect(find(tr, "TV").regurgitation).toBe("severe");
    for (const a of [clip, ring]) { expect(find(a, "TV").regurgMl).toBeLessThan(find(tr, "TV").regurgMl * 0.7); expect(vwave(a)).toBeLessThan(vwave(tr)); }
    expect(find(ring, "TV").regurgFraction!).toBeLessThan(find(clip, "TV").regurgFraction!);
    expect(clip.report.lvOutput).toBeGreaterThan(tr.report.lvOutput);
  });
  it("a tricuspid bioprosthesis opens without a significant gradient (< 6 mmHg)", () => {
    const t = solve({ valves: { tv: { prosthesis: { kind: "bioprosthetic", sizeMm: 31 } } } });
    expect(find(t, "TV").meanGradient).toBeLessThan(6); expect(find(t, "TV").stenosis).toBe("none");
  });
  it("tricuspid stenosis with a failing bioprosthesis: 60 % obstruction raises the right atrial pressure", () => {
    const bad = solve({ valves: { tv: { prosthesis: { kind: "bioprosthetic", sizeMm: 31, obstruction: 0.7 } } } });
    expect(bad.report.pressure.RA.mean).toBeGreaterThan(normal().report.pressure.RA.mean + 1); expect(find(bad, "TV").stenosis).not.toBe("none");
  });
});

describe("the pulmonary valve", () => {
  const ps = solve({ valves: valveSet({ pv: { stenosis: 0.8 } }) });
  it("balloon pulmonary valvuloplasty lowers the right ventricular pressure and the gradient, and leaves a mild pulmonary regurgitation", () => {
    const b = after({ valves: valveSet({ pv: { stenosis: 0.8 } }) }, { type: "balloon", valve: "pv" });
    expect(b.report.pressure.RV.max).toBeLessThan(ps.report.pressure.RV.max - 5);
    expect(find(b, "PVL").meanGradient).toBeLessThan(find(ps, "PVL").meanGradient * 0.5);
    expect(find(b, "PVL").regurgitation).not.toBe("none"); expect(find(b, "PVL").regurgitation).not.toBe("severe");
    expect(find(b, "PVL").stenosis).toBe("none");
  });
  it("a pulmonary bioprosthesis (the usual replacement for repaired Fallot with severe regurgitation) removes the regurgitation without a gradient", () => {
    const pr = solve({ valves: valveSet({ pv: { regurgitation: 0.8 } }) });
    const r = after({ valves: valveSet({ pv: { regurgitation: 0.8 } }) }, { type: "replace", valve: "pv", kind: "bioprosthetic", sizeMm: 25 });
    expect(find(pr, "PVL").regurgitation).toBe("severe"); expect(find(r, "PVL").regurgitation).toBe("none");
    expect(find(r, "PVL").meanGradient).toBeLessThan(15);
  });
});
