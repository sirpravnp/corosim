import "./lab-play.css";
import { mountShell } from "../../shell/shell";
import { Simulation } from "../../sim/simulation";
import { LabEngine } from "../../lab/engine";
import { attachLabKeyboard } from "../../lab/controls";
import { deviceFocus } from "../../lab/camera";
import { routeTo } from "../../lab/route";
import { LAB_CASES } from "./cases";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const c = $<HTMLCanvasElement>("view");
const ctx = c.getContext("2d")!;

const case0 = LAB_CASES[0]!;
const sim = new Simulation({ seed: 4, lesions: case0.scenario.lesions });
sim.warmup(25);
const engine = new LabEngine(sim, { seed: 7, access: case0.access, plaques: case0.plaques });

const logEl = $("log");
const readout = $("readout");

const pushLog = (lines: string[]) => {
  for (const t of lines) {
    const li = document.createElement("li");
    li.textContent = t;
    logEl.prepend(li);
  }
  while (logEl.children.length > 40) logEl.lastElementChild?.remove();
};

const act = (label: string, a: Parameters<LabEngine["apply"]>[0]) => {
  const ev = engine.apply(a);
  pushLog(ev.map((e) => `${e.severity}: ${e.text}`));
  if (!ev.length) pushLog([`${label}`]);
  paint();
  return ev;
};

const bounds = () => {
  const g = engine.graph();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of g.segs) for (const p of s.samples) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  return { minX, maxX, minY, maxY };
};

const paint = () => {
  const g = engine.graph();
  const st = engine.state();
  const { minX, maxX, minY, maxY } = bounds();
  const pad = 28;
  const w = c.width - pad * 2, h = c.height - pad * 2;
  const sx = w / (maxX - minX || 1);
  const sy = h / (maxY - minY || 1);
  const scale = Math.min(sx, sy);
  const tx = pad - minX * scale;
  const ty = pad + maxY * scale;
  const proj = (x: number, y: number) => [x * scale + tx, -y * scale + ty] as const;

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--stage").trim() || "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#888";
  ctx.lineWidth = 1.2;
  for (const s of g.segs) {
    ctx.beginPath();
    for (let i = 0; i < s.samples.length; i++) {
      const p = proj(s.samples[i][0], s.samples[i][1]);
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
  }

  const route = st.guide
    ? routeTo(g, st.access ?? "femoral-R", st.wire ? "LAD" : "LM")
    : [];
  if (route.length > 1) {
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--ok").trim() || "#ccc";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let started = false;
    for (const id of route) {
      const seg = g.byId[id];
      for (const sm of seg.samples) {
        const p = proj(sm[0], sm[1]);
        if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
        else ctx.lineTo(p[0], p[1]);
      }
    }
    ctx.stroke();
  }

  const focus = deviceFocus(st, g);
  const tip = proj(focus.point[0], focus.point[1]);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--warn").trim() || "#e0a447";
  ctx.beginPath();
  ctx.arc(tip[0], tip[1], 5, 0, Math.PI * 2);
  ctx.fill();

  const gs = st.guide;
  const ws = st.wire;
  readout.textContent = [
    `Zone ${focus.zone}`,
    `Guide ${gs ? `${gs.id} @ ${gs.tipSeg} ${gs.tipMm.toFixed(1)} mm, Q ${(gs.quality * 100).toFixed(0)}%` : "—"}`,
    `Wire ${ws ? `${ws.id} @ ${ws.tipSeg} ${ws.tipMm.toFixed(1)} mm` : "—"}`,
    `Engaged ${gs?.engaged ?? "—"}`,
    `ACT ${st.act.toFixed(0)} s`,
  ].join("\n");
};

$("setup").onclick = () => {
  act("access", { t: "access", site: "femoral-R" });
  act("sheath", { t: "sheath", french: 6 });
  act("heparin", { t: "drug", id: "heparin", dose: 5000 });
  act("guide", { t: "select", slot: "guide", id: case0.recommended.guide });
};
$("skip").onclick = () => act("auto", { t: "autoAdvance", to: "LM" });
$("wire").onclick = () => act("wire", { t: "select", slot: "wire", id: case0.recommended.wire });

attachLabKeyboard(window, {
  apply: (a) => {
    const ev = engine.apply(a);
    pushLog(ev.map((e) => `${e.severity}: ${e.text}`));
    paint();
    return ev;
  },
});

paint();
mountShell({ page: "cath", root: "../../" }).ai.start();
