import { clinicalTime } from "../physics/infarct";
import { MAX_SCORE, Point, TREAT, TreatScore, dayKey, dayNumber, keyOfDay, streaks } from "../game";
import { tree, $, T, G, inGame } from "./state";
import { PROC_LABEL, reperfused } from "./manage";

/** What the player did with a day's case, kept in this browser so the day is played once and can be looked at again. */
interface Played { total: number; distance: number; elapsed: number; call: Point | null; rv?: boolean | null; archive?: boolean; cls: string; result: string; why: string; treat?: TreatScore; treatWhy?: string }
const STORE = "corosim.daily";
export let history: Record<string, Played> = {};
try { history = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { history = {}; }
export const remember = (key: string, p: Played) => { history[key] = p; try { localStorage.setItem(STORE, JSON.stringify(history)); } catch { /* private window, blocked storage: the day just replays */ } };
const dayLabel = (key: string) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }); };
export const callUi = () => {
  $("qcall").textContent = G.call ? `${tree.byId[G.call.segId].name}, ${Math.round(G.call.pos * 100)}% along` : "none yet";
  $("rv_yes").classList.toggle("on", G.rv === true); $("rv_no").classList.toggle("on", G.rv === false);
  ($("qlock") as HTMLButtonElement).disabled = !G.call || G.rv === null;
};
/** Days played on their own day, as case numbers (archive plays do not keep a streak alive). */
export const liveDays = () => Object.entries(history).filter(([, p]) => !p.archive).map(([k]) => dayNumber(k));

export function gameUi() {
  $("quiz").dataset.phase = G.phase; document.body.dataset.game = G.phase;
  // idle: the front door over the blurred page; in a case: the panel in the rail
  $("qgate").hidden = !(inGame && G.phase === "idle"); $("quiz").hidden = !(inGame && G.phase !== "idle");
  document.body.classList.toggle("gated", inGame && G.phase === "idle");
  if (G.phase === "idle") {
    const today = dayKey(), key = G.target || today, n = dayNumber(key), archive = key !== today, p = history[key];
    $("qday").textContent = `${archive ? "Archive · " : ""}Case #${n} · ${dayLabel(key)}`;
    $("qdone").hidden = !p;
    if (p) $("qdone").textContent = `Played${archive ? "" : " today"}: ${p.total} of ${MAX_SCORE}.`;
    $("qstart").textContent = p ? "Look at this case again" : archive ? `Play case #${n}` : "Start today's case";
    // streak, and the last seven days as bars
    const s = streaks(liveDays(), dayNumber(today)), days = Object.keys(history).length, pts = Object.values(history).reduce((a, x) => a + x.total, 0);
    $("qstreak").textContent = days ? `Streak ${s.current} · best ${s.best} · ${days} day${days === 1 ? "" : "s"} played · ${pts} pts` : "No days played yet.";
    $("qstrip").innerHTML = Array.from({ length: 7 }, (_, i) => { const k = keyOfDay(n - 6 + i), q = history[k]; return `<i class="${q ? "on" : ""}${k === key ? " here" : ""}" style="height:${q ? Math.max(12, (100 * q.total) / MAX_SCORE) : 10}%" title="#${n - 6 + i}${q ? `: ${q.total}` : ""}"></i>`; }).join("");
    // the archive: the day before, the day after, and today
    const prev = $("qprev") as HTMLAnchorElement, next = $("qnext") as HTMLAnchorElement, tod = $("qtoday") as HTMLAnchorElement;
    prev.hidden = n <= 1; prev.href = `?day=${keyOfDay(n - 1)}`; prev.textContent = `← #${n - 1}`;
    next.hidden = !archive; next.href = `?day=${keyOfDay(n + 1)}`; next.textContent = `#${n + 1} →`;
    tod.hidden = !archive; tod.href = location.pathname;
    return;
  }
  $("qround").textContent = `Case #${dayNumber(G.day)}`;
  $("qclock").textContent = `${G.clock.toFixed(1)} s`;
  $("qscore").textContent = `${G.score} pts`;
  if (G.phase === "treat" && G.treat) {
    $("qclin").textContent = `${clinicalTime(G.treat.minutes)} of ${clinicalTime(TREAT.capMinutes)}`;
    $("qartery").textContent = T.pending ? `${PROC_LABEL[T.pending.kind]} in ${clinicalTime(Math.max(0, T.pending.remaining))}` : reperfused() ? `open (${G.treat.reperfusedBy})` : "closed";
    $("qartery").style.color = reperfused() ? "var(--ok)" : T.pending ? "var(--warn)" : "var(--bad)";
  }
}
