import { describe, it, expect } from "vitest";
import { CaseRunner, Probe } from "../src/cases/engine";
import { CaseSpec, compileCase, compileCond, condText, parseCond, parseConds, validateCase } from "../src/cases/spec";

const P = (o: Partial<Probe> = {}): Probe => ({ map: 70, hr: 80, arrest: "none", rhythmClass: "perfusing", shocks: 0, epiDoses: 0, amioMg: 0, lidoDoses: 0, cpr: false, ecmo: false, impella: false, iabp: false, pci: false, pciPending: false, drugs: {}, ef: 0.6, lvIschemia: 0, rvIschemia: 0, congestion: 0, fluidsL: 0, dead: false, ...o });

const spec = (): CaseSpec => ({
  id: "toy-case", title: "Toy", tier: "easy", blurb: "b", complaint: "Chest pain", devices: ["IABP"],
  card: { presents: "A patient.", pmh: "None." }, start: {}, points: { survive: 40, stable: 20, harm: 20 }, limitS: 120,
  musts: [{ flag: "a", label: "do a" }],
  checkpoints: [
    { id: "q1", atS: 5, prompt: { text: "Q1", options: [{ label: "right", points: 10, correct: true, outcome: { flags: ["a"] } }, { label: "wrong", points: -5, correct: false }] } },
    { id: "low", when: [{ num: "map", op: "<", value: 60 }], forS: 3, outcome: { reveal: ["pressure fell"] } },
    { id: "end", requires: ["a"], when: [{ is: "pci" }], outcome: { end: "success" } },
  ],
});

describe("case spec", () => {
  it("round-trips through JSON and runs in the engine", () => {
    const def = compileCase(JSON.parse(JSON.stringify(spec())));
    const r = new CaseRunner(def);
    for (let i = 0; i < 5; i++) r.tick(P(), 1);
    expect(r.open?.id).toBe("q1");
    r.answer(0);
    for (let i = 0; i < 4; i++) r.tick(P({ map: 50 }), 1);
    expect(r.log.some((l) => l.text === "pressure fell")).toBe(true);
    r.tick(P({ pci: true }), 1);
    expect(r.result).toBe("success");
  });

  it("evaluates each kind of condition", () => {
    const t = (c: string, p: Partial<Probe>) => compileCond(parseCond(c) as never)(P(p));
    expect(t("map < 60", { map: 50 })).toBe(true);
    expect(t("map >= 60", { map: 50 })).toBe(false);
    expect(t("not pci", {})).toBe(true);
    expect(t("rhythm = vf", { rhythmClass: "vf" })).toBe(true);
    expect(t("rhythm != perfusing", {})).toBe(false);
    expect(t("arrest = rosc", { arrest: "rosc" })).toBe(true);
    expect(t("drug betaBlocker > 0.1", { drugs: { betaBlocker: 0.5 } })).toBe(true);
    expect(t("rhythm = vf or map < 40", { map: 30 })).toBe(true);
  });

  it("writes and reads conditions as text", () => {
    for (const c of ["map < 62", "pci", "not ecmo", "rhythm = pea", "arrest != none", "drug nitroglycerin >= 0.2", "hr > 120 or map < 50"]) expect(condText(parseCond(c) as never)).toBe(c);
    expect(typeof parseCond("bp < 3")).toBe("string");
    expect(parseConds("map < 60; banana").errors).toHaveLength(1);
  });

  it("accepts a good spec", () => { expect(validateCase(spec())).toEqual([]); });

  it("names what is wrong", () => {
    const s = spec(); s.id = "Bad Id"; s.checkpoints[0].prompt!.options = [{ label: "only", points: 1 }]; s.checkpoints.push({ id: "q1", atS: 1, outcome: {} }, { id: "n", atS: 3, requires: ["ghost"], outcome: { reveal: ["x"] } });
    const e = validateCase(s).join("\n");
    expect(e).toMatch(/id must be/); expect(e).toMatch(/at least two options/); expect(e).toMatch(/appears twice/); expect(e).toMatch(/ghost/);
  });

  it("flags a patient the simulator would clamp", () => {
    const s = spec(); s.start = { bloodLoss: 5 } as never;
    expect(validateCase(s).join()).toMatch(/Starting patient/);
  });
});
