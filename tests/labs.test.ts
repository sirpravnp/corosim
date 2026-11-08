import { describe, it, expect } from "vitest";
import { ANALYTES, REF, estimateLabs, flag, LabsInput } from "../src/sim/labs";
import { CATALOG, PatientNow, itemById } from "../src/cases/orders";
import { CaseSpec, validateCase } from "../src/cases/spec";
import { buildPatientNow, accrueLowFlow, resetLowFlow, lowFlow } from "../src/page/patientNow";

const base = (o: Partial<LabsInput> = {}): LabsInput => ({
  respRateBase: 15, map: 90, spo2: 0.98, lactate: 1, congestion: 0, arrest: "none",
  co: 5, lvEf: 0.6, lvIschemia: 0, lowFlowMin: 0, caseMin: 0, ageY: 65, ...o,
});
const shockIn = () => base({ map: 55, lowFlowMin: 120, lactate: 6, co: 2.5, lvEf: 0.3, lvIschemia: 0.5, caseMin: 180, congestion: 0.5, spo2: 0.9 });
const now = (o: Partial<PatientNow> = {}): PatientNow => ({
  ...base(), hr: 75, sbp: 120, dbp: 70, urineMlHr: 60, rvIschemia: 0, rhythmLabel: "Sinus rhythm", tempC: 37, respRate: 15, ...o,
});
const labItems = CATALOG.filter((i) => i.group === "lab" && i.id !== "lactate");

describe("estimateLabs", () => {
  it("a normal patient has every analyte inside its reference range", () => {
    const v = estimateLabs(base());
    for (const a of ANALYTES) expect(flag(a, v[a]), a).toBe("");
  });
  it("low flow (map 55, lowFlowMin 120, lactate 6) raises creatinine, BUN, ALT, AST and potassium", () => {
    const v = estimateLabs(base({ map: 55, lowFlowMin: 120, lactate: 6 }));
    expect(v.cr).toBeGreaterThan(1.5);
    expect(v.bun).toBeGreaterThan(REF.bun.hi);
    expect(v.alt).toBeGreaterThan(REF.alt.hi);
    expect(v.ast).toBeGreaterThan(REF.ast.hi);
    expect(v.k).toBeGreaterThan(5.0);
  });
  it("congestion 0.8 raises BNP above 400 and total bilirubin above its range", () => {
    const v = estimateLabs(base({ congestion: 0.8 }));
    expect(v.bnp).toBeGreaterThan(400);
    expect(v.tbili).toBeGreaterThan(REF.tbili.hi);
  });
  it("lvIschemia 0.5 with caseMin 180 puts troponin above its range, and caseMin 0 does not", () => {
    expect(estimateLabs(base({ lvIschemia: 0.5, caseMin: 180 })).trop).toBeGreaterThan(REF.trop.hi);
    expect(estimateLabs(base({ lvIschemia: 0.5, caseMin: 0 })).trop).toBeLessThanOrEqual(REF.trop.hi);
  });
  it("bicarbonate falls as lactate rises", () => {
    expect(estimateLabs(base({ lactate: 8 })).hco3).toBeLessThan(estimateLabs(base({ lactate: 4 })).hco3);
    expect(estimateLabs(base({ lactate: 4 })).hco3).toBeLessThan(estimateLabs(base({ lactate: 1 })).hco3);
  });
  it("an override sets exactly that analyte and leaves the rest derived", () => {
    const plain = estimateLabs(shockIn()), v = estimateLabs(shockIn(), { k: 2.9, nope: 5, tsh: NaN });
    expect(v.k).toBe(2.9);
    for (const a of ANALYTES) if (a !== "k") expect(v[a], a).toBe(plain[a]);
  });
  it("every analyte is finite for a normal, a shock and an arrested patient, and for NaN inputs (baseline)", () => {
    const nan = base({ respRateBase: NaN, map: NaN, spo2: NaN, lactate: NaN, congestion: NaN, co: NaN, lvEf: NaN, lvIschemia: NaN, lowFlowMin: NaN, caseMin: NaN, ageY: NaN });
    for (const i of [base(), shockIn(), base({ map: 0, arrest: "arrest", lactate: 15, co: 0, spo2: 0, lowFlowMin: 600 }), base({ arrest: "dead", lactate: 30, lowFlowMin: 1e6, caseMin: 1e6 }), nan]) {
      const v = estimateLabs(i);
      for (const a of ANALYTES) expect(Number.isFinite(v[a]), a).toBe(true);
    }
    const n = estimateLabs(nan), b = estimateLabs(base({ co: NaN, lvEf: NaN }));
    for (const a of ANALYTES) expect(n[a], a).toBe(b[a]);
  });
  it("flag returns H, L and empty correctly at both bounds", () => {
    const { lo, hi } = REF.k;
    expect(flag("k", lo)).toBe(""); expect(flag("k", hi)).toBe("");
    expect(flag("k", lo - 0.01)).toBe("L"); expect(flag("k", hi + 0.01)).toBe("H");
  });
});

describe("validateCase labs", () => {
  const spec = (labs: Record<string, number>): CaseSpec => ({
    id: "toy-case", title: "Toy", tier: "easy", blurb: "b", card: { presents: "A patient.", pmh: "None." }, start: {},
    points: { survive: 40, stable: 20, harm: 20 }, limitS: 120, labs,
    checkpoints: [{ id: "e", atS: 5, outcome: { end: "success" } }],
  });
  it("rejects an unknown labs key with a sentence naming it and accepts a known one", () => {
    expect(validateCase(spec({ k: 6 }))).toEqual([]);
    const e = validateCase(spec({ potassium: 6 }));
    expect(e.length).toBe(1); expect(e[0]).toMatch(/potassium/); expect(e[0]).toMatch(/\.$/);
  });
});

describe("lab catalog items", () => {
  it("lists the brief's ids as lab items with the brief's delays", () => {
    const want: Record<string, number> = { bmp: 900, renal: 900, "mg-phos": 900, cbc: 900, lft: 1800, coags: 1200, troponin: 1200, bnp: 1200, tsh: 3600, abg: 300, ddimer: 1800, lipase: 1800, procalcitonin: 3600, lipids: 3600, a1c: 3600, ua: 900, tox: 1800 };
    for (const [id, d] of Object.entries(want)) { const it = itemById(id); expect(it?.group, id).toBe("lab"); expect(it?.delayS, id).toBe(d); }
  });
  it("every lab item returns text without NaN for three patients, and flags the shock patient's chemistry as text", () => {
    const pts = [now(), now({ ...shockIn() }), now({ map: 0, arrest: "arrest", co: 0, spo2: 0, lactate: 14 }), now({ map: NaN, lactate: NaN, spo2: NaN, co: NaN })];
    for (const it of labItems) for (const p of pts) expect(it.read!(p).text, it.id).not.toMatch(/NaN|Infinity/);
    const shock = now({ ...shockIn() });
    for (const id of ["bmp", "renal", "lft", "troponin", "bnp", "abg"]) expect(itemById(id)!.read!(shock).text, id).toMatch(/ [HL]($|\n)/m);
    expect(itemById("bmp")!.read!(now()).text).not.toMatch(/ [HL]($|\n)/m);
    expect(itemById("bmp")!.read!(shock).text.split("\n").length).toBe(8);
    expect(itemById("bmp")!.read!(shock).text).toMatch(/^Na \d+ mmol\/L/);
  });
  it("lab items are labeled estimate unless fully overridden", async () => {
    const { setCaseLabs } = await import("../src/sim/labs");
    expect(itemById("bmp")!.read!(now()).estimate).toBe(true);
    setCaseLabs({ na: 140, k: 4, cl: 100, hco3: 24, bun: 12, cr: 1, glu: 90, ca: 9.5 });
    expect(itemById("bmp")!.read!(now()).estimate).toBe(false);
    expect(itemById("renal")!.read!(now()).estimate).toBe(true);
    setCaseLabs(undefined);
    expect(itemById("bmp")!.read!(now()).estimate).toBe(true);
  });
});

describe("patient snapshot for labs", () => {
  const src = (o = {}) => ({ vitals: null, fallbackMap: 50, fallbackHr: 80, spo2: 0.95, lactate: 3, urineMlPerMin: 0.5, lvIschemia: 0.2, rvIschemia: 0, congestion: 0.1, arrest: "none" as const, rhythmLabel: "x", respRateBase: 15, ...o });
  it("low-flow minutes accumulate only while MAP is below 65 and reset", () => {
    resetLowFlow(); accrueLowFlow(60, 50); accrueLowFlow(60, 80); accrueLowFlow(30, 64);
    expect(lowFlow.min).toBeCloseTo(1.5);
    resetLowFlow(); expect(lowFlow.min).toBe(0);
  });
  it("buildPatientNow carries co, lvEf, lowFlowMin, caseMin and ageY with safe defaults", () => {
    const d = buildPatientNow(src());
    expect(d.ageY).toBe(65); expect(d.lowFlowMin).toBe(0); expect(d.caseMin).toBe(0);
    const n = buildPatientNow(src({ co: 3.2, lvEf: 0.4, lowFlowMin: 7, caseMin: 12, ageY: 50 }));
    expect([n.co, n.lvEf, n.lowFlowMin, n.caseMin, n.ageY]).toEqual([3.2, 0.4, 7, 12, 50]);
  });
});
