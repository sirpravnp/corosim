// Engine benchmark: how many times faster than real time the engines run, so later work can hold a performance budget.
//   npx tsx scripts/bench-engine.ts [--json]
// Structural: analyze() builds the model, calibrates the volume offset and runs simulate() to a periodic state. Each case is
// timed after one warm-up run; the median of RUNS is reported. Simulated seconds = beats × 60 / hr.
import { analyze, buildModel, simulate, volumeOffsetFor, type StructuralSpec } from "../src/physics/structural";
import { createEngine } from "../src/physics/core/engine";
import { engineFromModel, fromModel } from "../src/physics/core/fromModel";
import { LESION_BY_ID, defaults } from "../src/sim/structural";
import { SOLVER } from "../src/config/structural";
import { Simulation } from "../src/sim/simulation";
import type { Scenario } from "../src/sim/scenario";
import type { PatientSpec } from "../src/sim/patient";
import { LiveSource } from "../src/sim/liveSource";

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

// The Simulator page (task P16): the core-engine Simulation stepped in 50 ms frames and read through a LiveSource (a BeatSummary per beat,
// and every third frame numbers(), saturations() and a 6 s trace of four nodes, as the panels draw). Building and settling are not timed
// (they take about a second: `setPatient` on a structural change); the median of RUNS runs of SIM_SECONDS is reported.
const live = (name: string, sp: PatientSpec): Row => {
  const ts: number[] = [];
  for (let r = 0; r < RUNS + 1; r++) {
    const s = new Simulation({}, { engine: "core" }), src = new LiveSource(s);
    s.reset({ seed: 3, ...sp }, { settled: true }); s.warmup(5);
    const t0 = performance.now();
    for (let i = 0; i < SIM_SECONDS * 20; i++) { s.step(0.05); if (i % 3 === 0) { src.numbers(); src.saturations(); for (const n of ["AO", "LV", "RA", "PA"]) src.trace(n, 6, { maxPoints: 600 }); } }
    if (r > 0) ts.push(performance.now() - t0); // the first run is the warm-up
  }
  const ms = median(ts);
  return { name: `page (core + LiveSource): ${name} (${SIM_SECONDS} s)`, wallMs: ms, simSeconds: SIM_SECONDS, xRealTime: SIM_SECONDS / (ms / 1000) };
};

const lesion = (id: string) => { const l = LESION_BY_ID[id]!; return l.build(defaults(l)); };
const rows: Row[] = [
  structural("adult normal heart", {}),
  structural("neonate normal heart", { patient: "neonate" }),
  structural("tetralogy of Fallot", lesion("tof")),
  solveRow("simulate(): adult normal (solve only)", {}, (m) => simulate(m)),
  solveRow("core: adult normal (fromModel + periodic)", {}, (m) => engineFromModel(m).periodic(m.hr)),
  solveRow("core + septum: adult normal (B2)", {}, (m) => engineFromModel(m, { septum: true }).periodic(m.hr)),
  solveRow("core: adult shock + Impella CP P8 (fromModel + periodic)", { lvEes: 0.35, lvStiffness: 1.6 }, (m) => { const g = fromModel(m, { impella: { model: "CP", level: 8 } }); return createEngine(g.nodes, g.elements, g.options).periodic(m.hr); }),
  headless("normal patient", {}),
  headless("proximal LAD occlusion", { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }] }),
  live("normal adult", {}),
  live("anterior STEMI + Impella CP P6", { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }], devices: { impella: { model: "CP", level: 6 } } }),
  live("tamponade 200 ml + ventilated PEEP 8", { pericardium: { effusionMl: 200 }, ventilation: { mode: "positive", peep: 8 } }),
  live("VA-ECMO 4 L/min + IABP 1:2", { devices: { ecmo: { flowLpm: 4 }, iabp: { ratio: 2 } } }),
];

if (json) console.log(JSON.stringify({ node: process.version, runs: RUNS, rows }, null, 2));
else {
  console.log(`Node ${process.version}, median of ${RUNS} runs after one warm-up\n`);
  console.log("case".padEnd(48) + "wall ms".padStart(10) + "beats".padStart(7) + "sim s".padStart(8) + "x real".padStart(9) + "steps/s".padStart(11));
  for (const r of rows) console.log(r.name.padEnd(48) + r.wallMs.toFixed(1).padStart(10) + String(r.beats ?? "-").padStart(7) + r.simSeconds.toFixed(1).padStart(8) + r.xRealTime.toFixed(1).padStart(9) + (r.stepsPerSec ? r.stepsPerSec.toExponential(2) : "-").padStart(11));
}
