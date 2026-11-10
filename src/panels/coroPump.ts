/**
 * The CoroPump console as a workspace panel (id `coropump`, the catalog item of src/cases/orders.ts). It shows what a pump console
 * shows: flow, cardiac power output, P-level, purge pressure and flow, the aortic and inlet pressure and motor-current waveforms of the last beat, and the alarm list.
 * Free hemoglobin and urine color are not on a pump console; in free play a separate labs line shows them, in a case the learner
 * orders the lab and reads the bedside item. `thrombusBurden` is never displayed: the learner infers a clot from the purge
 * pressure, the lab and the urine. The treatment controls (src/panels/playgroundControls.ts) are hosted inside the pane.
 */
import type { CoroPumpReadout } from "../sim/coreDevices";
import type { HemoSource } from "../sim/hemoSource";
import { DASH } from "./numbers";
import type { Panel, PanelDef } from "./panel";
import "./coroPump.css";

// ---------------------------------------------------------------- formatting (DOM-free, tested)
const fin = (x: number) => Number.isFinite(x);
const num = (x: number, d = 0) => (fin(x) ? x.toFixed(d) : DASH);

/** Cardiac power output in watts: MAP (mean of the aortic trace) times pump flow, over 451. Null without a waveform or a finite input. */
export function coroPumpCpo(r: CoroPumpReadout): number | null {
  const ao = r.waveform?.aorticMmHg;
  if (!ao || ao.length === 0) return null;
  const map = ao.reduce((a, b) => a + b, 0) / ao.length;
  if (!fin(map) || !fin(r.flowLpm)) return null;
  return (map * r.flowLpm) / 451;
}

/** Motor current as peak over trough from the beat's waveform (`745/602 mA`), else the mean. */
function motorCurrentText(r: CoroPumpReadout): string {
  const c = r.waveform?.currentMa;
  if (c && c.length) {
    const hi = Math.round(Math.max(...c)), lo = Math.round(Math.min(...c));
    if (fin(hi) && fin(lo)) return `${hi}/${lo} mA`;
  }
  return fin(r.motorCurrentMa) ? `${num(r.motorCurrentMa)} mA` : DASH;
}

/** The console's numbers as text with units. */
export function coroPumpNumbers(r: CoroPumpReadout) {
  const cpo = coroPumpCpo(r);
  return {
    flow: fin(r.flowLpm) ? `${num(r.flowLpm, 1)} L/min` : DASH,
    cpo: cpo === null ? DASH : `${cpo.toFixed(2)} W`,
    level: `P${r.level}`,
    purgePressure: fin(r.purge.pressureMmHg) ? `${num(r.purge.pressureMmHg)} mmHg` : DASH,
    purgeFlow: fin(r.purge.flowMlHr) ? `${num(r.purge.flowMlHr)} ml/hr` : DASH,
    placement: fin(r.placementAmplitudeMmHg) ? `${num(r.placementAmplitudeMmHg)} mmHg` : DASH,
    motorCurrent: motorCurrentText(r),
  };
}

/** Captions of the two waveform figures (the first sentence is bolded by the pane). */
export const coroPumpFigureCaptions = {
  pressure: "Figure 3. Aortic and inlet pressure, mmHg, over the last beat. With the inlet in the ventricle the inlet trace falls well below the aortic trace in diastole; with the inlet pushed out into the aorta the two traces coincide.",
  current: "Figure 4. Motor current, mA, over the last beat.",
};

/** Alarms as words with a label, so color is never the only cue. */
export function alarmLines(r: CoroPumpReadout): string[] {
  return r.alarms.length ? r.alarms.map((a) => `Alarm: ${a}`) : ["No alarms"];
}

/** The console shows only while a pump is placed and running. */
export const coroPumpShown = (r: CoroPumpReadout | null | undefined): r is CoroPumpReadout => !!r && r.on;

const URINE = { clear: "clear", tea: "tea-colored", dark: "dark" } as const;
/** Free play only: the lab and the bedside item that are not on the pump. In a case the learner orders them (src/cases/orders.ts), so no text here. */
export function coroPumpLabsLine(r: CoroPumpReadout, inCase: boolean): string | null {
  if (inCase) return null;
  const pf = r.hemolysis.plasmaFreeHbMgDl;
  return `Plasma free hemoglobin ${fin(pf) ? Math.round(pf) : DASH} mg/dL. Urine: ${URINE[r.hemolysis.urineColor] ?? DASH}.`;
}

// ---------------------------------------------------------------- what the page lends the pane
/** The page fills this in (src/page/patient.ts): the controls built by the playground, the case gate, and the pump's on/off switch. */
export interface CoroPumpHost {
  /** The treatment and scenario controls (createPlaygroundUi's `mounts.coroPump`); moved into the pane while it is open. */
  controls?: HTMLElement;
  /** True while a running case's learner gate is on: disease controls are hidden. */
  inCase?(): boolean;
  /** Place or remove the pump; false when the gate refuses. */
  setOn?(on: boolean): boolean;
}
export const coroPumpHost: CoroPumpHost = {};

// ---------------------------------------------------------------- the panel
function create(): Panel {
  let src: HemoSource;
  let root: HTMLElement, empty: HTMLElement, live: HTMLElement, placeBtn: HTMLButtonElement, offBtn: HTMLButtonElement;
  let alarms: HTMLElement, labs: HTMLElement, ctlSlot: HTMLElement;
  const nums: Record<string, HTMLElement> = {};
  let inlet: HTMLCanvasElement, current: HTMLCanvasElement;
  let lastKey = "";

  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const cell = (key: string, label: string) => {
    const c = h("div", "cp-cell"), v = h("div", "cp-val", DASH);
    c.append(h("div", "cp-label", label), v);
    nums[key] = v;
    return c;
  };
  const figure = (cls: string, aria: string, caption: string) => {
    const f = h("figure", "cp-fig"), cv = h("canvas", cls), cap = h("figcaption");
    cv.setAttribute("role", "img"); cv.setAttribute("aria-label", aria);
    const b = h("b", "", caption.slice(0, caption.indexOf(".") + 1));
    cap.append(b, caption.slice(caption.indexOf(".") + 1));
    f.append(cv, cap);
    return { f, cv };
  };

  /** One trace (ink) or two on one shared axis: `second` is drawn muted, and `second.names` gives the legend text for both traces. */
  function wave(cv: HTMLCanvasElement, ys: readonly number[] | undefined, unit: string, second?: { ys: readonly number[] | undefined; names: [string, string] }) {
    const dpr = window.devicePixelRatio || 1, W = Math.max(160, cv.clientWidth || cv.width), H = Math.round(W * 0.32);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext("2d");
    if (!g) return;
    const css = getComputedStyle(cv), ink = css.getPropertyValue("--ink").trim() || "#f4f1ea", muted = css.getPropertyValue("--muted").trim() || "#98a0b8", rule = css.getPropertyValue("--rule-light").trim() || "#1a1d2c", bg = css.getPropertyValue("--bg").trim() || "#05060a";
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.font = "11px ui-monospace, Menlo, monospace"; g.fillStyle = muted;
    if (!ys || ys.length < 2) { g.textAlign = "center"; g.fillText("waiting for a completed beat", W / 2, H / 2); g.textAlign = "start"; return; }
    let lo = Infinity, hi = -Infinity;
    for (const y of [...ys, ...(second?.ys ?? [])]) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    if (hi - lo < 10) { const m = (hi + lo) / 2; lo = m - 5; hi = m + 5; } // a flat trace still gets a readable axis
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const L = 40, R = W - 8, T = 8, B = H - 8;
    const x = (i: number) => L + (i / (ys.length - 1)) * (R - L), y = (v: number) => B - ((v - lo) / (hi - lo)) * (B - T);
    g.strokeStyle = rule; g.lineWidth = 1;
    for (const v of [lo + pad, hi - pad]) { g.beginPath(); g.moveTo(L, y(v)); g.lineTo(R, y(v)); g.stroke(); g.fillText(String(Math.round(v)), 4, y(v) + 4); }
    g.fillText(unit, L + 4, T + 8);
    const trace = (series: readonly number[], color: string) => {
      g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath();
      series.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
      g.stroke();
    };
    if (second?.ys && second.ys.length >= 2) trace(second.ys, muted);
    trace(ys, ink);
    if (second) { // text legend, in the two trace colors, top right
      g.textAlign = "right";
      g.fillStyle = muted; g.fillText(second.names[1], R - 4, T + 8);
      const w = g.measureText(second.names[1]).width;
      g.fillStyle = ink; g.fillText(second.names[0], R - 4 - w - 14, T + 8);
      g.textAlign = "start";
    }
  }

  return {
    id: "coropump",
    title: "CoroPump console",
    mount(el, source) {
      src = source;
      root = h("div", "cp");
      // not placed: only the way to place one
      empty = h("div", "cp-empty");
      placeBtn = h("button", "", "Place CoroPump"); placeBtn.type = "button";
      empty.append(h("p", "cp-note", "No CoroPump is placed."), placeBtn);
      // placed: the console
      live = h("div", "cp-live");
      const top = h("div", "cp-top");
      top.append(h("span", "cp-state", "Running"));
      offBtn = h("button", "", "Remove pump"); offBtn.type = "button";
      top.append(offBtn);
      const grid = h("div", "cp-grid");
      grid.append(cell("flow", "Pump flow"), cell("cpo", "Cardiac power (pump flow)"), cell("level", "P-level"), cell("purgePressure", "Purge pressure"), cell("purgeFlow", "Purge flow"), cell("placement", "Placement swing"), cell("motorCurrent", "Motor current"));
      alarms = h("div", "cp-alarms"); alarms.setAttribute("role", "status"); alarms.setAttribute("aria-live", "polite");
      const a = figure("cp-cv", "Aortic and inlet pressure across the last beat", coroPumpFigureCaptions.pressure);
      const b = figure("cp-cv", "Motor current across the last beat", coroPumpFigureCaptions.current);
      inlet = a.cv; current = b.cv;
      labs = h("p", "cp-labs"); labs.hidden = true;
      live.append(top, grid, alarms, a.f, b.f, labs);
      ctlSlot = h("div", "cp-controls");
      root.append(empty, live, ctlSlot);
      el.append(root);
      placeBtn.addEventListener("click", () => coroPumpHost.setOn?.(true));
      offBtn.addEventListener("click", () => coroPumpHost.setOn?.(false));
      if (coroPumpHost.controls) ctlSlot.append(coroPumpHost.controls);
    },
    setSource(s) { src = s; lastKey = ""; },
    draw() {
      const con = src.devices().find((d) => d.id === "coroPump"), r = con?.coroPump ?? null, shown = coroPumpShown(r);
      empty.hidden = shown; live.hidden = !shown;
      // learner gate: disease controls (position, purge line) never show in a running case
      const gate = !!coroPumpHost.inCase?.();
      for (const e of ctlSlot.querySelectorAll<HTMLElement>("[data-disease]")) e.hidden = gate;
      if (!shown || !r) return;
      const n = coroPumpNumbers(r);
      for (const k of Object.keys(nums)) nums[k].textContent = n[k as keyof typeof n];
      const lines = alarmLines(r);
      const key = lines.join("|");
      if (key !== lastKey) {
        lastKey = key;
        alarms.replaceChildren(...lines.map((t) => h("p", r.alarms.length ? "cp-alarm on" : "cp-alarm", t)));
      }
      const line = coroPumpLabsLine(r, gate);
      labs.hidden = line === null; if (line !== null) labs.textContent = line;
      wave(inlet, r.waveform?.aorticMmHg, "mmHg", { ys: r.waveform?.inletMmHg, names: ["Aortic", "LV inlet"] });
      wave(current, r.waveform?.currentMa, "mA");
    },
    resize() { /* the canvases are sized from their CSS width on each draw */ },
    dispose() {
      root?.remove(); // the controls stay referenced by the host and move into the next pane that opens
    },
  };
}

export const coroPumpPanel: PanelDef = { id: "coropump", title: "CoroPump console", defaultOn: false, create };
