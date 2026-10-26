// Side-by-side of the two ACS engines ("legacy" circulation() and "core" LiveHeart) on the five scenarios of the regression
// fixtures (tests/fixtures/compute.ts), for gate R-A2:
//   npx tsx scripts/compare-engines.ts
// Same setup as the fixtures: settled start, seed 3, 60 s warm-up with no clinical time, then 60 s; every number is the mean of
// the beats of the LAST 30 s (what a monitor shows); the state is the circulation state at the end. The core also prints the
// catheter numbers (CVP, PCWP, LVEDP), which the legacy engine does not have.
import { Simulation, type EngineKind } from "../src/sim/simulation";
import { ACS_SCENARIOS, ACS_SEED, ACS_WARMUP_S, ACS_TRACE_S } from "../tests/fixtures/compute";

const WINDOW_S = 30;
const f = (x: number | undefined, d = 0) => (x === undefined || !Number.isFinite(x) ? "-" : x.toFixed(d));

function run(engine: EngineKind, name: string) {
  const s = new Simulation({}, { engine });
  s.reset({ seed: ACS_SEED, ...ACS_SCENARIOS[name] }, { settled: true });
  s.warmup(ACS_WARMUP_S); s.history = [];
  s.step(ACS_TRACE_S);
  const r = s.rolling(WINDOW_S), h = s.hemo(WINDOW_S);
  return { map: r.map, sv: r.sv, co: r.cardiacOutput, hr: r.hr, state: s.state().circulationState, cvp: h?.cvp, pcwp: h?.pcwp, lvedp: h?.lvedp, warnings: s.warnings };
}

const rows: string[][] = [["scenario", "engine", "MAP", "SV", "CO", "HR", "state", "CVP", "PCWP", "LVEDP"]];
const t0 = performance.now();
for (const name of Object.keys(ACS_SCENARIOS)) {
  for (const engine of ["legacy", "core"] as const) {
    const o = run(engine, name);
    rows.push([name, engine, f(o.map), f(o.sv), f(o.co, 1), f(o.hr), o.state, f(o.cvp), f(o.pcwp), f(o.lvedp)]);
  }
}
const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
for (const [i, r] of rows.entries()) {
  console.log("| " + r.map((c, j) => (j < 2 || j === 6 ? c.padEnd(w[j]) : c.padStart(w[j]))).join(" | ") + " |");
  if (i === 0) console.log("|" + w.map((n) => "-".repeat(n + 2)).join("|") + "|");
}
console.log(`\nMAP mmHg (true mean aortic pressure per beat), SV ml, CO L/min (device flow included), HR bpm; CVP, PCWP, LVEDP mmHg (core only). ${(performance.now() - t0) / 1000 | 0} s wall.`);
