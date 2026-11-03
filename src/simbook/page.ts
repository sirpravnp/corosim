import "../shell/shell.css";
import "./simbook.css";
import { mountShell } from "../shell/shell";
import { CHAPTERS, chapterById } from "./chapters";
import type { Block, ChapterDef } from "./runner";
import { CircuitWidget, CircuitWidgetMode } from "./widgets/circuitWidget";
import { DiffusionWidget } from "./widgets/diffusionWidget";
import { FickWidget } from "./widgets/fickWidget";
import { StarlingWidget } from "./widgets/starlingWidget";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

mountShell({ page: "simbook", root: "../" });

interface Tickable { tick(dt: number): void }

let chapter: ChapterDef | null = null;
const choices = new Map<number, number>();
let widgets: Tickable[] = [];
let raf = 0;
let lastT = 0;

const CAPTION: Record<string, string> = {
  diffusion: "Tissue slab",
  fick: "Diffusion across a membrane",
  starling: "Fluid across a capillary",
  "circuit|autoreg": "Pressure and organ flow",
  "circuit|pump": "The circuit",
};

function defaultChapterId(): string {
  const hash = location.hash.replace(/^#/, "");
  return chapterById(hash)?.ready ? hash : CHAPTERS.find((c) => c.ready)?.id ?? CHAPTERS[0]!.id;
}

function renderList() {
  const cur = chapter?.id ?? "";
  $("list").innerHTML = `<h3>Chapters</h3>` + CHAPTERS.map((ch) => {
    const on = ch.id === cur ? " on" : "";
    const href = ch.ready ? `#${ch.id}` : "#";
    return `<a href="${href}" class="${on.trim()}${ch.ready ? "" : " disabled"}" data-id="${ch.id}" aria-disabled="${ch.ready ? "false" : "true"}"><b>${ch.number}. ${esc(ch.title)}</b><small>${esc(ch.subtitle)}</small></a>`;
  }).join("");
}

function renderRead(ch: ChapterDef) {
  const paragraphs = ch.blocks.flatMap((b) => b.kind === "text" ? b.paragraphs : []);
  $("sb-read").innerHTML = `<div class="sb-prose">${paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`;
}

function renderQuestions() {
  if (!chapter) return;
  const questions = chapter.blocks.flatMap((b, i) => b.kind === "predict" ? [{ b, i }] : []);
  const close = chapter.blocks.flatMap((b) => b.kind === "reveal" ? b.paragraphs : []);
  $("sb-questions").innerHTML = `
    <h2>Questions</h2>
    ${questions.map(({ b, i }) => {
      const pick = choices.get(i);
      const lines = pick == null ? [] : [b.options[pick]?.note, ...b.reveal].filter((x): x is string => !!x);
      return `<div class="sb-predict">
        <p>${esc(b.question)}</p>
        <div class="opts">${b.options.map((o, j) =>
          `<button type="button" class="opt${pick === j ? " on" : ""}" data-q="${i}" data-i="${j}">${esc(o.label)}</button>`).join("")}</div>
        ${lines.length ? `<div class="sb-reveal">${lines.map((p) => `<p>${esc(p)}</p>`).join("")}</div>` : ""}
      </div>`;
    }).join("")}
    ${close.length ? `<div class="sb-close">${close.map((p) => `<p>${esc(p)}</p>`).join("")}</div>` : ""}`;
}

function mountOne(block: Extract<Block, { kind: "widget" }>, canvas: HTMLCanvasElement, readout: HTMLElement, controls: HTMLElement): Tickable | null {
  if (block.id === "diffusion") return new DiffusionWidget(canvas, readout, controls);
  if (block.id === "fick") return new FickWidget(canvas, readout, controls);
  if (block.id === "starling") return new StarlingWidget(canvas, readout, controls);
  if (block.id === "circuit") {
    return new CircuitWidget(canvas, readout, controls, {
      mode: (block.mode ?? "pump") as CircuitWidgetMode,
      editableOrgan: "gut",
      coRange: [2, 8],
      radiusRange: [0.4, 1.4],
      mapRange: [45, 110],
    });
  }
  return null;
}

function mountSims(ch: ChapterDef) {
  cancelAnimationFrame(raf);
  widgets = [];
  const root = $("sb-sims");
  root.innerHTML = "";
  ch.blocks.forEach((b) => {
    if (b.kind !== "widget") return;
    const key = b.mode ? `${b.id}|${b.mode}` : b.id;
    const sec = document.createElement("section");
    sec.className = "sb-sim";
    sec.innerHTML = `<h2>${esc(CAPTION[key] ?? "Model")}</h2>
      <div class="sb-screen"><canvas width="960" height="360" aria-label="${esc(CAPTION[key] ?? "Model")}"></canvas></div>
      <div class="sb-controls"></div>
      <div class="sb-readout"></div>`;
    root.appendChild(sec);
    const widget = mountOne(b, sec.querySelector("canvas")!, sec.querySelector(".sb-readout")!, sec.querySelector(".sb-controls")!);
    if (widget) widgets.push(widget);
  });
  lastT = performance.now();
  const loop = (t: number) => {
    const dt = (t - lastT) / 1000;
    lastT = t;
    for (const w of widgets) w.tick(dt);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

function loadChapter(id: string) {
  const ch = chapterById(id);
  if (!ch?.ready) return;
  chapter = ch;
  choices.clear();
  location.hash = id;
  $("title").textContent = `${ch.number}. ${ch.title}`;
  $("summary").textContent = ch.subtitle;
  renderList();
  renderRead(ch);
  mountSims(ch);
  renderQuestions();
}

$("list").addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-id]");
  if (!a) return;
  e.preventDefault();
  const ch = chapterById(a.dataset.id!);
  if (!ch?.ready) return;
  loadChapter(ch.id);
});
$("sb-questions").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button.opt");
  if (!btn) return;
  choices.set(+btn.dataset.q!, +btn.dataset.i!);
  renderQuestions();
});
addEventListener("hashchange", () => {
  const id = location.hash.replace(/^#/, "");
  if (id && id !== chapter?.id && chapterById(id)?.ready) loadChapter(id);
});

renderList();
loadChapter(defaultChapterId());
