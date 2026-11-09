/**
 * Plays each CoroPump case against the real simulation: the right answer at every question must win, and a wrong answer must not (a case the learner
 * can finish by guessing teaches nothing). The harness stands in for the page: it builds the probe, applies the author's patches, and orders the labs a
 * case waits for.
 */
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { CaseRunner } from "../src/cases/engine";
import type { CaseDef, Probe, Tick } from "../src/cases/engine";
import { COROPUMP_CASES } from "../src/cases";
import { OrderBook } from "../src/cases/orderBook";

/** The labs a learner who is paying attention orders, and when (case seconds). */
const ORDER_AT: Record<string, [number, string[]]> = { "purge-rising": [355, ["hemolysis", "urine-color"]], hemolysis: [18, ["hemolysis", "urine-color"]] };

function play(def: CaseDef, pick: (opts: { correct?: boolean }[]) => number, maxS = 2400) {
  const sim = new Simulation({}, { engine: "core" });
  sim.reset({ seed: 3, ...def.start }, { settled: true });
  sim.warmup(20);
  const runner = new CaseRunner(def), book = new OrderBook();
  let pci = false, pciAt = -1;
  const probe = (): Probe => {
    const st = sim.arrestState(), d = sim.devices();
    return {
      map: sim.map, hr: sim.circ?.hr ?? 0, arrest: sim.dead ? "dead" : st.status, rhythmClass: st.rhythmClass, shocks: 0, epiDoses: 0, amioMg: 0, lidoDoses: 0, cpr: false,
      ecmo: false, coroPump: !!d?.coroPump?.on, iabp: false, pci, pciPending: pciAt >= 0 && !pci, drugs: { ...(sim.drugState()?.level ?? {}) },
      ef: sim.circ?.ejectionFraction ?? 0.6, lvIschemia: sim.circ?.lvIschemia ?? 0, rvIschemia: sim.circ?.rvIschemia ?? 0, congestion: sim.circ?.congestion ?? 0, fluidsL: sim.support.fluids,
      dead: sim.dead, ordered: book.ordered(), pending: book.pending.map((q) => q.id), waiting: book.pending.length > 0,
    };
  };
  const carry = (t: Tick) => {
    for (const p of t.patches) sim.apply(p);
    for (const o of t.orders) if (o === "pci" && pciAt < 0) pciAt = runner.t;
  };
  const prompts: string[] = [];
  const DT = 2;
  while (!runner.over && runner.t < maxS) {
    const ord = ORDER_AT[def.id];
    if (ord && runner.t >= ord[0] && book.ordered().size === 0) for (const id of ord[1]) book.order(id, runner.t, def.limitS);
    book.tick(runner.t, { respRateBase: 15, map: sim.map, spo2: 0.97, lactate: 1, congestion: 0, arrest: "none", hr: 80, sbp: 100, dbp: 60, urineMlHr: 50, lvIschemia: 0, rvIschemia: 0, rhythmLabel: "", tempC: 37, respRate: 15 });
    if (pciAt >= 0 && !pci && runner.t - pciAt >= 12) { pci = true; sim.revascularize("pci"); }
    sim.run(DT);
    const t = runner.tick(probe(), DT);
    carry(t);
    if (t.opened) { prompts.push(t.opened.id); carry(runner.answer(pick(t.opened.prompt.options))); }
  }
  return { result: runner.result, prompts, runner, sim };
}
const right = (opts: { correct?: boolean }[]) => opts.findIndex((o) => o.correct);
const wrong = (opts: { correct?: boolean }[]) => opts.findIndex((o) => !o.correct);

describe("CoroPump cases against the engine", () => {
  for (const def of COROPUMP_CASES) {
    it(`${def.id}: the right answers win, in the time allowed`, () => {
      const r = play(def, right, def.limitS);
      expect(r.result, `${def.id}: ${r.prompts.join(" > ")} at ${r.runner.t}s`).toBe("success");
      expect(r.runner.debrief().lines.join("\n")).not.toMatch(/Not done/);
    }, 300_000);
    it(`${def.id}: answering wrong does not win`, () => {
      const r = play(def, wrong, def.limitS);
      expect(r.result).not.toBe("success");
    }, 300_000);
  }
});
