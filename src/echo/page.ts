import "../cath/cath.css";
import "./echo.css";
import { buildPoses, Pose } from "./poses";
import { ProbePreset, presetsFromPoses, referenceBlend } from "./probe";
import { EchoScene } from "./scene";
import { playClean } from "./cleanVideo";
import { paintLive } from "./paint";
import { mountShell } from "../shell/shell";
import { VIEWS, ViewDef, imageFor, Window } from "./views";

/**
 * Echo page: move the probe on the 3D heart; the ideal slice and a teaching echo follow the scan
 * plane. At a calibrated view the real reference loop fades in over the teaching image.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** Vite rewrites these URLs for whatever base the site is published under. */
const MEDIA: Record<string, string> = {
  "plax.webm": new URL("./media/plax.webm", import.meta.url).href,
  "psax-pm.webm": new URL("./media/psax-pm.webm", import.meta.url).href,
  "subcostal.webm": new URL("./media/subcostal.webm", import.meta.url).href,
};
const asset = (f: string) => MEDIA[f];

const PROBE_NOTE = "Figure 1. Probe and imaging plane on the simulator's 3D heart. Drag the heart to turn it and scroll to zoom. Drag the probe to slide it on the chest, shift-drag to tilt it, and scroll over it to roll the index mark. Pick a view to snap the probe into place.";
const ECHO_NOTE_SIM = "Figure 3. Teaching echo from the schematic model — not a realistic ultrasound. Move the probe toward a standard view to fade in a real reference loop.";

let current = VIEWS[0];
let poses: Record<string, Pose> | null = null;
let presets: ProbePreset[] = [];
let scene: EchoScene | null = null;
let livePose: Pose | null = null;
let labelsOn = true;
let firstSelect = true;
let paintQueued = false;
let paintQuality: "draft" | "full" = "full";
let settleTimer = 0;
let realViewId: string | null = null;
let realVideo: HTMLVideoElement | null = null;

function viewForPoseKey(poseKey: string | null): ViewDef | null {
  if (!poseKey) return null;
  return VIEWS.find((v) => v.pose === poseKey) ?? null;
}

function renderList() {
  const groups: Window[] = ["Parasternal", "Subcostal"];
  $("list").innerHTML = groups.map((g) => `<h3>${g}</h3>` + VIEWS.filter((v) => v.window === g).map((v) =>
    `<a href="#${v.id}" data-id="${v.id}" role="button">${esc(v.short)}<small>${esc(v.name)}</small></a>`).join("")).join("");
}

function fillMeta(v: ViewDef) {
  document.querySelectorAll<HTMLElement>("#list a").forEach((a) => a.classList.toggle("on", a.dataset.id === v.id));
  $("title").textContent = v.name;
  $("summary").textContent = v.lookFor;
  $("placement").textContent = v.placement;
  $("marker").textContent = v.marker;
  $("shows").innerHTML = v.shows.map((s) => `<li>${esc(s)}</li>`).join("");
  if (location.hash.slice(1) !== v.id) history.replaceState(null, "", `#${v.id}`);
}

function stopReal() {
  if (realVideo) {
    realVideo.pause();
    realVideo.removeAttribute("src");
    realVideo.load();
    realVideo = null;
  }
  realViewId = null;
  const real = $("real") as HTMLCanvasElement;
  const g = real.getContext("2d");
  g?.clearRect(0, 0, real.width, real.height);
  real.style.opacity = "0";
  $("badge").hidden = true;
  $("echonote").textContent = ECHO_NOTE_SIM;
}

function showReal(view: ViewDef, amount: number) {
  const im = imageFor(view.id);
  const real = $("real") as HTMLCanvasElement;
  const badge = $("badge");
  if (!im || im.kind !== "video" || !im.clean) {
    stopReal();
    return;
  }
  if (realViewId !== view.id) {
    stopReal();
    realViewId = view.id;
    realVideo = playClean(real, asset(im.file), im.clean);
  }
  real.style.opacity = String(amount);
  badge.hidden = amount < 0.15;
  badge.textContent = `Reference echo: ${view.short}`;
  const credit = `${esc(im.note)} ${esc(im.author)}, <a href="${im.licenseUrl}" rel="noopener">${esc(im.license)}</a>, <a href="${im.source}" rel="noopener">source</a>.`;
  $("echonote").innerHTML = amount > 0.15
    ? `Figure 3. Reference echo: ${esc(view.name)}.<span class="echo-credit">${credit}</span>`
    : ECHO_NOTE_SIM;
}

function paintNow(pose: Pose, quality: "draft" | "full") {
  paintLive($("ideal") as HTMLCanvasElement, $("stylized") as HTMLCanvasElement, pose, labelsOn, quality);
  const blend = referenceBlend(pose, presets);
  const view = viewForPoseKey(blend.id);
  if (view && blend.amount > 0) showReal(view, blend.amount);
  else stopReal();
}

function queuePaint(pose: Pose, quality: "draft" | "full" = "full") {
  livePose = pose;
  paintQuality = quality;
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    if (livePose) paintNow(livePose, paintQuality);
  });
  window.clearTimeout(settleTimer);
  if (quality === "draft") {
    settleTimer = window.setTimeout(() => { if (livePose) queuePaint(livePose, "full"); }, 140);
  }
}

function select(id: string) {
  current = VIEWS.find((v) => v.id === id) ?? VIEWS[0];
  fillMeta(current);
  $("posenote").textContent = PROBE_NOTE;
  if (poses) {
    const preset = presets.find((p) => p.id === current.pose);
    if (preset) scene?.goTo(preset, firstSelect ? false : true);
    queuePaint(poses[current.pose], "full");
    firstSelect = false;
  }
}

function onPoseChange(pose: Pose, poseKey: string | null) {
  queuePaint(pose, poseKey ? "full" : "draft");
  const view = viewForPoseKey(poseKey);
  if (view && view.id !== current.id) {
    current = view;
    fillMeta(view);
  }
}

$("list").addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).closest<HTMLElement>("a[data-id]");
  if (a) { e.preventDefault(); select(a.dataset.id!); }
});
/** The labels control is a two-button segmented group; each button carries data-labels="on" or "off". */
$("labels").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-labels]");
  if (!b) return;
  const on = b.dataset.labels === "on";
  if (on === labelsOn) return;
  labelsOn = on;
  $("labels").querySelectorAll<HTMLButtonElement>("button[data-labels]").forEach((btn) =>
    btn.setAttribute("aria-pressed", String(btn.dataset.labels === (on ? "on" : "off"))));
  if (livePose) queuePaint(livePose, "full");
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const t = e.target as HTMLElement; if (t.closest("input,select,textarea,button")) return;
  e.preventDefault();
  const i = VIEWS.indexOf(current) + (e.key === "ArrowDown" ? 1 : -1);
  select(VIEWS[(i + VIEWS.length) % VIEWS.length].id);
});

renderList();
mountShell({ page: "echo", root: "../" }).ai.start();

try {
  poses = buildPoses();
  presets = presetsFromPoses(poses);
  scene = new EchoScene($("scene"));
  scene.setPresets(presets);
  scene.onPoseChange = onPoseChange;
  $("loading").remove();
  select(location.hash.slice(1) || VIEWS[0].id);
} catch (err) {
  $("loading").textContent = "The 3D heart could not be drawn in this browser.";
  console.error(err);
}
window.addEventListener("hashchange", () => select(location.hash.slice(1)));
