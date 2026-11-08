// The bedside monitor in a case: lead II on pink paper above a row of measurement tiles (numbers in ./caseMonitor.ts). It mounts into #casemon,
// reads the page's one patient snapshot every frame, and shows only what the case's monitor list names. No text besides labels, numbers and units.
import "./caseMonitor.css";
import { EcgStrip } from "../ecgStrip";
import type { Rhythm, Vec3 } from "../config/ecg";
import type { PatientNow } from "../cases/orders";
import { $, sim } from "./state";
import { monitorTiles, type MonitorInput, type Tile } from "./caseMonitor";

let strip: EcgStrip | null = null;
let root: HTMLElement | null = null, tilesEl: HTMLElement, figure: HTMLElement;
let shown: string[] | null = null;
let key = "", wasShowingStrip = false;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function mount(): void {
  if (root) return;
  root = document.createElement("div");
  root.className = "cm"; root.hidden = true;
  root.innerHTML = `<figure class="cm-fig"><canvas class="cm-ecg" role="img" aria-label="Lead II rhythm strip"></canvas><figcaption><b>Figure 1.</b> Lead II, 25 mm/s, 10 mm/mV.</figcaption></figure><div class="cm-tiles" role="group" aria-label="Vital signs"></div>`;
  $("casemon").prepend(root);
  figure = root.querySelector<HTMLElement>(".cm-fig")!; tilesEl = root.querySelector<HTMLElement>(".cm-tiles")!;
  strip = new EcgStrip(root.querySelector<HTMLCanvasElement>(".cm-ecg")!, sim.stream, "strip");
}

/** The monitor items the case shows (ids of cases/orders.ts), or null when no case runs. */
export function setCaseMonitorItems(ids: readonly string[] | null): void {
  shown = ids ? [...ids] : null;
  key = "";
  if (!shown) { if (root) root.hidden = true; wasShowingStrip = false; }
}

/** A tile as markup: the label small, the number in the readout face with its unit beside it. Words ("no pulse") and dashes are not dot-matrix digits. */
function tileHtml(t: Tile): string {
  const m = /^(.*?)(?: (\(.*\)))?$/.exec(t.value)!;
  const numeric = /^[\d/.]+$/.test(m[1]);
  const val = numeric ? `<i>${esc(m[1])}</i>` : `<i class="${m[1] === "—" ? "dash" : "word"}">${esc(m[1])}</i>`;
  const map = m[2] ? `<small>${esc(m[2])}</small>` : "";
  return `<div class="cm-tile${t.abnormal ? " abn" : ""}" data-tile="${t.id}"><div class="cm-top"><span class="cm-label">${esc(t.label)}</span>${t.estimate ? `<span class="cm-est">estimate</span>` : ""}</div>`
    + `<div class="cm-val">${val}${map}${t.unit ? `<em>${esc(t.unit)}</em>` : ""}</div></div>`;
}

/**
 * One frame of the monitor. `now` is the page's patient snapshot (patientNow()), the same numbers the ordered panels are computed from.
 * The strip steps on the simulation's shared beat stream, so it stays beat-exact with the pressure traces.
 */
export function caseMonitorFrame(dt: number, now: PatientNow, fx: { injury: Vec3; tBoost: number; potassium: number }, rhythm: Rhythm): void {
  render(dt, now, fx, rhythm);
}
/** While the engine settles there are no beats yet: dashes and blank paper, so the screen is not a hole. */
export function caseMonitorSettling(): void { render(0, null, null, "sinus" as Rhythm); }

function render(dt: number, now: PatientNow | null, fx: { injury: Vec3; tBoost: number; potassium: number } | null, rhythm: Rhythm): void {
  if (!shown) return;
  mount();
  root!.hidden = false;
  const tiles = monitorTiles(now ?? ({} as MonitorInput), shown);
  const k = tiles.map((t) => `${t.id}|${t.value}|${t.abnormal}`).join(";");
  if (k !== key) { key = k; tilesEl.innerHTML = tiles.map(tileHtml).join(""); tilesEl.hidden = !tiles.length; }
  const showStrip = shown.includes("ecg");
  figure.hidden = !showStrip;
  if (!showStrip) { wasShowingStrip = false; return; }
  if (!wasShowingStrip) { strip!.reset(sim.t); wasShowingStrip = true; }
  if (fx && !sim.dead) strip!.step(dt, fx.injury, fx.tBoost, rhythm, fx.potassium); // death freezes the strip
  strip!.draw();
}

/** The core engine was rebuilt: the strip starts from now. */
export function caseMonitorReset(): void { strip?.reset(sim.t); }
