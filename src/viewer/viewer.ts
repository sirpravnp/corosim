import { App } from "@modelcontextprotocol/ext-apps";
import { Simulation } from "../sim/simulation";
import { Scenario } from "../sim/scenario";
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
let reported: { infarct?: number; problems?: string[]; steps?: string[] } = {}; // the tool's own numbers where the replay cannot know them

function load(sc: Scenario, headline?: string) {
  sim.reset(sc, { settled: true });
  sim.warmup(20);
  ecg.stream = sim.stream; ecg.reset(sim.t);
  scene.rebuild();
  if (headline) $("headline").textContent = headline;
  monitor();
}

const fmt = (x: number | null | undefined, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? "…" : x.toFixed(d));
function monitor() {
  const st = sim.state(), e = sim.ecg(), roll = sim.rolling(10), lb = sim.history[sim.history.length - 1];
  $("rhythm").textContent = st.rhythm.label + (e.pvcsLast10s ? ", PVCs" : "");
  $("hr").textContent = `${fmt(roll.hr)} bpm`;
  $("bp").textContent = lb ? `${Math.round(lb.sbp)}/${Math.round(lb.dbp)} (${Math.round(sim.map)})` : "…";
  $("bp").className = sim.map < 65 ? "bad" : sim.map < 75 ? "warn" : "";
  $("co").textContent = `${fmt(roll.cardiacOutput, 1)} L/min · SV ${fmt(roll.sv)} ml`;
  $("stup").textContent = e.stElevation.join(", ") || "none"; $("stup").className = e.meetsStemiCriteria ? "bad" : "";
  $("stdown").textContent = e.stDepression.join(", ") || "none";
  $("isch").textContent = `${Math.round(st.ischemicMassFraction * 100)}% · ${e.ischemia}`;
  const inf = reported.infarct ?? st.ventricle.lvInfarctFraction;
  $("inf").textContent = inf > 0.005 ? `${Math.round(inf * 100)}%` : "none";
  const a = sim.assessment();
  const problems = reported.problems ?? a.issues.map((i) => i.text), steps = reported.steps ?? a.steps.map((s) => s.text);
  $("problems").innerHTML = problems.map((p) => `<div class="${/shock|occlusion|block|NSTE|left main/i.test(p) ? "bad" : ""}">${esc(p)}</div>`).join("") || `<div class="ok">Stable</div>`;
  $("steps").innerHTML = steps.map((s, i) => `<div>${i + 1}. ${esc(s)}</div>`).join("") || "<div>Nothing to do</div>";
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// ---- the animation: heartbeats, ECG sweep, muscle colour
let last = performance.now(), paintClock = 0, uiClock = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  sim.step(dt, { minutes: 0 }); // the infarct clock belongs to the AI's patient, not to this replay
  const fx = sim.ecgInputs();
  ecg.step(dt, fx.injury, fx.tBoost, sim.rstate.rhythm);
  ecg.draw();
  if ((paintClock += dt) > 0.2) { paintClock = 0; scene.paint(); }
  if ((uiClock += dt) > 0.5) { uiClock = 0; monitor(); }
  scene.render();
  requestAnimationFrame(frame);
}

for (const b of document.querySelectorAll<HTMLButtonElement>(".views button")) {
  b.addEventListener("click", () => { scene.view(b.dataset.view!); for (const x of document.querySelectorAll(".views button")) x.classList.toggle("on", x === b); });
}

// ---- in a chat: receive the AI's tool results
interface Structured { scenario?: Scenario; applied?: Scenario; state?: { ventricle?: { lvInfarctFraction?: number } }; assessment?: { problems?: string[]; guidelineNextSteps?: { step: string }[] }; explanation?: { headline?: string }; outcome?: { result?: string } }
const embedded = window.parent !== window;
let app: App | null = null;
const appUrl = () => `https://corosim.com/#s=${encodeScenario(sim.scenario())}`;

if (embedded) {
  app = new App({ name: "CoroSim viewer", version: "0.5.0" }, {}, { autoResize: true });
  app.ontoolresult = (r) => {
    const s = (r.structuredContent ?? {}) as Structured;
    const sc = s.scenario ?? s.applied;
    if (!sc) return;
    reported = { infarct: s.state?.ventricle?.lvInfarctFraction, problems: s.assessment?.problems, steps: s.assessment?.guidelineNextSteps?.map((x) => x.step) };
    load(sc, s.outcome?.result ?? s.explanation?.headline ?? "Your CoroSim patient");
  };
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
(window as unknown as { corosimViewer: object }).corosimViewer = { sim, load };
