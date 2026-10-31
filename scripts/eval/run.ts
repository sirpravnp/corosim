// Evaluation runner. The engine runs headless (no browser, no site): Simulation is a DOM-free class.
//   npx tsx scripts/eval/run.ts list [--suite standard,edge,valve,stochastic,sweep]
//   npx tsx scripts/eval/run.ts template [state ...] [--observed]   blank spec CSV; --observed adds seen_* columns from the last observe (not expectations)
//   npx tsx scripts/eval/run.ts observe  [state ...] [--seeds 8] [--jobs 4] [--suite S] [--shard i/n]
//   npx tsx scripts/eval/run.ts check    [state ...] [--invariants-only]   expectations, then invariants; exit 1 on either
//   npx tsx scripts/eval/run.ts report   write scripts/eval/out/REPORT.md from whatever has been observed
//   npx tsx scripts/eval/run.ts timescale   hemorrhage, bleed and LAD occlusion at 1x/3x/6x, equal clinical minutes
// Default observe/check skip the input sweep (one state per field value). Pass --suite sweep or --suite all.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VARIABLES, CROSS_CHECKS } from "./variables";
import { STATES, STATE_BY_ID, type State } from "./states";
import { parseRule, satisfies, PASS_FRACTION } from "./grammar";
import { cpOf, runOne, summarise, type SeedRun } from "./engine";
import { scanInvariants } from "./invariants";
import { renderReport } from "./report";
import { writeTimescale } from "./timescale";

const here = dirname(fileURLToPath(import.meta.url));
const SPEC = join(here, "spec");
const OUT = join(here, "out");
const TAKES = new Set(["--seeds", "--jobs", "--suite", "--shard"]);
const DEFAULT_SUITES = ["standard", "edge", "valve", "stochastic"];
const TIMEOUT_MS = 180_000;

const arg = (name: string, d: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (name: string) => process.argv.includes(`--${name}`);
const suiteOf = (st: State) => st.suite ?? "standard";

function pick(): State[] {
  const ids = process.argv.slice(3).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && TAKES.has(all[i - 1])));
  for (const i of ids) if (!STATE_BY_ID[i]) { console.error(`unknown state ${i}`); process.exit(2); }
  let list = ids.length ? ids.map((i) => STATE_BY_ID[i]) : STATES;
  const suite = arg("suite", "");
  if (suite && suite !== "all") {
    const ok = new Set(suite.split(",").map((s) => s.trim()));
    list = list.filter((s) => ok.has(suiteOf(s)));
  } else if (!suite && !ids.length) {
    const skipped = list.filter((s) => !DEFAULT_SUITES.includes(suiteOf(s)));
    list = list.filter((s) => DEFAULT_SUITES.includes(suiteOf(s)));
    if (skipped.length) console.error(`skipping ${skipped.length} states (pass --suite sweep or --suite all)`);
  }
  const shard = arg("shard", "");
  if (shard) {
    const [i, n] = shard.split("/").map(Number);
    if (!Number.isInteger(i) || !Number.isInteger(n) || i < 1 || i > n) { console.error("--shard i/n"); process.exit(2); }
    list = list.filter((_, k) => k % n === i - 1);
  }
  return list;
}

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
const seenMean = (cell: string) => cell.includes(" (") ? cell.slice(0, cell.indexOf(" (")) : cell;

function observedMeans(st: State): Map<string, string[]> | null {
  const f = join(OUT, `${st.id}.observed.csv`);
  if (!existsSync(f)) return null;
  const rows = parseCsv(readFileSync(f, "utf8")).filter((r) => r.length > 1 && !r[0].startsWith("#"));
  const head = rows[0] ?? [];
  const cols = cpOf(st).map((t) => head.indexOf(`t${t}s`));
  const out = new Map<string, string[]>();
  for (const row of rows.slice(1)) out.set(row[0], cols.map((i) => (i >= 0 ? seenMean(row[i] ?? "") : "")));
  return out;
}

function template(st: State) {
  const file = join(SPEC, `${st.id}.csv`);
  const cps = cpOf(st);
  const seen = flag("observed");
  const means = seen ? observedMeans(st) : null;
  const seenHead = seen ? cps.map((t) => `seen_t${t}s`) : [];
  const head = ["variable", "unit", "panel", ...cps.map((t) => `t${t}s`), ...seenHead, "note"];
  const blank = (id: string) => {
    const m = means?.get(id) ?? cps.map(() => "");
    return [id, VARIABLES.find((v) => v.id === id)?.unit ?? "", VARIABLES.find((v) => v.id === id)?.panel ?? "", ...cps.map(() => ""), ...(seen ? m : []), ""];
  };
  mkdirSync(SPEC, { recursive: true });
  if (!existsSync(file)) {
    const lines = [`# ${st.id}: ${st.title}. Columns t<N>s are expectations (grammar.ts). seen_t<N>s is the last observed mean, not an expectation; check ignores it.`, head.join(",")];
    for (const v of VARIABLES) lines.push(blank(v.id).map(csvCell).join(","));
    writeFileSync(file, lines.join("\n") + "\n");
    console.log(`wrote  ${file}`);
    return;
  }
  if (!seen) { console.log(`keep   ${file} (exists)`); return; }
  const rows = parseCsv(readFileSync(file, "utf8"));
  const comment = rows.length && rows[0][0]?.startsWith("#") ? rows[0][0] : "";
  const body = rows.filter((r) => r.length > 1 && !r[0].startsWith("#"));
  const oldHead = body[0] ?? [];
  const expIdx = cps.map((t) => oldHead.indexOf(`t${t}s`));
  const noteIdx = oldHead.indexOf("note");
  const byId = new Map(body.slice(1).map((r) => [r[0], r]));
  const lines = [`# ${st.id}: ${st.title}. Columns t<N>s are expectations. seen_t<N>s is the last observed mean, not an expectation; check ignores it.${comment ? " " + comment.replace(/^#\s*/, "") : ""}`, head.join(",")];
  for (const v of VARIABLES) {
    const prev = byId.get(v.id);
    const exp = expIdx.map((i) => (prev && i >= 0 ? prev[i] ?? "" : ""));
    const m = means?.get(v.id) ?? cps.map(() => "");
    const note = noteIdx >= 0 && prev ? prev[noteIdx] ?? "" : "";
    lines.push([v.id, v.unit, v.panel, ...exp, ...m, note].map(csvCell).join(","));
  }
  writeFileSync(file, lines.join("\n") + "\n");
  console.log(`updated ${file} (seen_* from the last observe; expectation cells kept)`);
}

async function observe(states: State[]) {
  const seeds = +arg("seeds", "8"), jobs = Math.max(1, +arg("jobs", "4"));
  const queue = states.flatMap((st) => Array.from({ length: st.seeds ?? seeds }, (_, i) => ({ st, seed: i + 1 })));
  const results: SeedRun[] = []; let next = 0, done = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (next < queue.length) {
      const job = queue[next++];
      const r = await new Promise<SeedRun>((res) => {
        const p = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "worker", job.st.id, String(job.seed)], { stdio: ["ignore", "pipe", "inherit"] });
        let buf = ""; let timed = false;
        const timer = setTimeout(() => { timed = true; p.kill("SIGKILL"); }, TIMEOUT_MS);
        p.stdout.on("data", (d) => (buf += d));
        p.on("close", () => {
          clearTimeout(timer);
          if (timed) { res({ state: job.st.id, seed: job.seed, error: `timed out after ${TIMEOUT_MS / 1000}s`, warnings: [], at: {} }); return; }
          try { res(JSON.parse(buf.split("\n").filter((l) => l.startsWith("{")).pop()!)); }
          catch { res({ state: job.st.id, seed: job.seed, error: "worker produced no result", warnings: [], at: {} }); }
        });
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
    console.log(`${st.id.padEnd(28)} ${runs.length} seeds${errs.length ? `  ${errs.length} CRASHED` : ""}  -> out/${st.id}.observed.csv`);
  }
}

function check(states: State[]) {
  let fail = 0, pass = 0, open = 0, bad = 0;
  if (!flag("invariants-only")) for (const st of states) {
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
  if (!flag("invariants-only")) {
    console.log(`\n${pass} cells pass, ${fail} fail, ${bad} unparseable, ${open} cells with no opinion yet`);
    for (const st of states) {
      const f = join(OUT, `${st.id}.json`); if (!existsSync(f)) continue;
      const runs = (JSON.parse(readFileSync(f, "utf8")) as SeedRun[]).filter((r) => !r.error);
      for (const x of CROSS_CHECKS) for (const cp of ["base", ...cpOf(st).map(String)]) {
        const d = runs.filter((r) => !(x.unlessDevice && Number(r.at[cp]?.["deviceFlow"]) > 0.1)).map((r) => Math.abs(Number(r.at[cp]?.[x.a]) - Number(r.at[cp]?.[x.b]))).filter(Number.isFinite);
        if (!d.length) continue;
        const worst = Math.max(...d); if (worst > x.tol) console.log(`CROSS ${st.id} ${cp}: ${x.why}: ${x.a} vs ${x.b} differ by up to ${worst.toFixed(3)} (tol ${x.tol})`);
      }
    }
  }
  const runs: SeedRun[] = [];
  for (const st of states) {
    const f = join(OUT, `${st.id}.json`); if (!existsSync(f)) continue;
    runs.push(...(JSON.parse(readFileSync(f, "utf8")) as SeedRun[]));
  }
  const hits = scanInvariants(states, runs);
  console.log(`\n--- invariants ---`);
  const show = hits.slice(0, 80);
  for (const h of show) console.log(`INV ${h.state} seed ${h.seed} ${h.where}: ${h.rule}`);
  if (hits.length > show.length) console.log(`... ${hits.length - show.length} more`);
  console.log(`${hits.length} invariant violations over ${runs.length} runs${runs.length ? "" : " (no observations)"}`);
  const warnStates = states.filter((s) => suiteOf(s) !== "sweep");
  for (const st of warnStates) {
    const f = join(OUT, `${st.id}.json`); if (!existsSync(f)) continue;
    const ws = [...new Set((JSON.parse(readFileSync(f, "utf8")) as SeedRun[]).flatMap((r) => r.warnings))];
    if (ws.length) console.log(`warn ${st.id}: ${ws.join(" | ")}`);
  }
  process.exit(fail || bad || hits.length ? 1 : 0);
}

const cmd = process.argv[2];
if (cmd === "worker") {
  const st = STATE_BY_ID[process.argv[3]];
  if (!st) { console.error(`unknown state ${process.argv[3]}`); process.exit(2); }
  console.log(JSON.stringify(runOne(st, +process.argv[4])));
} else if (cmd === "list") for (const s of pick()) console.log(`${s.id.padEnd(28)} ${(s.suite ?? "standard").padEnd(11)} ${s.title}`);
else if (cmd === "template") pick().forEach(template);
else if (cmd === "observe") await observe(pick());
else if (cmd === "check") check(pick());
else if (cmd === "report") { mkdirSync(OUT, { recursive: true }); const md = renderReport(OUT, SPEC); writeFileSync(join(OUT, "REPORT.md"), md); console.log(`wrote ${join(OUT, "REPORT.md")}`); }
else if (cmd === "timescale") { mkdirSync(OUT, { recursive: true }); writeTimescale(OUT, +arg("seed", "1")); }
else console.log("usage: run.ts list | template [--observed] | observe [--seeds N --jobs N --suite S --shard i/n] | check [--invariants-only] | report | timescale");
