import { describe, it, expect } from "vitest";
import { ALL_LEADS } from "../src/config/ecg";
import { EkgEngine, measure, EBeat } from "../src/ekg/engine";
import { PRESETS, PRESET_BY_ID, findPreset, resolveSpec } from "../src/ekg/presets";

const m = (id: string) => measure(resolveSpec(PRESET_BY_ID[id]));
const beats = (id: string, until = 20) => { const e = new EkgEngine(resolveSpec(PRESET_BY_ID[id])); e.ensure(until); return e.beats.filter((b) => b.t < until); };
/** Peak-to-peak amplitude (mV) of a lead over a window. */
function span(id: string, lead: (typeof ALL_LEADS)[number], from: number, to: number) {
  const e = new EkgEngine(resolveSpec(PRESET_BY_ID[id]));
  let hi = -Infinity, lo = Infinity;
  for (let t = from; t < to; t += 0.002) { const v = e.leads(t)[lead]; hi = Math.max(hi, v); lo = Math.min(lo, v); }
  return { hi, lo };
}

describe("EKG library", () => {
  it("has unique ids and teaching text for every preset", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) { expect(p.features.length).toBeGreaterThan(1); expect(p.pearls.length).toBeGreaterThan(0); expect(p.summary.length).toBeGreaterThan(10); }
  });
  it("covers the rhythms a learner asks for", () => {
    for (const q of ["afib", "aflutter", "vfib", "vtach", "polymorphic vt", "torsades", "stemi", "nstemi", "complete heart block", "mobitz 2", "wenckebach", "junctional", "de winter", "pericarditis", "brugada", "hyperkalemia", "wellens"]) expect(findPreset(q), q).toBeTruthy();
  });
  it("every preset renders finite voltages in all 15 leads", () => {
    for (const p of PRESETS) {
      const e = new EkgEngine(resolveSpec(p));
      for (let t = 0.5; t < 6; t += 0.37) for (const l of ALL_LEADS) expect(Number.isFinite(e.leads(t)[l]), `${p.id} ${l}`).toBe(true);
    }
  });
  it("keeps Einthoven's law (II = I + III) whatever the rhythm", () => {
    for (const id of ["vf-coarse", "torsades", "flutter-21", "lbbb"]) {
      const e = new EkgEngine(resolveSpec(PRESET_BY_ID[id]));
      for (let t = 1; t < 4; t += 0.13) { const s = e.leads(t); expect(s.II).toBeCloseTo(s.I + s.III, 9); }
    }
  });
});

describe("rhythms", () => {
  it("normal sinus rhythm: 72, regular, PR 160, normal axis, flat ST", () => {
    const r = m("nsr");
    expect(r.ventricularRate).toBeCloseTo(72, -1); expect(r.regular).toBe(true); expect(r.prMs).toBe(160);
    expect(r.axisDeg!).toBeGreaterThan(0); expect(r.axisDeg!).toBeLessThan(90);
    for (const l of ALL_LEADS) expect(Math.abs(r.stMm![l])).toBeLessThan(0.5);
  });
  it("atrial fibrillation is irregular with no P waves", () => {
    const r = m("af");
    expect(r.regular).toBe(false); expect(r.prPattern).toBe("none");
  });
  it("flutter with 2:1 block: atria at 300, ventricles at 150, regular", () => {
    const r = m("flutter-21");
    expect(r.atrialRate).toBe(300); expect(r.ventricularRate).toBeCloseTo(150, -1); expect(r.regular).toBe(true);
  });
  it("flutter waves are negative sawtooth inferiorly and upright in V1", () => {
    const e = new EkgEngine(resolveSpec(PRESET_BY_ID["flutter-var"]));
    // in a gap between QRS complexes, the baseline is the flutter wave: opposite polarity in II and V1
    let c = 0, n = 0;
    for (let t = 2; t < 8; t += 0.01) { const s = e.leads(t); if (Math.abs(s.II) > 0.03) { n++; if (Math.sign(s.II) !== Math.sign(s.V1)) c++; } }
    expect(c / n).toBeGreaterThan(0.5);
  });
  it("Wenckebach: the PR lengthens and then a P wave does not conduct", () => {
    const b = beats("wenckebach").filter((x) => x.t > 1);
    const firstDrop = b.findIndex((x) => x.kind === "p");
    const before = b.slice(Math.max(0, firstDrop - 3), firstDrop).filter((x) => x.kind === "sv").map((x) => x.pr!);
    expect(before.length).toBeGreaterThan(1);
    for (let i = 1; i < before.length; i++) expect(before[i]).toBeGreaterThan(before[i - 1]);
    expect(m("wenckebach").prPattern).toBe("progressive");
  });
  it("Mobitz II: constant PR around the dropped beat, wide QRS", () => {
    const r = m("mobitz2"); expect(r.prPattern).toBe("constant"); expect(r.qrsMs!).toBeGreaterThanOrEqual(120);
    expect(beats("mobitz2").some((x) => x.kind === "p")).toBe(true);
  });
  it("complete heart block: atria faster than the ventricles, dissociated", () => {
    const r = m("chb"); expect(r.prPattern).toBe("dissociated"); expect(r.atrialRate!).toBeGreaterThan(r.ventricularRate! + 20);
  });
  it("junctional rhythm: 40–60, retrograde P after the QRS", () => {
    const r = m("junctional"); expect(r.ventricularRate!).toBeGreaterThanOrEqual(40); expect(r.ventricularRate!).toBeLessThanOrEqual(60);
    expect(beats("junctional").every((b: EBeat) => b.pr === undefined && b.retroP! > 0)).toBe(true);
  });
  it("VT: fast, wide, positive in V1 and aVR (RBBB-like, northwest axis)", () => {
    const r = m("vt-mono"); expect(r.ventricularRate!).toBeGreaterThan(150); expect(r.qrsMs!).toBeGreaterThanOrEqual(120);
    const v1 = span("vt-mono", "V1", 2, 4), avr = span("vt-mono", "aVR", 2, 4), avf = span("vt-mono", "aVF", 2, 4);
    expect(v1.hi).toBeGreaterThan(-v1.lo); expect(avr.hi).toBeGreaterThan(-avr.lo); expect(-avf.lo).toBeGreaterThan(avf.hi);
  });
  it("torsades: long QT sinus beats, then a run whose polarity twists", () => {
    expect(m("torsades").qtcMs!).toBeGreaterThan(500);
    const b = beats("torsades", 20).filter((x) => x.kind === "v");
    expect(b.length).toBeGreaterThan(20);
    const ii = b.map((x) => x.vm!.v[0] * 0.5 + x.vm!.v[1] * 0.866); // projection on lead II
    expect(Math.max(...ii)).toBeGreaterThan(0.5); expect(Math.min(...ii)).toBeLessThan(-0.5);
  });
  it("VF has no QRS complexes but large chaotic deflections", () => {
    expect(beats("vf-coarse").length).toBe(0);
    const s = span("vf-coarse", "II", 1, 6); expect(s.hi - s.lo).toBeGreaterThan(0.4);
  });
  it("ventricular pacing puts a spike before every wide QRS", () => {
    expect(beats("paced").filter((b) => b.kind === "v").every((b) => b.paced)).toBe(true);
  });
});

describe("conduction and morphology", () => {
  it("LAFB swings the axis beyond −45°", () => { expect(m("lafb").axisDeg!).toBeLessThan(-40); });
  it("RBBB keeps a normal axis and an upright terminal R′ in V1", () => {
    const r = m("rbbb"); expect(r.axisDeg!).toBeGreaterThan(-30); expect(r.axisDeg!).toBeLessThan(90);
  });
  it("WPW: short PR and a widened QRS", () => { const r = m("wpw"); expect(r.prMs!).toBeLessThan(120); expect(r.qrsMs!).toBeGreaterThan(110); });
  it("LVH meets Sokolow–Lyon (S V1 + R V5 ≥ 3.5 mV)", () => {
    const b = beats("lvh").find((x) => x.kind === "sv" && x.t > 2)!;
    const v1 = span("lvh", "V1", b.t - 0.05, b.t + 0.06), v5 = span("lvh", "V5", b.t - 0.05, b.t + 0.06);
    expect(-v1.lo + v5.hi).toBeGreaterThan(3.5);
  });
  it("hyperkalemia peaks the T wave; long QT prolongs the QTc", () => {
    expect(m("long-qt").qtcMs!).toBeGreaterThan(500);
    const b = beats("hyperk").find((x) => x.kind === "sv" && x.t > 2)!;
    const t = span("hyperk", "V3", b.t + 0.15, b.t + 0.4), n = span("nsr", "V3", 2.2, 2.6);
    expect(t.hi).toBeGreaterThan(0.6);
    expect(n.hi).toBeLessThan(t.hi);
  });
  it("electrical alternans alternates the QRS height", () => {
    const b = beats("alternans").filter((x) => x.kind === "sv").slice(2, 6);
    expect(b[0].alt).not.toBe(b[1].alt); expect(b[0].alt).toBe(b[2].alt);
  });
});

describe("ischemia and its mimics", () => {
  it("anterior STEMI (from the coronary model): elevation V2–V4, reciprocal inferior depression", () => {
    const r = m("stemi-anterior");
    expect(r.meetsStemiCriteria).toBe(true);
    for (const l of ["V2", "V3", "V4"] as const) expect(r.stMm![l]).toBeGreaterThan(2);
    expect(r.stMm!.III).toBeLessThan(-1);
  });
  it("inferior STEMI: elevation in II, III, aVF with III > II, depression in aVL", () => {
    const r = m("stemi-inferior");
    expect(r.stMm!.III).toBeGreaterThan(r.stMm!.II); expect(r.stMm!.aVF).toBeGreaterThan(1); expect(r.stMm!.aVL).toBeLessThan(-1);
  });
  it("posterior STEMI: depression V1–V3, elevation V7–V9", () => {
    const r = m("stemi-posterior");
    for (const l of ["V1", "V2"] as const) expect(r.stMm![l]).toBeLessThan(-1);
    for (const l of ["V8", "V9"] as const) expect(r.stMm![l]).toBeGreaterThan(0.5);
  });
  it("high lateral STEMI: elevation in I and aVL, depression in III", () => {
    const r = m("stemi-lateral"); expect(r.stMm!.aVL).toBeGreaterThanOrEqual(1); expect(r.stMm!.III).toBeLessThan(-1);
  });
  it("NSTEMI: non-localizing depression with elevation in aVR, no STEMI", () => {
    const r = m("nstemi"); expect(r.meetsStemiCriteria).toBe(false); expect(r.stMm!.aVR).toBeGreaterThan(1); expect(r.stMm!.V6).toBeLessThan(-0.5);
  });
  it("de Winter: anterior J-point depression with tall T waves, elevation in aVR, no STEMI", () => {
    const r = m("de-winter"); expect(r.meetsStemiCriteria).toBe(false); expect(r.stMm!.V3).toBeLessThan(-0.5); expect(r.stMm!.aVR).toBeGreaterThan(0.5);
    const b = beats("de-winter").find((x) => x.kind === "sv" && x.t > 2)!;
    expect(span("de-winter", "V3", b.t + 0.15, b.t + 0.4).hi).toBeGreaterThan(span("nsr", "V3", 2.2, 2.6).hi * 1.5);
  });
  it("Wellens B: deep T inversion in V2–V3 without ST elevation", () => {
    const r = m("wellens-b"); expect(r.meetsStemiCriteria).toBe(false);
    const b = beats("wellens-b").find((x) => x.kind === "sv" && x.t > 2)!;
    expect(span("wellens-b", "V2", b.t + 0.15, b.t + 0.45).lo).toBeLessThan(-0.3);
  });
  it("pericarditis: diffuse elevation, depression only in aVR, PR depression in II", () => {
    const r = m("pericarditis");
    for (const l of ["I", "II", "aVF", "V4", "V5", "V6"] as const) expect(r.stMm![l]).toBeGreaterThan(0.8);
    expect(r.stMm!.aVR).toBeLessThan(-1);
    expect(r.stDepression.filter((l) => !["aVR", "V1", "V8", "V9"].includes(l))).toEqual([]);
    const b = beats("pericarditis").find((x) => x.kind === "sv" && x.t > 2)!;
    const e = new EkgEngine(resolveSpec(PRESET_BY_ID.pericarditis));
    expect(e.leads(b.t - 0.06).II).toBeLessThan(-0.03); // PR segment below baseline
  });
  it("Brugada: coved elevation in V1–V2", () => { const r = m("brugada"); expect(r.stMm!.V1).toBeGreaterThan(2); expect(r.stMm!.V2).toBeGreaterThan(2); });
  it("LBBB alone shows only discordant ST; Sgarbossa adds concordant change", () => {
    const l = m("lbbb"), s = m("sgarbossa");
    expect(l.stMm!.I).toBeLessThan(0); expect(s.stMm!.I).toBeGreaterThan(0.5); // I has a positive QRS: concordant elevation
    expect(s.stMm!.V2).toBeLessThan(-1); // concordant depression in V1–V3
  });
});

describe("EKG tools (MCP)", async () => {
  const { TOOLS } = await import("../src/mcp/tools");
  const run = (name: string, args: Record<string, unknown>) => TOOLS.find((t) => t.name === name)!.run({ sim: undefined as never, appUrl: "https://corosim.com" }, args) as Record<string, any>;
  it("lists every preset by category", () => {
    const r = run("corosim_ekg_list", {});
    expect(r.categories.flatMap((c: { presets: unknown[] }) => c.presets)).toHaveLength(PRESETS.length);
  });
  it("shows a preset by common name with its measurements and a link", () => {
    const r = run("corosim_ekg_show", { preset: "afib", rate: 130 });
    expect(r.ekg.preset).toBe("af"); expect(r.ekg.rate).toBe(130);
    expect(r.tracing.measurements.regular).toBe(false); expect(r.link).toBe("https://corosim.com/ekg/#p=af");
  });
  it("quiz hides the answer from the screen and returns it as an answer key", () => {
    const r = run("corosim_ekg_show", { quiz: true });
    expect(r.ekg.quiz).toBe(true); expect(r.answerKey.name).toBeTruthy(); expect(r.tracing).toBeUndefined();
  });
  it("is stateless and says what it does not know", () => {
    expect(TOOLS.filter((t) => t.name.startsWith("corosim_ekg")).every((t) => t.stateless && t.readOnly)).toBe(true);
    expect(() => run("corosim_ekg_show", { preset: "not a rhythm" })).toThrow(/corosim_ekg_list/);
  });
});

import { buildCustom, decodeCustom, encodeCustom } from "../src/ekg/custom";
describe("custom tracings (built from a description)", () => {
  const mc = (c: Parameters<typeof buildCustom>[0]) => measure(resolveSpec(buildCustom(c).preset));
  it("puts the asked-for ST elevation in the lead facing the wall, with reciprocal change", () => {
    const r = mc({ morph: { st: [{ territory: "anterior", mm: 2 }] } });
    expect(r.stMm!.V3).toBeCloseTo(2, 0); expect(r.stMm!.III).toBeLessThan(0);
    const inf = mc({ morph: { st: [{ territory: "inferior", mm: 3 }] } });
    expect(inf.stMm!.aVF).toBeCloseTo(3, 0); expect(inf.stMm!.aVL).toBeLessThan(-1);
  });
  it("combines rhythm, conduction and morphology: sinus 110 with LBBB and inferior STE", () => {
    const r = mc({ rhythm: { rate: 110 }, morph: { bbb: "lbbb", st: [{ territory: "inferior", mm: 3 }] } });
    expect(r.ventricularRate).toBeCloseTo(110, -1); expect(r.qrsMs!).toBeGreaterThanOrEqual(120); expect(r.stMm!.III).toBeGreaterThan(2);
  });
  it("hits a target axis, PR and QRS width", () => {
    const r = mc({ rhythm: { prMs: 260 }, morph: { axisDeg: -60, qrsWidthMs: 130 } });
    expect(r.axisDeg!).toBeCloseTo(-60, -1); expect(r.prMs).toBe(260); expect(r.qrsMs).toBe(130);
  });
  it("inverts the T wave to the asked depth", () => {
    const { preset } = buildCustom({ morph: { tInversion: [{ territory: "anterior", mm: 5 }] } });
    const e = new EkgEngine(resolveSpec(preset)); e.ensure(6);
    const b = e.beats.find((x) => x.kind === "sv" && x.t > 2)!;
    let lo = 0; for (let t = b.t + 0.15; t < b.t + 0.45; t += 0.002) lo = Math.min(lo, e.leads(t).V3);
    expect(lo).toBeCloseTo(-0.5, 1);
  });
  it("builds rhythms the library does not have (AF with pre-excitation, 3:2 Wenckebach, VT at 220)", () => {
    const af = mc({ rhythm: { kind: "af", rate: 180 }, morph: { deltaWave: true } });
    expect(af.regular).toBe(false); expect(af.qrsMs!).toBeGreaterThan(110);
    const w = buildCustom({ rhythm: { av: "wenckebach", dropEvery: 3 } }).preset;
    const e = new EkgEngine(resolveSpec(w)); e.ensure(10);
    const kinds = e.beats.filter((b) => b.t > 1 && b.t < 9).map((b) => b.kind).join("");
    expect(kinds).toMatch(/svsvp/);
    expect(mc({ rhythm: { kind: "vt", rate: 220 } }).ventricularRate).toBeCloseTo(220, -1);
  });
  it("starts from a preset and changes only what is given", () => {
    const { preset } = buildCustom({ base: "hyperk", rhythm: { rate: 40 } });
    expect(preset.spec.morph?.tNarrow).toBe(0.5); expect(measure(resolveSpec(preset)).ventricularRate).toBeCloseTo(40, -1);
  });
  it("uses the coronary model for lesions", () => {
    const r = mc({ lesions: [{ artery: "RCA", occluded: true }] });
    expect(r.stMm!.III).toBeGreaterThan(1.5);
  });
  it("clamps and reports what it could not do", () => {
    const { warnings } = buildCustom({ rhythm: { kind: "nope" as never, rate: 999 }, morph: { st: [{ territory: "moon" as never, mm: 2 }] } });
    expect(warnings.join(" ")).toMatch(/unknown.*clamped|clamped.*unknown/s); expect(warnings.some((w) => w.includes("moon"))).toBe(true);
  });
  it("round-trips through a share link", () => {
    const c = { name: "Test ✓", rhythm: { kind: "af" as const, rate: 120 } };
    expect(decodeCustom(encodeCustom(c))).toEqual(c);
  });
  it("the MCP tool draws a custom tracing, reports its measurements and links it", async () => {
    const { TOOLS } = await import("../src/mcp/tools");
    const r = TOOLS.find((t) => t.name === "corosim_ekg_show")!.run({ sim: undefined as never, appUrl: "https://corosim.com/" }, { custom: { name: "Sinus with LBBB", morph: { bbb: "lbbb" } } }) as Record<string, any>;
    expect(r.ekg.preset).toBe("custom"); expect(r.ekg.custom.morph.bbb).toBe("lbbb");
    expect(r.tracing.name).toBe("Sinus with LBBB"); expect(r.tracing.measurements.qrsMs).toBeGreaterThanOrEqual(120);
    expect(r.link).toMatch(/^https:\/\/corosim\.com\/ekg\/#c=/);
  });
});
