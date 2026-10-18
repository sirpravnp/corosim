import "./ekg.css";
import { App } from "@modelcontextprotocol/ext-apps";
import { ALL_LEADS, LEADS, LeadName } from "../config/ecg";
import { Simulation } from "../sim/simulation";
import { HeartScene } from "../viewer/heartScene";
import { EkgEngine, EkgSpec, Measurements, measure } from "./engine";
import { CATEGORIES, EkgPreset, PRESETS, PRESET_BY_ID, findPreset, resolveSpec } from "./presets";
import { Paper } from "./paper";
import { LeadAxes, LeadSet } from "./leadScene";

/**
 * The EKG page: pick a rhythm, watch the 12-lead write itself, and see in 3D why each lead looks the way it does.
 * Also runs inside Claude as an MCP App (the corosim_ekg_show tool), where the AI picks the tracing.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const embedded = window.parent !== window;
if (embedded) document.body.classList.add("embedded");

const sim = new Simulation({ seed: 1 });
const scene = new HeartScene($("stage"), sim);
scene.view("anterior", 1.12);
scene.setOpacity(0.55); // the lead axes and the heart vector run through the middle of the heart
const axes = new LeadAxes();
scene.addOverlay(axes.root);
const paper = new Paper($<HTMLCanvasElement>("paper"));

// What each lead looks at: where its positive pole is and which wall it faces.
const LEAD_INFO: Record<LeadName, string> = {
  I: "right arm → left arm, 0° in the frontal plane: the high lateral wall",
  II: "right arm → left leg, +60°: the inferior wall; the best lead for P waves and rhythm",
  III: "left arm → left leg, +120°: the inferior wall, right-sided",
  aVR: "toward the right shoulder, −150°: looks into the cavity, so it is upside-down from II",
  aVL: "toward the left shoulder, −30°: the high lateral wall",
  aVF: "toward the feet, +90°: the inferior wall",
  V1: "4th intercostal space, right sternal edge: the septum and right ventricle",
  V2: "4th intercostal space, left sternal edge: the septum and anterior wall",
  V3: "between V2 and V4: the anterior wall",
  V4: "5th intercostal space, mid-clavicular line: the anterior wall and apex",
  V5: "anterior axillary line: the lateral wall",
  V6: "mid-axillary line: the lateral wall",
  V7: "posterior axillary line: the posterior wall",
  V8: "tip of the scapula: the posterior wall",
  V9: "left paraspinal: the posterior wall",
};

let preset: EkgPreset = PRESETS[0];
let spec: EkgSpec = preset.spec;
let engine = new EkgEngine(spec);
let meas: Measurements = measure(spec);
let rate: number | null = null; // the learner's rate override
let t = 0, paused = false, artifact = false;
let selected: LeadName = "II";

// ---------------------------------------------------------------- quiz
const quiz = { on: false, answered: false, right: 0, total: 0, streak: 0 };
const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage blocked: score for this visit only */ } },
};
try { Object.assign(quiz, JSON.parse(store.get("corosim.ekgQuiz") ?? "{}"), { on: false, answered: false }); } catch { /* fresh */ }

// ---------------------------------------------------------------- library
function renderList(filter = "") {
  const q = filter.trim().toLowerCase(), list = $("list");
  list.innerHTML = "";
  let any = false;
  for (const cat of CATEGORIES) {
    const items = PRESETS.filter((p) => p.category === cat && (!q || `${p.name} ${p.id} ${p.category} ${p.summary}`.toLowerCase().includes(q)));
    if (!items.length) continue;
    any = true;
    const h = document.createElement("h3"); h.textContent = cat; list.append(h);
    for (const p of items) {
      const a = document.createElement("a");
      a.href = `#p=${p.id}`; a.textContent = p.name; a.dataset.id = p.id;
      if (p.id === preset.id && !quiz.on) a.classList.add("on");
      a.addEventListener("click", (e) => { e.preventDefault(); stopQuiz(); load(p); });
      list.append(a);
    }
  }
  if (!any) list.innerHTML = `<div class="empty">No preset matches “${esc(filter)}”.</div>`;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const pick = $<HTMLSelectElement>("pick");
pick.innerHTML = CATEGORIES.map((c) => `<optgroup label="${esc(c)}">${PRESETS.filter((p) => p.category === c).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</optgroup>`).join("");
pick.addEventListener("change", () => { stopQuiz(); load(PRESET_BY_ID[pick.value]); });
if (embedded) $("pickwrap").hidden = false;

// ---------------------------------------------------------------- load a preset
const hasRate = (s: EkgSpec) => "rate" in s.rhythm && s.rhythm.kind !== "torsades";
function engineSpec(): EkgSpec {
  if (rate === null || !hasRate(spec)) return spec;
  return { ...spec, rhythm: { ...spec.rhythm, rate } as EkgSpec["rhythm"] };
}

function rebuildEngine(prefill = true) {
  const s = engineSpec();
  engine = new EkgEngine(s, 1);
  meas = measure(s);
  paper.clear(); axes.clearTrail();
  t = 0;
  // Print a full 10 s straight away; the sweep then overwrites it live.
  if (prefill) for (let i = 0; i < paper.fs * 10; i++) step1();
}

function load(p: EkgPreset, opts: { quiz?: boolean } = {}) {
  preset = p; rate = null;
  if (p.coronary) spec = resolveSpec(p, sim);
  else { sim.reset({}, { settled: true }); spec = p.spec; }
  scene.rebuild();
  rebuildEngine();
  const r = $<HTMLInputElement>("rate");
  $("rateWrap").hidden = !hasRate(spec);
  if (hasRate(spec)) { r.value = String((spec.rhythm as { rate: number }).rate); $("rateVal").textContent = `${r.value} bpm`; }
  if (p.leads?.length) select(p.leads[0]); else select(selected);
  pick.value = p.id;
  if (!opts.quiz && !embedded) history.replaceState(null, "", `#p=${p.id}`);
  render();
}

// ---------------------------------------------------------------- reading
const fmt = (x: number | null | undefined, unit = "") => (x === null || x === undefined ? "—" : `${x}${unit}`);
function axisWord(a: number | null) {
  if (a === null) return "";
  return a < -90 || a > 180 ? "extreme" : a < -30 ? "left" : a > 90 ? "right" : "normal";
}
function render() {
  const hidden = quiz.on && !quiz.answered;
  $("cat").textContent = hidden ? "Quiz" : preset.category;
  $("title").textContent = hidden ? "Unknown tracing" : preset.name;
  $("summary").textContent = hidden ? "Read it the usual way (rate, rhythm, axis, intervals, morphology), then choose." : preset.summary;
  $("read").hidden = hidden; $("hiddenRead").hidden = !hidden;
  const m = meas;
  const rr = m.regular === null ? "" : m.regular ? "regular" : "irregular";
  const pr = m.prPattern === "constant" ? fmt(m.prMs, " ms") : m.prPattern === "none" ? "no P waves" : m.prPattern;
  const cells: [string, string, string?][] = [
    ["Ventricular rate", m.ventricularRate === 0 ? "none" : `${fmt(m.ventricularRate)} bpm ${rr}`, m.ventricularRate !== null && (m.ventricularRate > 150 || (m.ventricularRate < 45)) ? "bad" : ""],
    ["Atrial rate", m.atrialRate ? `${m.atrialRate} /min` : "—"],
    ["PR", pr, m.prMs !== null && (m.prMs > 200 || m.prMs < 120) ? "warn" : ""],
    ["QRS", fmt(m.qrsMs, " ms"), m.qrsMs !== null && m.qrsMs >= 120 ? "warn" : ""],
    ["QTc (Bazett)", fmt(m.qtcMs, " ms"), m.qtcMs !== null && m.qtcMs > 480 ? "bad" : m.qtcMs !== null && m.qtcMs > 460 ? "warn" : ""],
    ["Axis", m.axisDeg === null ? "—" : `${m.axisDeg}° ${axisWord(m.axisDeg)}`],
    ["STEMI criteria", m.stMm ? (m.meetsStemiCriteria ? "met" : "not met") : "—", m.meetsStemiCriteria ? "bad" : ""],
  ];
  $("meas").innerHTML = cells.map(([k, v, c]) => `<div><b>${k}</b><span class="${c ?? ""}">${esc(v)}</span></div>`).join("");
  const leads = paper.posterior ? ALL_LEADS : LEADS;
  const st = $("stmap"); st.classList.toggle("wide", paper.posterior);
  st.innerHTML = m.stMm ? leads.map((l) => { const v = m.stMm![l]; return `<div data-lead="${l}" class="${l === selected ? "sel" : ""}" title="ST at J+60 ms"><b>${l}</b><span class="${v >= 1 || (v >= 0.5 && /V[789]/.test(l)) ? "up" : v <= -1 ? "down" : ""}">${v > 0 ? "+" : ""}${v.toFixed(1)}</span></div>`; }).join("") : "";
  st.hidden = !m.stMm;
  const li = (xs: string[] | undefined) => (xs ?? []).map((x) => `<li>${esc(x)}</li>`).join("");
  $("features").innerHTML = li(preset.features);
  $("pearls").innerHTML = li(preset.pearls);
  $("mimics").innerHTML = li(preset.mimics); $("mimicsBox").hidden = !preset.mimics?.length;
  $("next").hidden = !preset.next; $("next").textContent = preset.next ? `Next: ${preset.next}` : "";
  for (const a of document.querySelectorAll<HTMLAnchorElement>("#list a")) a.classList.toggle("on", a.dataset.id === preset.id && !hidden);
  askLink();
}
$("stmap").addEventListener("click", (e) => { const d = (e.target as HTMLElement).closest<HTMLElement>("[data-lead]"); if (d) select(d.dataset.lead as LeadName); });

function select(lead: LeadName) {
  if (!paper.posterior && /V[789]/.test(lead)) { paper.posterior = true; axes.posterior = true; $<HTMLInputElement>("posterior").checked = true; }
  selected = lead; paper.selected = lead; axes.select(lead);
  paper.rhythmLead = lead; // the long strip at the bottom follows the selected lead
  $("leadnote").innerHTML = `<b>${lead}</b>: ${esc(LEAD_INFO[lead])}. The white dot is the heart vector projected on this lead: above the centre toward the labelled pole, the trace goes up.`;
  for (const d of document.querySelectorAll<HTMLElement>("#stmap [data-lead]")) d.classList.toggle("sel", d.dataset.lead === lead);
}
paper.onSelect = (l) => select(l);

// ---------------------------------------------------------------- controls
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-gain]")) b.addEventListener("click", () => {
  paper.gain = +b.dataset.gain!; for (const x of document.querySelectorAll("[data-gain]")) x.classList.toggle("on", x === b);
});
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-set]")) b.addEventListener("click", () => {
  axes.set = b.dataset.set as LeadSet; axes.restyle(); for (const x of document.querySelectorAll("[data-set]")) x.classList.toggle("on", x === b);
});
for (const b of document.querySelectorAll<HTMLButtonElement>("#views button")) b.addEventListener("click", () => {
  scene.view(b.dataset.view!); for (const x of document.querySelectorAll("#views button")) x.classList.toggle("on", x === b);
});
$<HTMLInputElement>("posterior").addEventListener("change", (e) => { paper.posterior = axes.posterior = (e.target as HTMLInputElement).checked; axes.restyle(); render(); });
$<HTMLInputElement>("artifact").addEventListener("change", (e) => { artifact = (e.target as HTMLInputElement).checked; });
$("pause").addEventListener("click", () => { paused = !paused; $("pause").textContent = paused ? "Resume" : "Pause"; $("pause").classList.toggle("on", paused); });
$<HTMLInputElement>("rate").addEventListener("input", (e) => {
  rate = +(e.target as HTMLInputElement).value; $("rateVal").textContent = `${rate} bpm`;
  rebuildEngine(); render();
});
$<HTMLInputElement>("search").addEventListener("input", (e) => renderList((e.target as HTMLInputElement).value));

// ---------------------------------------------------------------- quiz
function shuffle<T>(xs: T[]) { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; }
function startQuiz(target?: EkgPreset) {
  quiz.on = true; quiz.answered = false;
  const answer = target ?? PRESETS[Math.floor(Math.random() * PRESETS.length)];
  const same = shuffle(PRESETS.filter((p) => p.id !== answer.id && p.category === answer.category)).slice(0, 2);
  const others = shuffle(PRESETS.filter((p) => p.id !== answer.id && !same.includes(p))).slice(0, 3 - same.length);
  const choices = shuffle([answer, ...same, ...others]);
  $("quiz").hidden = false; $("qafter").hidden = true;
  $("choices").innerHTML = "";
  for (const c of choices) {
    const b = document.createElement("button"); b.textContent = c.name;
    b.addEventListener("click", () => answerQuiz(c, answer, b));
    $("choices").append(b);
  }
  score();
  load(answer, { quiz: true });
  if (!embedded) history.replaceState(null, "", "#quiz"); // reloading starts a fresh quiz, and the address gives nothing away
}
function answerQuiz(c: EkgPreset, answer: EkgPreset, btn: HTMLButtonElement) {
  if (quiz.answered) return;
  quiz.answered = true; quiz.total++;
  const ok = c.id === answer.id;
  if (ok) { quiz.right++; quiz.streak++; } else quiz.streak = 0;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#choices button")) { b.disabled = true; if (b.textContent === answer.name) b.classList.add("right"); }
  if (!ok) btn.classList.add("wrong");
  $("qverdict").textContent = ok ? `Right: ${answer.name}.` : `It was ${answer.name}.`;
  $("qafter").hidden = false;
  store.set("corosim.ekgQuiz", JSON.stringify({ right: quiz.right, total: quiz.total, streak: quiz.streak }));
  score(); render();
}
function score() { $("qscore").textContent = quiz.total ? `${quiz.right}/${quiz.total} · streak ${quiz.streak}` : ""; }
function stopQuiz() {
  if (!quiz.on) return;
  quiz.on = false; $("quiz").hidden = true;
  if (!embedded) history.replaceState(null, "", `#p=${preset.id}`);
  render();
}
$("quizBtn").addEventListener("click", () => startQuiz());
$("qnext").addEventListener("click", () => startQuiz());
$("qstop").addEventListener("click", () => stopQuiz());
$("reveal").addEventListener("click", () => { quiz.answered = true; for (const b of document.querySelectorAll<HTMLButtonElement>("#choices button")) { b.disabled = true; if (b.textContent === preset.name) b.classList.add("right"); } $("qverdict").textContent = `It was ${preset.name}.`; $("qafter").hidden = false; render(); });

// ---------------------------------------------------------------- Ask Claude
function askLink() {
  const hidden = quiz.on && !quiz.answered;
  const text = hidden
    ? "Use the CoroSim connector to quiz me on EKGs: call corosim_ekg_show with quiz true for a random preset, ask me to read it step by step (rate, rhythm, axis, intervals, morphology), and only reveal the answer after I commit."
    : `Use the CoroSim connector: call corosim_ekg_show for the EKG preset "${preset.id}" (${preset.name}) and teach me to read it. Ask me what I see before you explain, and point to the leads and the 3D heart vector.`;
  $<HTMLAnchorElement>("askClaude").href = `https://claude.ai/new?q=${encodeURIComponent(text)}`;
}

// ---------------------------------------------------------------- the clock
let noiseSeed = 1;
const rnd = () => { noiseSeed = (noiseSeed * 16807) % 2147483647; return noiseSeed / 2147483647 - 0.5; };
const PH = Object.fromEntries(ALL_LEADS.map((l, i) => [l, i * 1.7])) as Record<LeadName, number>;
function step1() {
  const s = engine.leads(t);
  if (artifact) for (const l of ALL_LEADS) s[l] += 0.06 * Math.sin(2 * Math.PI * 0.28 * t + PH[l]) + 0.018 * rnd();
  paper.push(s);
  t += 1 / paper.fs;
}
let last = performance.now(), acc = 0, pruneClock = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused) {
    acc += dt * paper.fs;
    const n = Math.floor(acc); acc -= n;
    for (let i = 0; i < n; i++) step1();
    if ((pruneClock += dt) > 5) { pruneClock = 0; engine.prune(t); }
    axes.update(engine.vector(t));
  }
  paper.draw();
  scene.render();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- in a chat: the AI picks the tracing
interface Shown { ekg?: { preset?: string; quiz?: boolean; rate?: number; lead?: string } }
if (embedded) {
  const app = new App({ name: "CoroSim EKG", version: "0.5.0" }, {}, { autoResize: true });
  app.ontoolresult = (r) => {
    const e = ((r.structuredContent ?? {}) as Shown).ekg;
    const p = e?.preset ? findPreset(e.preset) : undefined;
    if (!p) return;
    if (e?.quiz) startQuiz(p); else { stopQuiz(); load(p); }
    if (e?.rate && hasRate(spec)) { rate = Math.round(e.rate); $<HTMLInputElement>("rate").value = String(rate); $("rateVal").textContent = `${rate} bpm`; rebuildEngine(); render(); }
    if (e?.lead && (ALL_LEADS as readonly string[]).includes(e.lead)) select(e.lead as LeadName);
  };
  const theme = () => { document.documentElement.dataset.theme = app.getHostContext()?.theme === "light" ? "light" : "dark"; };
  app.onhostcontextchanged = theme;
  void app.connect().then(theme);
}

// ---------------------------------------------------------------- start
const fromHash = location.hash.match(/p=([\w-]+)/)?.[1];
renderList();
if (/quiz/.test(location.hash)) startQuiz();
else load((fromHash && findPreset(fromHash)) || PRESETS[0]);
window.addEventListener("hashchange", () => {
  const id = location.hash.match(/p=([\w-]+)/)?.[1], p = id ? findPreset(id) : undefined;
  if (/quiz/.test(location.hash)) startQuiz(); else if (p && p.id !== preset.id) { stopQuiz(); load(p); }
});
requestAnimationFrame(frame);
(window as unknown as { corosimEkg: object }).corosimEkg = { load: (id: string) => { const p = findPreset(id); if (p) load(p); }, presets: PRESETS, measure: () => meas };
