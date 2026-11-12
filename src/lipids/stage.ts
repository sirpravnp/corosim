import { G, LEGEND, coreColor, ramp, svgG } from "./glyphs";
import { DRUGS, GENOS, LipidModel, Snapshot } from "./model";
import { CLASSES, ClassId, P } from "./paint";
import { SCENES as ORGANS, Scene, bodyScene, drawBody } from "./scenes";
import { followScene } from "./follow";
import { DRUG_INFO, drugLabel, effect, effectText } from "./drugInfo";
import type { DrugId } from "./model";
import { onTrials, trial } from "./trials";

/** Every view, in tab order: the whole body, the one-molecule story, then the organ views. */
const SCENES: Record<string, Scene> = { body: ORGANS.body, follow: followScene, ...ORGANS };

/**
 * The stage: view tabs, the canvas, the "In this view" key beside it, the lab rail and the patient and drug controls. One model
 * drives every view; the loop steps the model and the current view, then draws it with the hover name and the key's highlight.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const KEYDEF: Record<string, [string, string]> = {
  CM: ["Chylomicron", "Dietary TG on ApoB-48"], CMR: ["Chylomicron remnant", "ApoE-rich, to LRP1"], VLDL: ["VLDL", "Liver TG on ApoB-100"],
  IDL: ["IDL", "VLDL after LPL"], LDL: ["LDL", "ApoB-100 only"], LPA: ["Lp(a)", "LDL plus apo(a)"], HDL: ["HDL", "ApoA-I"],
  PREB: ["Pre-β HDL", "Lipid-poor ApoA-I"], OXLDL: ["Oxidized LDL", "Retained in the intima"], lymph: ["Lymph", "Thoracic duct, dotted"],
  artmark: ["Aortic wall marker", "Click to zoom"], fenestra: ["Fenestra", "Gap in the sinusoid lining"], RBC: ["Red cell", "For scale"],
  FFA: ["Free fatty acid", "From LPL into tissue"], micelle: ["Bile micelle", "Carries cholesterol"], FA: ["Our fatty acid", "The one molecule this view follows"], FC: ["Our cholesterol", "The one molecule this view follows"], TG: ["Triglyceride", "Three fatty acids on glycerol"], droplet: ["Lipid droplet", "Stored fat or cholesteryl ester"],
};
const GLYPH_INFO: Record<string, [string, string]> = {};
for (const [, rows] of LEGEND) for (const [id, n, d] of rows) GLYPH_INFO[id] = [n, d];

function keySvg(id: string): string {
  if (id in CLASSES || id === "OXLDL") {
    if (id === "PREB") return `<svg viewBox="-12 -12 24 24" aria-hidden="true"><rect x="-6" y="-2" width="12" height="4" fill="${coreColor(0.05)}" stroke="currentColor" stroke-width="0.8"/></svg>`;
    const tg = id === "OXLDL" ? 0 : CLASSES[id as ClassId].tg, r = id === "HDL" ? 4 : 4 + 6 * tg;
    return `<svg viewBox="-12 -12 24 24" aria-hidden="true"><circle r="${r}" fill="${id === "OXLDL" ? ramp(0.06) : coreColor(tg)}"/><circle r="${r}" fill="none" stroke="currentColor" stroke-width="0.8" stroke-dasharray="1.2 1.7"/></svg>`;
  }
  const custom: Record<string, string> = {
    lymph: `<path d="M-10,0 H10" stroke="currentColor" stroke-dasharray="2 3"/>`,
    artmark: `<rect x="-6" y="-6" width="12" height="12" fill="none" stroke="currentColor"/>`,
    fenestra: `<path d="M-11,0 H-3 M3,0 H11" stroke="currentColor" stroke-width="2.5"/>`,
    RBC: `<ellipse rx="10" ry="4.5" fill="none" stroke="currentColor"/><ellipse rx="4" ry="1.8" fill="none" stroke="currentColor"/>`,
    FFA: [[-4, 0], [2, -3], [4, 3]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="${coreColor(0.95)}"/>`).join(""),
    micelle: Array.from({ length: 9 }, (_, k) => `<rect x="${(7 * Math.cos((k / 9) * 6.28) - 0.7).toFixed(1)}" y="${(7 * Math.sin((k / 9) * 6.28) - 0.7).toFixed(1)}" width="1.4" height="1.4" fill="currentColor"/>`).join("") + `<circle r="2.2" fill="${coreColor(0.1)}"/>`,
    FA: `<path d="M-9,1 L-6,-1 L-3,1 L0,-1 L3,1 L6,-1 L9,1" fill="none" stroke="${coreColor(0.95)}" stroke-width="1.6"/><circle cx="-10.5" cy="1" r="1.4" fill="none" stroke="currentColor"/><circle r="11" fill="none" stroke="currentColor" stroke-dasharray="2 2"/>`,
    FC: `<g fill="none" stroke="currentColor" stroke-width="1.1"><path d="M-9,2 l3,-2 l3,2 v3 l-3,2 l-3,-2 z M-3,2 l3,-2 l3,2 v3 l-3,2 l-3,-2 z M0,-3 l3,-2 l3,2 v3 l-3,2 l-3,-2 z M6,-3 l3,0 l1,3 l-2,2 l-2,-1 z"/><circle r="11" stroke-dasharray="2 2"/></g>`,
    TG: `<path d="M-8,-5 V5" stroke="currentColor"/>` + [-5, 0, 5].map((y, i) => `<path d="M-6,${y} L-3,${y - 1.5} L0,${y} L3,${y - 1.5} L6,${y} L9,${y - 1.5}" fill="none" stroke="${i ? "currentColor" : coreColor(0.95)}" stroke-width="${i ? 0.9 : 1.5}"/>`).join(""),
    droplet: `<circle cx="-3" r="3" fill="${coreColor(0.2)}"/><circle cx="4" cy="2" r="3" fill="${coreColor(0.2)}"/>`,
  };
  if (custom[id]) return `<svg viewBox="-12 -12 24 24" aria-hidden="true">${custom[id]}</svg>`;
  return G[id] ? svgG(id) : "";
}

const LAB_ROWS: [keyof Snapshot & ("ldl" | "tg" | "hdl" | "apob" | "lpa"), string, string][] = [
  ["ldl", "LDL-C", "mg/dL"], ["tg", "Triglycerides", "mg/dL"], ["hdl", "HDL-C", "mg/dL"], ["apob", "ApoB", "mg/dL"], ["lpa", "Lp(a)", "nmol/L"],
];

export function mountStage(model: LipidModel) {
  const cv = $<HTMLCanvasElement>("flow"), tip = $("tip");
  P.attach(cv); P.model = model; P.snap = model.snapshot();
  let scene: Scene = bodyScene, hlKey: string | null = null, mouse: { x: number; y: number } | null = null, hoverRegion: string | null = null;
  let running = !matchMedia("(prefers-reduced-motion: reduce)").matches, last = 0, labT = 0;
  let mini: { x: number; y: number; w: number; h: number } | null = null;
  const shown: Record<string, number> = {};
  P.redraw = () => { if (!running) draw(0); };

  // ---- controls
  const tabs = $("lp-tabs");
  tabs.innerHTML = Object.values(SCENES).map((s) => `<button type="button" role="tab" aria-controls="lp-panel" data-s="${s.id}" aria-selected="${s.id === scene.id}">${s.name}</button>`).join("");
  tabs.addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button"); if (b) setScene(b.dataset.s!); });
  // tabs move with the arrow keys, Home and End, focus following the selection
  tabs.addEventListener("keydown", (e) => {
    const bs = Array.from(tabs.querySelectorAll<HTMLButtonElement>("button")), i = bs.findIndex((b) => b.dataset.s === scene.id);
    const j = e.key === "ArrowRight" ? (i + 1) % bs.length : e.key === "ArrowLeft" ? (i - 1 + bs.length) % bs.length : e.key === "Home" ? 0 : e.key === "End" ? bs.length - 1 : -1;
    if (j < 0) return; e.preventDefault(); setScene(bs[j].dataset.s!); bs[j].focus();
  });
  const geno = $("lp-geno");
  geno.innerHTML = GENOS.map((g) => `<button type="button" data-g="${g.id}" aria-pressed="${g.id === model.geno}" title="${g.blurb}">${g.label}</button>`).join("");
  geno.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!b) return;
    model.setGeno(b.dataset.g as never);
    geno.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    for (const k in shown) delete shown[k];
    P.snap = model.snapshot(); scene.init(); warm(2); draw(0); updateLabs(true); updateEffect();
  });
  const drugs = $("lp-drugs"), groups = ["ldl", "tg", "lpa"] as const;
  drugs.innerHTML = groups.map((g) => DRUGS.filter((d) => d.group === g).map((d) => `<button type="button" data-d="${d.id}" aria-pressed="false"${d.investigational ? ' title="Investigational"' : ""}>${d.investigational ? `<i>${d.label}</i> <span class="inv">inv</span>` : d.label}</button>`).join("")).join('<span class="sep" aria-hidden="true"></span>');
  drugs.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!b) return;
    const d = b.dataset.d as DrugId;
    model.toggle(d); b.setAttribute("aria-pressed", String(model.drugs.has(d)));
    flash = model.drugs.has(d) ? { d, t: 4.5 } : null; hintTab();
    updateEffect();
    if (!running) { P.snap = model.snapshot(); draw(0); updateLabs(true); }
  });
  const meal = $<HTMLButtonElement>("lp-meal");
  meal.addEventListener("click", () => { model.feed(); });
  onTrials(() => { P.invalidate(); buildOpts(); P.redraw(); });

  // ---- view options on the stage: what this view can show (the thermogram, the camera, which molecule to follow)
  const optsEl = $("lp-opts");
  function buildOpts() {
    const o = scene.opts?.() ?? [];
    optsEl.hidden = !o.length;
    let html = "", group: string | undefined;
    o.forEach((x, i) => {
      if (x.group !== group) { if (group) html += "</span>"; if (x.group) html += `<span class="seg" role="group" aria-label="Molecule">`; else if (i) html += `<span class="sep" aria-hidden="true"></span>`; group = x.group; }
      html += `<button type="button" data-o="${x.id}" aria-pressed="${x.on}">${x.label}</button>`;
    });
    if (group) html += "</span>";
    optsEl.innerHTML = html;
    // the meal is the story's own in the camera view; elsewhere it is the learner's
    const off = scene.id === "follow" && trial("camera");
    meal.disabled = off; meal.title = off ? "The story gives its own meal while the camera follows the molecule" : "A fatty meal fills the gut and sends chylomicrons into the lymph";
  }
  optsEl.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!b || !scene.setOpt) return;
    scene.setOpt(b.dataset.o!); buildOpts(); buildRoute(); buildKey();
    $("lp-caption").textContent = scene.caption; P.redraw();
  });
  const pause = $("lp-pause");
  pause.textContent = running ? "Pause" : "Play";
  pause.addEventListener("click", () => { running = !running; pause.textContent = running ? "Pause" : "Play"; if (running) { last = 0; requestAnimationFrame(loop); } });

  // ---- a drug's effect, shown directly: its target lit on the stage, and what it does to the labs alone and together
  let flash: { d: DrugId; t: number } | null = null;
  const effEl = $("lp-effect");
  function updateEffect() {
    const on = DRUGS.filter((x) => model.drugs.has(x.id)).map((x) => x.id);
    if (!on.length) { effEl.innerHTML = `<span class="none">Switch a drug on to see what it does, alone and in combination, at steady state.</span>`; return; }
    const rows = on.map((d) => `<li><span class="n">${drugLabel(d)}</span> ${DRUG_INFO[d].action}. Alone: <span class="v">${effectText(effect(model.geno, [d]))}</span></li>`);
    if (on.length > 1) rows.push(`<li><span class="n">Together</span> <span class="v">${effectText(effect(model.geno, on), 3)}</span> (effects compound rather than add)</li>`);
    effEl.innerHTML = `<ul>${rows.join("")}</ul>`;
  }
  function hintTab() {
    const views = flash ? DRUG_INFO[flash.d].views : [];
    tabs.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("hint", !!flash && b.dataset.s !== scene.id && views.includes(b.dataset.s!) && !views.includes(scene.id)));
  }
  /** A callout line kept inside the stage, on a backing so tissue does not run through it; long lines wrap once. */
  function callout(t: string, x: number, y: number, a: CanvasTextAlign) {
    const c = P.ctx, s = 12.5; c.font = `500 ${s}px "Hanken Grotesk", "Helvetica Neue", Arial, sans-serif`;
    const maxW = P.W - 24; let lines = [t];
    if (c.measureText(t).width > maxW) { const w = t.split(" "), half = Math.ceil(w.length / 2); lines = [w.slice(0, half).join(" "), w.slice(half).join(" ")]; }
    const tw = Math.min(maxW, Math.max(...lines.map((l) => c.measureText(l).width)));
    let x0 = a === "right" ? x - tw : a === "center" ? x - tw / 2 : x; x0 = Math.max(12, Math.min(P.W - 12 - tw, x0));
    c.save(); c.fillStyle = P.stage; c.globalAlpha *= 0.88; c.fillRect(x0 - 6, y - s - 3, tw + 12, lines.length * (s + 4) + 6); c.restore();
    lines.forEach((l, i) => P.label(l, x0, y + i * (s + 4), { s, a: "left" }));
  }
  function drawFlash(dt: number) {
    if (!flash) return;
    flash.t -= dt; if (flash.t <= 0) { flash = null; hintTab(); return; }
    const info = DRUG_INFO[flash.d], c = P.ctx, a = Math.min(1, flash.t / 0.6), name = drugLabel(flash.d);
    const hits = P.hits.filter((h) => h.key === info.key).slice(0, 6);
    c.save(); c.globalAlpha = a; c.strokeStyle = P.ink; c.lineWidth = 1.5;
    if (hits.length && info.views.includes(scene.id)) {
      const pulse = 4 + 3 * Math.sin(flash.t * 6);
      for (const h of hits) { c.beginPath(); c.arc(h.x, h.y, h.r + 6 + pulse, 0, 6.28); c.stroke(); }
      const h = hits[0], right = h.x < P.W * 0.6, lx = h.x + (right ? 1 : -1) * (h.r + 34), ly = Math.max(18, h.y - h.r - 26);
      c.lineWidth = 1; c.beginPath(); c.moveTo(h.x + (right ? 1 : -1) * (h.r + 8), h.y - h.r * 0.6); c.lineTo(lx, ly + 4); c.stroke();
      callout(`${name} ${info.action}`, lx + (right ? 4 : -4), ly, right ? "left" : "right");
    } else if (scene.id !== "body" && scene.id !== "follow") {
      callout(`${name} acts in the ${info.views.map((v) => SCENES[v].name.toLowerCase()).join(" and ")} view: ${info.action}`, P.W / 2, 24, "center");
    } else callout(`${name} ${info.action}`, P.W / 2, 24, "center");
    c.restore();
  }

  // ---- key
  const keyEl = $("lp-key");
  function buildKey() {
    keyEl.innerHTML = scene.key.map((id) => {
      const [n, d] = KEYDEF[id] ?? GLYPH_INFO[id] ?? [id, ""];
      return `<button type="button" class="key-item" data-k="${id}" aria-pressed="false">${keySvg(id)}<span><span class="n">${n}</span><span class="s">${d}</span></span></button>`;
    }).join("");
  }
  keyEl.addEventListener("pointerover", (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>(".key-item"); if (b) { hlKey = b.dataset.k!; P.redraw(); } });
  keyEl.addEventListener("pointerout", (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>(".key-item"); if (b && b.getAttribute("aria-pressed") !== "true") { hlKey = keyEl.querySelector<HTMLElement>('.key-item[aria-pressed="true"]')?.dataset.k ?? null; P.redraw(); } });
  keyEl.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".key-item"); if (!b) return;
    const on = b.getAttribute("aria-pressed") !== "true";
    keyEl.querySelectorAll(".key-item").forEach((x) => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", String(on)); hlKey = on ? b.dataset.k! : null; P.redraw();
  });

  // ---- labs
  const labsEl = $("lp-labs");
  labsEl.innerHTML = [...LAB_ROWS, ["R", "Surface LDLR", "× normal"], ["PC", "Free PCSK9", "× normal"]].map(([k, n]) => `<div class="labrow"><span class="k">${n}</span><span class="v" id="lv-${k}"></span><span class="d" id="ld-${k}"></span></div>`).join("");
  function updateLabs(jump = false) {
    const s = P.snap;
    for (const [k, , u] of LAB_ROWS) {
      shown[k] = jump || shown[k] === undefined ? s[k] : shown[k] + (s[k] - shown[k]) * 0.25;
      const v = shown[k], pct = Math.round((v / s.untreated[k] - 1) * 100);
      $("lv-" + k).innerHTML = `${Math.round(v)}<small>${u}</small>`;
      $("ld-" + k).textContent = Math.abs(pct) < 2 ? "untreated" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
    }
    $("lv-R").innerHTML = `${s.receptors.toFixed(s.receptors < 0.2 ? 2 : 1)}<small>×</small>`;
    $("lv-PC").innerHTML = `${s.pcsk9.toFixed(1)}<small>×</small>`;
  }

  // ---- scenes
  function setScene(id: string) {
    scene = SCENES[id]; P.sceneId = id; hlKey = null; hoverRegion = null; tip.hidden = true;
    if (flash && !DRUG_INFO[flash.d].views.includes(id)) flash = null;
    tabs.querySelectorAll("button").forEach((b) => { const on = b.dataset.s === id; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
    $("lp-note").textContent = scene.note; $("lp-caption").textContent = scene.caption;
    scene.init(); buildKey(); warm(1.5); buildRoute(); buildOpts(); hintTab(); draw(0);
  }
  function step(dt: number) { model.step(dt); P.snap = model.snapshot(); scene.step(dt); }
  function warm(sec: number) { for (let t = 0; t < sec; t += 1 / 30) step(1 / 30); }

  // ---- a story view's chapters, and its live sentence in the note
  const routeEl = $("lp-route"), noteEl = $("lp-note");
  let routeAt = -1;
  function buildRoute() {
    routeAt = -1; routeEl.hidden = !scene.route;
    routeEl.innerHTML = (scene.route ?? []).map((r, i) => `<li><button type="button" data-i="${i}"><span class="n">${i + 1}</span>${r}</button></li>`).join("");
    syncRoute();
  }
  function syncRoute() {
    if (!scene.route) return;
    const i = scene.at!();
    if (i !== routeAt) { routeAt = i; routeEl.querySelectorAll("button").forEach((b, k) => { if (k === i) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current"); b.classList.toggle("past", k < i); }); }
    const t = scene.live!(); if (noteEl.textContent !== t) noteEl.textContent = t;
  }
  routeEl.addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button"); if (b && scene.jump) { scene.jump(+b.dataset.i!); syncRoute(); P.redraw(); } });

  function drawMini() {
    mini = null;
    if (scene.id === "body") return;
    const m = scene.mini ? scene.mini() : { hi: scene.id };
    if (!m) return;
    const w = Math.min(118, P.W * 0.2), h = w * 0.62, x = P.W - w - 10, y = P.H - h - 10, c = P.ctx;
    c.fillStyle = P.stage; c.fillRect(x, y, w, h); c.strokeStyle = P.rule; c.lineWidth = 1; c.strokeRect(x, y, w, h);
    drawBody(x + 4, y + 4, w - 8, h - 8, true, m.hi); P.mono("whole body", x + 6, y + 12, { s: 9.5 });
    if (m.dot) { const dx = x + 4 + m.dot[0] * (w - 8), dy = y + 4 + m.dot[1] * (h - 8); P.dot(dx, dy, 3, coreColor(0.95)); c.strokeStyle = P.ink; c.lineWidth = 1; c.beginPath(); c.arc(dx, dy, 6, 0, 6.28); c.stroke(); }
    mini = { x, y, w, h };
  }
  const inMini = (x: number, y: number) => !!mini && x > mini.x && y > mini.y && x < mini.x + mini.w && y < mini.y + mini.h;
  function draw(dt: number) {
    const c = P.ctx;
    c.setTransform(P.dpr, 0, 0, P.dpr, 0, 0); c.fillStyle = P.stage; c.fillRect(0, 0, P.W, P.H); P.hits = [];
    bodyScene.hover = hoverRegion;
    scene.draw(dt); drawFlash(dt); drawMini();
    c.strokeStyle = P.ink; c.lineWidth = 1.5;
    if (hlKey) for (const h of P.hits) if (h.key === hlKey) { c.beginPath(); c.arc(h.x, h.y, h.r + 5, 0, 6.28); c.stroke(); }
    if (!mouse) return;
    let best = null as (typeof P.hits)[number] | null, bd = 1e9;
    for (const h of P.hits) { const d = Math.hypot(h.x - mouse.x, h.y - mouse.y) - h.r; if (d < 6 && d < bd) { bd = d; best = h; } }
    let text = "";
    if (inMini(mouse.x, mouse.y)) text = "Back to the whole body";
    else if (scene.id === "body" && hoverRegion) text = `Zoom into: ${SCENES[hoverRegion].name}`;
    else if (best) { text = best.label; c.beginPath(); c.arc(best.x, best.y, best.r + 5, 0, 6.28); c.stroke(); }
    cv.style.cursor = inMini(mouse.x, mouse.y) || (scene.id === "body" && hoverRegion) ? "pointer" : "default";
    tip.hidden = !text;
    if (text) { tip.textContent = text; tip.style.left = Math.max(4, Math.min(mouse.x + 14, P.W - 270)) + "px"; tip.style.top = (mouse.y + 16 > P.H - 50 ? mouse.y - 46 : mouse.y + 16) + "px"; }
  }
  cv.addEventListener("pointermove", (e) => {
    const r = cv.getBoundingClientRect(); mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    hoverRegion = scene.id === "body" ? bodyScene.region(mouse.x, mouse.y) : null; P.redraw();
  });
  cv.addEventListener("pointerleave", () => { mouse = null; hoverRegion = null; tip.hidden = true; P.redraw(); });
  cv.addEventListener("click", (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (scene.id === "body") { const g = bodyScene.region(x, y); if (g) setScene(g); }
    else if (inMini(x, y)) setScene("body");
  });

  function loop(ts: number) {
    if (!running) return;
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 1 / 60; last = ts;
    step(dt); draw(dt); syncRoute();
    labT += dt; if (labT > 0.2) { labT = 0; updateLabs(); }
    requestAnimationFrame(loop);
  }
  const onTheme = () => { P.readTheme(); P.redraw(); };
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", onTheme);
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  let lastW = 0;
  new ResizeObserver(() => { P.resize(); if (Math.abs(P.W - lastW) > 2) { lastW = P.W; scene.init(); } P.redraw(); }).observe(cv);

  document.fonts?.ready.then(() => { P.invalidate(); P.redraw(); });
  P.resize(); lastW = P.W;
  setScene("body"); updateLabs(true); updateEffect();
  if (running) requestAnimationFrame(loop);
}
