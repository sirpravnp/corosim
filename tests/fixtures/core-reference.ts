// One-off generator of tests/fixtures/core-reference.json: the output of the OLD hand-written RK4 loop in physics/structural.ts
// (before task A2 replaced it with the core engine) for the cases tests/core.test.ts compares against. It was run once, at the
// commit parent of A2, with `npx tsx tests/fixtures/core-reference.ts`. The loop it calls no longer exists, so it cannot be
// re-run at HEAD; the JSON is a frozen reference, never edited by hand.
import { writeFileSync } from "node:fs";
import { buildModel, simulate, volumeOffsetFor, type StructuralSpec } from "../../src/physics/structural";
import { LESIONS, defaults } from "../../src/sim/structural";

export const REFERENCE_CASES: [string, StructuralSpec][] = [
  ["adult normal", {}], ["neonate normal", { patient: "neonate" }],
  ...LESIONS.map((l) => [l.id, l.build(defaults(l))] as [string, StructuralSpec]),
];

// Waveforms are large; the two normal hearts carry them, which is enough to pin the sampling grid and rounding.
const WAVE_FOR = new Set(["adult normal", "neonate normal"]);

if (process.argv[1]?.endsWith("core-reference.ts")) {
  const out: Record<string, unknown> = {};
  for (const [id, spec] of REFERENCE_CASES) {
    const m = buildModel(spec, volumeOffsetFor(spec)), h = simulate(m);
    out[id] = { beats: h.beats, converged: h.converged, p: h.p, vol: h.vol, fwd: h.fwd, bwd: h.bwd, valves: h.valves, volume: h.volume, wave: WAVE_FOR.has(id) ? h.wave : undefined };
  }
  writeFileSync(new URL("./core-reference.json", import.meta.url), JSON.stringify(out));
  console.log(`wrote ${Object.keys(out).length} cases`);
}
