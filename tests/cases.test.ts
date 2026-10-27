import { describe, it, expect } from "vitest";
import { CaseRunner, Probe, CaseDef } from "../src/cases/engine";
import { CASES, caseById } from "../src/cases";
import { ECPELLA } from "../src/cases/ecpella";
import { Simulation } from "../src/sim/simulation";

const P = (o: Partial<Probe> = {}): Probe => ({ map: 70, hr: 80, arrest: "none", rhythmClass: "perfusing", shocks: 0, epiDoses: 0, amioMg: 0, lidoDoses: 0, cpr: false, ecmo: false, impella: false, iabp: false, pci: false, pciPending: false, dead: false, ...o });
const run = (r: CaseRunner, p: Probe, s: number) => { for (let i = 0; i < s; i++) r.tick(p, 1); };

const toy: CaseDef = {
  id: "toy", title: "Toy", tier: "easy", blurb: "", card: { presents: "", pmh: "" }, start: {},
  points: { survive: 40, stable: 20, harm: 20 }, limitS: 100,
  musts: [{ flag: "a", label: "do a" }],
  harms: [{ tag: "low", label: "pressure low", when: (p) => p.map < 50 }],
  checkpoints: [
    { id: "q1", atS: 5, prompt: { text: "Q1", options: [
      { label: "right", points: 10, correct: true, why: "because", outcome: { flags: ["a"], reveal: ["news"] } },
      { label: "wrong", points: -5, correct: false, why: "no", outcome: { patch: { exertion: true } } },
    ] } },
    { id: "gate", requires: ["a"], when: (p) => p.map >= 65, forS: 3, prompt: { text: "Q2", options: [{ label: "finish", points: 10, outcome: { end: "success" } }] } },
    { id: "ev", when: (p) => p.hr > 100, repeatAfterS: 10, outcome: { reveal: ["fast"] } },
  ],
};

describe("case runner", () => {
  it("holds a checkpoint until its time, then opens its prompt and pauses", () => {
    const r = new CaseRunner(toy);
    run(r, P(), 4); expect(r.open).toBeNull();
    const t = r.tick(P(), 1);
    expect(t.opened?.id).toBe("q1"); expect(r.paused).toBe(true);
    const before = r.t; r.tick(P(), 5); expect(r.t).toBe(before); // paused: the clock holds
  });
  it("applies the answer's outcome: flags, reveals and patches come back for the page", () => {
    const r = new CaseRunner(toy); run(r, P(), 5);
    const t = r.answer(0);
    expect(t.reveals).toEqual(["news"]); expect(r.flags.has("a")).toBe(true); expect(r.log[0].text).toBe("news");
    const w = new CaseRunner(toy); run(w, P(), 5);
    expect(w.answer(1).patches).toEqual([{ exertion: true }]);
  });
  it("gates a later checkpoint on a flag and on a condition held long enough", () => {
    const r = new CaseRunner(toy); run(r, P({ map: 70 }), 5); r.answer(1); // wrong answer: no flag
    run(r, P({ map: 70 }), 20); expect(r.open).toBeNull();
    const g = new CaseRunner(toy); run(g, P({ map: 70 }), 5); g.answer(0);
    run(g, P({ map: 60 }), 10); expect(g.open).toBeNull(); // flag set but pressure too low
    run(g, P({ map: 70 }), 2); expect(g.open).toBeNull(); // not yet 3 s
    expect(g.tick(P({ map: 70 }), 1).opened?.id).toBe("gate");
    expect(g.answer(0).over).toBe("success"); expect(g.over).toBe(true);
  });
  it("a sustain counter resets when the condition drops", () => {
    const r = new CaseRunner(toy); run(r, P(), 5); r.answer(0);
    run(r, P({ map: 70 }), 2); run(r, P({ map: 50 }), 1); run(r, P({ map: 70 }), 2);
    expect(r.open).toBeNull();
  });
  it("an event without a prompt plays at once and may repeat after its cooldown", () => {
    const ev: CaseDef = { ...toy, checkpoints: [toy.checkpoints[2]] };
    const r = new CaseRunner(ev);
    expect(r.tick(P({ hr: 120 }), 1).reveals).toEqual(["fast"]); // t = 1
    run(r, P({ hr: 120 }), 8); // t = 9
    expect(r.tick(P({ hr: 120 }), 1).reveals).toEqual([]); // t = 10: nine seconds since it fired
    expect(r.tick(P({ hr: 120 }), 1).reveals).toEqual(["fast"]);
  });
  it("death and the time limit end the case", () => {
    const d = new CaseRunner(toy); expect(d.tick(P({ dead: true }), 1).over).toBe("died");
    const t = new CaseRunner(toy); run(t, P(), 5); t.answer(1); run(t, P(), 120); expect(t.result).toBe("timeout");
  });
  it("scores survival, stability, choices and harm, and the debrief says what was missed", () => {
    const ok = new CaseRunner(toy); run(ok, P(), 5); ok.answer(0); run(ok, P({ map: 70 }), 3); ok.answer(0);
    const d = ok.debrief();
    expect(d.result).toBe("success"); expect(d.score).toBeGreaterThan(70); expect(d.score).toBeLessThanOrEqual(d.max);
    expect(d.lines.join(" ")).toContain("because"); expect(d.lines.join(" ")).not.toContain("Not done");
    const bad = new CaseRunner(toy); run(bad, P({ map: 40 }), 5); bad.answer(1); run(bad, P({ map: 40 }), 100);
    const b = bad.debrief();
    expect(b.score).toBeLessThan(d.score); expect(b.lines.join(" ")).toContain("Not done: do a"); expect(b.lines.join(" ")).toContain("pressure low");
  });
});

describe("the cases", () => {
  it("are registered with a card, and every prompt has options that name a teaching point", () => {
    expect(caseById("ecpella")).toBe(ECPELLA);
    for (const c of CASES) {
      expect(c.card.presents.length).toBeGreaterThan(20);
      const ids = c.checkpoints.map((x) => x.id); expect(new Set(ids).size).toBe(ids.length);
      for (const cp of c.checkpoints) for (const o of cp.prompt?.options ?? []) { expect(o.correct === undefined || typeof o.why === "string").toBe(true); }
      const flags = new Set(c.checkpoints.flatMap((x) => (x.prompt?.options.flatMap((o) => o.outcome?.flags ?? []) ?? []).concat(x.outcome?.flags ?? [])));
      for (const cp of c.checkpoints) for (const f of [...(cp.requires ?? []), ...(cp.forbids ?? [])]) expect(flags.has(f)).toBe(true);
      for (const m of c.musts ?? []) expect(flags.has(m.flag)).toBe(true);
    }
  });
  it("ECPELLA: the right path wins, and ECMO alone branches to a venting prompt", () => {
    const full = ECPELLA.checkpoints.find((c) => c.id === "device")!.prompt!.options[1].outcome!.patch!;
    expect(full.devices?.ecmo?.flowLpm).toBeGreaterThan(0); expect(full.devices?.impella?.level).toBeGreaterThan(0); // both devices in one patch
    const r = new CaseRunner(ECPELLA);
    let t = r.tick(P({ arrest: "arrest", rhythmClass: "vf" }), 1); expect(t.opened?.id).toBe("arrival");
    r.answer(1);
    t = r.tick(P({ arrest: "arrest", rhythmClass: "vf" }), 1); expect(t.opened?.id).toBe("device");
    expect(r.answer(0).patches[0]).toHaveProperty("devices.ecmo"); // ECMO alone
    run(r, P({ arrest: "arrest", ecmo: true }), 44); expect(r.open).toBeNull();
    expect(r.tick(P({ arrest: "arrest", ecmo: true }), 1).opened?.id).toBe("distension");
    expect(r.answer(0).patches[0]).toHaveProperty("devices.impella");
    const a = r.tick(P({ arrest: "arrest", ecmo: true, impella: true }), 1); expect(a.opened).toBeNull();
    run(r, P({ arrest: "arrest", ecmo: true, impella: true }), 19);
    expect(r.open?.id).toBe("artery");
    expect(r.answer(0).orders).toEqual(["pci"]);
    // the storm: transient ROSC before the artery opens sends the patient back to VF
    const storm = Array.from({ length: 13 }, () => r.tick(P({ arrest: "rosc", ecmo: true, impella: true }), 1)).flatMap((x) => x.patches);
    expect(storm.some((p) => p.patient?.rhythm === "vf-coarse")).toBe(true);
    const done = r.tick(P({ pci: true, ecmo: true, impella: true }), 1);
    expect(done.patches.some((p) => p.patient?.rhythm === "sinus")).toBe(true);
    expect(done.opened?.id).toBe("after");
    expect(r.answer(1).over).toBe("success");
    const d = r.debrief(); expect(d.result).toBe("success"); expect(d.lines.join(" ")).toContain("Impella");
  });
  it("ECPELLA: ACLS-only answers repeat the arrival prompt instead of ending the case", () => {
    const r = new CaseRunner(ECPELLA); r.tick(P({ arrest: "arrest" }), 1); r.answer(0);
    run(r, P({ arrest: "arrest" }), 149); expect(r.open).toBeNull();
    expect(r.tick(P({ arrest: "arrest" }), 1).opened?.id).toBe("arrival");
  });
  it("ECPELLA: the patch applies to a real simulation, which arrests and then carries the devices", () => {
    const sim = new Simulation({ seed: 7 }, { engine: "core" });
    sim.reset(ECPELLA.start, { settled: true }); sim.warmup(5);
    sim.apply({ patient: { rhythm: ECPELLA.opening!.rhythm! } });
    sim.step(1);
    expect(sim.arrestState().status).toBe("arrest");
    const off = sim.devices();
    expect(off?.ecmo?.flowLpm ?? 0).toBeLessThan(0.5); expect(off?.impella?.on).toBe(false);
    sim.apply(ECPELLA.checkpoints.find((c) => c.id === "device")!.prompt!.options[1].outcome!.patch!);
    sim.step(8);
    const d = sim.devices();
    expect(d?.ecmo?.flowLpm).toBeGreaterThan(2.5); expect(d?.impella?.on).toBe(true);
  }, 60000);
});
