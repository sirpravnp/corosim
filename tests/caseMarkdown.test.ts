import { describe, it, expect } from "vitest";
import { caseToMarkdown, parseCaseMarkdown, parseDuration } from "../src/cases/markdown";
import type { CaseSpec } from "../src/cases/spec";

const full = (): CaseSpec => ({
  id: "full-case", title: "A full case", tier: "hard", blurb: "Everything at once.", complaint: "Cardiac arrest", devices: ["ECMO", "Impella"],
  card: { presents: "62-year-old man collapsed.", pmh: "Smoker.", info: ["ECG: ST elevation.", "Wife is a nurse."] },
  start: { lesions: [{ artery: "LAD", occluded: true, position: 0.1 }], seed: 3 },
  opening: { rhythm: "vf-coarse", cpr: true, drugs: [{ drug: "epinephrine", mg: 1 }] },
  points: { survive: 30, stable: 25, harm: 20 }, limitS: 900, skipHarms: ["diuretic"],
  monitor: ["hr", "bp", "ecg", "heart3d", "lactate"], tempC: 38.6, labs: { na: 128, k: 5.8, cr: 2.1 },
  musts: [{ flag: "pciOrdered", label: "activate the cath lab" }],
  stable: [{ num: "map", op: ">=", value: 60 }, { arrest: "arrest", not: true }],
  harms: [{ tag: "low map", label: "pressure under 50", when: [{ num: "map", op: "<", value: 50 }] }],
  checkpoints: [
    { id: "plan", atS: 5, forbids: ["pciOrdered"], repeatAfterS: 40, prompt: { text: "What is your plan?", options: [
      { label: "Cath lab now", points: 20, correct: true, why: "Time is muscle.", outcome: { flags: ["pciOrdered"], order: "pci", reveal: ["The lab is activated."] } },
      { label: "Wait for troponin", points: -15, correct: false, why: "A STEMI is a clinical diagnosis.", outcome: { reveal: ["An hour passes."], patch: { exertion: true } } },
      { label: "Oxygen only", points: 2, outcome: { cpr: true } },
    ] } },
    { id: "low", when: [{ num: "map", op: "<", value: 62 }, { rhythm: "perfusing", not: true }], forS: 20, branch: true, outcome: { reveal: ["Pressure is falling."], patch: { support: { norepinephrine: 0.3 } } } },
    { id: "shock", requires: ["pciOrdered"], atS: 30, outcome: { shock: { joules: 200, onSuccess: { reveal: ["Back in sinus."] }, onFail: { reveal: ["Still VF."] } }, cpr: false } },
    { id: "done", when: [{ is: "pci" }], outcome: { end: "success", reveal: ["Admitted."] } },
  ],
});

describe("case markdown", () => {
  it("round-trips a full case", () => {
    const md = caseToMarkdown(full());
    const r = parseCaseMarkdown(md);
    expect(r.errors).toEqual([]);
    expect(JSON.parse(JSON.stringify(r.spec))).toEqual(JSON.parse(JSON.stringify(full())));
  });

  it("reads durations", () => {
    expect(parseDuration("0:05")).toBe(5); expect(parseDuration("15:00")).toBe(900); expect(parseDuration("90s")).toBe(90);
    expect(parseDuration("1m30s")).toBe(90); expect(parseDuration("45")).toBe(45); expect(parseDuration("soon")).toBeUndefined();
  });

  it("reports unreadable lines with their numbers", () => {
    const md = caseToMarkdown(full()).replace("- at: 0:05", "- at: soon").replace("- flags: pciOrdered", "- flags pciOrdered");
    const r = parseCaseMarkdown(md);
    expect(r.spec).toBeUndefined();
    expect(r.errors.join("\n")).toMatch(/Line \d+: cannot read the time 'soon'/);
    expect(r.errors.join("\n")).toMatch(/Line \d+: cannot read 'flags pciOrdered'/);
  });

  it("opens a readable case that still has content problems, with the problems listed", () => {
    const md = caseToMarkdown(full()).replace("- requires: pciOrdered\n", "- requires: ghost\n");
    const r = parseCaseMarkdown(md);
    expect(r.errors).toEqual([]);
    expect(r.spec?.id).toBe("full-case");
    expect(r.warnings.join()).toMatch(/ghost/);
  });

  it("asks for what is missing", () => {
    const r = parseCaseMarkdown("- id: x\n");
    expect(r.errors.join("\n")).toMatch(/title/); expect(r.errors.join("\n")).toMatch(/Card/); expect(r.errors.join("\n")).toMatch(/Time points/);
  });

  it("writes and reads the monitor, the body temperature and the lab values", () => {
    const md = caseToMarkdown(full());
    expect(md).toMatch(/- monitor: hr, bp, ecg, heart3d, lactate/);
    expect(md).toMatch(/- temperature: 38\.6/);
    expect(md).toMatch(/## Lab values/);
    const r = parseCaseMarkdown(md);
    expect(r.spec?.monitor).toEqual(["hr", "bp", "ecg", "heart3d", "lactate"]);
    expect(r.spec?.tempC).toBe(38.6);
    expect(r.spec?.labs).toEqual({ na: 128, k: 5.8, cr: 2.1 });
  });
  it("reports an unreadable lab value or temperature with its line number", () => {
    const md = caseToMarkdown(full()).replace("- temperature: 38.6", "- temperature: warm").replace("- na: 128", "- na: low");
    expect(parseCaseMarkdown(md).errors.join("\n")).toMatch(/Line \d+: .*temperature[\s\S]*Line \d+: .*'na'/);
  });
});
