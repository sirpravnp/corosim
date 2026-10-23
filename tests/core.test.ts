// The core engine against the structural engine it ports (A1): same numbers from the same model.
import { describe, it, expect } from "vitest";
import { buildModel, simulate, volumeOffsetFor, NODES, type StructuralSpec } from "../src/physics/structural";
import { LESIONS, defaults } from "../src/sim/structural";
import { createEngine } from "../src/physics/core/engine";
import { engineFromModel } from "../src/physics/core/fromModel";
import { BeatRecorder } from "../src/physics/core/recorder";
import { Compliance } from "../src/physics/core/chamber";
import { Resistor } from "../src/physics/core/valves";
import type { Element, Engine, HeartEvent } from "../src/physics/core/types";

const REL = 0.005, FLOOR = 0.05; // 0.5 % relative, 0.05 mmHg / ml absolute

/** Both engines on one model, built the way analyze() builds it. Returns the largest relative difference seen and where. */
function compare(spec: StructuralSpec) {
  const m = buildModel(spec, volumeOffsetFor(spec)), want = simulate(m);
  const eng = engineFromModel(m), rec = new BeatRecorder(eng, m.T, m.edges.filter((e) => e.type === "valve" && (e.name !== "RVAO" || e.area)).map((e) => e.name));
  const run = eng.periodic(m.hr), got = rec.beat(), fv = eng.flowVolumes();
  const bad: string[] = []; let worst = { rel: 0, where: "" };
  const cmp = (label: string, w: number, g: number) => {
    const rel = Math.abs(g - w) / Math.max(Math.abs(w), 1e-12);
    if (!(Math.abs(g - w) <= Math.max(REL * Math.abs(w), FLOOR))) bad.push(`${label}: simulate ${w}, core ${g}`);
    if (Math.abs(g - w) > 1e-9 && rel > worst.rel) worst = { rel, where: label };
  };
  expect(run.beats, "beats").toBe(want.beats);
  expect(run.converged, "converged").toBe(want.converged);
  for (const n of NODES) for (const f of ["min", "max", "mean", "end"] as const) cmp(`p.${n}.${f}`, want.p[n][f], got.p[n][f]);
  for (const n of ["RA", "RV", "LA", "LV"] as const) for (const f of ["min", "max", "mean", "end"] as const) cmp(`vol.${n}.${f}`, want.vol[n][f], got.v[n][f]);
  for (const e of m.edges) { cmp(`fwd.${e.name}`, want.fwd[e.name], fv.fwd[e.name]); cmp(`bwd.${e.name}`, want.bwd[e.name], fv.bwd[e.name]); }
  for (const [name, w] of Object.entries(want.valves)) for (const f of Object.keys(w) as (keyof typeof w)[]) cmp(`valve.${name}.${f}`, w[f], got.valves[name][f]);
  expect(Object.keys(got.valves).sort()).toEqual(Object.keys(want.valves).sort());
  return { bad, worst };
}

describe("core engine reproduces simulate()", () => {
  const cases: [string, StructuralSpec][] = [
    ["adult normal", {}], ["neonate normal", { patient: "neonate" }],
    ...LESIONS.map((l) => [l.id, l.build(defaults(l))] as [string, StructuralSpec]),
  ];
  for (const [id, spec] of cases) {
    it(`${id}: pressures, volumes, edge volumes and valve stats within 0.5 %`, () => {
      const { bad, worst } = compare(spec);
      if (process.env.CORE_VERBOSE) console.log(`${id}: worst ${worst.rel.toExponential(2)} at ${worst.where}`);
      expect(bad, bad.join("\n")).toEqual([]);
    });
  }
});

describe("core engine mechanics", () => {
  /** Two compliances joined by a resistor: ΔP decays with τ = R·C1·C2/(C1+C2). */
  const pair = (V1: number, C1: number, C2: number, R: number): Engine => createEngine(
    [{ name: "a", model: new Compliance("a", C1), group: "none", start: V1 }, { name: "b", model: new Compliance("b", C2), group: "none", start: 0 }],
    [new Resistor("r", 0, 1, R)]);

  it("equalises with the analytical time constant", () => {
    const C1 = 2, C2 = 3, R = 0.5, tau = (R * C1 * C2) / (C1 + C2), V1 = 100, eng = pair(V1, C1, C2, R);
    const dP0 = V1 / C1;
    for (let i = 0; i < 400; i++) {
      eng.step(0.005);
      const s = eng.sample(), want = dP0 * Math.exp(-eng.t / tau);
      expect(Math.abs(s.P[0] - s.P[1])).toBeCloseTo(want, 6);
    }
  });

  it("conserves volume to 1e-9 relative", () => {
    const eng = pair(100, 2, 3, 0.5);
    for (let i = 0; i < 300; i++) { eng.step(0.01); const s = eng.sample(); expect(Math.abs(s.V[0] + s.V[1] - 100) / 100).toBeLessThan(1e-9); }
  });

  it("delivers an event scheduled mid-step exactly at its time, and never steps across it", () => {
    const seen: { at: number; ev: HeartEvent }[] = []; const stops: number[] = [];
    const probe: Element = { name: "probe", onEvent: (ev) => seen.push({ at: eng.t, ev }) };
    const eng = createEngine([{ name: "a", model: new Compliance("a", 1), group: "none", start: 10 }], [probe]);
    eng.onSample((s) => stops.push(s.t));
    eng.schedule({ kind: "atrial", t: 0.0371 }); eng.schedule({ kind: "ventricular", t: 0.0123 });
    eng.step(0.05);
    expect(seen.map((x) => x.ev.kind)).toEqual(["ventricular", "atrial"]);
    expect(seen[0].at).toBeCloseTo(0.0123, 12); expect(seen[1].at).toBeCloseTo(0.0371, 12);
    expect(stops.map((t) => +t.toFixed(12))).toEqual([0.0123, 0.0371, 0.05]);
    expect(eng.t).toBeCloseTo(0.05, 12);
  });

  it("keeps a later event pending when the step ends before it", () => {
    const seen: number[] = [];
    const eng = createEngine([{ name: "a", model: new Compliance("a", 1), group: "none", start: 10 }], [{ name: "probe", onEvent: () => seen.push(eng.t) }]);
    eng.schedule({ kind: "ventricular", t: 0.1 });
    eng.step(0.05); expect(seen).toEqual([]);
    eng.step(0.06); expect(seen[0]).toBeCloseTo(0.1, 12);
  });
});
