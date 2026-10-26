import { describe, it, expect } from "vitest";
import { decodePatient, decodeScenario, encodePatient, encodeScenario, SCENARIO_REFERENCE } from "../src/sim/llm";
import { DEFAULT_IABP, DEFAULT_IMPELLA, effectiveDevices, normalizePatient, PatientSpec } from "../src/sim/patient";
import { Scenario } from "../src/sim/scenario";
import { LESIONS, parseLesionHash, patientFromLesionHash } from "../src/sim/structural";

/** Realistic scenarios as the app, the MCP link tool and LLMs have produced them. */
const OLD: Scenario[] = [
  {},
  { lesions: [{ artery: "LAD", occluded: true, position: 0.2 }], seed: 7 },
  { anatomy: { dominance: "left", lm: "trifurcation" }, lesions: [{ artery: "RCA", stenosis: 0.9 }, { artery: "circumflex", stenosis: 0.6, position: 0.5 }], exertion: true, drugs: { betaBlocker: 0.5 }, seed: 42 },
  { bloodLoss: 0.3, patient: { rhythm: "af", bbb: "lbbb" }, support: { fluids: 1.5, norepinephrine: 0.4, pacing: true, paceRate: 80, iabp: true }, autonomic: { baroreflexGain: 0, noise: 0 } },
  { lesions: [{ artery: "LAD", stenosis: 0.95 }], support: { impella: true, dobutamine: 0.3 }, autonomic: { respRate: 12, respDepth: 1.2, setPointShift: 20 }, drugs: { vasopressor: -0.5, atropine: 1 } },
];

describe("encodePatient / decodePatient", () => {
  it("round-trips a full PatientSpec", () => {
    const p: PatientSpec = {
      lesions: [{ artery: "LAD", stenosis: 0.8 }], seed: 3, kind: "neonate",
      heart: { vsd: { diameterMm: 5 }, pvri: 2, valves: { mv: { reg: 0.3 } } },
      pericardium: { effusionMl: 300, effusionRateMlMin: 5, stiffness: 1.5 },
      fluids: { given: [{ kind: "blood", ml: 500, atMin: 10, overMin: 20 }], capillaryLeak: 0.2 },
      ventilation: { mode: "positive", peep: 8 },
      devices: { impella: { model: "CP", level: 4 }, iabp: { ratio: 2, volumeMl: 30 }, ecmo: { flowLpm: 4, fio2: 0.6 } },
    };
    const code = encodePatient(p);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodePatient(code)).toEqual(p);
  });
  it("old #s= scenarios decode to exactly the same object through the old and the new functions, with the same bytes", () => {
    for (const s of OLD) {
      const code = encodeScenario(s);
      expect(encodePatient(s)).toBe(code);
      expect(decodePatient(code)).toEqual(s);
      expect(decodeScenario(code)).toEqual(s);
      expect(decodePatient(code)).toEqual(decodeScenario(code));
    }
  });
  it("decodes a link written by hand (padding stripped, URL-safe alphabet)", () => {
    const code = Buffer.from(JSON.stringify(OLD[2]), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodePatient(code)).toEqual(OLD[2]);
  });
  it("the LLM reference mentions every new field", () => {
    for (const k of ["kind", "heart", "pericardium", "fluids", "ventilation", "devices", "effusionMl", "peep", "ecmo"]) expect(SCENARIO_REFERENCE).toContain(`"${k}"`);
  });
});

describe("normalizePatient", () => {
  it("a plain Scenario passes through with normalizeScenario's warnings", () => {
    const r = normalizePatient({ bloodLoss: 0.9, lesions: [{ artery: "nonsense" }] });
    expect(r.spec.kind).toBeUndefined();
    expect(r.warnings.length).toBeGreaterThanOrEqual(2);
    expect(r.scenario.bloodLoss).toBe(0.6);
  });
  it("accepts in-range values unchanged, with no warnings", () => {
    const p: PatientSpec = { kind: "adult", pericardium: { effusionMl: 500, open: false }, fluids: { given: [{ kind: "crystalloid", ml: 1000 }], legRaise: true }, ventilation: { mode: "positive", peep: 10, tidalMlKg: 6 }, devices: { impella: { model: "5.5", level: 9, position: "deep" }, ecmo: { flowLpm: 7, fio2: 1 } }, heart: { asd: { diameterMm: 12 } } };
    const r = normalizePatient(p);
    expect(r.warnings).toEqual([]);
    expect(r.spec).toEqual(p);
  });
  it("clamps out-of-range numbers and says so", () => {
    const r = normalizePatient({ pericardium: { effusionMl: 5000 }, ventilation: { peep: 40 }, devices: { impella: { level: 12 }, ecmo: { flowLpm: -1, fio2: 0.1 } }, fluids: { given: [{ kind: "blood", ml: 9000 }], capillaryLeak: 2 } });
    expect(r.spec.pericardium?.effusionMl).toBe(2000);
    expect(r.spec.ventilation?.peep).toBe(25);
    expect(r.spec.devices?.impella?.level).toBe(9);
    expect(r.spec.devices?.ecmo).toEqual({ flowLpm: 0, fio2: 0.21 });
    expect(r.spec.fluids?.given?.[0].ml).toBe(5000);
    expect(r.spec.fluids?.capillaryLeak).toBe(1);
    expect(r.warnings.filter((w) => /clamped/.test(w))).toHaveLength(7);
  });
  it("drops invalid values with a warning and never throws", () => {
    const bad = { kind: "child", pericardium: { effusionMl: NaN, stiffness: "2" }, fluids: { given: [{ kind: "wine", ml: 100 }, { kind: "blood" }, 5], hemorrhageMlMin: Infinity }, ventilation: { mode: "cpap", peep: null }, devices: { iabp: { ratio: 4 }, impella: "on" }, heart: 3 } as unknown as PatientSpec;
    const r = normalizePatient(bad);
    expect(r.spec.kind).toBeUndefined();
    expect(r.spec.pericardium).toBeUndefined();
    expect(r.spec.fluids).toBeUndefined();
    expect(r.spec.ventilation).toBeUndefined();
    expect(r.spec.heart).toBeUndefined();
    expect(r.spec.devices).toEqual({ iabp: {} });
    expect(r.warnings.length).toBeGreaterThanOrEqual(10);
    for (const junk of [null, 5, "x", []] as unknown[]) expect(() => normalizePatient({ pericardium: junk, devices: junk, fluids: junk, ventilation: junk, heart: junk } as PatientSpec)).not.toThrow();
  });
  it("uses the structural engine's clamping for the heart and strips patient and hr", () => {
    const r = normalizePatient({ heart: { pvri: 500, vsd: { diameterMm: 90 }, valves: { av: { open: 3 } }, patient: "neonate", hr: 150, bogus: 1 } as never });
    expect(r.spec.heart).toEqual({ pvri: 60, vsd: { diameterMm: 40 }, valves: { av: { open: 1 } } });
    expect(r.warnings.some((w) => w.includes("heart.pvri clamped to 60"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("heart.bogus"))).toBe(true);
  });
  it("does not change its input", () => {
    const p: PatientSpec = { ventilation: { peep: 99 } };
    normalizePatient(p);
    expect(p.ventilation?.peep).toBe(99);
  });
});

describe("effectiveDevices", () => {
  it("maps the legacy booleans to the documented defaults", () => {
    expect(DEFAULT_IABP).toEqual({ ratio: 1, inflateMs: 0, deflateMs: 0, volumeMl: 40 });
    expect(DEFAULT_IMPELLA).toEqual({ model: "CP", level: 6, position: "correct" });
    expect(effectiveDevices({ support: { iabp: true, impella: true } })).toEqual({ iabp: DEFAULT_IABP, impella: DEFAULT_IMPELLA });
    expect(effectiveDevices({ support: { iabp: true } })).toEqual({ iabp: DEFAULT_IABP });
    expect(effectiveDevices({ support: { iabp: false, impella: false } })).toEqual({});
    expect(effectiveDevices({})).toEqual({});
  });
  it("explicit devices win over the booleans, and other devices are kept", () => {
    const d = effectiveDevices({ support: { iabp: true, impella: true }, devices: { impella: { model: "5.5", level: 8 }, ecmo: { flowLpm: 3 } } });
    expect(d.impella).toEqual({ model: "5.5", level: 8 });
    expect(d.iabp).toEqual(DEFAULT_IABP);
    expect(d.ecmo).toEqual({ flowLpm: 3 });
  });
  it("does not mutate the spec or share the default objects", () => {
    const spec: PatientSpec = { support: { iabp: true } };
    const d = effectiveDevices(spec);
    expect(spec.devices).toBeUndefined();
    d.iabp!.volumeMl = 1;
    expect(DEFAULT_IABP.volumeMl).toBe(40);
  });
});

describe("patientFromLesionHash", () => {
  it("an adult valve lesion: kind adult, heart from the lesion", () => {
    expect(patientFromLesionHash("#lesion=as&severity=0.5")).toEqual({ kind: "adult", heart: { valves: { av: { open: 1 - 0.85 * 0.5 } } } });
  });
  it("a neonate lesion: kind neonate, patient and hr left out, defaults filled in", () => {
    const p = patientFromLesionHash("#lesion=vsd&diameter=7");
    expect(p.kind).toBe("neonate");
    expect(p.heart).toEqual({ pvri: 2, vsd: { diameterMm: 7 } });
  });
  it("tetralogy with a spell", () => {
    const p = patientFromLesionHash("#lesion=tof&spasm=0.8");
    expect(p.kind).toBe("neonate");
    expect(p.heart?.tof).toMatchObject({ spasm: 0.8, vsdMm: 8 });
    expect(p.heart?.svrScale).toBe(1);
  });
  it("normal and unknown hashes give a normal adult heart; every lesion yields a valid, warning-free spec", () => {
    expect(patientFromLesionHash("#lesion=normal")).toEqual({ kind: "adult", heart: {} });
    expect(patientFromLesionHash("#lesion=constructor")).toEqual({ kind: "adult", heart: {} });
    for (const l of LESIONS) {
      const p = patientFromLesionHash(`#lesion=${l.id}`);
      expect(p.kind).toBe(l.patient);
      expect(normalizePatient(p).warnings).toEqual([]);
      expect(parseLesionHash(`#lesion=${l.id}`).id).toBe(l.id);
      expect(decodePatient(encodePatient(p))).toEqual(JSON.parse(JSON.stringify(p)));
    }
  });
});
