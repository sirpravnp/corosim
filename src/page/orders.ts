// ---------------------------------------------------------------- cases: the Order menu, the pending list and the safe time skip
// The book (src/cases/orderBook.ts) holds what was ordered; this module draws it in the case panel and carries out a skip. A skip raises
// the page clock for as long as the rules in src/cases/skip.ts allow: it stops on a result, a stop reason, or the cap, never past them.
import { CATALOG, itemById, resolveMonitor } from "../cases/orders";
import { OrderBook, noteReturned } from "../cases/orderBook";
import { canSkip, skipStop, SKIP_CAP_S, SKIP_SPEED } from "../cases/skip";
import type { CaseRunner, Probe, Tick } from "../cases/engine";
import { $, K, S, on } from "./state";
import { setCaseMonitor } from "./workspace";
import { patientNow, probe, casesUi } from "./cases";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const clock = (s: number) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const GROUPS: { id: "monitor" | "panel" | "lab" | "bedside"; title: string }[] = [
  { id: "monitor", title: "Monitor readings" }, { id: "panel", title: "Panels and studies" }, { id: "lab", title: "Labs" }, { id: "bedside", title: "At the bedside" },
];
/** The slowest a single frame can be (src/page/loop.ts caps real time at this), used to land a skip on the moment it is wanted. */
const FRAME_S = 0.05;

/** The orders of the case running now. */
export const orders = { book: new OrderBook() };
let shown: string[] = [];      // what the monitor shows now (ids of the catalog)
let menuOpen = false;
let note = "";                 // why a skip was refused or stopped: one line beside the control
const skip: { on: boolean; target: string | null; start: number; prev: Probe | null; saved: number } = { on: false, target: null, start: 0, prev: null, saved: 1 };

/** A case begins: an empty book and the monitor the case names. */
export function ordersBegin(def: { monitor?: string[] }) {
  orders.book = new OrderBook(); shown = resolveMonitor(def); menuOpen = false; note = ""; stopSkip("");
  setCaseMonitor(shown);
}
/** The case is left: the viewer's own layout comes back. */
export function ordersEnd() { stopSkip(""); orders.book = new OrderBook(); shown = []; menuOpen = false; note = ""; setCaseMonitor(null); }

/** The case is over: a running skip ends and the clock goes back to its own speed. */
export function ordersStop() { stopSkip(""); }

function stopSkip(msg: string) {
  if (skip.on) S.speed = skip.saved;
  skip.on = false; skip.target = null; skip.prev = null;
  note = msg;
}

/** The probe fields the order system adds. */
export function orderProbe(): Pick<Probe, "ordered" | "pending" | "waiting"> {
  const pending = orders.book.pending.map((p) => p.id);
  return { ordered: orders.book.ordered(), pending, waiting: pending.length > 0 };
}

/** Before the clock advances: while a skip runs, the page's time scale is raised, lowered near the end so a frame never carries past the moment wanted. */
export function skipFrame() {
  if (!skip.on) return;
  const r = K.runner;
  if (!r) { stopSkip(""); return; }
  const readyAt = skip.target ? orders.book.pending.find((p) => p.id === skip.target)?.readyAt : undefined;
  const left = readyAt !== undefined ? readyAt - r.t : SKIP_CAP_S - (r.t - skip.start);
  S.speed = Math.max(1, Math.min(SKIP_SPEED, left / FRAME_S));
}

function startSkip(target: string | null) {
  const r = K.runner;
  if (!r || K.phase !== "run" || skip.on) return;
  if (r.open) { note = "Answer the checkpoint first."; ordersUi(); return; }
  const p = probe(), ok = canSkip(p, (q) => r.isStable(q));
  if (!ok.ok) { note = ok.why; ordersUi(); return; }
  if (skip.target === null && target && !orders.book.pending.some((x) => x.id === target)) return;
  note = ""; skip.on = true; skip.target = target; skip.start = r.t; skip.prev = p; skip.saved = S.speed;
  ordersUi();
}

function show(id: string) {
  if (shown.includes(id)) return;
  shown = [...shown, id]; setCaseMonitor(shown);
}

/** After each tick of the runner: bring back what is due, put each result in the log, and decide whether a running skip goes on. */
export function ordersStep(r: CaseRunner, p: Probe, _tick: Tick) {
  const now = patientNow();
  const back = orders.book.tick(r.t, now);
  if (back.length) {
    const plain = back.filter((b) => { const g = itemById(b.id)?.group; return g !== "monitor" && g !== "panel"; });
    noteReturned(r, plain);
    for (const b of back) { const it = itemById(b.id); if (it && (it.group === "monitor" || it.group === "panel")) { show(b.id); r.note(it.group === "monitor" ? `${it.label}: now on the monitor.` : `${it.label}: ready.`); } }
    casesUi();
  }
  if (!skip.on) return;
  const label = (id: string) => itemById(id)?.label ?? id;
  const hit = skip.target ? back.find((b) => b.id === skip.target) : back[0];
  let why: string | null = null;
  if (hit) why = `Stopped: ${label(hit.id)} result is back.`;
  else if (K.phase !== "run" || r.over) why = "";
  else if (skip.prev && (why = skipStop(skip.prev, p, { promptOpen: r.open !== null, harmActive: r.harmActive(p), spo2: now.spo2 })) === null) {
    if (!r.isStable(p)) why = "Stopped: the patient is unstable.";
    else if (skip.target && !orders.book.pending.some((x) => x.id === skip.target)) why = "";
    else if (!skip.target && r.t - skip.start >= SKIP_CAP_S) why = `Skipped ${clock(SKIP_CAP_S)}.`;
  }
  skip.prev = p;
  if (why !== null) stopSkip(why);
}

// ---- the page
let menuSig = "", pendSig = "";
/** Keep the Order menu, the pending list and the skip line in step with the book. Cheap: the frame loop reaches it through casesUi. */
export function ordersUi() {
  const r = K.runner, live = !!r && K.phase === "run";
  $("c_orders").hidden = !live;
  if (!live || !r) return;
  const pend = orders.book.pending;
  $("o_menu").setAttribute("aria-expanded", String(menuOpen));
  $("o_list").hidden = !menuOpen;
  const msig = `${menuOpen}|${shown.join()}|${pend.map((p) => p.id).join()}`;
  if (msig !== menuSig) {
    menuSig = msig;
    const pending = new Set(pend.map((p) => p.id));
    $("o_list").innerHTML = GROUPS.map((g) => `<div class="o-group"><h4>${g.title}</h4>${CATALOG.filter((i) => i.group === g.id).map((i) => {
      const onMon = shown.includes(i.id), isPend = pending.has(i.id);
      const tag = onMon ? "on monitor" : isPend ? "pending" : i.delayS >= 1 ? `back in ${clock(i.delayS)}` : "";
      return `<button class="o-item" data-o="${i.id}"${onMon || isPend ? " disabled" : ""}><span>${esc(i.label)}</span><em>${tag}</em></button>`;
    }).join("")}</div>`).join("");
  }
  const psig = pend.map((p) => p.id).join();
  if (psig !== pendSig) {
    pendSig = psig;
    $("o_pending").innerHTML = pend.map((p) => `<li><span class="o-eta" data-eta="${p.id}"></span>${esc(itemById(p.id)?.label ?? p.id)}<button class="o-skipto" data-skipto="${p.id}">Skip to result</button></li>`).join("");
  }
  for (const p of pend) { const e = document.querySelector<HTMLElement>(`[data-eta="${p.id}"]`); if (e) e.textContent = clock(p.readyAt - r.t); }
  $("o_pendhead").hidden = pend.length === 0;
  ($("o_skip") as HTMLButtonElement).disabled = skip.on;
  $("o_skip").textContent = skip.on ? "Skipping" : "Skip ahead";
  $("o_note").textContent = note;
}

/** The menu, the item buttons and the skip controls. */
export function wireOrders() {
  on("o_menu", () => { menuOpen = !menuOpen; menuSig = ""; ordersUi(); });
  $("o_list").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-o]");
    const r = K.runner;
    if (!b || !r || K.phase !== "run") return;
    orders.book.order(b.dataset.o!, r.t);
    menuOpen = false; menuSig = ""; ordersUi();
  });
  $("o_pending").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-skipto]");
    if (b) startSkip(b.dataset.skipto!);
  });
  on("o_skip", () => startSkip(null));
}
