import { describe, it, expect } from "vitest";
import { CaseRunner, Probe, CaseDef, Outcome, Tick } from "../src/cases/engine";
import { CASES, caseById } from "../src/cases";
import { ECPELLA } from "../src/cases/ecpella";
import { Simulation } from "../src/sim/simulation";
import { GENERIC_HARMS } from "../src/cases/harms";

const P = (o: Partial<Probe> = {}): Probe => ({ map: 70, hr: 80, arrest: "none", rhythmClass: "perfusing", shocks: 0, epiDoses: 0, amioMg: 0, lidoDoses: 0, cpr: false, ecmo: false, impella: false, iabp: false, pci: false, pciPending: false, drugs: {}, ef: 0.6, lvIschemia: 0, rvIschemia: 0, congestion: 0, fluidsL: 0, dead: false, ...o });
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
      const outs = (o?: Outcome): string[] => (o ? [...(o.flags ?? []), ...outs(o.shock?.onSuccess), ...outs(o.shock?.onFail)] : []);
      const flags = new Set(c.checkpoints.flatMap((x) => (x.prompt?.options.flatMap((o) => outs(o.outcome)) ?? []).concat(outs(x.outcome))));
      for (const cp of c.checkpoints) for (const f of [...(cp.requires ?? []), ...(cp.forbids ?? [])]) expect(flags.has(f)).toBe(true);
      for (const m of c.musts ?? []) expect(flags.has(m.flag)).toBe(true);
    }
  });
  /** A patient just reactive enough for the ECPELLA case: a shock converts, ROSC is called 10 s after a perfusing rhythm and lost 15 s after VF, a PCI lands 12 s after it is ordered. */
  const patient = (r: CaseRunner) => {
    const st = { arrest: "arrest" as Probe["arrest"], cls: "vf", cpr: true, ecmo: false, impella: false, pci: false, orderedAt: -1, since: 0, shocks: 0, pcis: 0, ordered: [] as string[] };
    const probe = () => P({ arrest: st.arrest, rhythmClass: st.cls, cpr: st.cpr, ecmo: st.ecmo, impella: st.impella, pci: st.pci, pciPending: st.orderedAt >= 0 && !st.pci, map: st.cls === "perfusing" ? 62 : 35 });
    const note = (t: Tick) => {
      for (const p of t.patches) {
        const rh = p.patient?.rhythm; if (rh) { st.cls = rh === "sinus" ? "perfusing" : "vf"; st.since = 0; }
        if (p.devices?.ecmo) st.ecmo = true; if (p.devices?.impella) st.impella = true;
      }
      if (t.cpr !== undefined) st.cpr = t.cpr;
      for (const o of t.orders) { st.ordered.push(o); if (st.orderedAt < 0) st.orderedAt = r.t; }
      for (const sh of t.shocks) { st.shocks++; note(r.resolve(sh.onSuccess ?? {})); }
      return t;
    };
    /** Advance `secs`, stopping at the first prompt. Returns its id (or null). */
    const go = (secs: number): string | null => {
      for (let i = 0; i < secs && !r.over; i++) {
        st.since++;
        if (st.cls === "perfusing" && st.arrest === "arrest" && st.since >= 10) st.arrest = "rosc";
        if (st.cls === "vf" && st.arrest === "rosc" && st.since >= 15) st.arrest = "arrest";
        if (st.orderedAt >= 0 && !st.pci && r.t - st.orderedAt >= 12) st.pci = true;
        note(r.tick(probe(), 1)); if (r.open) return r.open.id;
      }
      return null;
    };
    const pick = (i: number) => note(r.answer(i));
    return { st, go, pick };
  };
  /** Play to Decision 2 on the right path: quick ROSC, the cath lab, VF on the table. */
  const toLabArrest = () => {
    const r = new CaseRunner(ECPELLA), w = patient(r);
    expect(w.go(300)).toBe("disposition"); expect(w.st.shocks).toBeGreaterThan(0); expect(w.st.cpr).toBe(false); // ROSC came quickly and compressions stopped
    expect(r.flags.has("rosc1")).toBe(true); expect(r.t).toBeGreaterThan(30);
    w.pick(0); expect(r.flags.has("cathLab")).toBe(true);
    expect(w.go(300)).toBe("device"); expect(w.st.cls).toBe("vf"); expect(w.st.cpr).toBe(true);
    return { r, w };
  };
  it("ECPELLA: the right path wins, with time on the table between the decisions", () => {
    const full = ECPELLA.checkpoints.find((c) => c.id === "device")!.prompt!.options[0].outcome!.patch!;
    expect(full.devices?.ecmo?.flowLpm).toBeGreaterThan(0); expect(full.devices?.impella?.level).toBeGreaterThan(0); // both devices in one patch
    const { r, w } = toLabArrest(); const t2 = r.t;
    w.pick(0); expect(w.st.ecmo && w.st.impella).toBe(true); expect(["mcs", "vented"].every((f) => r.flags.has(f))).toBe(true);
    expect(w.go(300)).toBe("artery"); expect(r.t - t2).toBeGreaterThanOrEqual(45);
    w.pick(0); expect(w.st.ordered).toEqual(["pci"]);
    // the storm: a transient ROSC before the artery opens sends the patient back to VF
    w.st.arrest = "rosc"; w.st.cls = "perfusing"; w.st.since = 0; const storm: Tick[] = [];
    for (let i = 0; i < 4; i++) storm.push(r.tick(P({ arrest: "rosc", ecmo: true, impella: true }), 1));
    for (let i = 0; i < 9; i++) storm.push(r.tick(P({ arrest: "rosc", ecmo: true, impella: true }), 1));
    expect(storm.flatMap((x) => x.patches).some((p) => p.patient?.rhythm === "vf-coarse")).toBe(true);
    const done = r.tick(P({ pci: true, ecmo: true, impella: true }), 1);
    expect(done.patches.some((p) => p.patient?.rhythm === "sinus")).toBe(true);
    expect(r.open).toBeNull(); // the recovery plays first
    const t3 = r.t; run(r, P({ arrest: "rosc", pci: true, ecmo: true, impella: true }), 60);
    expect(r.open?.id).toBe("after"); expect(r.t - t3).toBeGreaterThanOrEqual(35);
    expect(r.answer(1).over).toBe("success");
    const d = r.debrief(); expect(d.result).toBe("success"); expect(d.lines.join(" ")).toContain("Impella"); expect(d.lines.join(" ")).not.toContain("Not done");
  });
  it("ECPELLA: the quick ROSC is not undone by the storm rule, and CPR comes off at ROSC and on at an arrest", () => {
    const r = new CaseRunner(ECPELLA), w = patient(r);
    expect(w.go(300)).toBe("disposition");
    const storm = ECPELLA.checkpoints.find((c) => c.id === "storm")!; expect(storm.requires).toContain("labArrested");
    expect(w.st.cpr).toBe(false); // compressions stopped at ROSC
  });
  it("ECPELLA: keeping on with ACLS in the ED re-arrests him, and the cath lab prompt comes back", () => {
    const r = new CaseRunner(ECPELLA), w = patient(r);
    expect(w.go(300)).toBe("disposition"); w.pick(1); expect(r.flags.has("edWorse")).toBe(true);
    const before = w.st.shocks;
    let reprompt: string | null = null; const seen: string[] = [];
    for (let i = 0; i < 400 && !reprompt; i++) { reprompt = w.go(1); if (w.st.cls === "vf") seen.push("vf"); }
    expect(seen.length).toBeGreaterThan(0); // he went back into VF in the ED
    expect(w.st.shocks).toBeGreaterThan(before); // and was shocked back
    expect(reprompt).toBe("disposition"); expect(r.flags.has("cathLab")).toBe(false);
    w.pick(0); expect(r.flags.has("cathLab")).toBe(true);
    expect(w.go(300)).toBe("device");
    expect(r.debrief().lines.join(" ")).toContain("Drugs do not treat");
  });
  it("ECPELLA: going straight to PCI in the lab ends in death on the table, after a delay, with the artery never opened", () => {
    const { r, w } = toLabArrest(); const t2 = r.t;
    w.pick(2); expect(r.flags.has("unsupportedPci")).toBe(true);
    w.go(10); expect(r.over).toBe(false); expect(w.st.ordered).toEqual([]);
    w.go(60);
    expect(r.result).toBe("fail"); expect(r.t - t2).toBeGreaterThanOrEqual(25); expect(w.st.ordered).toEqual([]); expect(w.st.pci).toBe(false);
    expect(r.log.some((l) => l.text.includes("refractory shock before the LAD is opened"))).toBe(true);
    const d = r.debrief(); expect(d.lines.join(" ")).toContain("Support first"); expect(d.lines.join(" ")).toContain("Not done");
  });
  it("ECPELLA: a balloon pump or more shocks in the lab repeat the prompt", () => {
    const { r, w } = toLabArrest();
    w.pick(3); expect(r.flags.has("iabpOnly")).toBe(true); expect(w.go(100)).toBe("device");
    w.pick(4); expect(w.go(100)).toBe("device");
    expect(r.over).toBe(false);
  });
  it("ECPELLA: ECMO alone gets time to distend, then the venting prompt, then the PCI prompt", () => {
    const { r, w } = toLabArrest(); const t2 = r.t;
    w.pick(1); expect(w.st.ecmo).toBe(true); expect(w.st.impella).toBe(false);
    expect(w.go(300)).toBe("distension"); expect(r.t - t2).toBeGreaterThanOrEqual(42);
    w.pick(0); expect(w.st.impella).toBe(true); expect(r.flags.has("vented")).toBe(true);
    expect(w.go(300)).toBe("artery");
    w.pick(0); expect(w.st.ordered).toEqual(["pci"]);
  });
  it("ECPELLA: a wrong move on support (wean, lysis, shocks) repeats the PCI prompt", () => {
    const { r, w } = toLabArrest(); w.pick(0); expect(w.go(300)).toBe("artery");
    w.pick(1); expect(w.go(200)).toBe("artery"); w.pick(2); expect(w.go(200)).toBe("artery"); expect(w.st.ordered).toEqual([]);
  });
  it("ECPELLA: a vasodilator or beta blocker on support costs points and is named in the debrief", () => {
    const run2 = (drugs: Record<string, number>) => {
      const r = new CaseRunner(ECPELLA); const p = P({ arrest: "arrest", ecmo: true, impella: true, drugs });
      // flags a player would have earned by now; the point here is the scoring of the drug during the support phase
      for (const f of ["rosc1", "cathLab", "labArrested", "deviceChosen", "mcs", "vented"]) r.flags.add(f);
      run(r, p, 46); expect(r.open?.id).toBe("artery"); r.answer(0);
      const d = r.tick(P({ pci: true, ecmo: true, impella: true, drugs }), 1); expect(d.patches.length).toBeGreaterThan(0);
      run(r, P({ pci: true, ecmo: true, impella: true, drugs }), 40); expect(r.open?.id).toBe("after"); r.answer(1);
      return r.debrief();
    };
    const clean = run2({}), harm = run2({ nitroglycerin: 0.6 });
    expect(clean.lines.join(" ")).not.toContain("vasodilator");
    expect(harm.lines.join(" ")).toContain("vasodilator"); expect(harm.score).toBeLessThan(clean.score);
  });
  it("ECPELLA: in a real simulation the opening shock gives a quick ROSC that holds, with compressions stopped", () => {
    const sim = new Simulation({ seed: 7 }, { engine: "core" });
    sim.reset(ECPELLA.start, { settled: true }); sim.warmup(5);
    sim.apply({ patient: { rhythm: "vf-coarse" } }); sim.step(1);
    for (const d of ECPELLA.opening!.drugs!) sim.giveDrug(d.drug, d.mg);
    sim.startCpr(); sim.step(7);
    let ok = false; for (let i = 0; i < 4 && !ok; i++) { ok = sim.shock({ joules: 200 }).success; if (!ok) sim.step(6); }
    expect(ok).toBe(true);
    sim.apply({ patient: { rhythm: "sinus" } }); sim.stopCpr(); sim.step(20);
    expect(sim.arrestState().status).toBe("rosc"); expect(sim.map).toBeGreaterThan(30);
  }, 60000);
  it("ECPELLA: the patch applies to a real simulation, which arrests and then carries the devices", () => {
    const sim = new Simulation({ seed: 7 }, { engine: "core" });
    sim.reset(ECPELLA.start, { settled: true }); sim.warmup(5);
    sim.apply({ patient: { rhythm: ECPELLA.opening!.rhythm! } });
    sim.step(1);
    expect(sim.arrestState().status).toBe("arrest");
    const off = sim.devices();
    expect(off?.ecmo?.flowLpm ?? 0).toBeLessThan(0.5); expect(off?.impella?.on).toBe(false);
    sim.apply(ECPELLA.checkpoints.find((c) => c.id === "device")!.prompt!.options[0].outcome!.patch!);
    sim.step(8);
    const d = sim.devices();
    expect(d?.ecmo?.flowLpm).toBeGreaterThan(2.5); expect(d?.impella?.on).toBe(true);
  }, 60000);
});

describe("generic harms", () => {
  const bare: CaseDef = { ...toy, harms: undefined, musts: undefined, checkpoints: [] };
  const harmed = (p: Probe, def: CaseDef = bare) => { const r = new CaseRunner(def); r.tick(p, 1); const d = r.debrief(); return d.lines.filter((l) => l.startsWith("Harmful")).join(" "); };
  it("every rule fires in its own bad context and stays quiet in a benign one", () => {
    const cases: [string, Probe, Probe][] = [
      ["vasodilator", P({ map: 55, drugs: { nitroglycerin: 0.5 } }), P({ map: 90, drugs: { nitroglycerin: 0.5 } })],
      ["beta blocker", P({ ef: 0.25, drugs: { betaBlocker: 0.5 } }), P({ ef: 0.6, drugs: { betaBlocker: 0.5 } })],
      ["catecholamine", P({ hr: 150, lvIschemia: 0.4, drugs: { dobutamine: 0.6 } }), P({ hr: 90, lvIschemia: 0.4, drugs: { dobutamine: 0.6 } })],
      ["pure vasoconstrictor", P({ ef: 0.25, drugs: { phenylephrine: 0.6 } }), P({ ef: 0.6, drugs: { phenylephrine: 0.6 } })],
      ["diuretic", P({ map: 55, drugs: { furosemide: 0.5 } }), P({ map: 55, congestion: 0.6, drugs: { furosemide: 0.5 } })],
      ["calcium channel blocker", P({ ef: 0.25, drugs: { diltiazem: 0.5 } }), P({ ef: 0.6, map: 90, drugs: { diltiazem: 0.5 } })],
      ["dual AV-nodal blockade", P({ ef: 0.6, map: 90, drugs: { betaBlocker: 0.5, diltiazem: 0.5 } }), P({ ef: 0.6, map: 90, drugs: { diltiazem: 0.5 } })],
      ["fluid into congestion", P({ ef: 0.25, congestion: 0.6, fluidsL: 1 }), P({ ef: 0.6, congestion: 0, fluidsL: 1 })],
    ];
    expect(cases.map((c) => c[0]).sort()).toEqual(GENERIC_HARMS.map((h) => h.tag).sort()); // a new rule needs a test here
    for (const [tag, bad, ok] of cases) {
      const label = GENERIC_HARMS.find((h) => h.tag === tag)!.label.slice(0, 20);
      // eslint-disable-next-line no-await-in-loop
      expect(harmed(bad), tag).toContain(label.slice(0, 12));
      expect(harmed(ok), tag).toBe("");
    }
  });
  it("a preload-dependent right ventricle makes a vasodilator harmful even at a normal pressure", () => {
    expect(harmed(P({ map: 80, rvIschemia: 0.5, drugs: { nitroglycerin: 0.5 } }))).toContain("vasodilator");
  });
  it("a case may skip a generic rule and add its own", () => {
    const bad = P({ map: 50, drugs: { nitroglycerin: 0.5 } });
    expect(harmed(bad, { ...bare, skipHarms: ["vasodilator"] })).toBe("");
    const own: CaseDef = { ...bare, harms: [{ tag: "x", label: "a thing this case dislikes", when: (p) => p.hr > 100 }] };
    expect(harmed(P({ hr: 120 }), own)).toContain("a thing this case dislikes");
  });
  it("harm lowers the score in proportion to the time spent doing it", () => {
    // stable the whole time, so only harm moves the score
    const run3 = (drugs: Record<string, number>, secs: number) => { const r = new CaseRunner(bare); for (let i = 0; i < 10; i++) r.tick(P({ map: 80, rvIschemia: 0.5, drugs: i < secs ? drugs : {} }), 1); return r.debrief().score; };
    const none = run3({}, 0), brief = run3({ nitroglycerin: 0.5 }, 2), long = run3({ nitroglycerin: 0.5 }, 8);
    expect(brief).toBeLessThan(none); expect(long).toBeLessThan(brief);
  });
});
