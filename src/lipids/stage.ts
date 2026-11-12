import { G, LEGEND, coreColor, ramp, svgG } from "./glyphs";
import { DRUGS, GENOS, LipidModel, Snapshot } from "./model";
import { CLASSES, ClassId, P } from "./paint";
import { SCENES, Scene, bodyScene, drawBody } from "./scenes";

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
  FFA: ["Free fatty acid", "From LPL into tissue"], micelle: ["Bile micelle", "Carries cholesterol"], droplet: ["Lipid droplet", "Stored fat or cholesteryl ester"],
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
  tabs.innerHTML = Object.values(SCENES).map((s) => `<button type="button" role="tab" data-s="${s.id}" aria-selected="${s.id === scene.id}">${s.name}</button>`).join("");
  tabs.addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button"); if (b) setScene(b.dataset.s!); });
  const geno = $("lp-geno");
  geno.innerHTML = GENOS.map((g) => `<button type="button" data-g="${g.id}" aria-pressed="${g.id === model.geno}" title="${g.blurb}">${g.label}</button>`).join("");
  geno.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!b) return;
    model.setGeno(b.dataset.g as never);
    geno.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    for (const k in shown) delete shown[k];
    P.snap = model.snapshot(); scene.init(); warm(2); draw(0); updateLabs(true);
  });
  const drugs = $("lp-drugs"), groups = ["ldl", "tg", "lpa"] as const;
  drugs.innerHTML = groups.map((g) => DRUGS.filter((d) => d.group === g).map((d) => `<button type="button" data-d="${d.id}" aria-pressed="false"${d.investigational ? ' title="Investigational"' : ""}>${d.investigational ? `<i>${d.label}</i> <span class="inv">inv</span>` : d.label}</button>`).join("")).join('<span class="sep" aria-hidden="true"></span>');
  drugs.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!b) return;
    model.toggle(b.dataset.d as never); b.setAttribute("aria-pressed", String(model.drugs.has(b.dataset.d as never)));
    if (!running) { P.snap = model.snapshot(); draw(0); updateLabs(true); }
  });
  $("lp-meal").addEventListener("click", () => { model.feed(); });
  const pause = $("lp-pause");
  pause.textContent = running ? "Pause" : "Play";
  pause.addEventListener("click", () => { running = !running; pause.textContent = running ? "Pause" : "Play"; if (running) { last = 0; requestAnimationFrame(loop); } });

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
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.s === id)));
    $("lp-note").textContent = scene.note; $("lp-caption").textContent = scene.caption;
    scene.init(); buildKey(); warm(1.5); draw(0);
  }
  function step(dt: number) { model.step(dt); P.snap = model.snapshot(); scene.step(dt); }
  function warm(sec: number) { for (let t = 0; t < sec; t += 1 / 30) step(1 / 30); }

  function drawMini() {
    mini = null;
    if (scene.id === "body") return;
    const w = Math.min(140, P.W * 0.22), h = w * 0.62, x = P.W - w - 10, y = P.H - h - 10, c = P.ctx;
    c.fillStyle = P.stage; c.fillRect(x, y, w, h); c.strokeStyle = P.rule; c.lineWidth = 1; c.strokeRect(x, y, w, h);
    drawBody(x + 4, y + 4, w - 8, h - 8, true, scene.id); P.mono("whole body", x + 6, y + 12, { s: 9.5 });
    mini = { x, y, w, h };
  }
  const inMini = (x: number, y: number) => !!mini && x > mini.x && y > mini.y && x < mini.x + mini.w && y < mini.y + mini.h;
  function draw(dt: number) {
    const c = P.ctx;
    c.setTransform(P.dpr, 0, 0, P.dpr, 0, 0); c.fillStyle = P.stage; c.fillRect(0, 0, P.W, P.H); P.hits = [];
    bodyScene.hover = hoverRegion;
    scene.draw(dt); drawMini();
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
    step(dt); draw(dt);
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
  setScene("body"); updateLabs(true);
  if (running) requestAnimationFrame(loop);
}
