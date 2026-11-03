// B5: the valve lesions, prostheses and interventions through the live Simulation (core engine): a heart patch from `intervene` applied
// while the patient runs, the way the page and the MCP tools will do it.
import { describe, it, expect } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { LiveSource } from "../src/sim/liveSource";
import { leftHeartCath } from "../src/sim/leftHeartCath";
import { intervene, valveSet } from "../src/sim/valves";
import type { HeartSpec } from "../src/sim/patient";

const mk = (heart: HeartSpec) => { const s = new Simulation({}, { engine: "core" }); s.reset({ seed: 3, heart }, { settled: true }); s.warmup(15); return s; };
const aorta = (s: Simulation, sec = 20) => { const src = new LiveSource(s); s.run(sec); return src.numbers(); };
const lastBeats = (s: Simulation, sec = 20) => { const src = new LiveSource(s); s.run(sec); return { src, beats: src.beats(6) }; };

describe("valves in the live Simulation", () => {
  const stenosis: HeartSpec = { valves: valveSet({ av: { stenosis: 0.95 }, mv: { regurgitation: 0.6 } }) };
  const s = mk(stenosis);
  const before = lastBeats(s);

  it("aortic stenosis with mitral regurgitation shows both on the live heart: a severe aortic gradient on the cath read and a regurgitant volume on the mitral valve", () => {
    const b = before.beats[before.beats.length - 1], cath = leftHeartCath(before.src.numbers(), b, "adult")!;
    expect(cath.gradient.mean).toBeGreaterThan(30); expect(cath.severity.aortic).toBe("severe");
    expect(b.valves.MV.regurgMl).toBeGreaterThan(30);
  });
  it("TAVR applied to the running patient (a heart patch) rebuilds the heart and drops the gradient; the mitral leak stays", () => {
    const live = s.live, r = intervene(stenosis, { type: "tavr" });
    s.apply({ heart: r.patch });
    expect(s.live).not.toBe(live);
    const a = lastBeats(s), b = a.beats[a.beats.length - 1], cath = leftHeartCath(a.src.numbers(), b, "adult", { aortic: true })!;
    expect(cath.gradient.mean).toBeLessThan(25);
    expect(cath.severity.aortic).toBe("none"); // graded as a prosthesis, by its gradient
    expect(leftHeartCath(a.src.numbers(), b, "adult")!.severity.aortic).not.toBe("none"); // graded as a native valve it would read as a stenosis: the reason for the option
    expect(b.valves.MV.regurgMl).toBeGreaterThan(20);
  });
  it("a second patch, a paravalvular leak on that valve, replaces nothing else and opens the diastolic pressure; clearing it by a new replacement closes it again", () => {
    const base = aorta(s).diastolic;
    s.apply({ heart: { valves: { av: { prosthesis: { leak: 0.4 } as never } } } }); // a partial patch: merged into the prosthesis in force
    const leaky = aorta(s);
    expect(leaky.diastolic).toBeLessThan(base - 8);
    s.apply({ heart: intervene({ valves: { av: { prosthesis: { kind: "transcatheter", sizeMm: 26, leak: 0.4 } } } }, { type: "replace", valve: "av", kind: "bioprosthetic", sizeMm: 25 }).patch });
    expect(aorta(s).diastolic).toBeGreaterThan(leaky.diastolic + 8);
  });
  it("a heart with prostheses in two positions builds and runs on the live engine, with the closing leak of the mechanical valve and the paravalvular leak of the tissue one", () => {
    const spec: HeartSpec = { valves: { av: { prosthesis: { kind: "mechanical", sizeMm: 23 } }, mv: { prosthesis: { kind: "bioprosthetic", sizeMm: 29, leak: 0.05 } } } };
    const x = mk(spec), a = lastBeats(x);
    expect(a.beats[a.beats.length - 1].valves.AV.regurgMl).toBeGreaterThan(1); // the closing leak of the mechanical valve
    expect(a.beats[a.beats.length - 1].valves.MV.regurgMl).toBeGreaterThan(1); // the paravalvular leak
    expect(Number.isFinite(a.src.numbers().map)).toBe(true);
  });
});
