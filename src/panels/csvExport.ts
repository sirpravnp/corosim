/**
 * CSV export of what the panels draw (task P13). Pure string builders (DOM-free); the Blob download is `downloadCsv`.
 * Traces: one row per sample of `source.trace`, time plus every node's pressure (mmHg) and the chamber volumes (ml).
 * Beats: one row per completed beat with its numbers.
 */
import type { BeatSummary, Chamber, HemoSource, Series } from "../sim/hemoSource";

export const CSV_SECONDS = 30;
export const CSV_BEATS = 20;
export const CSV_MAX_POINTS = 6000;
const CHAMBERS: readonly Chamber[] = ["RA", "RV", "LA", "LV"];
const VALVES = ["AV", "MV", "TV", "PV"] as const;

/** Shortest text that reads back as the same float32 (9 significant digits); empty for NaN. */
export function cell(x: number): string {
  return Number.isFinite(x) ? String(Number(x.toPrecision(9))) : "";
}
const line = (cells: readonly string[]): string => cells.join(",");

/** Value of `s` at time `t` (exact sample when the grids match, else linear interpolation; NaN outside). */
function at(s: Series, i: number, t: number, ref: Series): number {
  if (s.t.length === ref.t.length && s.t[i] === t) return s.v[i];
  const n = s.t.length;
  if (!n || t < s.t[0] || t > s.t[n - 1]) return NaN;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s.t[m] <= t) lo = m; else hi = m; }
  const span = s.t[hi] - s.t[lo];
  return span > 0 ? s.v[lo] + ((s.v[hi] - s.v[lo]) * (t - s.t[lo])) / span : s.v[lo];
}

/** Column names of the trace CSV for a source. */
export function traceColumns(nodes: readonly string[]): string[] {
  return ["time_s", ...nodes.map(n => `${n}_mmHg`), ...CHAMBERS.map(c => `${c}_vol_ml`)];
}

export function traceCsv(source: HemoSource, seconds = CSV_SECONDS, maxPoints = CSV_MAX_POINTS): string {
  const nodes = source.nodes();
  const cols: Series[] = [
    ...nodes.map(n => source.trace(n, seconds, { maxPoints })),
    ...CHAMBERS.map(c => source.trace(c, seconds, { quantity: "volume", maxPoints })),
  ];
  const ref = cols.find(s => s.t.length) ?? { t: new Float32Array(0), v: new Float32Array(0) };
  const out = [line(traceColumns(nodes))];
  for (let i = 0; i < ref.t.length; i++) {
    const t = ref.t[i];
    out.push(line([cell(t), ...cols.map(s => cell(s === ref ? ref.v[i] : at(s, i, t, ref)))]));
  }
  return out.join("\n") + "\n";
}

/** Time-weighted mean of samples v over times t (trapezoid). */
function mean(t: Float32Array, v: Float32Array): number {
  if (v.length < 2) return v.length ? v[0] : NaN;
  let a = 0;
  for (let i = 1; i < v.length; i++) a += ((v[i] + v[i - 1]) / 2) * (t[i] - t[i - 1]);
  const d = t[t.length - 1] - t[0];
  return d > 0 ? a / d : v[0];
}
const maxOf = (v: Float32Array) => v.reduce((m, x) => (x > m ? x : m), -Infinity);
const minOf = (v: Float32Array) => v.reduce((m, x) => (x < m ? x : m), Infinity);

export function beatColumns(nodes: readonly string[]): string[] {
  return [
    "beat", "t_s", "rr_s", "hr_bpm", "pvc", "lv_stroke_volume_ml",
    ...CHAMBERS.flatMap(c => [`${c}_edv_ml`, `${c}_esv_ml`]),
    ...nodes.flatMap(n => [`${n}_max_mmHg`, `${n}_min_mmHg`, `${n}_mean_mmHg`]),
    ...VALVES.flatMap(v => [`${v}_forward_ml`, `${v}_regurg_ml`, `${v}_open_ms`]),
  ];
}

export function beatsCsv(source: HemoSource, count = CSV_BEATS): string {
  const nodes = source.nodes(), beats: readonly BeatSummary[] = source.beats(count);
  const out = [line(beatColumns(nodes))];
  beats.forEach((b, k) => {
    out.push(line([
      String(k + 1), cell(b.t), cell(b.rr), cell(60 / b.rr), b.pvc ? "1" : "0", cell(b.strokeVolume),
      ...CHAMBERS.flatMap(c => [cell(b.edv[c]), cell(b.esv[c])]),
      ...nodes.flatMap(n => {
        const p = b.pressure[n as keyof BeatSummary["pressure"]];
        return p && p.length ? [cell(maxOf(p)), cell(minOf(p)), cell(mean(b.time, p))] : ["", "", ""];
      }),
      ...VALVES.flatMap(v => [cell(b.valves[v].forwardMl), cell(b.valves[v].regurgMl), cell(b.valves[v].openMs)]),
    ]));
  });
  return out.join("\n") + "\n";
}

/** Download text as a CSV file through a Blob and a temporary link. */
export function downloadCsv(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
