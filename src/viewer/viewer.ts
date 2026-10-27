import { App } from "@modelcontextprotocol/ext-apps";
import { Simulation } from "../sim/simulation";
import type { PatientSpec } from "../sim/patient";
import { assessHeart, valveSummary } from "../sim/valves";
import type { ValveFinding } from "../sim/structural";
import { encodeScenario } from "../sim/llm";
import { EcgStrip } from "../ecgStrip";
import { HeartScene } from "./heartScene";

/**
 * CoroSim inside the chat: when an AI builds, changes or treats a patient, the tool result carries the scenario,
 * and this view replays it in the same simulation core, so the 3D heart, the live 12-lead ECG and the monitor show
 * what the AI is describing. Runs as an MCP App (a sandboxed iframe in Claude or ChatGPT); opened on its own it
 * shows a demonstration patient.
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sim = new Simulation({ seed: 1 });
const scene = new HeartScene($("stage"), sim);
const ecg = new EcgStrip($<HTMLCanvasElement>("ecg"), sim.stream);
/** The tool's own numbers where the replay cannot know them (it cannot replay the user's shocks and drugs, so arrest and death come from here). */
interface Arrest { status: "none" | "arrest" | "rosc" | "dead"; rhythmClass: string; noFlowS: number; arrestS: number; injury: number; cpr: { on: boolean; rate?: number; depthCm?: number; quality?: number; output: number }; lastShock: { tS: number; joules: number; sync: boolean; success: boolean } | null; shocks: number; drugs: { drug: string; dose: number; tS: number }[] }
interface Reported { infarct?: number; problems?: string[]; steps?: string[]; narrative?: string; rhythm?: { label: string; library?: string; ventricularRate?: number }; arrest?: Arrest | null; dead?: boolean }
let reported: Reported = {};
let speed = 1, findings: ValveFinding[] = [], murmur = "";

function load(sc: PatientSpec, headline?: string, engine: "legacy" | "core" = "legacy") {
  sim.engine = engine; // takes effect at the reset: library rhythms, valves and arrest need the core engine
  sim.reset(sc, { settled: true });
  sim.warmup(20);
  if (reported.arrest?.cpr.on && !reported.dead) sim.startCpr({ rate: reported.arrest.cpr.rate, depthCm: reported.arrest.cpr.depthCm, quality: reported.arrest.cpr.quality }); // the replay can show compressions, not the earlier shocks and drugs
  try { const h = assessHeart(sc.heart ?? {}); findings = h.valves; murmur = h.murmur; } catch { findings = []; murmur = ""; }
  ecg.stream = sim.stream; ecg.reset(sim.t);
  scene.rebuild();
  if (headline) $("headline").textContent = headline;
  monitor();
}

const fmt = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "…" : x.toFixed(d));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const CLASS_NAME: Record<string, string> = { vf: "ventricular fibrillation", pulselessVt: "pulseless VT", asystole: "asystole", pea: "pulseless electrical activity", perfusing: "perfusing rhythm" };
const set = (id: string, text: string, cls = "") => { const e = $(id); e.textContent = text; e.className = cls; };

/** True when nothing is being pumped (the result's arrest block decides: the replay cannot know about shocks that failed or worked). */
function noPulse() {
  const a = reported.arrest;
  return reported.dead === true || (!!a && a.status === "arrest" && a.cpr.output < 0.05 && a.rhythmClass !== "perfusing");
}

function arrestPanel() {
  const a = reported.arrest, dead = reported.dead === true, show = !!a && (a.status !== "none" || a.shocks > 0);
  $("arrestbox").hidden = !show;
  const banner = $("banner"), deadEl = $("dead");
  deadEl.hidden = !dead;
  banner.hidden = !a || a.status === "none" || dead;
  if (dead) $("deadwhy").textContent = `No flow for ${fmt(a?.noFlowS)} s${a ? `, ${a.shocks} shock${a.shocks === 1 ? "" : "s"}` : ""}. Restart the patient to begin again.`;
  if (!a || !show) return;
  const cls = CLASS_NAME[a.rhythmClass] ?? a.rhythmClass;
  banner.className = `banner${a.status === "rosc" ? " rosc" : ""}`;
  banner.textContent = a.status === "rosc" ? "ROSC: pulse restored" : a.rhythmClass === "perfusing" ? `Shock converted the rhythm: waiting for a pulse · ${fmt(a.arrestS)} s${a.cpr.on ? " · CPR" : ""}` : `Cardiac arrest: ${cls} · ${fmt(a.arrestS)} s${a.cpr.on ? " · CPR" : ""}${a.shocks ? ` · ${a.shocks} shock${a.shocks === 1 ? "" : "s"}` : ""}`;
  const lines: [string, string, string?][] = [
    ["Status", dead ? "DEAD" : a.status === "rosc" ? "ROSC (return of spontaneous circulation)" : a.status === "arrest" ? "IN ARREST" : "none", dead || a.status === "arrest" ? "bad" : a.status === "rosc" ? "ok" : ""],
    ["Rhythm class", cls],
    ["Time in arrest", `${fmt(a.arrestS)} s`],
    ["No-flow time", `${fmt(a.noFlowS)} s`, a.noFlowS > 240 ? "bad" : a.noFlowS > 60 ? "warn" : ""],
    ["Irreversible injury", `${Math.round(a.injury * 100)}%`, a.injury > 0.5 ? "bad" : a.injury > 0.05 ? "warn" : ""],
    ["CPR", a.cpr.on ? `on${a.cpr.rate ? `, ${Math.round(a.cpr.rate)}/min` : ""}${a.cpr.depthCm ? `, ${a.cpr.depthCm.toFixed(1)} cm` : ""}, ${Math.round(a.cpr.output * 100)}% of normal output` : "off"],
    ["Shocks", a.shocks ? `${a.shocks}${a.lastShock ? `; last ${a.lastShock.joules} J ${a.lastShock.sync ? "synchronized" : "unsynchronized"}, ${a.lastShock.success ? "converted" : "no conversion"}` : ""}` : "none"],
    ["Drugs", a.drugs.length ? a.drugs.map((d) => `${d.drug} ${d.dose} mg`).join(", ") : "none"],
  ];
  $("arrestlist").innerHTML = lines.map(([k, v, c]) => `<div><span class="${c ?? ""}"><b>${esc(k)}:</b> ${esc(v)}</span></div>`).join("");
}

function valvePanel() {
  const present = findings.filter((v) => v.prosthesis || v.stenosis !== "none" || v.regurgitation !== "none");
  $("valverow").hidden = $("valvebox").hidden = present.length === 0;
  if (!present.length) return;
  $("valves").innerHTML = present.map((v) => {
    const bits: string[] = [];
    if (v.prosthesis) bits.push(`${v.prosthesis.kind} prosthesis`);
    if (v.stenosis !== "none") bits.push(`${v.stenosis} stenosis`);
    if (v.regurgitation !== "none") bits.push(`${v.regurgitation} regurgitation`);
    return `<div>${esc(v.label)}: ${esc(bits.join(", "))}<span class="chip ${v.grade}">${v.grade === "none" ? "ok" : v.grade}</span></div>`;
  }).join("");
  $("valvelist").innerHTML = [...valveSummary(present), murmur].map((l) => `<div>${esc(l)}</div>`).join("");
}

function monitor() {
  const st = sim.state(), e = sim.ecg(), roll = sim.rolling(10), lb = sim.history[sim.history.length - 1];
  const rh = reported.rhythm ?? st.rhythm, nopulse = noPulse(), cls = reported.arrest?.rhythmClass;
  set("rhythm", rh.label + (e.pvcsLast10s && !nopulse ? ", PVCs" : ""));
  const rate = rh.ventricularRate !== undefined ? rh.ventricularRate : roll.hr;
  if (reported.dead || cls === "asystole") set("hr", "0 bpm", "bad");
  else if (cls === "vf") set("hr", "chaotic, no organized rate", "bad");
  else set("hr", `${fmt(rate)} bpm`);
  if (nopulse) {
    set("bp", reported.dead ? "none (dead)" : "no pulse", "bad"); set("co", reported.dead ? "no flow" : "no flow (no output)", "bad");
  } else {
    const cpr = reported.arrest?.cpr;
    $("bp").textContent = lb ? `${Math.round(lb.sbp)}/${Math.round(lb.dbp)} (${Math.round(sim.map)})` : "…";
    $("bp").className = sim.map < 65 ? "bad" : sim.map < 75 ? "warn" : "";
    $("co").textContent = cpr?.on && reported.arrest?.status === "arrest" ? `CPR output ${Math.round(cpr.output * 100)}% of normal` : `${fmt(roll.cardiacOutput, 1)} L/min · SV ${fmt(roll.sv)} ml`;
    $("co").className = "";
  }
  $("stup").textContent = e.stElevation.join(", ") || "none"; $("stup").className = e.meetsStemiCriteria ? "bad" : "";
  $("stdown").textContent = e.stDepression.join(", ") || "none";
  $("isch").textContent = `${Math.round(st.ischemicMassFraction * 100)}% · ${e.ischemia}`;
  const inf = reported.infarct ?? st.ventricle.lvInfarctFraction;
  $("inf").textContent = inf > 0.005 ? `${Math.round(inf * 100)}%` : "none";
  const a = sim.assessment();
  const problems = reported.problems ?? a.issues.map((i) => i.text), steps = reported.steps ?? a.steps.map((s) => s.text);
  $("problems").innerHTML = problems.map((p) => `<div class="${/shock|occlusion|block|NSTE|left main|arrest|dead|fibrillation/i.test(p) ? "bad" : ""}">${esc(p)}</div>`).join("") || `<div class="ok">Stable</div>`;
  $("steps").innerHTML = steps.map((s, i) => `<div>${i + 1}. ${esc(s)}</div>`).join("") || "<div>Nothing to do</div>";
  const nar = $("narrative"); nar.hidden = !reported.narrative; nar.textContent = reported.narrative ?? "";
  arrestPanel(); valvePanel();
}

// ---- the animation: heartbeats, ECG sweep, muscle colour
let last = performance.now(), paintClock = 0, uiClock = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!reported.dead) sim.step(dt * speed, { minutes: 0 }); // a dead patient stops: the replay freezes like the simulation does (the infarct clock belongs to the AI's patient, not to this replay)
  const fx = sim.ecgInputs();
  ecg.step(dt * speed, fx.injury, fx.tBoost, sim.rstate.rhythm); // with the simulation frozen no new beats arrive: the strip runs on as a flat line
  ecg.draw();
  if ((paintClock += dt) > 0.2) { paintClock = 0; scene.paint(); }
  if ((uiClock += dt) > 0.5) { uiClock = 0; monitor(); }
  scene.render();
  requestAnimationFrame(frame);
}

const setView = (v: string) => { scene.view(v); for (const x of document.querySelectorAll<HTMLButtonElement>(".views button")) x.classList.toggle("on", x.dataset.view === v); };
for (const b of document.querySelectorAll<HTMLButtonElement>(".views button")) b.addEventListener("click", () => setView(b.dataset.view!));

/** corosim_show.display (the spec registry's displaySchema): what this view can draw. Coloring maps it cannot compute (pressure, velocity, wall shear, O2) and flow animation stay on the website page. */
export interface Display { view?: string; mode?: string; heart?: string; labels?: boolean; flow?: boolean; valves?: boolean; posteriorLeads?: boolean; coronaryScale?: number; autoRotate?: boolean; timeScale?: number }
function applyDisplay(d: Display) {
  const notes: string[] = [];
  if (d.view) setView(d.view);
  if (d.mode !== undefined && !scene.setMode(d.mode)) notes.push(`${d.mode} map: shown on the website page; arteries drawn anatomically`);
  if (d.coronaryScale !== undefined) scene.setCoronaryScale(Math.min(5, Math.max(1, d.coronaryScale)));
  if (d.heart !== undefined || d.valves !== undefined) {
    scene.setHeartStyle(d.heart ?? "solid");
    if (d.valves && (d.heart ?? "solid") === "solid") scene.setOpacity(0.45); // "makes a solid heart translucent"
  }
  if (d.labels !== undefined) scene.setLabels(d.labels, $("lbls"));
  if (d.posteriorLeads !== undefined) ecg.posterior = d.posteriorLeads;
  if (d.autoRotate !== undefined) scene.setAutoRotate(d.autoRotate);
  if (d.timeScale !== undefined) speed = d.timeScale;
  if (d.flow) notes.push("flow animation: shown on the website page");
  $("mapnote").hidden = !notes.length; $("mapnote").textContent = notes.join(" · ");
  const key = d.mode === "anat" || d.mode === "isch";
  $("legend").hidden = key; $("mapkey").hidden = !key;
  if (key) $("mapkey").innerHTML = d.mode === "anat" ? `<i style="background:#e0574c"></i>LAD<i style="background:#4c8be0"></i>LCx<i style="background:#e0b23c"></i>RCA` : `<i style="background:#3fa66b"></i>normal<i style="background:#e6c34a"></i>mild<i style="background:#e0392f"></i>ischemic<i style="background:#7d1d6b"></i>severe`;
}

// ---- in a chat: receive the AI's tool results
interface Structured {
  display?: Display; scenario?: PatientSpec; applied?: PatientSpec; patient?: PatientSpec; engine?: "legacy" | "core"; narrative?: string; arrest?: Arrest | null; dead?: boolean;
  state?: { ventricle?: { lvInfarctFraction?: number }; rhythm?: Reported["rhythm"]; arrest?: Arrest; dead?: boolean };
  assessment?: { problems?: string[]; guidelineNextSteps?: { step: string }[] }; explanation?: { headline?: string }; outcome?: { result?: string };
}
function receive(s: Structured) {
  const sc = s.patient ?? s.scenario ?? s.applied;
  if (!sc) return;
  const arrest = s.arrest ?? s.state?.arrest ?? null, dead = s.dead ?? s.state?.dead === true;
  reported = { infarct: s.state?.ventricle?.lvInfarctFraction, problems: s.assessment?.problems, steps: s.assessment?.guidelineNextSteps?.map((x) => x.step), narrative: s.narrative, rhythm: s.state?.rhythm, arrest, dead };
  // a dead patient's strip is a flat line: replay asystole (the rhythm row still names the rhythm they died in)
  load(dead ? { ...sc, patient: { ...sc.patient, rhythm: "asystole" } } : sc, s.outcome?.result ?? s.explanation?.headline ?? "Your CoroSim patient", s.engine === "core" || arrest ? "core" : "legacy");
  if (s.display) applyDisplay(s.display);
}
const embedded = window.parent !== window;
let app: App | null = null;
const appUrl = () => `https://corosim.com/sim/#s=${encodeScenario(sim.scenario())}`;

if (embedded) {
  app = new App({ name: "CoroSim viewer", version: "0.6.0" }, {}, { autoResize: true });
  app.ontoolresult = (r) => receive((r.structuredContent ?? {}) as Structured);
  const applyContext = () => {
    const ctx = app!.getHostContext();
    document.documentElement.dataset.theme = ctx?.theme === "light" ? "light" : "dark";
    const full = ctx?.displayMode === "fullscreen";
    $("root").classList.toggle("full", full);
    $("full").hidden = !ctx?.availableDisplayModes?.includes("fullscreen");
    $("full").textContent = full ? "Exit fullscreen" : "Fullscreen";
  };
  app.onhostcontextchanged = applyContext;
  $("full").addEventListener("click", () => {
    const full = app!.getHostContext()?.displayMode === "fullscreen";
    void app!.requestDisplayMode({ mode: full ? "inline" : "fullscreen" });
  });
  $("open").addEventListener("click", () => { void app!.openLink({ url: appUrl() }); });
  void app.connect().then(applyContext);
} else {
  $("open").addEventListener("click", () => { window.open(appUrl(), "_blank"); });
  load({ lesions: [{ artery: "LAD", occluded: true, position: 0.25 }] }, "Demonstration: proximal LAD occlusion");
}

scene.rebuild();
requestAnimationFrame(frame);
(window as unknown as { corosimViewer: object }).corosimViewer = { sim, load, receive };
