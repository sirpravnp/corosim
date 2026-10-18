import { Simulation } from "../sim/simulation";
import { Scenario, normalizeScenario } from "../sim/scenario";
import { BeatRecord, computeMetrics } from "../sim/metrics";
import { explain } from "../sim/explain";
import { SCENARIO_REFERENCE, encodeScenario } from "../sim/llm";
import { buildTree } from "../anatomy/tree";

/**
 * Tool definitions in one place, as plain JSON Schema. The MCP server, the HTTP/OpenAPI adapter and the
 * OpenAI/Anthropic function-calling exports are all generated from this list, so they cannot drift apart.
 */
export interface ToolContext { sim: Simulation; appUrl: string }
export interface ToolDef {
  name: string; title: string; description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  /** Shows the patient: hosts that support MCP Apps render the in-chat viewer with its result. */
  viewer?: boolean;
  run(ctx: ToolContext, args: Record<string, unknown>): unknown;
}

const NOT_CLINICAL = "Educational simulation; not for clinical decisions.";

const scenarioSchema = {
  type: "object",
  description: "Patient and intervention description. Every field optional; omitted fields keep the typical resting adult.",
  properties: {
    anatomy: {
      type: "object", description: "Coronary anatomy variant.",
      properties: {
        dominance: { enum: ["right", "co", "left"] }, lm: { enum: ["bifurcation", "trifurcation", "absent"], description: "Left-main pattern; trifurcation adds a ramus intermedius." },
        saNodeFrom: { enum: ["RCA", "LCx"] }, conusOstium: { enum: ["shared", "separate"] }, ladCourse: { enum: ["normal", "short", "wrap"] },
      },
    },
    lesions: {
      type: "array", description: "Coronary lesions, at most one per artery.",
      items: {
        type: "object", required: ["artery"],
        properties: {
          artery: { type: "string", description: "LM, LAD, D1, D2, RAMUS, LCX, OM1, OM2, RCA, AM, PDA, PLV, SAN (SA-node artery), AVN (AV-node artery), CONUS. Names like 'circumflex' also work." },
          stenosis: { type: "number", minimum: 0, maximum: 0.99, description: "Fractional diameter reduction at the narrowest point (0.7 = 70 % diameter stenosis). Default 0.7." },
          occluded: { type: "boolean", description: "Complete occlusion; overrides stenosis." },
          position: { type: "number", minimum: 0, maximum: 1, description: "0 = proximal end of the artery, 1 = distal. Default 0.15." },
        },
      },
    },
    exertion: { type: "boolean", description: "Moderate exertion: doubles myocardial oxygen demand." },
    bloodLoss: { type: "number", minimum: -0.3, maximum: 0.6, description: "Fraction of blood volume lost (0.15 = ATLS class II, 0.3 = class III). Negative = volume overload." },
    drugs: {
      type: "object",
      properties: {
        betaBlocker: { type: "number", minimum: 0, maximum: 1, description: "Fraction of beta-adrenergic effect blocked." },
        atropine: { type: "number", minimum: 0, maximum: 1, description: "Fraction of vagal effect on the sinus node blocked." },
        vasopressor: { type: "number", minimum: -1, maximum: 1, description: "-1 strong vasodilator, +1 strong alpha-agonist (phenylephrine-like)." },
      },
    },
    autonomic: {
      type: "object",
      properties: {
        baroreflexGain: { type: "number", minimum: 0, maximum: 4, description: "0 = denervated, 1 = normal, ≥2 = enough loop gain for a sustained ~0.1 Hz (Mayer-wave) oscillation." },
        respRate: { type: "number", minimum: 4, maximum: 40, description: "Breaths per minute (drives respiratory sinus arrhythmia)." },
        respDepth: { type: "number", minimum: 0, maximum: 2 },
        setPointShift: { type: "number", minimum: -30, maximum: 60, description: "mmHg added to the baroreceptor set point (chronic hypertension resets it upward)." },
        noise: { type: "number", minimum: 0, maximum: 3, description: "Scale of physiological noise. 0 = deterministic loop; 1 = normal." },
      },
    },
    patient: {
      type: "object", description: "What the patient brought with them.",
      properties: { rhythm: { enum: ["sinus", "af"], description: "Baseline rhythm; af = atrial fibrillation (no P waves, irregular, no atrial kick)." }, bbb: { enum: ["none", "rbbb", "lbbb"], description: "Pre-existing bundle branch block." } },
    },
    support: {
      type: "object", description: "Hemodynamic support (as in the app's management panel). Atropine is drugs.atropine.",
      properties: {
        fluids: { type: "number", minimum: 0, maximum: 3, description: "Litres of IV fluid given. Helps a right-ventricular infarct; congests the lungs of a failing left ventricle." },
        norepinephrine: { type: "number", minimum: 0, maximum: 1 }, dobutamine: { type: "number", minimum: 0, maximum: 1 }, nitroglycerin: { type: "number", minimum: 0, maximum: 1 },
        pacing: { type: "boolean" }, paceRate: { type: "number", minimum: 40, maximum: 120 },
        iabp: { type: "boolean", description: "Intra-aortic balloon pump." }, impella: { type: "boolean", description: "Microaxial left-ventricular pump." },
      },
    },
    seed: { type: "integer", description: "Random seed. The same scenario and seed reproduce the same beats." },
  },
} as const;

const round = (x: number, d = 1) => +x.toFixed(d);
const num = (v: unknown, def: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);

/** Mean of selected fields over consecutive time buckets: a bounded view of the dynamics. */
function trend(beats: BeatRecord[], from: number, to: number, buckets = 24) {
  const w = Math.max(1, (to - from) / buckets), out: Record<string, number>[] = [];
  for (let t = from; t < to - 1e-6; t += w) {
    const b = beats.filter((x) => x.t >= t && x.t < t + w);
    if (!b.length) continue;
    const avg = (f: (x: BeatRecord) => number) => b.reduce((s, x) => s + f(x), 0) / b.length;
    out.push({ t: round(t - from + w / 2, 1), hr: round(avg((x) => x.hr), 0), sbp: round(avg((x) => x.sbp), 0), dbp: round(avg((x) => x.dbp), 0), map: round(avg((x) => x.map), 0), sv: round(avg((x) => x.sv), 0), pvcs: b.filter((x) => x.pvc).length });
  }
  return out;
}

function beatTable(beats: BeatRecord[], max: number) {
  const step = Math.max(1, Math.ceil(beats.length / max));
  const pick = beats.filter((_, i) => i % step === 0);
  return {
    columns: ["t_s", "rr_ms", "sbp", "dbp", "sv_ml", "pvc"],
    rows: pick.map((b) => [round(b.t, 2), round(b.interval * 1000, 0), round(b.sbp, 1), round(b.dbp, 1), round(b.sv, 1), b.pvc ? 1 : 0]),
    decimatedEvery: step,
  };
}

/** What a clinician at the bedside would have: monitor, 12-lead ECG, and where the guidelines stand. */
function bedside(sim: Simulation) {
  const a = sim.assessment();
  return {
    scenario: sim.scenario(), // also what the in-chat viewer replays
    state: sim.state(),
    ecg: sim.ecg(),
    assessment: { problems: a.issues.map((i) => i.text), harmful: a.warnings.map((w) => w.text), guidelineNextSteps: a.steps.map((x) => ({ step: x.text, why: x.why })) },
  };
}

/** Beat statistics without the autonomic internals (HRV, baroreflex sensitivity) unless asked for. */
function clinicalMetrics(beats: BeatRecord[], seconds: number, autonomic: boolean) {
  const m = computeMetrics(beats, seconds) as unknown as Record<string, unknown>;
  if (!autonomic) { delete m.hrv; delete m.baroreflexSensitivity; delete m.respiratorySinusArrhythmia; delete m.note; }
  return m;
}

function runReport(ctx: ToolContext, seconds: number, beatsMode: string, maxBeats: number, autonomic = false) {
  const { sim } = ctx, from = sim.t, beats = sim.run(seconds);
  const out: Record<string, unknown> = {
    ranFromS: round(from), ranToS: round(sim.t), metrics: clinicalMetrics(beats, seconds, autonomic),
    timeCourse: trend(beats, from, sim.t), ...bedside(sim),
  };
  if (beatsMode === "all") out.beats = beatTable(beats, maxBeats);
  if (sim.warnings.length) out.warnings = sim.warnings;
  return out;
}

export const TOOLS: ToolDef[] = [
  {
    name: "corosim_get_schema", title: "Describe the scenario format", readOnly: true,
    description: `Return the Scenario JSON schema, valid artery ids for the current anatomy, units and what every knob does. Call this first when you are asked to build a patient. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run({ sim }) {
      return {
        reference: SCENARIO_REFERENCE, schema: scenarioSchema,
        arteriesInCurrentAnatomy: buildTree(sim.n.anatomy).segments.map((s) => ({ id: s.id, name: s.name, supplies: `${(s.subMass * 100).toFixed(0)}% of myocardium` })),
        referenceAdult: { hr: 72, strokeVolumeMl: 70, mapMmHg: 90, bp: "120/72" },
        howItWorks: "Pressure of each beat is sensed by baroreceptors; a fast vagal arm (~0.6 s) and a slow sympathetic arm (~2 s) change heart rate, contractility and resistance. Respiration gates vagal tone (RSA). Noise in tone makes every beat different. Coronary lesions cause ischemia over ~20 s, which causes AV block, ectopy and pump failure; pressure then feeds back on coronary perfusion.",
      };
    },
  },
  {
    name: "corosim_set_scenario", title: "Build a patient", readOnly: false, viewer: true,
    description: `Replace the current patient with this scenario, then run a warm-up so the reflexes have settled. Returns the monitor, the 12-lead ECG, the guideline assessment and a grounded explanation, plus warnings listing anything that was clamped or dropped (read them: they tell you what actually ran). Use settled=false to watch an occlusion develop from a healthy start. The warm-up does not advance the infarct clock; corosim_run and corosim_adjust do (2 clinical minutes per simulated second), so a closed artery loses muscle as you run it. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: { scenario: scenarioSchema, settled: { type: "boolean", description: "Start with ischemia already at its steady value (default true). False = ischemia develops over ~20 s." }, warmupSeconds: { type: "number", minimum: 0, maximum: 300, description: "Simulated seconds to run before returning (default 45)." } } },
    run({ sim }, a) {
      sim.reset((a.scenario ?? {}) as Scenario, { settled: a.settled !== false });
      sim.warmup(num(a.warmupSeconds, 45, 0, 300));
      return { warnings: sim.warnings, ...bedside(sim), explanation: explain(sim) };
    },
  },
  {
    name: "corosim_adjust", title: "Change the patient while it runs", readOnly: false, viewer: true,
    description: `Apply a change to the running patient (give a drug, start a hemorrhage, occlude an artery) and optionally run on to watch the response. Fields you leave out are unchanged; drug and volume changes ramp in over ~10 s like a real bolus. Returns the response time course. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", required: ["patch"], properties: { patch: scenarioSchema, runSeconds: { type: "number", minimum: 0, maximum: 600, description: "Simulated seconds to run after the change (default 60)." } } },
    run(ctx, a) {
      ctx.sim.apply((a.patch ?? {}) as Scenario);
      const rep = runReport(ctx, num(a.runSeconds, 60, 0, 600), "none", 0);
      return { applied: ctx.sim.scenario(), ...rep };
    },
  },
  {
    name: "corosim_run", title: "Advance the simulation", readOnly: false, viewer: true,
    description: `Run the current patient forward (the infarct clock runs: 2 clinical minutes per second) and return rate, pressures, stroke volume and ectopy, a time course, the monitor, ECG and guideline assessment at the end, and optionally the individual beats. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: { seconds: { type: "number", minimum: 1, maximum: 900, description: "Simulated seconds (default 60)." }, beats: { enum: ["none", "all"], description: "'all' adds a beat-by-beat table (decimated to maxBeats)." }, maxBeats: { type: "integer", minimum: 5, maximum: 500, description: "Row cap for the beat table (default 120)." }, autonomic: { type: "boolean", description: "Also return heart-rate variability and baroreflex-sensitivity statistics. Only for autonomic-physiology questions." } } },
    run(ctx, a) { return runReport(ctx, num(a.seconds, 60, 1, 900), a.beats === "all" ? "all" : "none", Math.trunc(num(a.maxBeats, 120, 5, 500)), a.autonomic === true); },
  },
  {
    name: "corosim_get_state", title: "Current hemodynamic state", readOnly: true, viewer: true,
    description: `The patient right now, as at the bedside: monitor (10 s rolling vitals), 12-lead ECG ST levels by lead, rhythm, ventricle and infarct size, support running, ischemic beds, FFR, and the guideline assessment (problems, anything harmful being done, next steps in order). Does not advance time. Read this first. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run({ sim }) { return { warnings: sim.warnings, ...bedside(sim) }; },
  },
  {
    name: "corosim_treat", title: "Revascularize: PCI, fibrinolysis or CABG", readOnly: false, viewer: true,
    description: `Treat the culprit artery. The order's real delay runs first on the infarct clock (primary PCI 60 min, fibrinolytic 40 min, CABG 4 h), so muscle keeps dying while the team gets there; then PCI stents the lesion open, a fibrinolytic opens an occlusion in about half of patients (fixed per patient) and leaves a 50% stenosis, CABG grafts beyond the lesion. Returns what happened, infarct size before and at arrival, and the patient afterwards. For support (fluids, pressors, inotropes, nitrates, atropine, pacing, balloon pump, Impella) use corosim_adjust. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", required: ["procedure"], properties: { procedure: { enum: ["pci", "lysis", "cabg"] }, runSecondsAfter: { type: "number", minimum: 0, maximum: 300, description: "Seconds to run after the procedure lands, to watch recovery (default 30)." } } },
    run(ctx, a) {
      const kind = String(a.procedure);
      if (!["pci", "lysis", "cabg"].includes(kind)) throw new Error("procedure must be pci, lysis or cabg.");
      const outcome = ctx.sim.revascularize(kind as "pci" | "lysis" | "cabg");
      const after = runReport(ctx, num(a.runSecondsAfter, 30, 0, 300) || 0.02, "none", 0);
      return { outcome, ...after };
    },
  },
  {
    name: "corosim_explain", title: "Grounded explanation of the current state", readOnly: true,
    description: `The model's causal account of the current state: which lesion, reflex or treatment produced each abnormal finding, and teaching points. Quote it rather than improvising physiology. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run({ sim }) { return explain(sim); },
  },
  {
    name: "corosim_compare", title: "Counterfactual comparison", readOnly: true,
    description: `Run several scenarios from the same seed in separate simulations (the current patient is not changed) and return their statistics side by side with differences from the first. Use for 'what if' teaching: with vs without baroreflex, with vs without a beta blocker, 15% vs 30% hemorrhage. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", required: ["scenarios"], properties: { scenarios: { type: "array", minItems: 2, maxItems: 5, items: { type: "object", required: ["label", "scenario"], properties: { label: { type: "string" }, scenario: scenarioSchema } }, description: "The first entry is the reference." }, seconds: { type: "number", minimum: 30, maximum: 600, description: "Measured seconds after warm-up (default 120)." }, warmupSeconds: { type: "number", minimum: 0, maximum: 300, description: "Default 60." } } },
    run(_ctx, a) {
      const list = (a.scenarios as { label: string; scenario: Scenario }[]) ?? [];
      if (list.length < 2) throw new Error("Provide at least two scenarios to compare.");
      const sec = num(a.seconds, 120, 30, 600), warm = num(a.warmupSeconds, 60, 0, 300);
      const results = list.slice(0, 5).map((s) => {
        const sim = new Simulation(); sim.reset(s.scenario ?? {}, { settled: true }); sim.warmup(warm); sim.history = []; sim.run(sec);
        const m = sim.metrics(sec), st = sim.state();
        return { label: s.label, warnings: sim.warnings, summary: { hr: m.hr.mean, sbp: m.sbp.mean, dbp: m.dbp.mean, map: m.map.mean, mapSd: m.map.sd, strokeVolume: m.strokeVolume.mean, sdnnMs: m.hrv?.sdnnMs ?? null, rmssdMs: m.hrv?.rmssdMs ?? null, lfHf: m.hrv?.lfHf ?? null, lfPeakHz: m.hrv?.lfPeakHz ?? null, pvcs: m.pvcs, circulationState: st.circulationState, rhythm: st.rhythm.label } };
      });
      const ref = results[0].summary as Record<string, unknown>;
      return results.map((r, i) => ({ ...r, deltaVsFirst: i === 0 ? null : Object.fromEntries(Object.entries(r.summary).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, typeof ref[k] === "number" ? round((v as number) - (ref[k] as number), 2) : null])) }));
    },
  },
  {
    name: "corosim_show", title: "Show the patient in the chat", readOnly: true, viewer: true,
    description: `Display the patient visually, right here in the chat: an interactive 3D heart (ischemic wall darkened, infarct darker, narrowing marked), a live 12-lead ECG and a bedside monitor with the guideline next steps. Call this whenever the user wants to see, show, view, visualize or look at the patient, the heart or the ECG. Does not advance time. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run({ sim }) { return { ...bedside(sim), shown: "The patient is displayed in the chat. Describe what it shows briefly; do not paste a link." }; },
  },
  {
    name: "corosim_open_link", title: "Shareable link to this patient", readOnly: true,
    description: "Only when the user explicitly asks for a link or URL (to share, or to open the full website): return a corosim.com address for this patient. To show the patient in the chat, use corosim_show instead.",
    inputSchema: { type: "object", properties: {} },
    run({ sim, appUrl }) {
      return { link: `${appUrl.replace(/\/$/, "")}/#s=${encodeScenario(sim.scenario())}` };
    },
  },
];

/** OpenAI function-calling format. */
export const openAiTools = () => TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
/** Anthropic Messages API tool format. */
export const anthropicTools = () => TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
export { normalizeScenario };
