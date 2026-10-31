import "../shell/shell.css";
import "./simbook.css";
import { mountShell } from "../shell/shell";
import { CHAPTERS, chapterById } from "./chapters";
import {
  advance,
  initChapter,
  predictRevealFor,
  recordPredictChoice,
  type ChapterView,
} from "./runner";
import { CircuitWidget, CircuitWidgetMode } from "./widgets/circuitWidget";
import { DiffusionWidget } from "./widgets/diffusionWidget";
import { FickWidget } from "./widgets/fickWidget";
import { StarlingWidget } from "./widgets/starlingWidget";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

mountShell({ page: "simbook", root: "../" });

interface Tickable {
  tick(dt: number): void;
}

let view: ChapterView | null = null;
let widget: Tickable | null = null;
let widgetKey: string | null = null;
let raf = 0;
let lastT = 0;

function defaultChapterId(): string {
  const hash = location.hash.replace(/^#/, "");
  return chapterById(hash)?.ready ? hash : CHAPTERS.find((c) => c.ready)?.id ?? CHAPTERS[0]!.id;
}

function firstWidgetIndex(v: ChapterView): number {
  return v.chapter.blocks.findIndex((b) => b.kind === "widget");
}

function widgetActive(v: ChapterView): boolean {
  const i = firstWidgetIndex(v);
  return i >= 0 && v.index >= i && !v.finished;
}

function activeWidgetKey(v: ChapterView): string | null {
  if (!widgetActive(v)) return null;
  let key = "";
  for (let i = 0; i <= v.index; i++) {
    const b = v.chapter.blocks[i];
    if (b?.kind === "widget") key = `${b.id}|${b.mode ?? ""}`;
  }
  return key || null;
}

function renderList() {
  const cur = view?.chapter.id ?? "";
  $("list").innerHTML = `<h3>Chapters</h3>` + CHAPTERS.map((ch) => {
    const on = ch.id === cur ? " on" : "";
    const dis = ch.ready ? "" : " disabled";
    const href = ch.ready ? `#${ch.id}` : "#";
    return `<a href="${href}" class="${on.trim()}${dis}" data-id="${ch.id}" aria-disabled="${ch.ready ? "false" : "true"}"><b>${ch.number}. ${esc(ch.title)}</b><small>${esc(ch.subtitle)}</small></a>`;
  }).join("");
}

function renderPredictReveals(v: ChapterView): string {
  const parts: string[] = [];
  v.chapter.blocks.forEach((b, i) => {
    if (b.kind !== "predict") return;
    let gate = i + 1;
    while (gate < v.chapter.blocks.length && v.chapter.blocks[gate]!.kind === "widget") gate++;
    if (v.index <= gate) return;
    const lines = predictRevealFor(v, i);
    if (!lines.length) return;
    parts.push(`<div class="sb-reveal"><h2>After you explored</h2>${lines.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`);
  });
  return parts.join("");
}

function renderStep(v: ChapterView): string {
  const b = v.block;
  if (b.kind === "text") return `<div class="sb-prose">${b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`;
  if (b.kind === "reveal") {
    return `<div class="sb-reveal"><h2>Takeaway</h2>${b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`;
  }
  if (b.kind === "predict") {
    const picked = v.choices.get(v.index);
    return `<div class="sb-predict"><h2>Predict</h2><p>${esc(b.question)}</p>
      <div class="opts">${b.options.map((o, i) =>
        `<button type="button" class="opt${picked === i ? " on" : ""}" data-i="${i}">${esc(o.label)}</button>`).join("")}</div>
      ${picked != null && widgetActive(v) ? `<p class="sb-note">Use the simulation below, then continue.</p>` : ""}
      </div>`;
  }
  if (b.kind === "widget") {
    const hints: Record<string, string> = {
      diffusion: "Adjust thickness, capillary density, metabolism, and flow. Watch the O₂ profile and anoxic depth.",
      fick: "Change area, membrane thickness, and gradient; flux follows J = D·A·ΔC / x.",
      starling: "Raise venous pressure, lower albumin, or increase permeability. Arrows show filtration vs reabsorption.",
      circuit: b.mode === "autoreg"
        ? "Slide MAP and watch each organ defend (or lose) flow."
        : "Set pump output and gut radius; MAP follows from total SVR.",
    };
    return `<div class="sb-prose"><p>${hints[b.id] ?? "Use the simulation below."}</p></div>`;
  }
  return "";
}

function mountWidget(key: string) {
  const canvas = $<HTMLCanvasElement>("sb-canvas");
  const readout = $("sb-readout");
  const controls = $("sb-controls");
  const [id, mode] = key.split("|");
  if (id === "diffusion") widget = new DiffusionWidget(canvas, readout, controls);
  else if (id === "fick") widget = new FickWidget(canvas, readout, controls);
  else if (id === "starling") widget = new StarlingWidget(canvas, readout, controls);
  else if (id === "circuit") {
    widget = new CircuitWidget(canvas, readout, controls, {
      mode: (mode || "pump") as CircuitWidgetMode,
      editableOrgan: "gut",
      coRange: [2, 8],
      radiusRange: [0.4, 1.4],
      mapRange: [45, 110],
    });
  }
}

function ensureWidget() {
  const area = $<HTMLElement>("sb-widget-area");
  if (!view) {
    area.hidden = true;
    return;
  }
  const key = activeWidgetKey(view);
  if (!key) {
    area.hidden = true;
    return;
  }
  area.hidden = false;
  if (widget && widgetKey === key) {
    if (widget instanceof CircuitWidget) {
      const mode = (key.split("|")[1] || "pump") as CircuitWidgetMode;
      widget.setMode(mode);
    }
    return;
  }
  cancelAnimationFrame(raf);
  widget = null;
  widgetKey = key;
  mountWidget(key);
  lastT = performance.now();
  const loop = (t: number) => {
    widget?.tick((t - lastT) / 1000);
    lastT = t;
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function syncNav() {
  const back = $<HTMLButtonElement>("sb-back");
  const next = $<HTMLButtonElement>("sb-next");
  if (!view) return;
  back.disabled = view.index === 0;
  if (view.finished) {
    next.textContent = "Finished";
    next.disabled = true;
    return;
  }
  if (view.block.kind === "predict" && !view.choices.has(view.index)) {
    next.textContent = "Pick an answer first";
    next.disabled = true;
    return;
  }
  next.textContent = "Continue";
  next.disabled = false;
}

function render() {
  if (!view) return;
  const ch = view.chapter;
  $("title").textContent = `${ch.number}. ${ch.title}`;
  $("summary").textContent = ch.subtitle;
  $("sb-step").innerHTML = renderStep(view) + renderPredictReveals(view);
  ensureWidget();
  syncNav();
  renderList();
}

function loadChapter(id: string) {
  const ch = chapterById(id);
  if (!ch || !ch.ready) return;
  cancelAnimationFrame(raf);
  widget = null;
  widgetKey = null;
  view = initChapter(ch);
  location.hash = id;
  render();
}

function onNext() {
  if (!view || view.finished) return;
  if (view.block.kind === "predict" && !view.choices.has(view.index)) return;
  view = advance(view);
  render();
}

function onBack() {
  if (!view || view.index === 0) return;
  const idx = view.index - 1;
  view = { ...view, index: idx, block: view.chapter.blocks[idx]!, finished: false };
  render();
}

$("list").addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-id]");
  if (!a) return;
  e.preventDefault();
  const ch = chapterById(a.dataset.id!);
  if (!ch?.ready) return;
  loadChapter(ch.id);
});
$("sb-step").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button.opt");
  if (!btn || !view || view.block.kind !== "predict") return;
  view = recordPredictChoice(view, +btn.dataset.i!);
  render();
});
$("sb-next").addEventListener("click", onNext);
$("sb-back").addEventListener("click", onBack);
addEventListener("hashchange", () => {
  const id = location.hash.replace(/^#/, "");
  if (id && id !== view?.chapter.id && chapterById(id)?.ready) loadChapter(id);
});

renderList();
$("intro").textContent =
  "Simbook is a chapter reader for preclinical cardiac physiology: predict, change one parameter, watch the model, then read the tie-back. Chapters 1–3 are available.";
loadChapter(defaultChapterId());
