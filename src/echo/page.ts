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

const PROBE_NOTE = "Figure 1. Probe and imaging plane on the simulator's 3D heart. Drag to slide the probe on the chest; scroll to roll the index mark; right-drag to turn the camera. Pick a view to snap back. The red dot is the index mark.";
const ECHO_NOTE_SIM = "Figure 3. Teaching echo from the schematic model — not a realistic ultrasound. Move the probe toward a standard view to fade in a real reference loop.";

let current = VIEWS[0];
let poses: Record<string, Pose> | null = null;
let presets: ProbePreset[] = [];
let scene: EchoScene | null = null;
let livePose: Pose | null = null;
let labelsOn = true;
let paintQueued = false;
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
  $("look").textContent = v.lookFor;
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
    ? `Figure 3. Reference echo: ${esc(view.name)}. ${credit}`
    : ECHO_NOTE_SIM;
}

function paintNow(pose: Pose) {
  paintLive($("ideal") as HTMLCanvasElement, $("stylized") as HTMLCanvasElement, pose, labelsOn);
  const blend = referenceBlend(pose, presets);
  const view = viewForPoseKey(blend.id);
  if (view && blend.amount > 0) showReal(view, blend.amount);
  else stopReal();
}

function queuePaint(pose: Pose) {
  livePose = pose;
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    if (livePose) paintNow(livePose);
  });
}

function select(id: string) {
  current = VIEWS.find((v) => v.id === id) ?? VIEWS[0];
  fillMeta(current);
  $("posenote").textContent = PROBE_NOTE;
  if (poses) {
    const pose = poses[current.pose];
    scene?.setPose(pose, true);
    queuePaint(pose);
  }
}

function onPoseChange(pose: Pose, poseKey: string | null) {
  queuePaint(pose);
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
$("labels").addEventListener("click", () => {
  labelsOn = !labelsOn;
  $("labels").setAttribute("aria-pressed", labelsOn ? "true" : "false");
  $("labels").textContent = labelsOn ? "Labels on" : "Labels off";
  if (livePose) queuePaint(livePose);
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
