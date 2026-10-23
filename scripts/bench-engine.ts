// Engine benchmark: how many times faster than real time the engines run, so later work can hold a performance budget.
//   npx tsx scripts/bench-engine.ts [--json]
// Structural: analyze() builds the model, calibrates the volume offset and runs simulate() to a periodic state. Each case is
// timed after one warm-up run; the median of RUNS is reported. Simulated seconds = beats × 60 / hr.
import { analyze, buildModel, simulate, volumeOffsetFor, type StructuralSpec } from "../src/physics/structural";
import { engineFromModel } from "../src/physics/core/fromModel";
import { LESION_BY_ID, defaults } from "../src/sim/structural";
import { SOLVER } from "../src/config/structural";
import { Simulation } from "../src/sim/simulation";
import type { Scenario } from "../src/sim/scenario";

const RUNS = 5, SIM_SECONDS = 60;
const json = process.argv.includes("--json");

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
function time<T>(fn: () => T): { ms: number; out: T } {
  fn(); // warm-up (JIT, caches)
  const ts: number[] = []; let out!: T;
  for (let i = 0; i < RUNS; i++) { const t0 = performance.now(); out = fn(); ts.push(performance.now() - t0); }
  return { ms: median(ts), out };
}

interface Row { name: string; wallMs: number; beats?: number; simSeconds: number; xRealTime: number; stepsPerSec?: number }

const structural = (name: string, spec: StructuralSpec): Row => {
  const { ms, out } = time(() => analyze(spec, { waveform: false }));
  const simSeconds = (out.beats * 60) / out.hr, stepsPerBeat = Math.round(60 / out.hr / SOLVER.dt);
  return { name: `structural: ${name}`, wallMs: ms, beats: out.beats, simSeconds, xRealTime: simSeconds / (ms / 1000), stepsPerSec: (out.beats * stepsPerBeat) / (ms / 1000) };
};

// Model built once (with its calibrated offset); only the solve is timed, so simulate() and the core are compared like for like.
const solveRow = (name: string, spec: StructuralSpec, solve: (m: ReturnType<typeof buildModel>) => { beats: number }): Row => {
  const m = buildModel(spec, volumeOffsetFor(spec));
  const { ms, out } = time(() => solve(m));
  const simSeconds = (out.beats * 60) / m.hr, stepsPerBeat = Math.round(60 / m.hr / SOLVER.dt);
  return { name, wallMs: ms, beats: out.beats, simSeconds, xRealTime: simSeconds / (ms / 1000), stepsPerSec: (out.beats * stepsPerBeat) / (ms / 1000) };
};

const headless = (name: string, sc: Scenario): Row => {
  const { ms } = time(() => { const s = new Simulation(); s.reset({ seed: 3, ...sc }, { settled: true }); s.step(SIM_SECONDS); });
  return { name: `Simulation: ${name} (${SIM_SECONDS} s)`, wallMs: ms, simSeconds: SIM_SECONDS, xRealTime: SIM_SECONDS / (ms / 1000) };
};

const lesion = (id: string) => { const l = LESION_BY_ID[id]!; return l.build(defaults(l)); };
const rows: Row[] = [
  structural("adult normal heart", {}),
  structural("neonate normal heart", { patient: "neonate" }),
  structural("tetralogy of Fallot", lesion("tof")),
  solveRow("simulate(): adult normal (solve only)", {}, (m) => simulate(m)),
  solveRow("core: adult normal (fromModel + periodic)", {}, (m) => engineFromModel(m).periodic(m.hr)),
  headless("normal patient", {}),
  headless("proximal LAD occlusion", { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }] }),
];

if (json) console.log(JSON.stringify({ node: process.version, runs: RUNS, rows }, null, 2));
else {
  console.log(`Node ${process.version}, median of ${RUNS} runs after one warm-up\n`);
  console.log("case".padEnd(48) + "wall ms".padStart(10) + "beats".padStart(7) + "sim s".padStart(8) + "x real".padStart(9) + "steps/s".padStart(11));
  for (const r of rows) console.log(r.name.padEnd(48) + r.wallMs.toFixed(1).padStart(10) + String(r.beats ?? "-").padStart(7) + r.simSeconds.toFixed(1).padStart(8) + r.xRealTime.toFixed(1).padStart(9) + (r.stepsPerSec ? r.stepsPerSec.toExponential(2) : "-").padStart(11));
}
