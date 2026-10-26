import { CIRC } from "../physics/circulation";
import { PROCEDURE } from "../config/management";
import { stepNecrosis, lvInfarctSize } from "../physics/infarct";
import { assess } from "../physics/advice";
import { MAX_SCORE, POINTS, TREAT, dailyCase, dayKey, dayNumber, explain, explainTreatment, fullFindings, judge, muscleSaved, rvInvolvement, score, streaks, treatScore } from "../game";
import { tree, sites, $, V, S, sim, sev, T, nec, clearTreatment, clearPending, on, G, PHYS_REST, ecg, rstate } from "./state";
import { paintMyocardium } from "./heart3d";
import { buildVessels, points, initParticles } from "./vessels3d";
import { reperfused, situation, setTab, resetManageSig } from "./manage";
import { history, remember, callUi, liveDays } from "./gameUi";
import { controlsUi, rhythmLabel, liveUi } from "./readouts";
import { rebuildAnatomy, syncSelects, setPhys } from "./model";
import { setProps } from "./controls";

const LESION_KEYS = ["lesionSeg", "pos", "ds", "occ", "exert", "mode", "flow", "speed", "rhythm", "bbb", "posterior"] as const;
const LOCKED = ["m_pressure", "m_velocity", "m_wss", "m_o2", "flowbtn", "propsbtn", "s1", "s3", "s6", "postbtn"]; // displays that would show the lesion, the clock, and the leads
/** A clean slate for a case: no ischemia carried over, pressure back at baseline. */
function resetPhysiology() {
  clearTreatment();
  sim.resetPhysiology();
}
/** Into the game: remember the simulator's state and lock the displays that would give the lesion away. */
function enterGame() {
  if (G.saved) return;
  setPhys(PHYS_REST); // every player gets the same patient: normal volume, no beta blocker
  G.saved = { V: { ...V }, S: Object.fromEntries(LESION_KEYS.map((k) => [k, S[k]])) };
  // pressure and velocity colouring and the flow particles would all show where the blood stops
  if (S.mode !== "real" && S.mode !== "anat") S.mode = "real";
  S.flow = false; points.visible = false; setProps(false); // the game hides the lesion; the defects stay out too
  S.speed = POINTS.speed; // one clock for every player
  S.posterior = true; // the back of the heart is in play
  for (const id of LOCKED) ($(id) as HTMLButtonElement).disabled = true;
  document.body.classList.add("game");
}
function loadCase(key: string) {
  const c = dailyCase(key);
  G.day = key; G.kase = c;
  Object.assign(V, c.variant); syncSelects();
  S.lesionSeg = c.lesion.segId; S.pos = c.lesion.pos; S.ds = c.lesion.ds; S.occ = !!c.lesion.occluded; S.exert = c.exert;
  S.rhythm = c.rhythm; S.bbb = c.bbb;
  clearPending();
}
function gameStart() {
  const key = G.target || dayKey();
  if (history[key]) return gameReview(key);
  enterGame(); loadCase(key);
  G.clock = 0; G.score = 0; G.phase = "play"; G.call = null; G.rv = null; G.treat = null;
  S.hide = S.hideIsch = true; S.selected = "";
  resetPhysiology(); rebuildAnatomy();
  $("pick").style.display = "none";
  callUi(); controlsUi(); liveUi();
}
/** A day already played: the case again, revealed, with the call and the result as they were. */
function gameReview(key: string) {
  const p = history[key];
  enterGame(); loadCase(key);
  G.clock = p.elapsed; G.score = p.total; G.phase = "reveal"; G.call = p.call; G.rv = p.rv ?? null; G.treat = null;
  S.hide = S.hideIsch = false; S.selected = G.kase!.lesion.segId;
  resetPhysiology(); rebuildAnatomy();
  const res = $("qresult"); res.className = "q-result " + p.cls; res.innerHTML = p.result;
  $("qwhy").textContent = p.why; $("qtreatwhy").textContent = p.treatWhy ?? "";
  $("pick").style.display = "none";
  controlsUi(); liveUi();
}
function gameAnswer(giveUp: boolean) {
  if (G.phase !== "play" || !G.kase) return;
  const truth = G.kase.lesion.segId, call = giveUp ? null : G.call;
  const rvT = rvInvolvement(G.kase), rv = !giveUp && G.rv !== null ? { answer: G.rv, truth: rvT.involved } : undefined;
  const sc = score(tree, call, { segId: truth, pos: G.kase.lesion.pos }, G.clock, rv);
  const verdict = call ? judge(tree, call.segId, truth) : "miss";
  G.score = sc.total; G.call = call;
  // show the lesion: the real lumen, the shaded vessels, the marker, the darkened muscle and the perfusion table
  S.hide = S.hideIsch = false; S.selected = truth;
  buildVessels(); initParticles(); paintMyocardium();
  const name = tree.byId[truth].name, chosen = call ? tree.byId[call.segId].name : "";
  const how = `${Math.round(sc.distance)} mm from the lesion along the tree, called at ${Math.round(G.clock)} s`;
  const rvLine = rv ? ` The right ventricle ${rvT.involved ? `was involved (${Math.round(rvT.fraction * 100)}% of it ischemic)` : `was spared (${Math.round(rvT.fraction * 100)}% ischemic)`}; you said ${rv.answer ? "yes" : "no"}.` : "";
  const pts = `location ${Math.round(sc.location)}${sc.floored ? " (territory floor)" : ""} × time ${sc.time.toFixed(2)}${rv ? ` ${sc.rv >= 0 ? "+" : "−"} ${Math.abs(sc.rv)} RV` : ""} = ${sc.total}`;
  const cls = sc.total >= 60 ? "vessel" : sc.total >= 20 ? "territory" : "miss";
  const result = !call ? `The culprit was the ${name}.${rvLine}`
    : verdict === "vessel" ? `On the ${name}, ${how}.${rvLine}`
    : verdict === "territory" ? `Right territory, wrong branch: you called the ${chosen}, ${how}.${rvLine}`
    : `Wrong territory: you called the ${chosen}, ${how}.${rvLine}`;
  // Now the patient: the infarct is judged against what immediate PCI, and no reperfusion at all, would leave from here.
  const lvAfter = (min: number) => lvInfarctSize(sites, Object.fromEntries(sites.map((x) => [x.key, stepNecrosis(nec[x.key] ?? 0, sev[x.key] ?? 0, min)])));
  G.treat = {
    minutes: 0, seconds: 0, stableS: 0, harmS: 0, harms: {}, steps: [],
    reperfusedBy: null, orderedAt: null, reperfusedAt: null, got: 0, best: lvAfter(PROCEDURE.pci.delayMin), worst: lvAfter(TREAT.capMinutes),
    found: { result, pts, cls, total: sc.total, distance: sc.distance },
  };
  G.phase = "treat";
  const res = $("qcallresult"); res.className = "q-result " + cls; res.innerHTML = `${result} <span class="pts">${pts} pts</span>`;
  setTab("support"); T.hint = false; resetManageSig();
  $("pick").style.display = "none";
  controlsUi(); liveUi();
}
/** Each frame of the treatment phase: the clock, the pressure held, the harm done, and whether the phase is over. */
export function treatStep(dt: number, minutes: number) {
  const R = G.treat;
  if (!R) return;
  R.minutes += minutes; R.seconds += dt;
  if (sim.map >= CIRC.shockMap) R.stableS += dt;
  const sit = situation();
  if (sit) {
    const a = assess(sit);
    if (!R.steps.length) R.steps = a.steps.map((x) => x.text); // what the guidelines would do, as the phase opens
    if (a.warnings.length) { R.harmS += dt; for (const w of a.warnings) R.harms[w.tag] = (R.harms[w.tag] ?? 0) + dt; }
  }
  if (R.reperfusedAt === null && reperfused()) R.reperfusedAt = R.minutes;
  if (R.minutes >= TREAT.capMinutes || (R.reperfusedAt !== null && R.minutes - R.reperfusedAt >= TREAT.settleMinutes)) gameTreatEnd();
}
/** The case is over: score the treatment, add it to the call, and show the whole debrief. */
function gameTreatEnd() {
  const R = G.treat;
  if (G.phase !== "treat" || !R || !G.kase) return;
  R.got = lvInfarctSize(sites, nec);
  for (const k of Object.keys(R.harms)) R.harms[k] /= Math.max(1e-9, R.seconds);
  const ts = treatScore(muscleSaved(R.got, R.best, R.worst), R.stableS / Math.max(1e-9, R.seconds), R.harmS / Math.max(1e-9, R.seconds));
  const total = R.found.total + ts.total;
  G.score = total; G.phase = "reveal";
  const findings = { ...fullFindings(G.kase), rhythm: rhythmLabel(ecg.rhythm(), rstate) };
  const pts = `<span class="pts">${R.found.pts} · treatment ${ts.total} (muscle ${ts.muscle}, pressure ${ts.hemo}) = ${total} pts</span>`;
  const result = `${R.found.result} ${pts}`;
  const cls = total >= MAX_SCORE * 0.55 ? "vessel" : total >= MAX_SCORE * 0.2 ? "territory" : "miss";
  const why = explain(tree, G.kase, findings), treatWhy = explainTreatment(R, ts);
  const res = $("qresult"); res.className = "q-result " + cls; res.innerHTML = result;
  $("qwhy").textContent = why; $("qtreatwhy").textContent = treatWhy;
  remember(G.day, { total, distance: R.found.distance, elapsed: G.clock, call: G.call, rv: G.rv, archive: G.day !== dayKey() || undefined, cls, result, why, treat: ts, treatWhy });
  controlsUi(); liveUi();
}
function gameQuit() {
  if (G.phase === "idle" || !G.saved) return;
  Object.assign(V, G.saved.V); Object.assign(S, G.saved.S); syncSelects();
  S.hide = S.hideIsch = false; S.selected = ""; G.phase = "idle"; G.kase = null; G.call = null; G.rv = null; G.treat = null; G.saved = null;
  for (const id of LOCKED) ($(id) as HTMLButtonElement).disabled = false;
  document.body.classList.remove("game");
  clearPending();
  resetPhysiology(); rebuildAnatomy(); points.visible = S.flow;
  $("pick").style.display = "none";
  controlsUi(); liveUi();
}

/** A spoiler-free line to paste anywhere: the case number, the score as a bar, how close and how soon. */
function shareText(): string {
  const p = history[G.day];
  if (!p) return "";
  const bar = "█".repeat(Math.round((10 * p.total) / MAX_SCORE)).padEnd(10, "░");
  const how = (p.call && Number.isFinite(p.distance) ? `${Math.round(p.distance)} mm from the lesion, called at ${Math.round(p.elapsed)} s` : p.call ? `called at ${Math.round(p.elapsed)} s` : "no call")
    + (p.treat ? ` · treatment ${p.treat.total}/${TREAT.muscle + TREAT.hemo}` : "");
  const s = streaks(liveDays(), dayNumber(dayKey()));
  const streak = !p.archive && s.current >= 2 ? `\n${s.current}-day streak` : "";
  const url = location.origin + location.pathname.replace(/index\.html$/, "").replace(/\/?$/, "/");
  return `CoroSim · Find the culprit #${dayNumber(G.day)}${p.archive ? " (archive)" : ""}\n${bar} ${p.total}/${MAX_SCORE}\n${how}${streak}\n${url}${p.archive ? `?day=${G.day}` : ""}`;
}
async function share() {
  const text = shareText(), btn = $("qshare") as HTMLButtonElement;
  if (!text) return;
  const done = (label: string) => { btn.textContent = label; btn.classList.add("done"); setTimeout(() => { btn.textContent = "Share your score"; btn.classList.remove("done"); }, 2500); };
  try {
    if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) { await navigator.share({ text }); return done("Shared"); }
    await navigator.clipboard.writeText(text);
    done("Copied to clipboard");
  } catch {
    // the share sheet was dismissed, or the clipboard is blocked: show the text so it can be copied by hand
    const w = window.prompt("Copy your score:", text.replaceAll("\n", " · "));
    void w;
  }
}
/** The Find the culprit buttons. */
export function wireGame() {
  on("qstart", gameStart);
  on("rv_yes", () => { G.rv = true; callUi(); }); on("rv_no", () => { G.rv = false; callUi(); });
  on("qlock", () => gameAnswer(false));
  on("qreveal", () => gameAnswer(true));
  on("qhand", gameTreatEnd);
  on("qquit", gameQuit);
  on("qshare", share);
}
