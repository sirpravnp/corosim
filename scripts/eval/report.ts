// The snapshot the owner reads. Numbers come from the last `observe`; nothing here is an expectation.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { VARIABLES, type Value } from "./variables";
import { STATES, type State } from "./states";
import { SWEEP_SKIPPED } from "./sweep";
import { cpOf, summarise, type SeedRun } from "./engine";
import { parseRule } from "./grammar";
import { FIELDS } from "../../src/sim/registry";

export const REPORT_VARS = ["hr", "sbp", "dbp", "map", "co", "sv", "lvEf", "pcwp", "cvp", "spo2", "svo2", "do2", "ischemicMassFraction", "lvInfarctFraction", "st.V2", "st.III", "st.aVL", "st.II", "st.aVF", "rhythm", "status", "dead", "lvedp", "lvPeakSys", "arrestStatus"];

const meanOf = (runs: SeedRun[], cp: string, id: string): number | null => {
  const a = runs.map((r) => r.at[cp]?.[id]).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
};
const moved = (base: Value | undefined, v: Value | undefined): boolean => {
  if (typeof base === "number" && typeof v === "number") return Math.abs(v - base) > Math.max(0.05 * Math.abs(base), 0.01);
  if (typeof base === "boolean" && typeof v === "boolean") return base !== v;
  if ((typeof base === "string" || typeof v === "string") && base != null && v != null) return String(base) !== String(v);
  return false;
};

/** Wilson score interval, 95%. */
export function wilson(k: number, n: number): { p: number; lo: number; hi: number } {
  if (!n) return { p: NaN, lo: NaN, hi: NaN };
  const z = 1.96, ph = k / n, z2 = z * z, den = 1 + z2 / n;
  const centre = (ph + z2 / (2 * n)) / den;
  const margin = (z * Math.sqrt((ph * (1 - ph) + z2 / (4 * n)) / n)) / den;
  return { p: ph, lo: Math.max(0, centre - margin), hi: Math.min(1, centre + margin) };
}
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;

function load(outDir: string, id: string): SeedRun[] | null {
  const f = join(outDir, `${id}.json`);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, "utf8")) as SeedRun[];
}

function stateTable(st: State, runs: SeedRun[]): string[] {
  const good = runs.filter((r) => !r.error);
  const cps = ["base", ...cpOf(st).map(String)];
  const lines = [`### ${st.id}`, "", st.title, ""];
  const crashed = runs.filter((r) => r.error);
  if (crashed.length) lines.push(`**Crashed:** ${crashed.map((r) => `seed ${r.seed}: ${r.error!.split(" | ")[0]}`).join("; ")}`, "");
  const warnings = [...new Set(runs.flatMap((r) => r.warnings))];
  if (warnings.length) lines.push(`**Warnings:** ${warnings.join(" | ")}`, "");
  if (!good.length) return lines;
  lines.push("| variable | " + cps.map((c) => (c === "base" ? "base" : `t${c}s`)).join(" | ") + " |", "|---|" + cps.map(() => "---").join("|") + "|");
  for (const id of REPORT_VARS) {
    const v = VARIABLES.find((x) => x.id === id);
    if (!v) continue;
    lines.push(`| ${id} | ` + cps.map((c) => summarise(good, c, id, v.kind).replace(/\|/g, "/") || " ").join(" | ") + " |");
  }
  lines.push("");
  return lines;
}

function rateBlock(outDir: string, specDir: string): string[] {
  const specs: { id: string; title: string; cp: string; idVar: string; pred: (row: Record<string, Value>) => boolean; note: string }[] = [
    { id: "lad-occlusion-then-lysis", title: "Fibrinolysis success", cp: "40", idVar: "lysisSucceeded", pred: (r) => r.lysisSucceeded === true, note: "The plan's informal figure is about 55%. A 24-seed interval around 55% is about 35-74%, so a spec cell has to be that wide. No expectation cell is written here." },
    { id: "vf-shock-200", title: "Defibrillation of VF at 200 J", cp: "25", idVar: "dead", pred: (r) => r.dead === false && r.arrestStatus !== "arrest", note: "Success means the patient is alive and not in arrest at 25 s (5 s after the shock). There is no expectation cell." },
    { id: "lad-vt-vf-6h", title: "VT or VF by 6 h after proximal LAD occlusion", cp: "180", idVar: "episodes", pred: (r) => ["episodes.nsvt", "episodes.mono", "episodes.poly", "episodes.vf"].some((k) => typeof r[k] === "number" && (r[k] as number) > 0), note: "Any episode of NSVT, monomorphic VT, polymorphic VT or VF. There is no expectation cell." },
    { id: "lad-reperfuse-pvc", title: "At least one PVC after reperfusion", cp: "40", idVar: "pvcsPer10s", pred: (r) => typeof r.pvcsPer10s === "number" && r.pvcsPer10s > 0, note: "Share of seeds with pvcsPer10s > 0 at 40 s (after PCI at 10 s). There is no expectation cell." },
  ];
  const lines = ["## Stochastic outcomes", "", "Wilson 95% interval. Compared with a `p<lo>..<hi>` cell when one has been written.", ""];
  lines.push("| outcome | k/n | rate | 95% interval | spec |", "|---|---|---|---|---|");
  for (const s of specs) {
    const runs = load(outDir, s.id);
    if (!runs) { lines.push(`| ${s.title} | | | | not run |`); continue; }
    const good = runs.filter((r) => !r.error && r.at[s.cp]);
    const k = good.filter((r) => s.pred(r.at[s.cp])).length;
    const w = wilson(k, good.length);
    let spec = "no cell";
    const specFile = join(specDir, `${s.id}.csv`);
    if (existsSync(specFile)) {
      const rows = readFileSync(specFile, "utf8").split("\n").map((l) => l.split(","));
      const head = rows.find((r) => r[0] === "variable");
      const col = head?.findIndex((h) => h === `t${s.cp}s`) ?? -1;
      const row = rows.find((r) => r[0] === s.idVar);
      const raw = col >= 0 ? row?.[col] ?? "" : "";
      const rule = parseRule(raw);
      if (rule && rule !== "bad" && rule.k === "rate") {
        const inside = w.p >= rule.lo && w.p <= rule.hi;
        spec = `\`${raw}\` ${inside ? "covers the rate" : "does not cover the rate"}`;
      }
    }
    lines.push(`| ${s.title} | ${k}/${good.length} | ${good.length ? pct(w.p) : ""} | ${good.length ? `${pct(w.lo)}-${pct(w.hi)}` : ""} | ${spec} |`);
    if (runs.some((r) => r.error)) lines.push(`| | crashed: ${runs.filter((r) => r.error).length} | | | |`);
  }
  lines.push("");
  for (const s of specs) lines.push(`- **${s.title}.** ${s.note}`);
  lines.push("");
  return lines;
}

function valveBlock(outDir: string): string[] {
  const lines = ["## Valves, against the engine's own claims", "", "docs/VALVES.md measured the structural model with no reflexes (aortic stenosis plus mitral regurgitation: mean gradient about 43 mmHg against 48 alone, mitral regurgitant fraction about 51% against 47%). tests/valvesSim.test.ts, on the live engine, requires a mean aortic gradient above 30 mmHg and mitral regurgitant volume above 30 ml for that pair. The numbers below are the live core engine (mean over seeds at t60s, or the last checkpoint).", ""];
  const at = (id: string, varId: string) => { const r = load(outDir, id); if (!r) return null; const good = r.filter((x) => !x.error); const cps = good[0] ? Object.keys(good[0].at).filter((k) => k !== "base").sort((a, b) => +a - +b) : []; const cp = cps.includes("60") ? "60" : cps[cps.length - 1]; return cp ? { cp, v: meanOf(good, cp, varId), base: meanOf(good, "base", varId) } : null; };
  const fmt = (x: { cp: string; v: number | null; base: number | null } | null, unit = "") => x ? `${x.v === null ? "missing" : x.v.toFixed(2)}${unit} at t${x.cp}s (base ${x.base === null ? "missing" : x.base.toFixed(2)})` : "not run";
  lines.push(`- Severe aortic stenosis, mean gradient: ${fmt(at("as-severe", "valve.av.meanGradient"), " mmHg")}; LV peak: ${fmt(at("as-severe", "lvPeakSys"), " mmHg")}; aortic systolic: ${fmt(at("as-severe", "sbp"), " mmHg")}.`);
  lines.push(`- Aortic stenosis plus mitral regurgitation, aortic mean gradient: ${fmt(at("as-mr", "valve.av.meanGradient"), " mmHg")}; mitral regurgitant fraction: ${fmt(at("as-mr", "valve.mv.regurgFraction"))}; mitral regurgitant volume: ${fmt(at("as-mr", "valve.mv.regurgMl"), " ml")}.`);
  lines.push(`- Chronic mitral regurgitation (same 0.6 leak, enlarged atrium), regurgitant fraction: ${fmt(at("mr-chronic", "valve.mv.regurgFraction"))}.`);
  lines.push(`- Aortic stenosis plus LAD 80%, LVEDP: ${fmt(at("as-lad-80", "lvedp"), " mmHg")}; EF: ${fmt(at("as-lad-80", "lvEf"))}. The earlier note of LVEDP 8 to 13 and EF 0.62 to 0.45 is checked against this, not written in as an expectation.`);
  lines.push(`- 23 mm mechanical aortic valve, regurgitant volume (closing leak): ${fmt(at("avr-mech-23", "valve.av.regurgMl"), " ml")}; mean gradient: ${fmt(at("avr-mech-23", "valve.av.meanGradient"), " mmHg")}.`);
  lines.push(`- Valve-in-valve mean gradient: ${fmt(at("valve-in-valve", "valve.av.meanGradient"), " mmHg")}; 26 mm TAVR: ${fmt(at("tavr-26", "valve.av.meanGradient"), " mmHg")}.`);
  lines.push("");
  return lines;
}

function sweepBlock(outDir: string): { md: string[]; nothing: string[] } {
  const lines = ["## Input sweep", "", "Each patient field at its low, middle and high value, one seed, compared with that seed's own baseline at the last checkpoint. A variable counts as moved when it changes by more than 5% of its baseline or by more than 0.01, whichever is larger (the same band as `same` in the expectation grammar). `seed` is not swept.", ""];
  const nothing: string[] = [];
  const byField = new Map<string, { level: string; value: string; moved: string[]; error?: string; noPage: boolean }[]>();
  for (const st of STATES.filter((s) => s.suite === "sweep" && s.sweep)) {
    const runs = load(outDir, st.id);
    const meta = st.sweep!;
    const row = { level: meta.level, value: meta.value, moved: [] as string[], error: undefined as string | undefined, noPage: meta.noPageControl };
    const list = byField.get(meta.field) ?? [];
    list.push(row); byField.set(meta.field, list);
    if (!runs) { row.error = "not run"; continue; }
    const good = runs.find((r) => !r.error);
    if (!good) { row.error = runs[0]?.error?.split(" | ")[0] ?? "crashed"; continue; }
    const cps = Object.keys(good.at).filter((k) => k !== "base").sort((a, b) => +a - +b);
    const cp = cps[cps.length - 1];
    if (!cp) { row.error = "no checkpoint"; continue; }
    for (const v of VARIABLES) if (moved(good.at.base?.[v.id], good.at[cp]?.[v.id])) row.moved.push(v.id);
    if (!row.moved.length) nothing.push(`${meta.field} ${meta.level}=${meta.value}`);
  }
  if (!byField.size) { lines.push("Not run.", ""); return { md: lines, nothing }; }
  lines.push("| field | level | value | variables that moved |", "|---|---|---|---|");
  for (const [field, rows] of byField) for (const r of rows) {
    const movedText = r.error ? `**${r.error}**` : r.moved.length ? (r.moved.length > 24 ? `${r.moved.slice(0, 24).join(", ")} (+${r.moved.length - 24})` : r.moved.join(", ")) : "(none)";
    lines.push(`| ${field} | ${r.level} | ${r.value.replace(/\|/g, "/")} | ${movedText} |`);
  }
  lines.push("");
  const noPage = FIELDS.filter((f) => f.target === "patient" && f.controls.length === 0).map((f) => f.path);
  lines.push("### No page control", "", "These patient fields have an empty `controls` list (set from chat or a link only). The registry has " + noPage.length + ", not 8:", "", ...noPage.map((p) => `- \`${p}\``), "");
  lines.push("Not swept:", "", ...SWEEP_SKIPPED.map((s) => `- \`${s.field}\`: ${s.why}`), "");
  if (nothing.length) lines.push("### Controls that moved nothing", "", ...nothing.map((s) => `- ${s}`), "");
  return { md: lines, nothing };
}

export function renderReport(outDir: string, specDir: string): string {
  let hash = "unknown", date = "unknown";
  try { hash = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }
  try { date = execSync("TZ=America/New_York date '+%Y-%m-%d %H:%M %Z'", { encoding: "utf8" }).trim(); } catch { /* date unavailable */ }
  const have = new Set(readdirSync(outDir).filter((f) => f.endsWith(".json") && f !== "timescale.json").map((f) => f.replace(/\.json$/, "")));
  const lines: string[] = [
    "# Core engine evaluation snapshot",
    "",
    `Generated ${date} from commit \`${hash}\`. Core engine only (\`engine: "core"\`, empty \`coreNote\`). Checkpoints are simulated seconds after the insult; at 1x that is 2 clinical minutes per second. A cell is the mean and the min..max across seeds. This file is a snapshot of a run, not a specification.`,
    "",
    "## Standard states",
    "",
  ];
  for (const st of STATES.filter((s) => (s.suite ?? "standard") === "standard")) {
    const runs = load(outDir, st.id);
    if (!runs) { lines.push(`### ${st.id}`, "", "Not run.", ""); continue; }
    lines.push(...stateTable(st, runs));
  }
  lines.push("## Edge states", "", "Invariants only. A crash is a failure of that input; warnings are what the normaliser reported.", "");
  for (const st of STATES.filter((s) => s.suite === "edge")) {
    const runs = load(outDir, st.id);
    if (!runs) continue;
    const crashed = runs.filter((r) => r.error);
    const warnings = [...new Set(runs.flatMap((r) => r.warnings))];
    lines.push(`- **${st.id}** (${st.title}). ${crashed.length ? `CRASH seed ${crashed.map((r) => r.seed).join(",")}: ${crashed[0].error!.split(" | ")[0]}` : `${runs.length} seeds, no throw`}${warnings.length ? `. Warnings: ${warnings.join(" | ")}` : ". No warnings."}`);
  }
  lines.push("");
  const ts = join(outDir, "timescale.md");
  if (existsSync(ts)) lines.push(readFileSync(ts, "utf8"), "");
  lines.push(...rateBlock(outDir, specDir));
  if ([...have].some((id) => STATE_BY_ID_hasValve(id))) lines.push(...valveBlock(outDir));
  const sweep = sweepBlock(outDir);
  if (sweep.md.length) lines.push(...sweep.md);
  lines.push("## Open questions", "",
    "1. Also a spec family for the static Structural tab (`analyze()`: neonates, congenital lesions, no reflexes)? Not started.",
    "2. Seeds: 8 for deterministic states, 24 for the four stochastic states. Rate cells, when written, need to be wide.",
    "3. Expectation source: PMID-cited literature, or clinical judgment marked as such? Not decided. No expectation cell was filled by this run.",
    "4. Unify the two EF definitions, or keep both labelled? Not started (that would change `src/` and the fixtures).",
    "");
  return lines.join("\n");
}

function STATE_BY_ID_hasValve(id: string): boolean {
  return STATES.some((s) => s.id === id && s.suite === "valve");
}
