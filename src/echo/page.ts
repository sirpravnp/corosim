import "../cath/cath.css";
import "./echo.css";
import type { Pose } from "./poses";
import type { TeeControls } from "./tee";
import type { Label, Reply, Request, ViewRef } from "./worker";
import type { EchoWindow } from "./scan";
import type { SurfaceMesh } from "../anatomy/heartSurface";
import { ProbePreset, presetsFromPoses } from "./probe";
import { EchoScene } from "./scene";
import { playClean } from "./cleanVideo";
import { mountShell } from "../shell/shell";
import { VIEWS, ViewDef, imageFor, Window } from "./views";
import { CASES, CASE_BY_ID } from "./cases";

/**
 * Echo page: a functional echo machine on the simulator's patient. The engine (CT heart, beat, image formation, Doppler) runs in a worker;
 * this file asks it for frames and strips and draws them. A cine loop of one beat is filled in the background, coarse frames first, and
 * plays at the patient's heart rate; while the probe moves, quick draft frames follow it and the loop refills once it stops.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const MEDIA: Record<string, string> = {
  "plax.webm": new URL("./media/plax.webm", import.meta.url).href,
  "psax-pm.webm": new URL("./media/psax-pm.webm", import.meta.url).href,
  "subcostal.webm": new URL("./media/subcostal.webm", import.meta.url).href,
};
const WINDOW_OF: Record<Window, EchoWindow> = { Parasternal: "parasternal", Apical: "apical", Subcostal: "subcostal", Suprasternal: "suprasternal", "Mid-esophageal": "tee", Transgastric: "tee" };
const HALF = Math.PI / 4;
/** Frames per beat in the cine loop, and the order they are filled in: every 8th, then every 4th, and so on, so the loop plays early. */
const NF = 16, FILL = [0, 8, 4, 12, 2, 6, 10, 14, 1, 3, 5, 7, 9, 11, 13, 15];

type Mode = "2d" | "mmode" | "color" | "pw" | "cw" | "tdi";
const STRIP_MODES = new Set<Mode>(["mmode", "pw", "cw", "tdi"]);
const MODE_NAME: Record<Mode, string> = { "2d": "2D", mmode: "M-mode", color: "Color Doppler", pw: "Pulsed-wave Doppler", cw: "Continuous-wave Doppler", tdi: "Tissue Doppler" };

// ---- state ----------------------------------------------------------------------------------------------------------------------
const st = {
  view: VIEWS[0], caseId: "normal", mode: "2d" as Mode, playing: true, gain: 0, nyquist: 0.65, baseline: 0.5,
  tte: null as Record<string, Pose> | null, tee: null as Record<string, TeeControls> | null,
  livePose: null as Pose | null, teeCtl: { level: 0, turn: 0, flex: 0, angle: 0 } as TeeControls,
  beat: null as null | { hr: number; period: number; engine: Extract<Reply, { type: "case" }>["engine"] },
  line: { lineAngle: 0, gateDepth: 80, target: "" },
  /** The pose and geometry of the last frame drawn, for the overlay and for clicks on the image. */
  shown: null as null | { pose: Pose; depth: number; px: number },
  report: null as Record<string, number | null> | null,
  /**
   * A standard view holds the probe still; the free probe (transthoracic or transesophageal) moves, and snaps to a standard view
   * near one of the dots. `snapped` is the view the free probe is on, if any; `view` is then that view (else the last one it was on).
   */
  free: null as null | "tte" | "tee", snapped: null as string | null,
  teeProbe: null as Record<string, [number, number, number]> | null,
  labelsOn: true, labels: [] as Label[],
};
const approach = () => st.free ?? st.view.approach;
let gen = 0, stripGen = 0, keySeq = 0, inflight = false, draftUntil = 0, needDraft = false, needMeasure = false, needAim = false, needStrip = false;
let cine: (ImageData | null)[] = new Array(NF).fill(null), draft: ImageData | null = null, frozenAt = 0;
let strip: { img: ImageData; top: number; bottom: number; seconds: number; nyquist: number; depth: number; mode: Mode } | null = null;
let faceNext = false;
let presets: ProbePreset[] = [], scene: EchoScene | null = null, refVideo: HTMLVideoElement | null = null, refFor = "";
const pending = new Map<number, { gen: number; kind: "frame" | "draft" | "strip" | "aim"; slot?: number; stripGen?: number }>();

const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const send = (r: Request) => worker.postMessage(r);

function viewRef(): ViewRef {
  if (approach() === "tee") return { approach: "tee", controls: { ...st.teeCtl } };
  return { approach: "tte", pose: st.livePose ?? st.tte![st.view.pose], window: WINDOW_OF[st.view.window] };
}

// ---- the job pump: one request in flight at a time, the most useful one first ----------------------------------------------------
function invalidate(opts: { draft?: boolean; strip?: boolean; aim?: boolean } = {}) {
  gen++; cine = new Array(NF).fill(null);
  if (opts.draft) { needDraft = true; draftUntil = performance.now() + 220; }
  if (opts.aim) needAim = true;
  if (opts.strip || opts.aim) { stripGen++; needStrip = STRIP_MODES.has(st.mode); }
  pump();
}

function pump() {
  if (inflight || !st.tte || !st.beat) return;
  const key = ++keySeq, w = 640, h = 560, color = st.mode === "color" ? { nyquist: st.nyquist } : null;
  const frameReq = (t: number, draftQ: boolean, frameNo: number): Request => ({ type: "frame", key, view: viewRef(), w, h, t, frameNo, draft: draftQ, gain: st.gain, color, labels: frameNo === 0 });
  if (needDraft) {
    needDraft = false;
    pending.set(key, { gen, kind: "draft" }); inflight = true; send(frameReq(0, true, 0));
    if (performance.now() < draftUntil) setTimeout(() => { if (!needDraft && cine.every((c) => !c)) pump(); }, 240);
    return;
  }
  if (performance.now() < draftUntil) { setTimeout(pump, draftUntil - performance.now() + 5); return; }
  if (needAim && STRIP_MODES.has(st.mode)) {
    needAim = false;
    pending.set(key, { gen, kind: "aim" }); inflight = true; send({ type: "aim", key, view: viewRef(), viewId: st.view.id, mode: st.mode as "mmode" });
    return;
  }
  // the first frame of the loop, then the measurements, then the strip, then the rest of the loop
  const missing = FILL.find((i) => !cine[i]);
  if (missing === 0) { pending.set(key, { gen, kind: "frame", slot: 0 }); inflight = true; send(frameReq(0, false, 0)); return; }
  if (needMeasure) { needMeasure = false; inflight = true; send({ type: "measure" }); return; }
  if (needStrip && STRIP_MODES.has(st.mode)) {
    needStrip = false;
    pending.set(key, { gen, kind: "strip", stripGen }); inflight = true;
    const spectral = st.mode !== "mmode";
    send({ type: "strip", key, view: viewRef(), w: 900, h: 250, mode: st.mode as "mmode", lineAngle: st.line.lineAngle, gateDepth: st.line.gateDepth, baseline: spectral ? st.baseline : undefined });
    return;
  }
  if (missing !== undefined) {
    pending.set(key, { gen, kind: "frame", slot: missing }); inflight = true;
    send(frameReq((missing / NF) * st.beat.period, false, missing));
  }
}

worker.onmessage = (ev: MessageEvent<Reply>) => {
  const r = ev.data;
  if (r.type === "ready") return onReady(r);
  if (r.type === "case") {
    st.beat = { hr: r.hr, period: r.period, engine: r.engine };
    needMeasure = true; st.report = null; renderTable();
    invalidate({ aim: true });
    return;
  }
  inflight = false;
  if (r.type === "error") { console.error(r.message); $("status").textContent = `The echo engine stopped: ${r.message}`; $("status").hidden = false; pump(); return; }
  if (r.type === "measure") { st.report = r.report; renderTable(); pump(); return; }
  const job = pending.get(r.key); pending.delete(r.key);
  if (!job) { pump(); return; }
  if (r.type === "aim") {
    if (job.gen === gen) { st.line = { lineAngle: r.lineAngle, gateDepth: r.gateDepth, target: r.target }; stripGen++; needStrip = true; drawOverlay(); captions(); }
  } else if (r.type === "strip") {
    if (job.stripGen === stripGen) {
      strip = { img: new ImageData(new Uint8ClampedArray(r.rgba), r.w, r.h), top: r.top, bottom: r.bottom, seconds: r.seconds, nyquist: r.nyquist, depth: r.depth, mode: st.mode };
      drawStrip();
    }
  } else if (r.type === "frame") {
    const img = new ImageData(new Uint8ClampedArray(r.rgba), r.w, r.h);
    st.shown = { pose: r.pose, depth: r.depth, px: r.pxPerMm };
    if (r.labels && (job.kind === "draft" || job.gen === gen)) { st.labels = r.labels; shownSlot = -1; shownDraft = null; }
    if (approach() === "tee" && scene) { scene.setPose(r.pose); if (faceNext) { scene.frameOn(r.pose); faceNext = false; } }
    if (job.kind === "draft") draft = img;
    else if (job.gen === gen && job.slot !== undefined) { cine[job.slot] = img; if (job.slot === 0) draft = null; }
    $("status").hidden = true;
    if (!st.playing || job.kind === "draft") paint();
  }
  pump();
};

function onReady(r: Extract<Reply, { type: "ready" }>) {
  st.tte = r.tte; st.tee = r.tee; st.teeProbe = r.teeProbe;
  presets = presetsFromPoses(r.tte);
  $("status").textContent = "Building the patient…";
  try {
    scene = new EchoScene($("scene"));
    scene.setMesh(r.mesh as unknown as SurfaceMesh);
    scene.setPresets(presets);
    scene.onPoseChange = (pose, id) => {
      if (st.free !== "tte") return;
      st.livePose = pose;
      const v = id ? VIEWS.find((x) => x.approach === "tte" && x.pose === id) : null;
      const was = st.snapped;
      st.snapped = v ? v.id : null;
      if (v) st.view = v;
      if (was !== st.snapped) fillMeta();
      invalidate({ draft: !id, aim: true });
    };
    $("loading").remove();
  } catch (err) {
    $("loading").textContent = "The 3D heart could not be drawn in this browser.";
    console.error(err);
  }
  if (st.free) enterFree(st.free, true); else selectView(st.view.id, false);
  send({ type: "case", id: st.caseId });
}

// ---- drawing --------------------------------------------------------------------------------------------------------------------
const img = $("img") as HTMLCanvasElement, over = $("over") as HTMLCanvasElement, ig = img.getContext("2d")!, og = over.getContext("2d")!;
const stripC = $("strip") as HTMLCanvasElement, stripO = $("stripOver") as HTMLCanvasElement, sg = stripC.getContext("2d")!, so = stripO.getContext("2d")!;
let shownSlot = -1, shownDraft: ImageData | null = null;

/** The cine frame for a moment in the beat: the nearest one already made. */
function frameFor(t: number): { im: ImageData | null; slot: number } {
  const p = st.beat?.period ?? 1, want = Math.round(((t % p) / p) * NF) % NF;
  for (let d = 0; d < NF / 2 + 1; d++) for (const s of [want - d, want + d]) { const i = (s + NF) % NF; if (cine[i]) return { im: cine[i], slot: i }; }
  return { im: null, slot: -1 };
}

function paint(now = performance.now()) {
  const t = st.playing ? now / 1000 : frozenAt;
  const showDraft = draft && (performance.now() < draftUntil + 400 || cine.every((c) => !c));
  if (showDraft) { if (shownDraft !== draft) { ig.putImageData(draft!, 0, 0); shownDraft = draft; shownSlot = -1; drawOverlay(); } }
  else {
    const f = frameFor(t);
    if (f.im && f.slot !== shownSlot) { ig.putImageData(f.im, 0, 0); shownSlot = f.slot; shownDraft = null; drawOverlay(); }
  }
  drawSweep(t);
}

function loop(now: number) { if (st.playing) paint(now); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

const INK = "#f4f1ea", FAINT = "rgba(244,241,234,0.55)";
function drawOverlay() {
  og.clearRect(0, 0, over.width, over.height);
  const s = st.shown; if (!s) return;
  const cx = over.width / 2, px = s.px;
  og.font = "500 12px 'JetBrains Mono', monospace"; og.fillStyle = INK; og.strokeStyle = FAINT; og.lineWidth = 1;
  // depth scale along the right edge of the sector: a tick every centimeter, labeled every 5
  const x0 = Math.min(over.width - 30, cx + Math.sin(HALF) * s.depth * px + 6);
  for (let cm = 0; cm * 10 <= s.depth; cm++) {
    const y = cm * 10 * px, major = cm % 5 === 0;
    og.beginPath(); og.moveTo(x0, y); og.lineTo(x0 + (major ? 8 : 4), y); og.stroke();
    if (major && cm > 0) og.fillText(String(cm), x0 + 10, y + 4);
  }
  // the index mark: a dot on the screen's right, beside the sector's apex
  og.beginPath(); og.arc(cx + 34, 12, 4, 0, 2 * Math.PI); og.fill();
  // the scanner's header: view, mode, heart rate, depth
  og.fillText(`${st.view.short}  ${MODE_NAME[st.mode]}`, 12, 20);
  if (st.beat) og.fillText(`HR ${Math.round(st.beat.hr)}`, 12, 38);
  og.fillText(`${(s.depth / 10).toFixed(0)} cm`, 12, 56);
  if (st.labelsOn) {
    // structure labels, centered in each cavity, as a teaching scanner's annotation
    og.font = "600 15px 'Hanken Grotesk', system-ui, sans-serif"; og.textAlign = "center"; og.textBaseline = "middle";
    og.lineWidth = 4; og.strokeStyle = "rgba(0,0,0,0.85)"; og.fillStyle = INK;
    for (const l of st.labels) { const x = cx + l.lateral * px, y = l.depth * px; og.strokeText(l.text, x, y); og.fillText(l.text, x, y); }
    og.textAlign = "start"; og.textBaseline = "alphabetic"; og.font = "500 12px 'JetBrains Mono', monospace"; og.strokeStyle = FAINT; og.lineWidth = 1;
  }
  if (st.mode === "color") {
    // color box outline and the scale bar with its Nyquist limit
    og.strokeStyle = FAINT; og.beginPath();
    const a0 = -0.38, a1 = 0.38, r0 = 8 * px, r1 = s.depth * px;
    og.arc(cx, 0, r0, Math.PI / 2 - a1, Math.PI / 2 - a0); og.arc(cx, 0, r1, Math.PI / 2 - a0, Math.PI / 2 - a1, true); og.closePath(); og.stroke();
    const bx = 16, by = over.height - 150;
    for (let i = 0; i < 100; i++) { const u = 1 - i / 49.5; const [r, g, b] = barColor(u); og.fillStyle = `rgb(${r},${g},${b})`; og.fillRect(bx, by + i, 10, 1); }
    og.fillStyle = INK; og.fillText(`+${st.nyquist.toFixed(2)}`, bx + 14, by + 8); og.fillText(`-${st.nyquist.toFixed(2)}`, bx + 14, by + 100); og.fillText("m/s", bx + 14, by + 54);
  }
  if (STRIP_MODES.has(st.mode)) {
    // the cursor line and, for PW and TDI, the sample volume; for CW, the focus mark
    const a = st.line.lineAngle, dx = Math.sin(a), dy = Math.cos(a), L = s.depth * px;
    og.strokeStyle = INK; og.setLineDash([4, 4]); og.beginPath(); og.moveTo(cx, 0); og.lineTo(cx + dx * L, dy * L); og.stroke(); og.setLineDash([]);
    const g = st.line.gateDepth * px, gx = cx + dx * g, gy = dy * g;
    if (st.mode === "pw" || st.mode === "tdi") {
      const nx = dy * 7, ny = -dx * 7, half = 1.5 * px;
      for (const k of [-half, half]) { og.beginPath(); og.moveTo(gx + dx * k - nx, gy + dy * k - ny); og.lineTo(gx + dx * k + nx, gy + dy * k + ny); og.stroke(); }
    } else if (st.mode === "cw") { og.beginPath(); og.moveTo(gx - 5, gy); og.lineTo(gx + 5, gy); og.moveTo(gx, gy - 5); og.lineTo(gx, gy + 5); og.stroke(); }
  }
}
/** The color bar is drawn with the same map the image uses (BART); see dopplerColor in scan.ts. */
function barColor(u: number): [number, number, number] {
  const a = Math.min(1, Math.abs(u));
  if (u >= 0) return [110 + 145 * Math.min(1, a * 1.6), a > 0.55 ? 255 * ((a - 0.55) / 0.45) : 0, a > 0.85 ? 160 * ((a - 0.85) / 0.15) : 0];
  return [a > 0.85 ? 120 * ((a - 0.85) / 0.15) : 0, a > 0.45 ? 230 * ((a - 0.45) / 0.55) : 30 * a, 120 + 135 * Math.min(1, a * 1.6)];
}

function drawStrip() {
  if (!strip) return;
  sg.putImageData(strip.img, 0, 0);
  so.clearRect(0, 0, stripO.width, stripO.height);
  so.font = "500 12px 'JetBrains Mono', monospace"; so.fillStyle = INK; so.strokeStyle = FAINT; so.lineWidth = 1;
  const W = stripO.width, H = stripO.height;
  if (strip.mode === "mmode") {
    for (let cm = 1; cm * 10 < strip.depth; cm++) { const y = (cm * 10 * H) / strip.depth; so.beginPath(); so.moveTo(W - 8, y); so.lineTo(W, y); so.stroke(); if (cm % 2 === 0) so.fillText(String(cm), W - 28, y + 4); }
    so.fillText("cm", W - 28, 14);
  } else {
    // velocity scale (m/s) and the baseline
    const vToY = (v: number) => ((strip!.top - v) / (strip!.top - strip!.bottom)) * H, span = strip.top - strip.bottom;
    const step = span > 6 ? 1 : span > 2.5 ? 0.5 : span > 1 ? 0.2 : 0.05;
    for (let v = Math.ceil(strip.bottom / step) * step; v <= strip.top + 1e-9; v += step) {
      const y = vToY(v); if (y < 6 || y > H - 4) continue;
      so.beginPath(); so.moveTo(W - 8, y); so.lineTo(W, y); so.stroke();
      so.fillText((Math.abs(v) < 1e-9 ? 0 : v).toFixed(step < 0.1 ? 2 : 1), W - 46, y + 4);
    }
    const y0 = vToY(0); so.beginPath(); so.moveTo(0, y0); so.lineTo(W - 50, y0); so.stroke();
    so.fillText("m/s", W - 46, 14);
    if (Number.isFinite(strip.nyquist)) so.fillText(`Nyquist ${strip.nyquist.toFixed(2)} m/s`, 10, 18);
  }
  // time marks: one per 200 ms, as on a scanner's sweep
  for (let t = 0.2; t < strip.seconds; t += 0.2) { const x = (t / strip.seconds) * W; so.beginPath(); so.moveTo(x, H - 6); so.lineTo(x, H); so.stroke(); }
  sweepBase = so.getImageData(0, 0, W, H);
}
let sweepBase: ImageData | null = null, lastSweep = -1;
/** A thin sweep line on the strip in step with the loop above it, so the eye can tie a velocity to a moment in the image. */
function drawSweep(t: number) {
  if (!strip || !sweepBase || !st.beat) return;
  const x = Math.round(((t % strip.seconds) / strip.seconds) * stripO.width);
  if (x === lastSweep) return; lastSweep = x;
  so.putImageData(sweepBase, 0, 0);
  so.fillStyle = INK; so.fillRect(x, 0, 1, stripO.height);
}

// ---- strip readout: a caliper under the pointer -------------------------------------------------------------------------------
stripO.addEventListener("pointermove", (e) => {
  if (!strip || !sweepBase) return;
  const rect = stripO.getBoundingClientRect(), x = ((e.clientX - rect.left) / rect.width) * stripO.width, y = ((e.clientY - rect.top) / rect.height) * stripO.height;
  so.putImageData(sweepBase, 0, 0); lastSweep = -1;
  so.strokeStyle = INK; so.setLineDash([3, 3]); so.beginPath(); so.moveTo(0, y); so.lineTo(stripO.width, y); so.stroke(); so.setLineDash([]);
  const tMs = (x / stripO.width) * strip.seconds * 1000;
  const read = strip.mode === "mmode" ? `${((y / stripO.height) * strip.depth).toFixed(0)} mm` : (() => {
    const v = strip!.top - (y / stripO.height) * (strip!.top - strip!.bottom); return `${v.toFixed(2)} m/s, ${(4 * v * v).toFixed(0)} mmHg`;
  })();
  so.fillStyle = INK; so.fillText(`${read}  ${tMs.toFixed(0)} ms`, Math.min(x + 8, stripO.width - 220), Math.max(14, y - 6));
});
stripO.addEventListener("pointerleave", () => { if (sweepBase) so.putImageData(sweepBase, 0, 0); lastSweep = -1; });

// ---- clicks on the image move the cursor line and the sample volume -------------------------------------------------------------
over.addEventListener("click", (e) => {
  const s = st.shown; if (!s || !STRIP_MODES.has(st.mode)) return;
  const rect = over.getBoundingClientRect(), x = ((e.clientX - rect.left) / rect.width) * over.width - over.width / 2, y = ((e.clientY - rect.top) / rect.height) * over.height;
  const a = Math.max(-HALF * 0.95, Math.min(HALF * 0.95, Math.atan2(x, y))), d = Math.max(5, Math.min(s.depth, Math.hypot(x, y) / s.px));
  st.line = { lineAngle: a, gateDepth: d, target: "" };
  stripGen++; needStrip = true; drawOverlay(); captions(); pump();
});

// ---- the page ---------------------------------------------------------------------------------------------------------------------
function renderCases() {
  $("cases").innerHTML = CASES.map((c) => `<a href="#" data-case="${c.id}" role="button">${esc(c.title)}<small>${esc(c.blurb)}</small></a>`).join("");
}
function renderList() {
  const groups: [string, Window][] = [["Transthoracic: parasternal", "Parasternal"], ["Transthoracic: apical", "Apical"], ["Transthoracic: subcostal", "Subcostal"], ["Transthoracic: suprasternal", "Suprasternal"], ["Transesophageal: mid-esophageal", "Mid-esophageal"], ["Transesophageal: transgastric", "Transgastric"]];
  $("list").innerHTML = `<h3>Free probe</h3><a href="#free-tte" data-free="tte" role="button">Transthoracic probe<small>Slide, tilt and roll it anywhere on the chest</small></a><a href="#free-tee" data-free="tee" role="button">Transesophageal probe<small>Advance, turn, flex and rotate the omniplane</small></a>` + groups.map(([label, g]) => `<h3>${label}</h3>` + VIEWS.filter((v) => v.window === g).map((v) =>
    `<a href="#${v.id}" data-id="${v.id}" role="button">${esc(v.short)}<small>${esc(v.name)}</small></a>`).join("")).join("");
}

function fillMeta() {
  const v = st.view, c = CASE_BY_ID[st.caseId]!, between = st.free && !st.snapped;
  document.querySelectorAll<HTMLElement>("#list a").forEach((a) => a.classList.toggle("on", st.free ? a.dataset.free === st.free : a.dataset.id === v.id));
  document.querySelectorAll<HTMLElement>("#cases a").forEach((a) => a.classList.toggle("on", a.dataset.case === st.caseId));
  const probeName = st.free === "tee" ? "Free transesophageal probe" : "Free transthoracic probe";
  $("title").textContent = !st.free ? v.name : between ? probeName : `${probeName}: ${v.name.charAt(0).toLowerCase()}${v.name.slice(1)}`;
  $("summary").textContent = between ? "Between standard views. Move the probe toward a dot on the heart and it snaps into that view." : v.lookFor;
  $("placement").textContent = between ? "Wherever you put it." : v.placement;
  $("marker").textContent = between ? "Where you turned it." : v.marker;
  $("shows").innerHTML = between ? "<li>Whatever the plane cuts. The labels name the chambers it finds.</li>" : v.shows.map((s) => `<li>${esc(s)}</li>`).join("");
  $("findings").innerHTML = `<li><b>${esc(c.title)}.</b> ${esc(c.blurb)}</li>` + c.findings.map((f) => `<li>${esc(f)}</li>`).join("");
  $("caseNote").textContent = c.note ?? "";
  const hash = `#${st.free ? `free-${st.free}` : v.id}${st.caseId !== "normal" ? `&case=${st.caseId}` : ""}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
  $("teeControls").hidden = approach() !== "tee";
  // a standard view holds the probe still: only the free probe moves
  if (scene) scene.interactive = st.free === "tte";
  for (const id of ["teeLevel", "teeTurn", "teeFlex", "teeAngle"]) ($(id) as HTMLInputElement).disabled = st.free !== "tee";
  $("teeControls").classList.toggle("locked", st.free !== "tee");
  markers();
  reference();
  captions();
}

/** Number the figures that are showing, in page order, and say what each shows. */
function captions() {
  const figs: [string, string][] = [];
  const where = approach() === "tee" ? "the transesophageal probe's position" : "the probe's position";
  figs.push(["cap1", `${MODE_NAME[st.mode]} of this patient at ${where}.${st.mode === "color" ? " Red is flow toward the probe, blue away; mosaic marks turbulent or aliased flow. Drag the Scale slider to move the Nyquist limit." : ""}${STRIP_MODES.has(st.mode) ? " Click the image to move the cursor." : ""}`]);
  if (STRIP_MODES.has(st.mode)) {
    const at = st.line.target ? ` The cursor starts at ${st.line.target}.` : "";
    const text = st.mode === "mmode" ? "M-mode along the cursor line: depth down, time across, two beats." : `${MODE_NAME[st.mode]} along the cursor line, two beats. Velocities toward the probe are above the baseline. Point at the strip to read a velocity and its simplified Bernoulli gradient (4v²).`;
    figs.push(["cap2", text + at]);
  }
  const dots = "The dots mark where the probe sits for each standard view.";
  figs.push(["cap3", approach() === "tee"
    ? `The transesophageal probe and its imaging plane on the CT heart. ${dots} ${st.free ? "Advance or withdraw, turn, flex and rotate the omniplane with the controls below; near a standard view the probe snaps to it." : "A standard view holds the probe still; choose the free transesophageal probe to move it."}`
    : `The probe and its imaging plane on the CT heart. ${dots} Drag the heart to turn it. ${st.free ? "Drag the probe to slide it, shift-drag to tilt, scroll over it to roll the index mark; let go near a dot and it snaps into that view." : "A standard view holds the probe still; choose the free transthoracic probe to move it."}`]);
  const im = st.free && !st.snapped ? undefined : imageFor(st.view.id);
  if (im && approach() === "tte") figs.push(["cap4", `Reference echo, ${st.view.name.toLowerCase()}: a real recording for comparison. <span class="echo-credit">${esc(im.note)} ${esc(im.author)}, <a href="${im.licenseUrl}" rel="noopener">${esc(im.license)}</a>, <a href="${im.source}" rel="noopener">source</a>.</span>`]);
  figs.forEach(([id, text], i) => { $(id).innerHTML = `Figure ${i + 1}. ${text}`; });
  $("stripFig").hidden = !STRIP_MODES.has(st.mode);
}

function reference() {
  const im = st.free && !st.snapped ? undefined : imageFor(st.view.id), fig = $("refFig");
  if (!im || im.kind !== "video" || !im.clean || approach() !== "tte") {
    fig.hidden = true;
    if (refVideo) { refVideo.pause(); refVideo.removeAttribute("src"); refVideo.load(); refVideo = null; refFor = ""; }
    return;
  }
  fig.hidden = false;
  if (refFor === st.view.id) return;
  if (refVideo) { refVideo.pause(); refVideo.removeAttribute("src"); refVideo.load(); }
  refVideo = playClean($("ref") as HTMLCanvasElement, MEDIA[im.file], im.clean); refFor = st.view.id;
}

function selectView(id: string, animate = true) {
  st.view = VIEWS.find((v) => v.id === id) ?? VIEWS[0];
  st.free = null; st.snapped = null;
  fillMeta();
  if (!st.tte || !st.tee) return;
  if (st.view.approach === "tte") {
    st.livePose = st.tte[st.view.pose];
    const p = presets.find((x) => x.id === st.view.pose);
    if (p) scene?.goTo(p, animate);
  } else {
    st.teeCtl = { ...st.tee[st.view.pose] };
    syncTee();
    st.livePose = null;
  }
  invalidate({ aim: true });
  // a transesophageal view: the frame's reply carries the pose; face the camera onto it once it arrives
  if (st.view.approach === "tee") faceNext = true;
}

/** Hand the probe to the student: from wherever it is now (or the first standard view of that approach), free to move. */
function enterFree(kind: "tte" | "tee", fresh = false) {
  const wasApproach = fresh ? null : approach();
  st.free = kind;
  if (wasApproach !== kind) {
    // switching approach: start the free probe at that approach's first standard view
    st.view = VIEWS.find((v) => v.approach === kind)!;
  }
  st.snapped = st.view.approach === kind ? st.view.id : null;
  if (st.tte && st.tee) {
    if (kind === "tte") {
      if (wasApproach !== "tte" || !st.livePose) st.livePose = st.tte[st.view.pose];
      if (wasApproach !== "tte") { const p = presets.find((x) => x.id === st.view.pose); if (p) scene?.goTo(p, false); }
    } else if (wasApproach !== "tee") { st.teeCtl = { ...st.tee[st.view.pose] }; syncTee(); faceNext = true; }
  }
  fillMeta();
  invalidate({ aim: true });
}

/** Dots for the standard views of the current approach, at their probe positions. */
function markers() {
  if (!scene || !st.tte || !st.teeProbe) return;
  const a = approach(), active = st.free ? st.snapped : st.view.id;
  scene.setMarkers(VIEWS.filter((v) => v.approach === a).map((v) => ({ id: v.id, label: v.short, at: a === "tte" ? st.tte![v.pose].probe : st.teeProbe![v.pose] })), active);
}

/** The free transesophageal probe snaps to a standard view when every control is close to that view's. */
function snapTee() {
  if (st.free !== "tee" || !st.tee) return;
  let best: string | null = null, bd = Infinity;
  for (const v of VIEWS) {
    if (v.approach !== "tee") continue;
    const c = st.tee[v.pose], q = st.teeCtl;
    const turn = Math.abs(((q.turn - c.turn + 540) % 360) - 180);
    const d = Math.abs(q.level - c.level) / 8 + turn / 12 + Math.abs(q.flex - c.flex) / 10 + Math.abs(q.angle - c.angle) / 15;
    if (d < bd) { bd = d; best = v.id; }
  }
  const was = st.snapped;
  if (best && bd < 1) { const v = VIEWS.find((x) => x.id === best)!; st.view = v; st.snapped = v.id; st.teeCtl = { ...st.tee[v.pose] }; syncTee(); invalidate({ aim: true }); }
  else st.snapped = null;
  if (was !== st.snapped) fillMeta();
}

function syncTee() {
  const c = st.teeCtl, set = (id: string, v: number, unit: string) => { ($(id) as HTMLInputElement).value = String(Math.round(v)); $(`${id}v`).textContent = `${Math.round(v)}${unit}`; };
  set("teeLevel", c.level, " mm"); set("teeTurn", c.turn, "°"); set("teeFlex", c.flex, "°"); set("teeAngle", c.angle, "°");
}
for (const [id, k] of [["teeLevel", "level"], ["teeTurn", "turn"], ["teeFlex", "flex"], ["teeAngle", "angle"]] as const) {
  $(id).addEventListener("input", (e) => {
    if (st.free !== "tee") return;
    st.teeCtl[k] = Number((e.target as HTMLInputElement).value);
    syncTee();
    if (st.snapped) { st.snapped = null; fillMeta(); }
    invalidate({ draft: true, aim: true });
  });
  $(id).addEventListener("change", snapTee);
}

function setMode(m: Mode) {
  st.mode = m;
  $("modes").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
  $("nyqWrap").hidden = m !== "color";
  $("baseWrap").hidden = !(m === "pw" || m === "cw" || m === "tdi");
  strip = null; sweepBase = null; sg.clearRect(0, 0, stripC.width, stripC.height); so.clearRect(0, 0, stripO.width, stripO.height);
  captions();
  invalidate({ aim: true });
  drawOverlay();
}

// ---- table --------------------------------------------------------------------------------------------------------------------
type Row = [label: string, key: string | null, digits: number, engine?: (e: NonNullable<typeof st.beat>["engine"]) => number | null];
const ROWS: [string, Row[]][] = [
  ["Left ventricle, Simpson's biplane (A4C and A2C)", [
    ["EF (%)", "simpsonEf", 0, (e) => e.ef], ["End-diastolic volume (ml)", "simpsonEdv", 0, (e) => e.edv], ["End-systolic volume (ml)", "simpsonEsv", 0, (e) => e.esv]]],
  ["M-mode, parasternal long axis", [
    ["Septum in diastole (mm)", "ivsd", 1], ["LV diameter in diastole (mm)", "lvidd", 1], ["Posterior wall in diastole (mm)", "lvpwd", 1],
    ["LV diameter in systole (mm)", "lvids", 1], ["Fractional shortening (%)", "fs", 0], ["EF, Teichholz (%)", "teichEf", 0, (e) => e.ef]]],
  ["Mitral inflow and annulus", [
    ["E velocity (m/s)", "e", 2], ["A velocity (m/s)", "a", 2], ["E/A", "ea", 1], ["E deceleration time (ms)", "dt", 0],
    ["e′, septal and lateral average (m/s)", "ePrime", 2], ["E/e′", "eOverEprime", 1], ["Mitral mean gradient (mmHg)", "mvMean", 1, (e) => e.mvMean]]],
  ["Outflow and aortic valve", [
    ["LVOT VTI (cm)", "lvotVti", 1], ["Stroke volume (ml)", "sv", 0, (e) => e.sv], ["Aortic peak velocity (m/s)", "avVmax", 2],
    ["Aortic peak gradient (mmHg)", "avPeak", 0], ["Aortic mean gradient (mmHg)", "avMean", 0, (e) => e.avMean], ["Aortic valve area (cm²)", "ava", 2]]],
  ["Right heart", [["TR peak velocity (m/s)", "trVmax", 2], ["RV systolic pressure (mmHg)", "rvsp", 0, (e) => e.rvSys]]],
];
function renderTable() {
  const f = (v: number | null | undefined, d: number) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(d));
  const e = st.beat?.engine, r = st.report;
  $("measBody").innerHTML = ROWS.map(([group, rows]) => `<tr class="grp"><th scope="rowgroup" colspan="3">${group}</th></tr>` + rows.map(([label, key, d, eng]) =>
    `<tr><th scope="row">${label}</th><td>${r ? f(key ? r[key] : null, d) : "…"}</td><td>${e && eng ? f(eng(e), d) : ""}</td></tr>`).join("")).join("");
}

// ---- controls ---------------------------------------------------------------------------------------------------------------------
$("list").addEventListener("click", (e) => {
  const f = (e.target as HTMLElement).closest<HTMLElement>("a[data-free]");
  if (f) { e.preventDefault(); enterFree(f.dataset.free as "tte" | "tee"); return; }
  const a = (e.target as HTMLElement).closest<HTMLElement>("a[data-id]");
  if (a) { e.preventDefault(); selectView(a.dataset.id!); }
});
$("cases").addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLElement>("a[data-case]");
  if (!a) return;
  e.preventDefault();
  if (a.dataset.case === st.caseId) return;
  st.caseId = a.dataset.case!; fillMeta();
  st.beat = null; cine = new Array(NF).fill(null); st.report = null; renderTable();
  $("status").textContent = "Building the patient…"; $("status").hidden = false;
  send({ type: "case", id: st.caseId });
});
$("modes").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-mode]");
  if (b && b.dataset.mode !== st.mode) setMode(b.dataset.mode as Mode);
});
$("play").addEventListener("click", () => {
  st.playing = !st.playing;
  if (!st.playing) frozenAt = performance.now() / 1000;
  $("play").textContent = st.playing ? "Freeze" : "Play";
  $("play").setAttribute("aria-pressed", String(st.playing));
  pump(); paint();
});
const slider = (id: string, out: string, fmt: (v: number) => string, apply: (v: number) => void) => {
  const el = $(id) as HTMLInputElement, show = () => { $(out).textContent = fmt(Number(el.value)); };
  show();
  el.addEventListener("input", show);
  el.addEventListener("change", () => apply(Number(el.value)));
};
slider("gain", "gainv", (v) => `${v > 0 ? "+" : ""}${v} dB`, (v) => { st.gain = v; invalidate(); });
slider("nyq", "nyqv", (v) => `${v.toFixed(2)} m/s`, (v) => { st.nyquist = v; invalidate(); });
slider("base", "basev", (v) => (v < 0.45 ? "high" : v > 0.55 ? "low" : "middle"), (v) => { st.baseline = v; stripGen++; needStrip = true; pump(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const t = e.target as HTMLElement; if (t.closest("input,select,textarea,button")) return;
  e.preventDefault();
  const i = VIEWS.indexOf(st.view) + (e.key === "ArrowDown" ? 1 : -1);
  selectView(VIEWS[(i + VIEWS.length) % VIEWS.length].id);
});
function fromHash() {
  const [id, ...rest] = location.hash.slice(1).split("&"), c = rest.find((p) => p.startsWith("case="))?.slice(5);
  const free = id === "free-tte" ? "tte" as const : id === "free-tee" ? "tee" as const : null;
  return { id: VIEWS.some((v) => v.id === id) ? id : VIEWS[0].id, free, caseId: c && CASE_BY_ID[c] ? c : "normal" };
}
window.addEventListener("hashchange", () => {
  const h = fromHash();
  if (h.caseId !== st.caseId) { st.caseId = h.caseId; st.beat = null; send({ type: "case", id: st.caseId }); }
  if (h.free) { if (h.free !== st.free) enterFree(h.free); }
  else if (h.id !== st.view.id || st.free) selectView(h.id);
});
$("labels").addEventListener("click", () => {
  st.labelsOn = !st.labelsOn;
  $("labels").setAttribute("aria-pressed", String(st.labelsOn));
  drawOverlay();
});


renderCases();
renderList();
renderTable();
{ const h = fromHash(); st.caseId = h.caseId; st.view = VIEWS.find((v) => v.id === h.id)!; st.free = h.free; if (h.free) st.view = VIEWS.find((v) => v.approach === h.free)!; }
fillMeta();
mountShell({ page: "echo", root: "../" }).ai.start();
send({ type: "init" });
