import "../cath/cath.css";
import "./echo.css";
import { buildPoses, Pose } from "./poses";
import { EchoScene } from "./scene";
import { playClean } from "./cleanVideo";
import { mountShell } from "../shell/shell";
import { VIEWS, ViewDef, imageFor, Window } from "./views";

/**
 * The echo atlas: pick a standard transthoracic view and see where the probe goes on the simulator's 3D heart, beside a clean open-licensed echo
 * image of that view where we have one.
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

let current = VIEWS[0];
let poses: Record<string, Pose> | null = null;
let scene: EchoScene | null = null;

const PROBE_NOTE = "Probe and imaging plane on the simulator's 3D heart, seen square onto the plane with the probe at the top as on the echo screen. Drag to turn it. The red dot on the probe is the index mark.";

function renderList() {
  const groups: Window[] = ["Parasternal", "Subcostal"];
  $("list").innerHTML = groups.map((g) => `<h3>${g}</h3>` + VIEWS.filter((v) => v.window === g).map((v) =>
    `<a href="#${v.id}" data-id="${v.id}" role="button">${esc(v.short)}<small>${esc(v.name)}</small></a>`).join("")).join("");
}

function renderRef(v: ViewDef) {
  const im = imageFor(v.id);
  const fill = (id: string) => {
    const pane = $(id);
    if (!im) return;
    const credit = `${esc(im.note)}<br>${esc(im.author)} · <a href="${im.licenseUrl}" rel="noopener">${esc(im.license)}</a> · <a href="${im.source}" rel="noopener">source</a>`;
    if (im.kind === "video" && im.clean) {
      pane.innerHTML = `<div class="echo-img"><canvas class="echo-clean" role="img" aria-label="${esc(im.alt)}"></canvas></div><figcaption>${credit}</figcaption>`;
      playClean(pane.querySelector("canvas")!, asset(im.file), im.clean);
      return;
    }
    const media = im.kind === "video"
      ? `<video src="${asset(im.file)}" width="${im.width}" height="${im.height}" autoplay loop muted playsinline controls aria-label="${esc(im.alt)}"></video>`
      : `<img src="${asset(im.file)}" width="${im.width}" height="${im.height}" alt="${esc(im.alt)}">`;
    pane.innerHTML = `<div class="echo-img">${media}</div><figcaption>${credit}</figcaption>`;
  };
  fill("refpane");
}

function select(id: string) {
  current = VIEWS.find((v) => v.id === id) ?? VIEWS[0];
  const v = current;
  document.querySelectorAll<HTMLElement>("#list a").forEach((a) => a.classList.toggle("on", a.dataset.id === v.id));
  $("title").textContent = v.name;
  $("summary").textContent = v.lookFor;
  $("placement").textContent = v.placement;
  $("marker").textContent = v.marker;
  $("shows").innerHTML = v.shows.map((s) => `<li>${esc(s)}</li>`).join("");
  $("look").textContent = v.lookFor;
  renderRef(v);
  if (poses) {
    scene?.setPose(poses[v.pose]);
    $("posenote").textContent = PROBE_NOTE;
  }
  if (location.hash.slice(1) !== v.id) history.replaceState(null, "", `#${v.id}`);
}

$("list").addEventListener("click", (e) => { const a = (e.target as HTMLElement).closest<HTMLElement>("a[data-id]"); if (a) { e.preventDefault(); select(a.dataset.id!); } });
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const t = e.target as HTMLElement; if (t.closest("input,select,textarea")) return;
  e.preventDefault();
  const i = VIEWS.indexOf(current) + (e.key === "ArrowDown" ? 1 : -1);
  select(VIEWS[(i + VIEWS.length) % VIEWS.length].id);
});

renderList();
mountShell({ page: "echo", root: "../" }).ai.start();
select(location.hash.slice(1) || VIEWS[0].id);

try {
  poses = buildPoses();
  scene = new EchoScene($("scene"));
  $("loading").remove();
  select(current.id);
} catch (err) {
  $("loading").textContent = "The 3D heart could not be drawn in this browser.";
  console.error(err);
}
window.addEventListener("hashchange", () => select(location.hash.slice(1)));
