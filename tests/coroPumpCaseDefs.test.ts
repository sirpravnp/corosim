/**
 * The ten CoroPump teaching cases (plan K6): schema, the "show only what is needed" rule, orders that can come back in time, the markdown round trip
 * and the learner gate. Engine behavior the cases rely on is pinned in coroPumpCases.test.ts.
 */
import { describe, it, expect } from "vitest";
import { CASES, COROPUMP_CASES, COROPUMP_SPECS, ALL_CASES } from "../src/cases";
import { backBeforeEnd, isDisplayId, itemById, resolveMonitor } from "../src/cases/orders";
import { caseToMarkdown, parseCaseMarkdown } from "../src/cases/markdown";
import { learnerMayApply } from "../src/cases/gate";
import { validateCase } from "../src/cases/spec";
import type { CondSpec } from "../src/cases/spec";

/** Easy to hard, the order the front door lists them. */
const IDS = ["weaning", "suction-alarm", "protected-pci", "stemi-shock-unload", "malposition-out", "malposition-deep", "purge-rising", "hemolysis", "myocarditis-bridge", "vt-ablation"];
/** Where reading the console is the skill. Every other case leaves the panel off the monitor. */
const CONSOLE = new Set(["suction-alarm", "malposition-out", "malposition-deep", "purge-rising", "hemolysis"]);
/** Words a card or a question may not use: the learner works out the diagnosis, the malposition, the clot and the cause. */
const GIVEAWAY = /malposition|thrombus|thrombosis|clot|hemolysis|hemolyz|suction|too deep|pulled back|migrat|hypovol|bleed|hemorrhag|myocarditis|pfhb/i;

const backs = (cs: CondSpec[] | undefined): string[] =>
  (cs ?? []).flatMap((c): string[] => ("any" in c ? backs(c.any) : "back" in c ? [c.back] : []));

describe("CoroPump cases", () => {
  it("there are ten, in the registry, easy to hard, and the built-in six are untouched", () => {
    expect(COROPUMP_CASES.map((c) => c.id)).toEqual(IDS);
    expect(COROPUMP_SPECS.length).toBe(10);
    expect(CASES.length).toBe(6);
    expect(ALL_CASES.length).toBe(16);
    const rank = { easy: 0, medium: 1, hard: 2 };
    const tiers = COROPUMP_CASES.map((c) => rank[c.tier]);
    expect(tiers).toEqual([...tiers].sort());
    for (const id of ["weaning", "protected-pci"]) expect(COROPUMP_CASES.find((c) => c.id === id)).toBeDefined();
    expect(COROPUMP_CASES.find((c) => c.id === "weaning")!.tier).toBe("easy");
    expect(COROPUMP_CASES.find((c) => c.id === "suction-alarm")!.tier).toBe("easy");
    expect(COROPUMP_CASES.find((c) => c.id === "myocarditis-bridge")!.tier).toBe("hard");
    expect(COROPUMP_CASES.find((c) => c.id === "vt-ablation")!.tier).toBe("hard");
    for (const c of COROPUMP_CASES) expect(c.devices).toEqual(["CoroPump"]);
  });

  it("each case has a card, at least two decisions, one correct option per decision, and a why on every option", () => {
    for (const s of COROPUMP_SPECS) {
      expect(s.card.presents.length, s.id).toBeGreaterThan(40);
      const prompts = s.checkpoints.filter((c) => c.prompt);
      expect(prompts.length, s.id).toBeGreaterThanOrEqual(2);
      expect(prompts.length, s.id).toBeLessThanOrEqual(4); // no more decisions than the lesson needs
      for (const cp of prompts) {
        const opts = cp.prompt!.options;
        expect(opts.filter((o) => o.correct).length, `${s.id}/${cp.id}`).toBe(1);
        for (const o of opts) expect(typeof o.why === "string" && o.why.length > 20, `${s.id}/${cp.id}/${o.label}`).toBe(true);
      }
      expect(validateCase(s), s.id).toEqual([]);
    }
  });

  it("monitor ids are display ids, and coropump is listed only where reading the console is the skill", () => {
    for (const c of COROPUMP_CASES) {
      expect(c.monitor?.length, c.id).toBeGreaterThan(0);
      for (const id of c.monitor!) { expect(itemById(id), `${c.id}/${id}`).toBeDefined(); expect(isDisplayId(id), `${c.id}/${id}`).toBe(true); }
      expect(c.monitor!.includes("coropump"), c.id).toBe(CONSOLE.has(c.id));
      expect(resolveMonitor(c)).toEqual(c.monitor);
      expect(c.monitor!.length, c.id).toBeLessThanOrEqual(5);
      for (const gone of ["numbers", "traces", "loops", "ischemia"]) expect(c.monitor, c.id).not.toContain(gone);
    }
  });

  it("no case lists heart3d (a retired id) and none lists free hemoglobin or urine color on the monitor", () => {
    for (const c of COROPUMP_CASES) {
      expect(c.monitor, c.id).not.toContain("heart3d");
      expect(c.monitor, c.id).not.toContain("hemolysis");
      expect(c.monitor, c.id).not.toContain("urine-color");
    }
  });

  it("the card and the questions do not name the diagnosis, the malposition, the clot or the cause", () => {
    for (const s of COROPUMP_SPECS) {
      const text = [s.card.presents, s.card.pmh, ...(s.card.info ?? []), s.blurb, ...s.checkpoints.map((c) => c.prompt?.text ?? "")].join("\n");
      expect(text, s.id).not.toMatch(GIVEAWAY);
    }
  });

  it("every lab or bedside item a checkpoint requires returns before the time limit (backBeforeEnd)", () => {
    for (const s of COROPUMP_SPECS) {
      for (const cp of s.checkpoints) {
        for (const id of backs(cp.when)) {
          const item = itemById(id)!;
          expect(item, `${s.id}/${cp.id}/${id}`).toBeDefined();
          expect(backBeforeEnd(item, cp.atS ?? 0, s.limitS), `${s.id}/${cp.id}/${id}`).toBe(true);
        }
      }
    }
    const need = (id: string) => backs(COROPUMP_SPECS.find((s) => s.id === id)!.checkpoints.flatMap((c) => c.when ?? []));
    for (const id of ["purge-rising", "hemolysis"]) { expect(need(id)).toContain("hemolysis"); expect(need(id)).toContain("urine-color"); }
  });

  it("round-trips through caseToMarkdown and parseCaseMarkdown", () => {
    for (const s of COROPUMP_SPECS) {
      const r = parseCaseMarkdown(caseToMarkdown(s));
      expect(r.errors, s.id).toEqual([]);
      expect(r.warnings, s.id).toEqual([]);
      expect(JSON.parse(JSON.stringify(r.spec)), s.id).toEqual(JSON.parse(JSON.stringify(s)));
    }
  });

  it("author patches may set position, purge.line and initial; the same patch from the learner is refused", () => {
    const edits = [
      { devices: { coroPump: { position: "deep" as const } } },
      { devices: { coroPump: { purge: { line: "blocked" as const } } } },
      { devices: { coroPump: { initial: { thrombusBurden: 0.5 } } } },
    ];
    for (const e of edits) expect(learnerMayApply(e).ok).toBe(false);
    // the case author's own start state is never gated, and it loads without warnings
    for (const id of ["malposition-out", "malposition-deep", "purge-rising", "hemolysis"]) {
      const s = COROPUMP_SPECS.find((x) => x.id === id)!;
      expect(validateCase(s), id).toEqual([]);
      expect(learnerMayApply(s.start).ok, id).toBe(false);
    }
    // what the learner is offered is treatment, and the gate lets all of it through
    for (const s of COROPUMP_SPECS) for (const cp of s.checkpoints) for (const o of cp.prompt?.options ?? []) {
      const p = o.outcome?.patch;
      if (p && p.devices?.coroPump && !p.devices.coroPump.position && !p.devices.coroPump.purge?.line && !p.devices.coroPump.initial) expect(learnerMayApply(p).ok, `${s.id}/${o.label}`).toBe(true);
    }
  });
});
