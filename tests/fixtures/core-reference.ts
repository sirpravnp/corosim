// One-off generator of tests/fixtures/core-reference.json: the output of the OLD hand-written RK4 loop in physics/structural.ts
// (before task A2 replaced it with the core engine) for the cases tests/core.test.ts compares against. It was run once, at the
// commit parent of A2, with `npx tsx tests/fixtures/core-reference.ts`. The loop it calls no longer exists, so it cannot be
// re-run at HEAD; the JSON is a frozen reference, never edited by hand.
import { writeFileSync } from "node:fs";
import { buildModel, simulate, volumeOffsetFor, type StructuralSpec } from "../../src/physics/structural";
import { LESIONS, defaults } from "../../src/sim/structural";
import { PATIENTS } from "../../src/config/structural";

/** Lessons added after the old solver was frozen (D1, adult congenital): they are built from the same fields as the lessons below, with no old-solver reference of their own. */
const ADDED_AFTER_FREEZE = new Set(["vsd-eisenmenger", "tof-repaired", "pda-adult"]);
/**
 * The frozen JSON was generated when aortic stenosis span was 0.85 and mitral regurgitant area fraction was 0.12.
 * Those two lessons now use the live calibration; the reference cases stay on the geometry the old solver saw.
 */
const FROZEN_BUILD: Record<string, (v: Record<string, number>) => StructuralSpec> = {
  as: (v) => ({ valves: { av: { open: 1 - 0.85 * v.severity } } }),
  mr: (v) => ({ valves: { mv: { reg: v.severity * 0.12 * PATIENTS.adult.valveAreas.mv } } }),
};
export const REFERENCE_CASES: [string, StructuralSpec][] = [
  ["adult normal", {}], ["neonate normal", { patient: "neonate" }],
  ...LESIONS.filter((l) => !ADDED_AFTER_FREEZE.has(l.id)).map((l) => [l.id, (FROZEN_BUILD[l.id] ?? l.build)(defaults(l))] as [string, StructuralSpec]),
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
