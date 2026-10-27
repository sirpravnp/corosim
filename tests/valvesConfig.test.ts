// B5: prosthetic valves and valve interventions, the parts that need no circulation solve (docs/VALVES.md): the EOA tables, how a
// valve lesion becomes the engine's edge, clamping and normalisation, and the interventions as edits. The solved numbers are in valves.test.ts.
import { describe, it, expect } from "vitest";
import { buildModel, clampStructuralSpec, prosthesisEoa, resolveValve } from "../src/physics/structural";
import { normalizePatient } from "../src/sim/patient";
import type { HeartSpec } from "../src/sim/patient";
import { intervene, nativeLesion, valveSet } from "../src/sim/valves";
import { LESION_BY_ID } from "../src/sim/structural";
import { PATIENTS } from "../src/config/structural";
import { PROSTHESIS_EOA, PROSTHESIS_KINDS, PROSTHESIS_SIZE, VALVE_KEYS } from "../src/config/valves";

const A = PATIENTS.adult.valveAreas;
const edge = (h: HeartSpec, name: string) => buildModel({ ...h, patient: "adult" }).edges.find((e) => e.name === name)!;

describe("prosthesis EOA tables", () => {
  it("every table rises with size, sits inside its valve's size range and below the native valve's area", () => {
    for (const kind of PROSTHESIS_KINDS) for (const k of VALVE_KEYS) {
      const t = PROSTHESIS_EOA[kind][k], [lo, hi] = PROSTHESIS_SIZE[k];
      expect(t.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < t.length; i++) { expect(t[i][0]).toBeGreaterThan(t[i - 1][0]); expect(t[i][1]).toBeGreaterThan(t[i - 1][1]); }
      expect(t[0][0]).toBeGreaterThanOrEqual(lo); expect(t[t.length - 1][0]).toBeLessThanOrEqual(hi);
      expect(t[t.length - 1][1]).toBeLessThan(A[k]);
    }
  });
  it("interpolates between sizes and holds the ends", () => {
    expect(prosthesisEoa("bioprosthetic", "av", 22)).toBeCloseTo(1.6, 6); // halfway between 21 (1.5) and 23 (1.7)
    expect(prosthesisEoa("bioprosthetic", "av", 10)).toBe(1.2);
    expect(prosthesisEoa("bioprosthetic", "av", 60)).toBe(2.5);
  });
  it("matches the published reference EOAs (Pibarot 2009, ASE 2009): a 21 mm aortic bioprosthesis 1.3 to 1.6, a 23 mm bileaflet mechanical 1.8 to 2.2, a 26 mm transcatheter 1.6 to 2.0", () => {
    expect(prosthesisEoa("bioprosthetic", "av", 21)).toBeGreaterThanOrEqual(1.3); expect(prosthesisEoa("bioprosthetic", "av", 21)).toBeLessThanOrEqual(1.6);
    expect(prosthesisEoa("mechanical", "av", 23)).toBeGreaterThanOrEqual(1.8); expect(prosthesisEoa("mechanical", "av", 23)).toBeLessThanOrEqual(2.2);
    expect(prosthesisEoa("transcatheter", "av", 26)).toBeGreaterThanOrEqual(1.6); expect(prosthesisEoa("transcatheter", "av", 26)).toBeLessThanOrEqual(2.0);
  });
});

describe("a valve lesion as the engine's edge", () => {
  it("a native lesion is what it always was: the normal area times `open`, the leak `reg`", () => {
    const e = edge({ valves: { av: { open: 0.3, reg: 0.12 } } }, "AV");
    expect(e.area).toBe(A.av * 0.3); expect(e.reg).toBe(0.12);
    expect(edge({}, "MV").area).toBe(A.mv); expect(edge({}, "MV").reg).toBe(0);
  });
  it("several lesions at once all reach the model: aortic stenosis and mitral regurgitation, side by side", () => {
    const h: HeartSpec = { valves: valveSet({ av: { stenosis: 0.9 }, mv: { regurgitation: 0.6 } }) };
    expect(edge(h, "AV").area).toBeCloseTo(A.av * (1 - 0.85 * 0.9), 9); expect(edge(h, "AV").reg).toBe(0);
    expect(edge(h, "MV").area).toBe(A.mv); expect(edge(h, "MV").reg).toBeCloseTo(0.6 * 0.12 * A.mv, 9);
  });
  it("valveSet builds the same lesion as the single-lesion presets, number for number", () => {
    for (const [id, k, key] of [["as", "av", "stenosis"], ["ms", "mv", "stenosis"], ["ts", "tv", "stenosis"], ["ps", "pv", "stenosis"], ["ar", "av", "regurgitation"], ["mr", "mv", "regurgitation"], ["tr", "tv", "regurgitation"], ["pr", "pv", "regurgitation"]] as const) {
      const preset = LESION_BY_ID[id]!.build({ severity: 0.7 }).valves![k]!, mine = nativeLesion(k, { [key]: 0.7 });
      if (key === "stenosis") expect(mine.open).toBe(preset.open); else expect(mine.reg).toBe(preset.reg);
    }
  });
  it("a prosthesis replaces the native valve: its EOA and closing leak, whatever `open` and `reg` say", () => {
    const m = resolveValve(PATIENTS.adult, "av", { open: 0.1, reg: 0.5, prosthesis: { kind: "mechanical", sizeMm: 23 } });
    expect(m.area).toBeCloseTo(2.0, 9); expect(m.reg).toBeCloseTo(0.03, 9); expect(m.prosthesis?.kind).toBe("mechanical");
    expect(resolveValve(PATIENTS.adult, "av", { prosthesis: { kind: "bioprosthetic", sizeMm: 23 } }).reg).toBe(0); // a tissue valve has no closing leak
    expect(resolveValve(PATIENTS.adult, "av", { prosthesis: { kind: "transcatheter", sizeMm: 26, leak: 0.1 } }).reg).toBeCloseTo(0.12, 9); // the trace leak plus a paravalvular one
  });
  it("obstruction takes a share of the orifice, valve-in-valve keeps 80% of it, and the area never exceeds the native valve's", () => {
    expect(resolveValve(PATIENTS.adult, "av", { prosthesis: { kind: "mechanical", sizeMm: 23, obstruction: 0.5 } }).area).toBeCloseTo(1.0, 9);
    expect(resolveValve(PATIENTS.adult, "av", { prosthesis: { kind: "transcatheter", sizeMm: 26, inRing: true } }).area).toBeCloseTo(1.9 * 0.8, 9);
    expect(resolveValve(PATIENTS.adult, "av", { prosthesis: { kind: "bioprosthetic", sizeMm: 23, inRing: true } }).area).toBeCloseTo(1.7, 9); // in-ring is for transcatheter valves only
    expect(resolveValve(PATIENTS.adult, "av", { prosthesis: { kind: "mechanical", sizeMm: 23, obstruction: 1 } }).area).toBe(0);
    for (const k of VALVE_KEYS) for (const kind of PROSTHESIS_KINDS) expect(resolveValve(PATIENTS.adult, k, { prosthesis: { kind, sizeMm: 99 } }).area).toBeLessThanOrEqual(A[k]);
  });
  it("prostheses in several positions are all built (aortic and mitral replacement)", () => {
    const h: HeartSpec = { valves: { av: { prosthesis: { kind: "bioprosthetic", sizeMm: 25 } }, mv: { prosthesis: { kind: "mechanical", sizeMm: 29 } } } };
    expect(edge(h, "AV").area).toBeCloseTo(2.0, 9); expect(edge(h, "MV").area).toBeCloseTo(2.2, 9); expect(edge(h, "MV").reg).toBeCloseTo(0.03, 9);
  });
});

describe("clamping and normalisation", () => {
  it("clamps size, leak and obstruction, drops a bad kind and a null prosthesis", () => {
    const c = clampStructuralSpec({ valves: { av: { prosthesis: { kind: "mechanical", sizeMm: 80, leak: 9, obstruction: 3 } }, mv: { prosthesis: { kind: "gold" as never } }, tv: { prosthesis: null } } });
    expect(c.valves!.av!.prosthesis).toMatchObject({ kind: "mechanical", sizeMm: PROSTHESIS_SIZE.av[1], leak: 2, obstruction: 1 });
    expect(c.valves!.mv!.prosthesis).toBeUndefined(); expect(c.valves!.tv!.prosthesis).toBeUndefined();
  });
  it("a patient keeps a valid prosthesis through normalisation (and through JSON), and an invalid one is dropped with a warning", () => {
    const ok = normalizePatient({ heart: { valves: { av: { prosthesis: { kind: "transcatheter", sizeMm: 26, leak: 0.05 } } } } });
    expect(ok.warnings).toEqual([]);
    expect(JSON.parse(JSON.stringify(ok.spec.heart))).toEqual({ valves: { av: { prosthesis: { kind: "transcatheter", sizeMm: 26, leak: 0.05 } } } });
    const bad = normalizePatient({ heart: { valves: { av: { prosthesis: { kind: "gold" as never, sizeMm: 26 } } } } });
    expect(bad.warnings.join(" ")).toMatch(/prosthesis/);
    expect(bad.spec.heart?.valves?.av?.prosthesis).toBeUndefined();
  });
});

describe("interventions as edits", () => {
  const as: HeartSpec = { valves: valveSet({ av: { stenosis: 0.95 } }) };
  it("TAVR replaces the stenotic aortic valve by a transcatheter prosthesis, with every field set so a merge leaves nothing stale", () => {
    const r = intervene(as, { type: "tavr" });
    expect(r.patch.valves!.av).toEqual({ open: 1, reg: 0, prosthesis: { kind: "transcatheter", sizeMm: 26, leak: 0, obstruction: 0, inRing: false } });
    expect(resolveValve(PATIENTS.adult, "av", r.heart.valves!.av).area).toBeCloseTo(1.9, 9);
    expect(r.changes.join(" ")).toMatch(/stenosis relieved/);
  });
  it("a second replacement over a leaky, obstructed prosthesis starts clean", () => {
    const worn: HeartSpec = { valves: { av: { prosthesis: { kind: "bioprosthetic", sizeMm: 21, leak: 0.3, obstruction: 0.5 } } } };
    const r = intervene(worn, { type: "tavr", sizeMm: 23 });
    expect(r.heart.valves!.av!.prosthesis).toEqual({ kind: "transcatheter", sizeMm: 23, leak: 0, obstruction: 0, inRing: true });
  });
  it("TAVR in a failed bioprosthesis is valve-in-valve; in a mechanical valve it is refused", () => {
    expect(intervene({ valves: { av: { prosthesis: { kind: "bioprosthetic", sizeMm: 21 } } } }, { type: "tavr" }).heart.valves!.av!.prosthesis!.inRing).toBe(true);
    const no = intervene({ valves: { av: { prosthesis: { kind: "mechanical", sizeMm: 23 } } } }, { type: "tavr" });
    expect(no.patch).toEqual({}); expect(no.warnings.join(" ")).toMatch(/mechanical/);
  });
  it("replacement clears the native regurgitation and out-of-range sizes are brought into range with a warning", () => {
    const r = intervene({ valves: valveSet({ mv: { regurgitation: 0.9 } }) }, { type: "replace", valve: "mv", kind: "mechanical", sizeMm: 40 });
    expect(r.heart.valves!.mv).toMatchObject({ open: 1, reg: 0, prosthesis: { kind: "mechanical", sizeMm: 33 } });
    expect(r.warnings.join(" ")).toMatch(/33 mm/); expect(r.changes.join(" ")).toMatch(/regurgitation treated/);
  });
  it("balloon valvuloplasty gains area up to a ceiling and adds a leak; it does nothing to a prosthesis, a tricuspid valve or a valve that is not stenotic", () => {
    const ms: HeartSpec = { valves: valveSet({ mv: { stenosis: 0.95 } }) };
    const area0 = A.mv * ms.valves!.mv!.open!, r = intervene(ms, { type: "balloon", valve: "mv" });
    const after = r.heart.valves!.mv!;
    expect(A.mv * after.open!).toBeCloseTo(area0 + 1.0, 6); expect(after.reg).toBeCloseTo(0.04, 9);
    expect(A.mv * intervene(ms, { type: "balloon", valve: "mv", effect: 0.5 }).heart.valves!.mv!.open!).toBeCloseTo(area0 + 0.5, 6);
    const mild = intervene({ valves: { av: { open: 0.4 } } }, { type: "balloon", valve: "av" }); // 1.5 cm², already above the 1.2 cm² a balloon can reach
    expect(mild.patch).toEqual({}); expect(mild.warnings.join(" ")).toMatch(/not stenotic enough/);
    expect(A.av * intervene({ valves: { av: { open: 0.15 } } }, { type: "balloon", valve: "av" }).heart.valves!.av!.open!).toBeCloseTo(0.87, 6); // 0.57 + 0.3
    expect(A.av * intervene({ valves: { av: { open: 0.25 } } }, { type: "balloon", valve: "av" }).heart.valves!.av!.open!).toBeCloseTo(1.2, 6); // 0.95 + 0.3 = 1.25, held at the 1.2 ceiling
    expect(intervene({ valves: { av: { prosthesis: { kind: "bioprosthetic", sizeMm: 23 } } } }, { type: "balloon", valve: "av" }).patch).toEqual({});
    expect(intervene(ms, { type: "balloon", valve: "tv" }).warnings.join(" ")).toMatch(/not offered/);
    expect(intervene({}, { type: "balloon", valve: "pv" }).warnings.join(" ")).toMatch(/not stenotic/);
  });
  it("edge-to-edge repair cuts the leak by a fixed share per clip and costs opening area; it needs a leak to treat and is for mitral and tricuspid only", () => {
    const mr: HeartSpec = { valves: valveSet({ mv: { regurgitation: 0.9 } }) }, reg0 = mr.valves!.mv!.reg!;
    const two = intervene(mr, { type: "teer", valve: "mv", clips: 2 }).heart.valves!.mv!;
    expect(two.reg).toBeCloseTo(reg0 * 0.55 ** 2, 9); expect(A.mv * two.open!).toBeCloseTo(A.mv - 1.0, 9);
    expect(intervene(mr, { type: "teer", valve: "mv", clips: 9 }).changes.join(" ")).toMatch(/4 clips/);
    expect(intervene({}, { type: "teer", valve: "mv" }).warnings.join(" ")).toMatch(/nothing to clip/);
    expect(intervene(mr, { type: "teer", valve: "av" }).warnings.join(" ")).toMatch(/mitral and tricuspid/);
    expect(intervene(mr, { type: "teer", valve: "mv", clips: 4 }).warnings).toEqual([]); // 5 - 2.0 = 3.0 cm²
    const narrow = intervene({ valves: { mv: { open: 0.5, reg: 0.3 } } }, { type: "teer", valve: "mv", clips: 3 }); // 2.5 - 1.5 = 1.0 cm², the floor
    expect(A.mv * narrow.heart.valves!.mv!.open!).toBeCloseTo(1.0, 9); expect(narrow.warnings.join(" ")).toMatch(/iatrogenic stenosis/);
  });
  it("annuloplasty repair cuts the leak to a tenth and narrows the opening a little", () => {
    const tr: HeartSpec = { valves: valveSet({ tv: { regurgitation: 0.8 } }) };
    const r = intervene(tr, { type: "repair", valve: "tv" }).heart.valves!.tv!;
    expect(r.reg).toBeCloseTo(tr.valves!.tv!.reg! * 0.15, 9); expect(r.open).toBeCloseTo(0.9, 9);
  });
  it("is pure: the heart it was given is not changed", () => {
    const before = JSON.stringify(as); intervene(as, { type: "tavr" }); expect(JSON.stringify(as)).toBe(before);
  });
});
