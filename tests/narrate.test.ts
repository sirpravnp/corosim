import { describe, it, expect } from "vitest";
import { FIELDS } from "../src/sim/registry";
import { describeSpec, diffSpecs, features, narrateCase, narrateChange, narrateNewPatient, narrateRun, narrateTreat, narrateValve, valveWords, vitalsChange, vitalsNow, type Vitals } from "../src/sim/narrate";
import type { PatientSpec } from "../src/sim/patient";
import { valveSet } from "../src/sim/valves";

/** Narration (D2) of patient specs and monitor readings: pure functions, no simulation. The tools that use them are in tests/mcpNarrative.test.ts. */
const vit = (o: Partial<Vitals> = {}): Vitals => ({ rhythm: "sinus rhythm", hr: 72, sbp: 120, dbp: 72, map: 88, circulation: "stable", infarct: 0, ischemicMass: 0, ef: 0.6, noOutput: false, treated: [], ...o });
const lad: PatientSpec = { lesions: [{ artery: "LAD", occluded: true, position: 0.1 }] };

describe("the patient in words", () => {
  it("a typical adult has nothing to report", () => {
    expect(describeSpec({})).toBe("with no abnormality set (a typical resting adult)");
    expect(narrateCase({}, vit())).toBe("A patient with no abnormality set (a typical resting adult), now in sinus rhythm at 72/min, BP 120/72 (MAP 88).");
  });
  it("coronary lesions: occlusion or stenosis, by position along the artery", () => {
    expect(describeSpec(lad)).toBe("with a proximal LAD occlusion");
    expect(describeSpec({ lesions: [{ artery: "RCA", stenosis: 0.8, position: 0.5 }, { artery: "OM1", stenosis: 0.7, position: 0.9 }] })).toBe("with an 80% mid RCA stenosis and a 70% distal OM1 stenosis");
    expect(describeSpec({ anatomy: { dominance: "left" }, lesions: [{ artery: "LM", stenosis: 0.6, position: 0.1 }] })).toBe("with a 60% proximal LM stenosis and a left-dominant coronary circulation");
  });
  it("the case reads like the website: lesion, VT, pressure, ischemia", () => {
    const v = vit({ rhythm: "monomorphic ventricular tachycardia", hr: 168, sbp: 84, dbp: 52, map: 62, circulation: "hypotension", ischemicMass: 0.43, infarct: 0.12, ef: 0.29, rhythmWhy: "a premature beat on the vulnerable phase of acutely ischemic myocardium started it" });
    expect(narrateCase(lad, v)).toBe("A patient with a proximal LAD occlusion, now in monomorphic ventricular tachycardia at 168/min (a premature beat on the vulnerable phase of acutely ischemic myocardium started it), BP 84/52 (MAP 62), hypotensive; about 43% of the myocardium ischemic, 12% of the left ventricle infarcted, EF 29%.");
  });
  it("VF has no output and no pressure to report", () => {
    expect(vitalsNow(vit({ rhythm: "ventricular fibrillation (coarse)", noOutput: true, hr: 0, sbp: 0, dbp: 0, map: 0, circulation: "shock", ef: 0 }))).toBe("now in ventricular fibrillation (coarse), with no cardiac output (an arrest rhythm)");
  });
  it("valve lesions are graded from the opening and the regurgitant orifice; a prosthesis gives size, kind and faults", () => {
    expect(describeSpec({ heart: { valves: valveSet({ av: { stenosis: 0.9 }, mv: { regurgitation: 0.5 } }) } })).toBe("with severe aortic stenosis and moderate mitral regurgitation");
    expect(valveWords("mv", { prosthesis: { kind: "mechanical", sizeMm: 29, obstruction: 0.4 } })).toBe("a 29 mm mechanical mitral valve with 40% of the orifice obstructed");
    expect(valveWords("av", { prosthesis: { kind: "transcatheter", sizeMm: 26, inRing: true, leak: 0.3 } })).toBe("a 26 mm valve-in-valve transcatheter aortic valve with a paravalvular leak of 0.3 cm²");
    expect(valveWords("tv", { open: 1, reg: 0 })).toBeNull();
  });
  it("support devices, pericardium, bleeding and electrolytes", () => {
    const spec: PatientSpec = {
      bloodLoss: 0.25, electrolytes: { potassium: 6.4, magnesium: 0.5 }, pericardium: { effusionMl: 400, effusionRateMlMin: 20 },
      support: { norepinephrine: 0.4, pacing: true, paceRate: 80 }, devices: { impella: { model: "CP", level: 6 }, ecmo: { flowLpm: 3.5 } }, ventilation: { mode: "positive", peep: 8 },
    };
    expect(describeSpec(spec)).toBe("with 25% blood loss (ATLS class II), hyperkalemia (K 6.4 mmol/l), hypomagnesemia (Mg 0.5 mmol/l), norepinephrine (40% of a full dose), pacing at 80/min, an Impella CP at P6, ECMO at 3.5 l/min, positive-pressure ventilation (PEEP 8) and a 400 ml pericardial effusion filling at 20 ml/min");
  });
  it("a library rhythm as the baseline", () => {
    expect(describeSpec({ patient: { rhythm: "vt-mono" } })).toBe("with a baseline rhythm of monomorphic ventricular tachycardia");
    expect(describeSpec({ patient: { rhythm: "nsr", bbb: "lbbb" } })).toBe("with left bundle branch block");
  });
});

describe("what changed between two patients", () => {
  it("a new finding says what it is and why it matters", () => {
    expect(diffSpecs({}, { bloodLoss: 0.15 })).toEqual(["15% blood loss (ATLS class II): less preload, so the stroke volume falls and the baroreflex speeds the heart"]);
    expect(diffSpecs({}, lad)).toEqual(["a proximal LAD occlusion: the muscle downstream loses its blood supply and becomes ischemic"]);
  });
  it("a finding that changes is shown with what it was; one that goes is said to have gone", () => {
    expect(diffSpecs({ bloodLoss: 0.15 }, { bloodLoss: 0.3 })).toEqual(["30% blood loss (ATLS class III) (was 15% blood loss (ATLS class II))"]);
    expect(diffSpecs({ support: { norepinephrine: 0.4 } }, { support: { norepinephrine: 0 } })).toEqual(["norepinephrine (40% of a full dose) stopped"]);
    expect(diffSpecs(lad, {})).toEqual(["a proximal LAD occlusion is gone"]);
    expect(diffSpecs({ lesions: [{ artery: "LAD", stenosis: 0.7 }] }, lad)).toEqual(["a proximal LAD occlusion (was a 70% proximal LAD stenosis)"]);
  });
  it("a valve procedure shows as the valve before and after", () => {
    const before: PatientSpec = { heart: { valves: valveSet({ av: { stenosis: 0.9 } }) } };
    const after: PatientSpec = { heart: { valves: { av: { open: 1, reg: 0, prosthesis: { kind: "transcatheter", sizeMm: 26 } } } } };
    expect(diffSpecs(before, after)).toEqual(["a 26 mm transcatheter aortic valve (was severe aortic stenosis)"]);
  });
  it("no change gives no phrase; a field no clinical phrase covers is narrated from its path", () => {
    expect(diffSpecs(lad, lad)).toEqual([]);
    expect(diffSpecs({}, { ectopyTendency: 3 })).toEqual(["ectopyTendency default -> 3"]);
    expect(diffSpecs({ autonomic: { baroreflexGain: 1 } }, { autonomic: { baroreflexGain: 0 } })).toEqual(["autonomic.baroreflexGain 1 -> 0"]);
  });
  it("pericardiocentesis reads as the effusion getting smaller", () => {
    expect(diffSpecs({ pericardium: { effusionMl: 400 } }, { pericardium: { effusionMl: 300 } })).toEqual(["a 300 ml pericardial effusion (was a 400 ml pericardial effusion)"]);
  });
});

describe("the sentences the tools return", () => {
  const a = vit({ rhythm: "monomorphic ventricular tachycardia", hr: 168, sbp: 84, dbp: 52, map: 62, circulation: "hypotension" });
  it("vitals change: rhythm, rate, pressure and the infarct, only when they moved", () => {
    expect(vitalsChange(vit(), a)).toBe("was sinus rhythm, HR 72 -> 168, MAP 88 -> 62");
    expect(vitalsChange(vit(), vit({ hr: 74, map: 86 }))).toBe("");
    expect(vitalsChange(vit({ infarct: 0.1 }), vit({ infarct: 0.2 }))).toBe("infarct 10% -> 20% of the left ventricle");
    expect(vitalsChange(vit(), vit({ rhythm: "ventricular fibrillation", noOutput: true }))).toBe("was sinus rhythm, the output stopped");
  });
  it("adjust: what was changed and why, then where the patient is", () => {
    expect(narrateChange({}, { bloodLoss: 0.15 }, vit(), vit({ hr: 96, sbp: 104, dbp: 70, map: 80 }), 60)).toBe(
      "15% blood loss (ATLS class II): less preload, so the stroke volume falls and the baroreflex speeds the heart. After 60 s: in sinus rhythm at 96/min, BP 104/70 (MAP 80) (HR 72 -> 96, MAP 88 -> 80).");
    expect(narrateChange(lad, lad, vit(), vit(), 0)).toBe("Nothing in the patient changed. Now: in sinus rhythm at 72/min, BP 120/72 (MAP 88).");
  });
  it("a new patient, a run, a revascularization and a valve procedure", () => {
    expect(narrateNewPatient(lad, vit({ hr: 104, sbp: 97, dbp: 76, map: 85, ischemicMass: 0.43, ef: 0.29 }), 20)).toBe("New patient with a proximal LAD occlusion (settled for 20 s): now in sinus rhythm at 104/min, BP 97/76 (MAP 85); about 43% of the myocardium ischemic, EF 29%.");
    expect(narrateRun(vit(), a, 30)).toBe("Ran 30 s: in monomorphic ventricular tachycardia at 168/min, BP 84/52 (MAP 62), hypotensive (was sinus rhythm, HR 72 -> 168, MAP 88 -> 62).");
    expect(narrateRun(vit(), vit(), 10)).toBe("Ran 10 s: in sinus rhythm at 72/min, BP 120/72 (MAP 88) (little changed).");
    expect(narrateTreat({ procedure: "Primary PCI", delayMinutes: 60, result: "Stent placed in the LAD; flow restored.", lvInfarctBefore: 0.1, lvInfarctAtArrival: 0.25 }, vit({ infarct: 0.25 }), vit({ infarct: 0.25, map: 90 }))).toBe(
      "Primary PCI: Stent placed in the LAD; flow restored; the infarct grew from 10% to 25% of the left ventricle during the 60-minute wait. Now: in sinus rhythm at 72/min, BP 120/72 (MAP 90); 25% of the left ventricle infarcted, EF 60%.");
    expect(narrateValve(true, ["aortic valve replaced by a 26 mm transcatheter valve"], [], vit(), vit({ map: 100 }))).toBe("Aortic valve replaced by a 26 mm transcatheter valve. Now: in sinus rhythm at 72/min, BP 120/72 (MAP 100) (MAP 88 -> 100).");
    expect(narrateValve(false, [], ["the mitral valve does not leak: nothing to clip"], vit(), vit())).toBe("No valve was changed: the mitral valve does not leak: nothing to clip. The patient is now in sinus rhythm at 72/min, BP 120/72 (MAP 88).");
  });
  it("is deterministic: the same input gives the same words", () => {
    expect(narrateCase(lad, a)).toBe(narrateCase(JSON.parse(JSON.stringify(lad)), { ...a }));
  });
});

/** A value for a registry field's schema that differs from the default. */
function sample(schema: any): unknown {
  if (schema.enum) return schema.enum[schema.enum.length - 1];
  switch (schema.type) {
    case "number": return schema.maximum;
    case "integer": return 7;
    case "boolean": return true;
    case "string": return "LAD";
    case "array": return [sample(schema.items)];
    case "object": return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, v]) => [k, sample(v)]));
    default: throw new Error(`no sample for ${JSON.stringify(schema)}`);
  }
}
const setPath = (o: Record<string, any>, path: string, v: unknown) => { const p = path.split("."); let c = o; for (const k of p.slice(0, -1)) c = c[k] ??= {}; c[p[p.length - 1]] = v; return o; };

describe("every field of the spec registry is narrated", () => {
  const fields = FIELDS.filter((f) => f.target === "patient" && f.path !== "seed"); // the seed is not a clinical finding
  it.each(fields.map((f) => [f.path, f] as const))("%s", (_p, f) => {
    const spec = setPath({}, f.path, sample(f.schema)) as PatientSpec;
    const d = diffSpecs({}, spec);
    expect(d.length, `no phrase for ${f.path}`).toBeGreaterThan(0);
    expect(d.every((x) => x.length > 3 && !/undefined|\[object/.test(x)), d.join(" | ")).toBe(true);
    expect(features(spec).size + d.length).toBeGreaterThan(0);
  });
});
