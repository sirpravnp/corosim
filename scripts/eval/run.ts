// Evaluation runner. The engine runs headless (no browser, no site): Simulation is a DOM-free class.
//   npx tsx scripts/eval/run.ts list
//   npx tsx scripts/eval/run.ts template [state ...]     blank spec CSV per state in scripts/eval/spec/ (never overwrites a filled one)
//   npx tsx scripts/eval/run.ts observe  [state ...] [--seeds 8] [--jobs 4]    run seeds, write scripts/eval/out/<state>.observed.csv + .json
//   npx tsx scripts/eval/run.ts check    [state ...]     compare scripts/eval/spec/<state>.csv with the last observe; exit 1 on failures
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Simulation } from "../../src/sim/simulation";
import { LiveSource } from "../../src/sim/liveSource";
import { VARIABLES, CROSS_CHECKS, context, snapshot, type Value } from "./variables";
import { STATES, STATE_BY_ID, CHECKPOINTS, type State } from "./states";
import { parseRule, satisfies, PASS_FRACTION } from "./grammar";

const here = dirname(fileURLToPath(import.meta.url)), SPEC = join(here, "spec"), OUT = join(here, "out");
const BASE_SPEC = { lesions: [] as never[] };
const WARM_S = 40;
type Row = Record<string, Value>;
interface SeedRun { state: string; seed: number; error?: string; warnings: string[]; at: Record<string, Row> } // keys: "base", "5", "20" ...

// ---- one (state, seed): the engine, headless
function runOne(st: State, seed: number): SeedRun {
  const out: SeedRun = { state: st.id, seed, warnings: [], at: {} };
  try {
    const s = new Simulation({}, { engine: "core" });
    s.reset({ ...BASE_SPEC, ...(st.baseline ?? {}), seed }, { settled: true, warmup: 30 });
    // The page makes its LiveSource first. A LiveSource only sees beats made after it exists; one made late has an empty ring and falls back
    // to a single stored warm-up beat (identical for every seed), which would make every baseline look the same.
    const src = new LiveSource(s);
    if (s.engine !== "core") throw new Error(`engine is ${s.engine}, not core`);
    if (s.coreNote) throw new Error(`core engine could not settle this patient: ${s.coreNote}`); // otherwise a plain adult is shown and the run means nothing
    s.warmup(WARM_S - 30);
    s.step(20);
    out.at["base"] = snapshot(context(s, src, 20));
    const t0 = s.t;
    s.apply({ ...st.insult });
    const cps = [...(st.checkpoints ?? CHECKPOINTS)].sort((a, b) => a - b);
    const acts = [...(st.actions ?? [])].sort((a, b) => a.atS - b.atS);
    const events = [...cps.map((t) => ({ t, kind: "snap" as const })), ...acts.map((a) => ({ t: a.atS, kind: "act" as const, a }))].sort((x, y) => x.t - y.t || (x.kind === "act" ? -1 : 1));
    for (const e of events) {
      const dt = t0 + e.t - s.t;
      if (dt > 0) s.step(dt);
      if (e.kind === "act") e.a.run(s); else out.at[String(e.t)] = snapshot(context(s, src, Math.max(5, Math.min(20, e.t))));
    }
    out.warnings = s.warnings.slice();
  } catch (e) { out.error = (e as Error).stack?.split("\n").slice(0, 3).join(" | ") ?? String(e); }
  return out;
}

// ---- driver
const arg = (name: string, d: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const pick = () => {
  const ids = process.argv.slice(3).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--")));
  for (const i of ids) if (!STATE_BY_ID[i]) { console.error(`unknown state ${i}`); process.exit(2); }
  return ids.length ? ids.map((i) => STATE_BY_ID[i]) : STATES;
};
const csvCell = (x: string) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
const parseCsv = (txt: string): string[][] => {
  const rows: string[][] = []; let cur: string[] = [], f = "", q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ",") { cur.push(f); f = ""; } else if (c === "\n") { cur.push(f); rows.push(cur); cur = []; f = ""; } else if (c !== "\r") f += c;
  }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  return rows;
};
const cpOf = (st: State) => (st.checkpoints ?? CHECKPOINTS).slice().sort((a, b) => a - b);

function template(st: State) {
  const file = join(SPEC, `${st.id}.csv`);
  if (existsSync(file)) { console.log(`keep   ${file} (exists)`); return; }
  const head = ["variable", "unit", "panel", ...cpOf(st).map((t) => `t${t}s`), "note"];
  const lines = [`# ${st.id}: ${st.title}. Columns t<N>s = N simulated seconds after the insult (x2 = clinical minutes). Grammar: scripts/eval/grammar.ts`, head.join(",")];
  for (const v of VARIABLES) lines.push([v.id, v.unit, v.panel, ...cpOf(st).map(() => ""), ""].map(csvCell).join(","));
  mkdirSync(SPEC, { recursive: true }); writeFileSync(file, lines.join("\n") + "\n"); console.log(`wrote  ${file}`);
}

async function observe(states: State[]) {
  const seeds = +arg("seeds", "8"), jobs = +arg("jobs", "4");
  const queue = states.flatMap((st) => Array.from({ length: st.seeds ?? seeds }, (_, i) => ({ st, seed: i + 1 })));
  const results: SeedRun[] = []; let next = 0, done = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < queue.length) {
      const job = queue[next++];
      const r = await new Promise<SeedRun>((res) => {
        const p = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "worker", job.st.id, String(job.seed)], { stdio: ["ignore", "pipe", "inherit"] });
        let buf = ""; p.stdout.on("data", (d) => (buf += d));
        p.on("close", () => { try { res(JSON.parse(buf.split("\n").filter((l) => l.startsWith("{")).pop()!)); } catch { res({ state: job.st.id, seed: job.seed, error: "worker produced no result", warnings: [], at: {} }); } });
      });
      results.push(r); done++; process.stderr.write(`\r${done}/${queue.length} runs, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }));
  process.stderr.write("\n"); mkdirSync(OUT, { recursive: true });
  for (const st of states) {
    const runs = results.filter((r) => r.state === st.id).sort((a, b) => a.seed - b.seed);
    writeFileSync(join(OUT, `${st.id}.json`), JSON.stringify(runs));
    const errs = runs.filter((r) => r.error);
    const cps = ["base", ...cpOf(st).map(String)];
    const lines = [`# ${st.id}: ${st.title}; ${runs.length} seeds${errs.length ? `; ${errs.length} CRASHED: ${errs[0].error}` : ""}. Cell = mean (min..max) for numbers, share true for booleans, most common for text.`, ["variable", "unit", "panel", ...cps.map((c) => (c === "base" ? "base" : `t${c}s`))].join(",")];
    for (const v of VARIABLES) lines.push([v.id, v.unit, v.panel, ...cps.map((c) => summarise(runs.filter((r) => !r.error), c, v.id, v.kind))].map(csvCell).join(","));
    writeFileSync(join(OUT, `${st.id}.observed.csv`), lines.join("\n") + "\n");
    console.log(`${st.id.padEnd(26)} ${runs.length} seeds${errs.length ? `  ${errs.length} CRASHED` : ""}  -> out/${st.id}.observed.csv`);
  }
}
function summarise(runs: SeedRun[], cp: string, id: string, kind: string): string {
  const vals = runs.map((r) => r.at[cp]?.[id]).filter((x) => x !== undefined && x !== null) as Exclude<Value, null>[];
  if (!vals.length) return "";
  if (kind === "num") { const a = vals as number[], m = a.reduce((x, y) => x + y, 0) / a.length, f = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)); return `${f(m)} (${f(Math.min(...a))}..${f(Math.max(...a))})`; }
  if (kind === "bool") return `p=${((vals as boolean[]).filter(Boolean).length / vals.length).toFixed(2)}`;
  const c = new Map<string, number>(); for (const x of vals) c.set(String(x), (c.get(String(x)) ?? 0) + 1);
  const top = [...c.entries()].sort((a, b) => b[1] - a[1]); return top.length === 1 ? top[0][0] : `${top[0][0]} (${top[0][1]}/${vals.length}; also ${top.slice(1).map((x) => x[0]).join(" | ")})`;
}

function check(states: State[]) {
  let fail = 0, pass = 0, open = 0, bad = 0;
  for (const st of states) {
    const specFile = join(SPEC, `${st.id}.csv`), runFile = join(OUT, `${st.id}.json`);
    if (!existsSync(specFile)) continue;
    if (!existsSync(runFile)) { console.log(`${st.id}: no observation yet; run observe`); continue; }
    const runs = (JSON.parse(readFileSync(runFile, "utf8")) as SeedRun[]).filter((r) => !r.error);
    const rows = parseCsv(readFileSync(specFile, "utf8")).filter((r) => r.length > 1 && !r[0].startsWith("#"));
    const head = rows[0], cols = head.map((h, i) => ({ h, i })).filter((c) => /^t\d+s$/.test(c.h));
    for (const row of rows.slice(1)) {
      const v = VARIABLES.find((x) => x.id === row[0]); if (!v) { console.log(`${st.id}: unknown variable ${row[0]}`); bad++; continue; }
      for (const c of cols) {
        const raw = row[c.i] ?? "", rule = parseRule(raw); if (rule === null) { open++; continue; }
        const cp = c.h.slice(1, -1); if (rule === "bad") { console.log(`${st.id} ${v.id} ${c.h}: cannot parse "${raw}"`); bad++; continue; }
        const vals = runs.map((r) => ({ v: r.at[cp]?.[v.id] ?? null, b: r.at["base"]?.[v.id] ?? null }));
        let ok: boolean;
        if (rule.k === "rate") { const w = vals.filter((x) => typeof x.v === "boolean"); const p = w.length ? w.filter((x) => x.v).length / w.length : NaN; ok = p >= rule.lo && p <= rule.hi; if (!ok) console.log(`FAIL ${st.id} ${v.id} ${c.h}: expected ${raw}, observed p=${p.toFixed(2)} over ${w.length} seeds`); }
        else { const res = vals.map((x) => satisfies(rule, x.v, x.b)), know = res.filter((x) => x !== null), good = know.filter(Boolean).length; ok = know.length > 0 && good / know.length >= PASS_FRACTION;
          if (!ok) console.log(`FAIL ${st.id} ${v.id} ${c.h}: expected ${raw}, ${good}/${know.length} seeds ok; observed ${summarise(runs, cp, v.id, v.kind)}${rule.k === "delta" || rule.k === "ratio" || rule.k === "dir" ? `  (base ${summarise(runs, "base", v.id, v.kind)})` : ""}`); }
        ok ? pass++ : fail++;
      }
    }
  }
  console.log(`\n${pass} cells pass, ${fail} fail, ${bad} unparseable, ${open} cells with no opinion yet`);
  // Do the panels agree with each other? Independent of any spec.
  for (const st of states) {
    const f = join(OUT, `${st.id}.json`); if (!existsSync(f)) continue;
    const runs = (JSON.parse(readFileSync(f, "utf8")) as SeedRun[]).filter((r) => !r.error);
    for (const x of CROSS_CHECKS) for (const cp of ["base", ...cpOf(st).map(String)]) {
      const d = runs.filter((r) => !(x.unlessDevice && Number(r.at[cp]?.["deviceFlow"]) > 0.1)).map((r) => Math.abs(Number(r.at[cp]?.[x.a]) - Number(r.at[cp]?.[x.b]))).filter(Number.isFinite);
      if (!d.length) continue;
      const worst = Math.max(...d); if (worst > x.tol) console.log(`CROSS ${st.id} ${cp}: ${x.why}: ${x.a} vs ${x.b} differ by up to ${worst.toFixed(3)} (tol ${x.tol})`);
    }
  }
  process.exit(fail || bad ? 1 : 0);
}

const cmd = process.argv[2];
if (cmd === "worker") { const st = STATE_BY_ID[process.argv[3]]; console.log(JSON.stringify(runOne(st, +process.argv[4]))); }
else if (cmd === "list") for (const s of STATES) console.log(`${s.id.padEnd(26)} ${s.title}`);
else if (cmd === "template") pick().forEach(template);
else if (cmd === "observe") await observe(pick());
else if (cmd === "check") check(pick());
else console.log("usage: run.ts list | template [state..] | observe [state..] [--seeds N] [--jobs N] | check [state..]");
