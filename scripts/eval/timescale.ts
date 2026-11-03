// Same insult at the page's three speeds, compared at the same clinical minute.
// Speed 1, 3 and 6 advance 2, 6 and 12 clinical minutes per simulated second, until the patient is critical:
// then the clock runs in real time (at most one clinical second per simulated second). A difference beyond 5%
// against the 1x run, or an arrest at a different clinical time, is a finding.
import { writeFileSync } from "node:fs";
import { Simulation } from "../../src/sim/simulation";
import { LiveSource } from "../../src/sim/liveSource";
import { context, snapshot } from "./variables";
import { STATE_BY_ID } from "./states";
import type { Value } from "./variables";

const SPEEDS = [1, 3, 6] as const;
const TARGETS = [10, 40, 120, 360]; // clinical minutes, the default checkpoints at 1x
const IDS = ["hemorrhage-30", "bleed-100mlmin", "lad-prox-occlusion"];
const SIM_CAP_S = 240;
const KEYS = ["map", "hr", "lvInfarctFraction"] as const;

export interface SpeedSample { clin: number; map: number | null; hr: number | null; lvInfarctFraction: number | null; dead: boolean }
export interface SpeedRun { state: string; speed: number; seed: number; error?: string; arrestClin: number | null; clinEnd: number; samples: SpeedSample[] }

const num = (x: Value | undefined): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

function one(id: string, speed: (typeof SPEEDS)[number], seed: number): SpeedRun {
  const st = STATE_BY_ID[id];
  const out: SpeedRun = { state: id, speed, seed, arrestClin: null, clinEnd: 0, samples: [] };
  try {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ lesions: [], ...(st.baseline ?? {}), seed }, { settled: true, warmup: 30 });
    const src = new LiveSource(s);
    if (s.engine !== "core") throw new Error(`engine is ${s.engine}, not core`);
    if (s.coreNote) throw new Error(`core engine could not settle this patient: ${s.coreNote}`);
    s.warmup(10);
    s.step(20);
    const clin0 = s.clinicalMinutes;
    s.speed = speed;
    s.apply({ ...st.insult });
    const cap = s.t + SIM_CAP_S;
    let next = 0;
    // One step is about 2 clinical minutes at this speed, so a sample lands close to its target. While the patient is
    // critical the same step advances only a fraction of a clinical second, and the sim-time cap stops the run.
    while (s.t < cap - 1e-9 && !s.dead && next < TARGETS.length) {
      s.step(Math.min(1 / speed, cap - s.t));
      const clin = s.clinicalMinutes - clin0;
      if (s.dead && out.arrestClin === null) out.arrestClin = clin;
      while (next < TARGETS.length && clin + 1e-6 >= TARGETS[next]) {
        const row = snapshot(context(s, src, 10));
        out.samples.push({ clin: TARGETS[next], map: num(row.map), hr: num(row.hr), lvInfarctFraction: num(row.lvInfarctFraction), dead: row.dead === true });
        next++;
      }
    }
    if (s.dead && out.arrestClin === null) out.arrestClin = s.clinicalMinutes - clin0;
    out.clinEnd = s.clinicalMinutes - clin0;
  } catch (e) { out.error = (e as Error).message; }
  return out;
}

const cell = (x: number | null) => (x === null ? "" : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
const differs = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) > Math.max(0.05 * Math.abs(a), a === 0 && b === 0 ? 0 : 0.01);

export function runTimescale(seed = 1): { md: string; runs: SpeedRun[]; findings: string[] } {
  const runs: SpeedRun[] = [];
  for (const id of IDS) for (const speed of SPEEDS) {
    process.stderr.write(`\rtimescale ${id} ${speed}x`);
    runs.push(one(id, speed, seed));
  }
  process.stderr.write("\n");
  const findings: string[] = [];
  const lines = ["## Time scale", "", `Seed ${seed}. Columns are the value at that clinical minute for 1x / 3x / 6x. A blank means the run did not reach that clinical minute (the clock is held to real time while the patient is critical, and each run stops at ${SIM_CAP_S} simulated seconds).`, ""];
  for (const id of IDS) {
    const rs = SPEEDS.map((sp) => runs.find((r) => r.state === id && r.speed === sp)!);
    lines.push(`### ${id}`, "");
    if (rs.some((r) => r.error)) { lines.push(rs.map((r) => `${r.speed}x: ${r.error ?? "ok"}`).join("; "), ""); continue; }
    lines.push("| | " + TARGETS.map((t) => `${t} min`).join(" | ") + " |", "|---|" + TARGETS.map(() => "---").join("|") + "|");
    for (const k of KEYS) {
      lines.push(`| ${k} | ` + TARGETS.map((t) => rs.map((r) => cell(r.samples.find((s) => s.clin === t)?.[k] ?? null)).join(" / ")).join(" | ") + " |");
      for (const t of TARGETS) {
        const base = rs[0].samples.find((s) => s.clin === t)?.[k] ?? null;
        for (const r of rs.slice(1)) {
          const v = r.samples.find((s) => s.clin === t)?.[k] ?? null;
          if (base === null || v === null) { if ((base === null) !== (v === null)) findings.push(`${id} ${k} at ${t} clinical min: ${r.speed}x ${v === null ? "did not reach it" : cell(v)} while 1x ${base === null ? "did not" : cell(base)}`); continue; }
          if (differs(base, v)) findings.push(`${id} ${k} at ${t} clinical min: 1x ${cell(base)} vs ${r.speed}x ${cell(v)}`);
        }
      }
    }
    const arrests = rs.map((r) => r.arrestClin);
    lines.push("", `Arrest (clinical min): ${rs.map((r) => `${r.speed}x ${r.arrestClin === null ? "none" : r.arrestClin.toFixed(1)} (reached ${r.clinEnd.toFixed(0)} min)`).join("; ")}`, "");
    const any = arrests.some((a) => a !== null), all = arrests.every((a) => a !== null);
    if (any && !all) findings.push(`${id}: arrest at ${rs.filter((r) => r.arrestClin !== null).map((r) => `${r.speed}x ${r.arrestClin!.toFixed(1)} min`).join(", ")}, and not by the end of the other speeds`);
    if (all) {
      const a0 = arrests[0]!;
      for (let i = 1; i < arrests.length; i++) if (Math.abs(arrests[i]! - a0) > Math.max(0.05 * a0, 1)) findings.push(`${id}: arrest at ${a0.toFixed(1)} clinical min at 1x and ${arrests[i]!.toFixed(1)} at ${SPEEDS[i]}x`);
    }
  }
  if (findings.length) lines.push("Differences beyond 5% (or an arrest at a different clinical time):", "", ...findings.map((f) => `- ${f}`), "");
  else lines.push("No speed differed from 1x by more than 5% at a shared clinical minute, and arrest times agree.", "");
  return { md: lines.join("\n"), runs, findings };
}

export function writeTimescale(outDir: string, seed = 1) {
  const r = runTimescale(seed);
  writeFileSync(`${outDir}/timescale.json`, JSON.stringify(r.runs));
  writeFileSync(`${outDir}/timescale.md`, r.md);
  console.log(r.md);
  return r;
}
