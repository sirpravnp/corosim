import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { solveBridge } from "../src/sim/bridgeSolver";
import { BridgeSource } from "../src/sim/bridgeSource";
import { rightHeartCath } from "../src/sim/rightHeartCath";
import { leftHeartCath } from "../src/sim/leftHeartCath";
import { rhcRows } from "../src/panels/rightHeartCath";
import { cathRows } from "../src/panels/leftHeartCath";
import { CASES } from "../src/cath/cases";
import { heartReports, openHeartBridge } from "../src/cath/heart";
import type { PatientSpec } from "../src/sim/patient";
import type { Scenario } from "../src/sim/scenario";

/** Vitest's 5 s default is too tight for a test that waits on real calibrated solves when the machine is under load. */
const SOLVE_TEST_TIMEOUT_MS = 60_000;

/** The patient as the cath page loads it. */
function lab(sc: Scenario, spec?: PatientSpec) {
  const sim = new Simulation({ seed: 1 });
  sim.reset(sc, { settled: true }); sim.warmup(20);
  return { sim, bridge: openHeartBridge(sim, spec) };
}
/** The Simulator page's way: a BridgeSource with the patient option, read by the panels' own functions. */
function simulatorRows(sc: Scenario, spec?: PatientSpec) {
  const sim = new Simulation({ seed: 1 });
  sim.reset(sc, { settled: true }); sim.warmup(20);
  const b = new BridgeSource(sim, { patient: spec });
  sim.step(8, { minutes: 0 });
  const r = rightHeartCath(b), l = leftHeartCath(b.numbers(), b.beats(1)[0]);
  return { right: r ? rhcRows(r) : null, left: l ? cathRows(l) : null };
}

describe("cath page heart tabs", () => {
  it("waits for the first (asynchronous) solve, then reports", async () => {
    const sim = new Simulation({ seed: 1 });
    sim.reset({}, { settled: true }); sim.warmup(20);
    let land!: () => void;
    const gate = new Promise<void>((ok) => { land = ok; });
    const bridge = openHeartBridge(sim, undefined, { solve: async (req) => { await gate; return solveBridge(req); } });
    sim.step(8, { minutes: 0 });
    expect(heartReports(bridge)).toEqual({ right: null, left: null });
    land(); await gate; await new Promise((r) => setTimeout(r, 0));
    sim.step(8, { minutes: 0 });
    const r = heartReports(bridge);
    expect(r.right).not.toBeNull(); expect(r.left).not.toBeNull();
  }, SOLVE_TEST_TIMEOUT_MS); // two real solves (several structural analyses each, ~0.3 s apiece on a busy machine) on top of the warm-up
  for (const c of CASES) {
    it(`${c.id}: same rows as the Simulator panels`, () => {
      const { sim, bridge } = lab(c.scenario);
      sim.step(8, { minutes: 0 });
      expect(heartReports(bridge)).toEqual(simulatorRows(c.scenario));
    });
  }
  it("a shared patient's structural lesion shows (aortic stenosis)", () => {
    const spec: PatientSpec = { heart: { valves: { av: { open: 0.2 } } } };
    const { sim, bridge } = lab({}, spec);
    sim.step(8, { minutes: 0 });
    const plain = lab({}); plain.sim.step(8, { minutes: 0 });
    const g = (rows: [string, string][] | null) => parseFloat(rows!.find((r) => r[0].startsWith("Mean gradient"))![1]);
    const as = heartReports(bridge);
    expect(as).toEqual(simulatorRows({}, spec));
    expect(g(as.left)).toBeGreaterThan(g(heartReports(plain.bridge).left) + 15);
  });
});
