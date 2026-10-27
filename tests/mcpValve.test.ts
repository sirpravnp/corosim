import { describe, it, expect, vi } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { TOOLS } from "../src/mcp/tools";
import { currentPatient } from "../src/mcp/hemo";
import { valveSet } from "../src/sim/valves";

vi.setConfig({ testTimeout: 120_000 });

/** The valve procedures and the prosthesis fields, from chat (core engine). */
const run = (sim: Simulation, name: string, args: Record<string, unknown> = {}) => TOOLS.find((x) => x.name === name)!.run({ sim, appUrl: "https://x/sim/" }, args) as any;
const aorticStenosis = () => {
  const sim = new Simulation({ seed: 1 });
  run(sim, "corosim_set_scenario", { engine: "core", scenario: { heart: { valves: valveSet({ av: { stenosis: 0.9 } }) } }, warmupSeconds: 20 });
  return sim;
};

describe("corosim_valve", () => {
  it("TAVR replaces the stenotic aortic valve with a transcatheter prosthesis", () => {
    const sim = aorticStenosis();
    const before = JSON.stringify(run(sim, "corosim_heart_cath", { side: "left" }));
    const r = run(sim, "corosim_valve", { type: "tavr", sizeMm: 26, runSeconds: 10 });
    expect(r.done).toBe(true);
    expect(r.changes.join(" ")).toMatch(/aortic valve replaced by a 26 mm transcatheter/);
    expect(currentPatient(sim).heart?.valves?.av?.prosthesis).toMatchObject({ kind: "transcatheter", sizeMm: 26 });
    expect(JSON.stringify(run(sim, "corosim_heart_cath", { side: "left" }))).not.toBe(before);
  });
  it("a procedure that cannot be done changes nothing and says why", () => {
    const sim = new Simulation({ seed: 1 });
    run(sim, "corosim_set_scenario", { engine: "core", scenario: {}, warmupSeconds: 10 });
    const r = run(sim, "corosim_valve", { type: "teer", valve: "mv", runSeconds: 0 });
    expect(r.done).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/does not leak/);
  });
  it("needs the core engine and a valid request", () => {
    const sim = new Simulation({ seed: 1 });
    expect(() => run(sim, "corosim_valve", { type: "tavr" })).toThrow(/core engine/);
    expect(() => run(sim, "corosim_valve", { type: "replace", valve: "mv" })).toThrow(/kind/);
    expect(() => run(sim, "corosim_valve", { type: "balloon", valve: "xx" })).toThrow(/valve must/);
  });
  it("a prosthesis can also be set directly with heart.valves.*.prosthesis in corosim_adjust", () => {
    const sim = new Simulation({ seed: 1 });
    run(sim, "corosim_set_scenario", { engine: "core", scenario: {}, warmupSeconds: 10 });
    const r = run(sim, "corosim_adjust", { patch: { heart: { valves: { mv: { prosthesis: { kind: "mechanical", sizeMm: 29, obstruction: 0.5 } } } } }, runSeconds: 5 });
    expect(r.warnings ?? []).toEqual([]);
    expect(currentPatient(sim).heart?.valves?.mv?.prosthesis).toMatchObject({ kind: "mechanical", obstruction: 0.5 });
  });
  it("a library rhythm can be set through the schema's rhythm field", () => {
    const sim = new Simulation({ seed: 1 });
    run(sim, "corosim_set_scenario", { engine: "core", scenario: { patient: { rhythm: "flutter-21" } }, warmupSeconds: 10 });
    expect(JSON.stringify(run(sim, "corosim_get_state").state.rhythm)).toMatch(/flutter/i);
  });
});
