import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";
import { rightHeartCath } from "../src/sim/rightHeartCath";
import { leftHeartCath } from "../src/sim/leftHeartCath";
import { rhcRows } from "../src/panels/rightHeartCath";
import { cathRows } from "../src/panels/leftHeartCath";
import { CASES } from "../src/cath/cases";
import { heartReports, openHeartSource } from "../src/cath/heart";
import type { PatientSpec } from "../src/sim/patient";
import type { Scenario } from "../src/sim/scenario";

/** The patient as the cath page loads it: a core-engine Simulation, a shared link's structural sections in the spec it is reset with. */
function lab(sc: Scenario, spec?: PatientSpec) {
  const sim = new Simulation({ seed: 1 }, { engine: "core" });
  const src = openHeartSource(sim);
  sim.reset({ ...sc, ...spec }, { settled: true }); sim.warmup(20);
  return { sim, src };
}
/** The Simulator page's way: a LiveSource over a core Simulation, read by the panels' own functions. */
function simulatorRows(sc: Scenario, spec?: PatientSpec) {
  const sim = new Simulation({ seed: 1 }, { engine: "core" });
  const b = new LiveSource(sim);
  sim.reset({ ...sc, ...spec }, { settled: true }); sim.warmup(20);
  sim.step(8, { minutes: 0 });
  const r = rightHeartCath(b), l = leftHeartCath(b.numbers(), b.beats(1)[0]);
  return { right: r ? rhcRows(r) : null, left: l ? cathRows(l) : null };
}

describe("cath page heart tabs", () => {
  it("reports once the heart has beaten, and again for the next patient", () => {
    const { sim, src } = lab({});
    sim.step(8, { minutes: 0 });
    const r = heartReports(src);
    expect(r.right).not.toBeNull(); expect(r.left).not.toBeNull();
    sim.reset({ lesions: [{ artery: "LAD", occluded: true, position: 0.2 }] }, { settled: true }); sim.warmup(20); sim.step(8, { minutes: 0 }); // a new patient: the same source follows the rebuilt heart
    const r2 = heartReports(src);
    expect(r2.left).not.toBeNull(); expect(r2.left).not.toEqual(r.left);
  });
  for (const c of CASES) {
    it(`${c.id}: same rows as the Simulator panels`, () => {
      const { sim, src } = lab(c.scenario);
      sim.step(8, { minutes: 0 });
      expect(heartReports(src)).toEqual(simulatorRows(c.scenario));
    });
  }
  it("a shared patient's structural lesion shows (aortic stenosis)", () => {
    const spec: PatientSpec = { heart: { valves: { av: { open: 0.2 } } } };
    const { sim, src } = lab({}, spec);
    sim.step(8, { minutes: 0 });
    const plain = lab({}); plain.sim.step(8, { minutes: 0 });
    const g = (rows: [string, string][] | null) => parseFloat(rows!.find((r) => r[0].startsWith("Mean gradient"))![1]);
    const as = heartReports(src);
    expect(as).toEqual(simulatorRows({}, spec));
    expect(g(as.left)).toBeGreaterThan(g(heartReports(plain.src).left) + 15);
  });
});
