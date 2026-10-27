import { describe, it, expect, vi } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { TOOLS } from "../src/mcp/tools";
import { assessHeart } from "../src/sim/valves";

vi.setConfig({ testTimeout: 120_000 });

/** D4: what the in-chat viewer (src/viewer/viewer.ts) replays and shows is in the tool results: the engine, the whole patient (valves), the arrest block, dead and the narrative. */
const run = (sim: Simulation, name: string, args: Record<string, unknown> = {}) => TOOLS.find((x) => x.name === name)!.run({ sim, appUrl: "https://x/sim/" }, args) as any;

describe("viewer parity (results the viewer reads)", () => {
  it("a core patient with valve disease and VF: engine, patient.heart, arrest, dead and narrative reach corosim_show", () => {
    const sim = new Simulation({ seed: 1 });
    run(sim, "corosim_set_scenario", { engine: "core", scenario: { heart: { valves: { av: { open: 0.3 }, mv: { prosthesis: { kind: "mechanical", sizeMm: 29 } } } } }, warmupSeconds: 5 });
    run(sim, "corosim_adjust", { patch: { patient: { rhythm: "vf-coarse" } }, runSeconds: 12 });
    const r = run(sim, "corosim_show", { display: { mode: "isch", labels: true, heart: "ghost" } });
    expect(r.engine).toBe("core");
    expect(r.patient.heart.valves.mv.prosthesis.kind).toBe("mechanical");
    expect(r.patient.patient.rhythm).toBe("vf-coarse");
    expect(r.arrest.status).toBe("arrest");
    expect(r.arrest.rhythmClass).toBe("vf");
    expect(r.dead).toBe(false);
    expect(r.narrative).toMatch(/fibrillation/);
    expect(r.display).toMatchObject({ mode: "isch", labels: true, heart: "ghost" });
    // the viewer grades the valves from the same heart spec
    const valves = assessHeart(r.patient.heart).valves.filter((v) => v.prosthesis || v.grade !== "none");
    expect(valves.map((v) => v.valve).sort()).toEqual(["AV", "MV"]);
  });
  it("the legacy engine reports itself and has no arrest block", () => {
    const sim = new Simulation({ seed: 1 });
    run(sim, "corosim_set_scenario", { scenario: {}, warmupSeconds: 5 });
    const r = run(sim, "corosim_show");
    expect(r.engine).toBe("legacy");
    expect(r.arrest).toBeUndefined();
    expect(r.dead).toBe(false);
  });
});
