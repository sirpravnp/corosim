import { Simulation } from "../sim/simulation";
import { normalizeScenario } from "../sim/scenario";
import { BeatRecord, computeMetrics, meanRate } from "../sim/metrics";
import { explain } from "../sim/explain";
import { SCENARIO_REFERENCE } from "../sim/llm";
import type { PatientSpec } from "../sim/patient";
import { encodePatient } from "../sim/llm";
import { rememberPatient, patchPatient, currentPatient, heartCath, jvp, oxygen, loopMetricsReport } from "./hemo";
import { buildTree } from "../anatomy/tree";
import { CATEGORIES, PRESETS, EkgPreset, findPreset, resolveSpec } from "../ekg/presets";
import { EkgSpec, measure } from "../ekg/engine";
import { CustomEkg, TERRITORIES, buildCustom, encodeCustom } from "../ekg/custom";
import { patientProperties, displaySchema } from "../sim/registry";
import { intervene } from "../sim/valves";
import type { Intervention } from "../sim/valves";
import { narrateCase, narrateNewPatient, narrateChange, narrateRun, narrateTreat, narrateValve, narrateArrest, features } from "../sim/narrate";
import { vitalsOf, snapshot } from "./narration";
import { simRhythmId } from "../physics/rhythmSource";
import type { ArrestDrug } from "../sim/arrest";

/**
 * Tool definitions in one place, as plain JSON Schema. The MCP server, the HTTP/OpenAPI adapter and the
 * OpenAI/Anthropic function-calling exports are all generated from this list, so they cannot drift apart.
 */
export interface ToolContext { sim: Simulation; appUrl: string }
export interface ToolDef {
  name: string; title: string; description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  /** Shows something: hosts that support MCP Apps render a viewer with its result. `true` is the patient viewer (only
   *  corosim_show, so a turn that looks at the patient and then shows it draws one panel, not one per tool call);
   *  "ekg" is the EKG page (corosim_ekg_show). */
  viewer?: true | "ekg";
  /** Needs no patient: runs on the server even while the user's page is open, and does not change what they see there. */
  stateless?: boolean;
  run(ctx: ToolContext, args: Record<string, unknown>): unknown;
}

const NOT_CLINICAL = "Educational simulation; not for clinical decisions.";

/**
 * The patient schema is generated from the spec registry (src/sim/registry.ts): one list of fields feeds this schema, the page's
 * controls and the parity test (tests/specRegistry.test.ts). To add a field, add it there.
 */
const scenarioSchema = {
  type: "object",
  description: "Patient and intervention description (a Scenario plus heart, pericardium, septum, fluids, ventilation and devices). Every field optional; omitted fields keep the typical resting adult. The additional fields are accepted and validated. `heart` shapes the readings of corosim_heart_cath, corosim_jvp, corosim_oxygen and corosim_loop_metrics too; `devices`, `heart`, `pericardium`, `ventilation` and library rhythms are read by the core engine only (the legacy engine ignores them).",
  properties: patientProperties(),
} as const;
const patientSchema = scenarioSchema;

const round = (x: number, d = 1) => +x.toFixed(d);
const num = (v: unknown, def: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);

/** Mean of selected fields over consecutive time buckets: a bounded view of the dynamics. */
function trend(beats: BeatRecord[], from: number, to: number, buckets = 24) {
  const w = Math.max(1, (to - from) / buckets), out: Record<string, number>[] = [];
  for (let t = from; t < to - 1e-6; t += w) {
    const b = beats.filter((x) => x.t >= t && x.t < t + w);
    if (!b.length) continue;
    const avg = (f: (x: BeatRecord) => number) => b.reduce((s, x) => s + f(x), 0) / b.length;
    out.push({ t: round(t - from + w / 2, 1), hr: round(meanRate(b), 0), sbp: round(avg((x) => x.sbp), 0), dbp: round(avg((x) => x.dbp), 0), map: round(avg((x) => x.map), 0), sv: round(avg((x) => x.sv), 0), pvcs: b.filter((x) => x.pvc).length });
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

/** The arrest block and the dead flag at the top level of the result (also inside `state`); `arrest` is absent on the legacy engine. */
function arrestView(sim: Simulation) {
  const st = sim.state() as unknown as { arrest?: unknown; dead?: boolean };
  return { ...(st.arrest ? { arrest: st.arrest } : {}), dead: st.dead === true };
}

/** What a clinician at the bedside would have: monitor, 12-lead ECG, and where the guidelines stand. */
function bedside(sim: Simulation) {
  const a = sim.assessment();
  return {
    scenario: sim.scenario(), // also what the in-chat viewer replays
    engine: sim.engine, // the viewer replays on the same engine, with the whole patient (heart: valves and prostheses, devices...) below
    patient: currentPatient(sim),
    state: sim.state(),
    ...arrestView(sim),
    ecg: sim.ecg(),
    ...(sim.devices() ? { devices: sim.devices() } : {}), // core engine: Impella and IABP consoles (see sim/coreDevices.ts)
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
    description: `Return the Scenario JSON schema, valid artery ids for the current anatomy, units and what every knob does. Call this first when you are asked to build a patient. To put a library rhythm on the patient (flutter, SVT, blocks, VT, VF...) so its hemodynamics follow, set patient.rhythm (every corosim_ekg_list id works); to only see a tracing, use corosim_ekg_show. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run({ sim }) {
      return {
        reference: SCENARIO_REFERENCE, schema: patientSchema,
        ekg: "The patient runs its own sinus or AF rhythm plus whatever its coronary physiology causes, and any rhythm of the EKG library through patient.rhythm (flutter, SVT, junctional, AV blocks, VT, torsades, VF, asystole, paced; ids from corosim_ekg_list) with the hemodynamics that follow, on the core engine. Use corosim_adjust { patch: { patient: { rhythm } } } when the rhythm's effect on the patient matters. To only show or teach a tracing (any rhythm or 12-lead pattern, STEMI mimics, electrolytes, custom tracings), call corosim_ekg_show: it does not touch this patient and its result offers to apply a library rhythm to the patient.",
        arrest: "Cardiac arrest (core engine): set patient.rhythm to vf-coarse, vt-mono or asystole with corosim_adjust, then run the resuscitation with corosim_arrest (cpr, shock, drug, restart). state.arrest and state.dead (also at the top level of corosim_get_state and corosim_show) report it.",
        arteriesInCurrentAnatomy: buildTree(sim.n.anatomy).segments.map((s) => ({ id: s.id, name: s.name, supplies: `${(s.subMass * 100).toFixed(0)}% of myocardium` })),
        referenceAdult: { hr: 72, strokeVolumeMl: 70, mapMmHg: 90, bp: "120/72" },
        howItWorks: "Pressure of each beat is sensed by baroreceptors; a fast vagal arm (~0.6 s) and a slow sympathetic arm (~2 s) change heart rate, contractility and resistance. Respiration gates vagal tone (RSA). Noise in tone makes every beat different. Coronary lesions cause ischemia over ~20 s, which causes AV block, ectopy and pump failure; pressure then feeds back on coronary perfusion.",
      };
    },
  },
  {
    name: "corosim_set_scenario", title: "Build a patient", readOnly: false,
    description: `Replace the current patient with this scenario, then run a warm-up so the reflexes have settled. Returns the monitor, the 12-lead ECG, the guideline assessment and a grounded explanation, plus warnings listing anything that was clamped or dropped (read them: they tell you what actually ran). Use settled=false to watch an occlusion develop from a healthy start. The warm-up does not advance the infarct clock; corosim_run and corosim_adjust do (2 clinical minutes per simulated second), so a closed artery loses muscle as you run it. To put a library rhythm on the patient (flutter, SVT, blocks, VT, VF...) so its hemodynamics follow, set patient.rhythm (every corosim_ekg_list id works); to only see a tracing, use corosim_ekg_show. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: { scenario: patientSchema, engine: { enum: ["legacy", "core"], description: "Hemodynamic engine for this patient. Omit to keep the current one (a new server starts on legacy). 'core' is the beat-by-beat engine and adds the Impella and IABP consoles (devices) to every report; slower." }, settled: { type: "boolean", description: "Start with ischemia already at its steady value (default true). False = ischemia develops over ~20 s." }, warmupSeconds: { type: "number", minimum: 0, maximum: 300, description: "Simulated seconds to run before returning (default 45)." } } },
    run({ sim }, a) {
      if (a.engine !== undefined && a.engine !== "legacy" && a.engine !== "core") throw new Error("engine must be legacy or core.");
      if (a.engine) sim.engine = a.engine as "legacy" | "core"; // takes effect at the reset below
      sim.reset((a.scenario ?? {}) as PatientSpec, { settled: a.settled !== false });
      rememberPatient(sim, (a.scenario ?? {}) as PatientSpec);
      const warm = num(a.warmupSeconds, 45, 0, 300);
      sim.warmup(warm);
      return { narrative: narrateNewPatient(currentPatient(sim), vitalsOf(sim), warm), warnings: sim.warnings, ...bedside(sim), explanation: explain(sim) };
    },
  },
  {
    name: "corosim_adjust", title: "Change the patient while it runs", readOnly: false,
    description: `Apply a change to the running patient (give a drug, start a hemorrhage, occlude an artery) and optionally run on to watch the response. Fields you leave out are unchanged; drug and volume changes ramp in over ~10 s like a real bolus. Returns the response time course. Set patch.patient.rhythm to any library rhythm (corosim_ekg_list ids) to run it on the patient with its hemodynamics, including vf-coarse, vt-mono and asystole to start an arrest for teaching (then corosim_arrest). ${NOT_CLINICAL}`,
    inputSchema: { type: "object", required: ["patch"], properties: { patch: patientSchema, runSeconds: { type: "number", minimum: 0, maximum: 600, description: "Simulated seconds to run after the change (default 60)." } } },
    run(ctx, a) {
      const before = snapshot(ctx.sim), secs = num(a.runSeconds, 60, 0, 600);
      ctx.sim.apply((a.patch ?? {}) as PatientSpec);
      patchPatient(ctx.sim, (a.patch ?? {}) as PatientSpec);
      const rep = runReport(ctx, secs, "none", 0), now = snapshot(ctx.sim);
      return { narrative: narrateChange(before.spec, now.spec, before.vitals, now.vitals, secs), applied: currentPatient(ctx.sim), ...rep };
    },
  },
  {
    name: "corosim_run", title: "Advance the simulation", readOnly: false,
    description: `Run the current patient forward (the infarct clock runs: 2 clinical minutes per second) and return rate, pressures, stroke volume and ectopy, a time course, the monitor, ECG and guideline assessment at the end, and optionally the individual beats. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: { seconds: { type: "number", minimum: 1, maximum: 900, description: "Simulated seconds (default 60)." }, beats: { enum: ["none", "all"], description: "'all' adds a beat-by-beat table (decimated to maxBeats)." }, maxBeats: { type: "integer", minimum: 5, maximum: 500, description: "Row cap for the beat table (default 120)." }, autonomic: { type: "boolean", description: "Also return heart-rate variability and baroreflex-sensitivity statistics. Only for autonomic-physiology questions." } } },
    run(ctx, a) {
      const before = vitalsOf(ctx.sim), secs = num(a.seconds, 60, 1, 900);
      const rep = runReport(ctx, secs, a.beats === "all" ? "all" : "none", Math.trunc(num(a.maxBeats, 120, 5, 500)), a.autonomic === true);
      return { narrative: narrateRun(before, vitalsOf(ctx.sim), secs), ...rep };
    },
  },
  {
    name: "corosim_get_state", title: "Current hemodynamic state", readOnly: true,
    description: `The patient right now, as at the bedside: monitor (10 s rolling vitals), 12-lead ECG ST levels by lead, rhythm, cardiac arrest status (arrest block and dead, core engine), ventricle and infarct size, support running, ischemic beds, FFR, and the guideline assessment (problems, anything harmful being done, next steps in order). Does not advance time. Read this first. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run({ sim }) { return { warnings: sim.warnings, ...bedside(sim) }; },
  },
  {
    name: "corosim_treat", title: "Revascularize: PCI, fibrinolysis or CABG", readOnly: false,
    description: `Treat the culprit artery. The order's real delay runs first on the infarct clock (primary PCI 60 min, fibrinolytic 40 min, CABG 4 h), so muscle keeps dying while the team gets there; then PCI stents the lesion open, a fibrinolytic opens an occlusion in about half of patients (fixed per patient) and leaves a 50% stenosis, CABG grafts beyond the lesion. Returns what happened, infarct size before and at arrival, and the patient afterwards. For support (fluids, pressors, inotropes, nitrates, atropine, pacing, balloon pump, Impella) use corosim_adjust. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", required: ["procedure"], properties: { procedure: { enum: ["pci", "lysis", "cabg"] }, runSecondsAfter: { type: "number", minimum: 0, maximum: 300, description: "Seconds to run after the procedure lands, to watch recovery (default 30)." } } },
    run(ctx, a) {
      const kind = String(a.procedure);
      if (!["pci", "lysis", "cabg"].includes(kind)) throw new Error("procedure must be pci, lysis or cabg.");
      const before = vitalsOf(ctx.sim);
      const outcome = ctx.sim.revascularize(kind as "pci" | "lysis" | "cabg");
      const after = runReport(ctx, num(a.runSecondsAfter, 30, 0, 300) || 0.02, "none", 0);
      return { narrative: narrateTreat(outcome, before, vitalsOf(ctx.sim)), outcome, ...after };
    },
  },
  {
    name: "corosim_valve", title: "Valve intervention: replace, TAVR, dilate, clip or repair", readOnly: false,
    description: `Do a valve procedure on the running patient and optionally run on to watch the response. replace: surgical or transcatheter prosthesis in any valve (kind bioprosthetic, mechanical or transcatheter; a transcatheter valve in a failed bioprosthesis is valve-in-valve); tavr: transcatheter aortic valve; balloon: valvuloplasty of a stenotic aortic, mitral or pulmonary valve (effect 0..1 for a calcified valve); teer: MitraClip or TriClip for mitral or tricuspid regurgitation (1 to 4 clips); repair: annuloplasty ring for mitral or tricuspid regurgitation. Changes only the valve it touches, so several valves can be diseased or treated at once. Returns what changed, warnings (a procedure that cannot be done changes nothing) and the patient afterwards. Needs the core engine (corosim_set_scenario engine: "core"). Build a native lesion or a prosthesis directly with heart.valves.* in corosim_adjust. ${NOT_CLINICAL}`,
    inputSchema: {
      type: "object", required: ["type"],
      properties: {
        type: { enum: ["replace", "tavr", "balloon", "teer", "repair"] },
        valve: { enum: ["av", "mv", "tv", "pv"], description: "Aortic, mitral, tricuspid or pulmonary. Not needed for tavr." },
        kind: { enum: ["bioprosthetic", "mechanical", "transcatheter"], description: "Replace only: the prosthesis." },
        sizeMm: { type: "number", minimum: 19, maximum: 36, description: "Replace or tavr: labelled valve size, mm (a default for the valve and kind if omitted; clamped to the valve's range)." },
        leakCm2: { type: "number", minimum: 0, maximum: 2, description: "Replace or tavr: paravalvular leak, regurgitant orifice cm2 (default none)." },
        effect: { type: "number", minimum: 0, maximum: 1, description: "Balloon: scales the result (default 1; less for a heavily calcified valve)." },
        clips: { type: "integer", minimum: 1, maximum: 4, description: "teer: number of clips (default 2)." },
        runSeconds: { type: "number", minimum: 0, maximum: 300, description: "Simulated seconds to run after the procedure (default 30)." },
      },
    },
    run(ctx, a) {
      const type = String(a.type), valve = String(a.valve ?? (type === "tavr" ? "av" : ""));
      if (!["replace", "tavr", "balloon", "teer", "repair"].includes(type)) throw new Error("type must be replace, tavr, balloon, teer or repair.");
      if (!["av", "mv", "tv", "pv"].includes(valve)) throw new Error("valve must be av, mv, tv or pv.");
      if (type === "replace" && !["bioprosthetic", "mechanical", "transcatheter"].includes(String(a.kind))) throw new Error("replace needs kind: bioprosthetic, mechanical or transcatheter.");
      if (ctx.sim.engine !== "core") throw new Error("Valve interventions need the core engine: call corosim_set_scenario with engine \"core\" first.");
      const opt = (k: string) => (typeof a[k] === "number" && Number.isFinite(a[k]) ? (a[k] as number) : undefined);
      const before = vitalsOf(ctx.sim);
      const iv = { type, valve, kind: a.kind, sizeMm: opt("sizeMm"), leakCm2: opt("leakCm2"), effect: opt("effect"), clips: opt("clips") } as unknown as Intervention;
      const r = intervene(currentPatient(ctx.sim).heart ?? {}, iv);
      if (Object.keys(r.patch).length) { ctx.sim.apply({ heart: r.patch }); patchPatient(ctx.sim, { heart: r.patch }); }
      const rep = runReport(ctx, num(a.runSeconds, 30, 0, 300) || 0.02, "none", 0);
      const done = Object.keys(r.patch).length > 0, warnings = [...r.warnings, ...ctx.sim.warnings];
      return { narrative: narrateValve(done, r.changes, warnings, before, vitalsOf(ctx.sim)), done, changes: r.changes, warnings, heartNow: currentPatient(ctx.sim).heart ?? {}, ...rep };
    },
  },
  {
    name: "corosim_arrest", title: "Cardiac arrest: CPR, shock, drugs, restart", readOnly: false,
    description: `Run a resuscitation on the patient (core engine). Start an arrest for teaching with corosim_adjust { patch: { patient: { rhythm: "vf-coarse" } } } (or "vt-mono" for pulseless VT, "asystole"); the patient is then in cardiac arrest with no flow and a clock running toward irreversible injury and death. Then act with this tool: action cpr (on true or false, optional rate per min, depthCm, quality 0..1: chest compressions give roughly a quarter of normal output and good CPR matters), shock (joules, default 200; sync false to defibrillate VF or pulseless VT, sync true to cardiovert a perfusing tachyarrhythmia; a shock can fail, can be repeated, and an unsynchronized shock on a perfusing rhythm can induce VF), drug (epinephrine 1 mg, amiodarone 300 then 150 mg, lidocaine 100 mg, or dose in mg), restart (after death, or to start the same patient again). Each call runs on (runSeconds, default 10) and returns narrative, ok and note (false with a note when the action cannot be done, e.g. CPR on a patient with a pulse), the arrest block (status none/arrest/rosc/dead, rhythm class, seconds of no flow, irreversible injury, CPR, last shock, drugs), dead, warnings, and the monitor. Without an arrest the same shock, drug and CPR calls are refused with a note. The legacy engine has no arrest: it returns ok false with a note (corosim_set_scenario engine "core"). Show it with corosim_show. ${NOT_CLINICAL}`,
    inputSchema: {
      type: "object", required: ["action"],
      properties: {
        action: { enum: ["cpr", "shock", "drug", "restart"] },
        on: { type: "boolean", description: "cpr: start (true, default) or stop (false) compressions." },
        rate: { type: "number", minimum: 60, maximum: 160, description: "cpr: compressions per minute (guideline 100 to 120)." },
        depthCm: { type: "number", minimum: 2, maximum: 8, description: "cpr: compression depth, cm (guideline 5 to 6)." },
        quality: { type: "number", minimum: 0, maximum: 1, description: "cpr: overall quality 0..1 (recoil, minimal pauses)." },
        joules: { type: "number", minimum: 1, maximum: 360, description: "shock: energy, J (default 200 biphasic)." },
        sync: { type: "boolean", description: "shock: synchronized cardioversion (a perfusing tachyarrhythmia) instead of defibrillation. Default false." },
        drug: { enum: ["epinephrine", "amiodarone", "lidocaine"], description: "drug: which one." },
        dose: { type: "number", minimum: 0, maximum: 1000, description: "drug: mg (a standard dose if omitted)." },
        runSeconds: { type: "number", minimum: 0, maximum: 300, description: "Simulated seconds to run after the action (default 10; restart 10)." },
      },
    },
    run(ctx, a) {
      const { sim } = ctx, action = String(a.action);
      if (!["cpr", "shock", "drug", "restart"].includes(action)) throw new Error("action must be cpr, shock, drug or restart.");
      const opt = (k: string) => (typeof a[k] === "number" && Number.isFinite(a[k]) ? (a[k] as number) : undefined);
      const before = vitalsOf(sim);
      let did = "", ok = true, note: string | undefined, shock: Record<string, unknown> | undefined;
      if (action === "cpr") {
        const on = a.on !== false;
        const r = sim.setCpr({ on, ...(opt("rate") !== undefined ? { rate: opt("rate")! } : {}), ...(opt("depthCm") !== undefined ? { depthCm: opt("depthCm")! } : {}), ...(opt("quality") !== undefined ? { quality: opt("quality")! } : {}) });
        ({ ok, note } = r); did = on ? "chest compressions started" : "chest compressions stopped";
      } else if (action === "shock") {
        const joules = Math.round(num(a.joules, 200, 1, 360)), sync = a.sync === true;
        const r = sim.shock({ joules, sync });
        ok = r.discharged; note = r.note; shock = { joules, sync, discharged: r.discharged, success: r.success, rhythmAfter: r.rhythm };
        did = `a ${joules} J ${sync ? "synchronized " : ""}shock ${r.discharged ? (r.success ? "converted the rhythm" : "did not convert the rhythm") : "was not delivered"}`;
        if (!ok) did = "the shock";
      } else if (action === "drug") {
        const drug = String(a.drug) as ArrestDrug;
        if (!["epinephrine", "amiodarone", "lidocaine"].includes(drug)) throw new Error("drug must be epinephrine, amiodarone or lidocaine.");
        const r = sim.giveDrug(drug, opt("dose"));
        ({ ok, note } = r); did = `${drug}${opt("dose") !== undefined ? ` ${opt("dose")} mg` : ""} given`;
        if (!ok) did = drug;
      } else {
        sim.restartPatient();
        rememberPatient(sim, sim.restartSpec());
        did = "the patient was restarted from the beginning of the same case";
      }
      const secs = ok ? num(a.runSeconds, 10, 0, 300) : 0;
      const rep = runReport(ctx, secs || 0.02, "none", 0);
      const now = vitalsOf(sim), st = sim.state() as unknown as { arrest?: unknown; dead?: boolean };
      const warnings = [...(note && !ok ? [note] : []), ...sim.warnings];
      return { narrative: narrateArrest(did, ok, note, now), ok, ...(note ? { note } : {}), action, ...(shock ? { shock } : {}), arrest: st.arrest ?? null, dead: st.dead === true, ...rep, warnings };
    },
  },
  {
    name: "corosim_describe_case", title: "The case in plain sentences", readOnly: true,
    description: `The current patient as a short case description, the way someone would read it out while building it on the website: the coronary lesions, valve disease and prostheses, rhythm, support devices, pericardium, bleeding and electrolytes, then where the monitor stands now (rhythm and rate, pressure, shock, ischemia and infarct). Returns narrative (one or two sentences) and the list of findings behind it. Does not advance time or change the patient. Every tool that changes the patient (corosim_set_scenario, corosim_adjust, corosim_run, corosim_treat, corosim_valve) also returns a narrative of what changed and why. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run({ sim }) {
      const spec = currentPatient(sim);
      return { narrative: narrateCase(spec, vitalsOf(sim)), findings: [...features(spec).values()].map((f) => (f.why ? { finding: f.text, why: f.why } : { finding: f.text })) };
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
    inputSchema: { type: "object", required: ["scenarios"], properties: { scenarios: { type: "array", minItems: 2, maxItems: 5, items: { type: "object", required: ["label", "scenario"], properties: { label: { type: "string" }, scenario: patientSchema } }, description: "The first entry is the reference." }, seconds: { type: "number", minimum: 30, maximum: 600, description: "Measured seconds after warm-up (default 120)." }, warmupSeconds: { type: "number", minimum: 0, maximum: 300, description: "Default 60." } } },
    run(_ctx, a) {
      const list = (a.scenarios as { label: string; scenario: PatientSpec }[]) ?? [];
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
    description: `Display the patient visually, right here in the chat: an interactive 3D heart (ischemic wall darkened, infarct darker, narrowing marked), a live 12-lead ECG and a bedside monitor with the guideline next steps. Call this whenever the user wants to see, show, view, visualize or look at the patient, the heart or the ECG. Does not advance time. Shows arrest and death on the monitor. The optional display fields choose the camera view (the chat viewer applies the view; the website page has the rest: coloring, heart style, labels, flow, valves, posterior leads). For a rhythm strip or EKG pattern on its own, use corosim_ekg_show instead. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: { display: displaySchema() } },
    run({ sim }, a) {
      const display = a.display && typeof a.display === "object" && !Array.isArray(a.display) ? (a.display as Record<string, unknown>) : undefined;
      return { narrative: narrateCase(currentPatient(sim), vitalsOf(sim)), ...bedside(sim), ...(display ? { display } : {}), shown: "The patient is displayed in the chat. Describe what it shows briefly; do not paste a link." };
    },
  },
  {
    name: "corosim_open_link", title: "Shareable link to this patient", readOnly: true,
    description: "Only when the user explicitly asks for a link or URL (to share, or to open the full website): return a corosim.com address for this patient. To show the patient in the chat, use corosim_show instead.",
    inputSchema: { type: "object", properties: {} },
    run({ sim, appUrl }) {
      return { link: `${appUrl.replace(/\/$/, "")}/#s=${encodePatient(currentPatient(sim))}` };
    },
  },
  {
    name: "corosim_heart_cath", title: "Right- and left-heart catheterization", readOnly: true,
    description: `Cath-lab readings for the current patient (does not advance time or change the patient). RIGHT: RA (mean, a, v), RV (systolic, end-diastolic), PA and wedge pressures; the oximetry run (SVC, IVC, RA, RV, PA saturation) with step-ups by level (atrial >= 7, ventricular >= 5, great vessel >= 5 points); Fick and thermodilution output; Qp, Qs, Qp:Qs, PVR, SVR, TPG, DPG, PAPi, cardiac power output. LEFT: LV, aortic and wedge pressures, aortic peak-to-peak, mean and peak-instantaneous gradients, mitral gradient, Gorlin and Hakki valve areas and the grade (none/mild/moderate/severe), graded against the normal adult valve. Use side to get one half. Build the patient with corosim_set_scenario (heart lesions, shunts); use for hemodynamic profiles, shock phenotypes (low PAPi and RA/PCWP >= 0.8 = RV failure), shunts and valve disease. Output format corosim.heart_cath/1. The first call after a patient change runs a structural solve (about 1 s); later calls are instant. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: { side: { enum: ["both", "right", "left"], description: "Default both." } } },
    run({ sim }, a) { return heartCath(sim, a.side === "right" || a.side === "left" ? a.side : "both"); },
  },
  {
    name: "corosim_jvp", title: "Jugular venous pulse", readOnly: true,
    description: `The jugular venous pulse of the current patient, from one beat of right-atrial pressure: height in cm above the sternal angle (45 degrees), which waves are present (a, c, x, v, y) with their times and heights, whether the a wave is absent or a cannon wave, and the classification in words (raised, giant v, steep or blunted y descent, cannon a, absent a). Use for AF (no a wave), complete heart block (cannon a), tricuspid regurgitation (giant v), tamponade (blunted y) and volume status. Does not advance time. Output format corosim.jvp/1. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run({ sim }) { return jvp(sim); },
  },
  {
    name: "corosim_oxygen", title: "Oxygen saturations and delivery", readOnly: true,
    description: `Oxygen status of the current patient: SpO2, pre- and post-ductal saturation (and the ductal difference), mixed venous (PA) saturation, saturation at every cath site, DO2, VO2 (assumed baseline), extraction ratio, Qp:Qs, lactate (when modelled), the ECMO return saturation when ECMO runs, and plain-language teaching cues (low delivery, high extraction, differential hypoxemia). Does not advance time. Output format corosim.oxygen/1. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run({ sim }) { return oxygen(sim); },
  },
  {
    name: "corosim_loop_metrics", title: "LV pressure-volume loop metrics", readOnly: true,
    description: `Energetics of the last left-ventricular beat: end-diastolic, end-systolic and stroke volume, EF, stroke work (mmHg.ml and J), pressure-volume area, potential energy, efficiency, arterial elastance Ea, end-systolic elastance Ees and Ea/Ees coupling, myocardial oxygen consumption (ml per beat, per minute, per 100 g), cardiac power output (W), peak dP/dt. Use for supply/demand questions (what does an Impella, a vasodilator or a higher afterload do to MVO2 and work). Does not advance time. Output format corosim.loop_metrics/1. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run({ sim }) { return loopMetricsReport(sim); },
  },
  {
    name: "corosim_ekg_list", title: "EKG library", readOnly: true, stateless: true,
    description: `List the simulated 12-lead EKG presets by category: sinus rhythms, atrial fibrillation and flutter, junctional and re-entrant rhythms (SVT, WPW), AV blocks (first degree, Wenckebach, Mobitz II, 2:1, complete), bundle branch and fascicular blocks, ventricular rhythms (PVCs, AIVR, monomorphic and polymorphic VT, torsades, VF, asystole, paced), acute coronary patterns (anterior, inferior, lateral and posterior STEMI, hyperacute T, de Winter, Wellens, NSTEMI, aVR elevation, Sgarbossa) and STEMI mimics (pericarditis, early repolarization, LVH, Brugada, Takotsubo, PE, LV aneurysm, hyperkalemia, hypothermia). Does not touch the patient; the same ids are the rhythms the patient can run (corosim_adjust patch.patient.rhythm). ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run() {
      return { categories: CATEGORIES.map((c) => ({ category: c, presets: PRESETS.filter((p) => p.category === c).map((p) => ({ id: p.id, name: p.name })) })), use: "Show one with corosim_ekg_show { preset: id }; add quiz: true to hide the answer. For anything not listed, build it with corosim_ekg_show { custom: {...} }." };
    },
  },
  {
    name: "corosim_ekg_show", title: "Show any EKG rhythm or 12-lead pattern", readOnly: true, stateless: true, viewer: "ekg",
    description: `Show any heart rhythm or EKG pattern (arrhythmia, block, ischemia, STEMI mimic, electrolyte or drug effect) as a simulated 12-lead right here in the chat. Use this for any request to see, draw, show or practise a rhythm or EKG: torsades, VT, VF, flutter, SVT, heart block, hyperkalemia and so on. It displays the tracing writing itself on paper, and a 3D heart with every lead drawn as an axis through it and the heart's electrical vector moving in real time, so the learner sees why each lead looks as it does. Returns the measurements (rates, PR, QRS, QTc, axis, ST by lead) taken from the waveform, so you can check what was drawn, and the teaching notes. Either name a library preset (an id from corosim_ekg_list or a common name: "afib", "torsades", "de winter", "inferior stemi"), or build any other tracing with custom: a rhythm, its conduction and what the complexes look like by territory (e.g. sinus 110 with LBBB and 3 mm inferior ST elevation; AF at 180 with a delta wave; Wenckebach 3:2 with anterior Q waves), optionally starting from a preset with custom.base. It does not change the patient; the library presets are the same rhythms the patient can run, and the result's applyToPatient says how to put this one on the patient (corosim_adjust patient.rhythm) when its effect on blood pressure or output matters (use corosim_show to see the patient). quiz: true hides the name on screen and returns the answer as answerKey: do not reveal it until the learner has read the tracing and committed. ${NOT_CLINICAL}`,
    inputSchema: {
      type: "object", properties: {
        preset: { type: "string", description: "Preset id or common name. Omit with quiz: true for a random tracing, or use custom instead." },
        custom: {
          type: "object", description: "Build a tracing that is not in the library. Every field optional; anything omitted is a normal adult (or the base preset). Out-of-range values are clamped and listed in warnings.",
          properties: {
            name: { type: "string", description: "What to call it on screen (hidden in quiz mode)." },
            base: { type: "string", description: "Start from this preset and change only what you give." },
            summary: { type: "string" }, teachingPoints: { type: "array", items: { type: "string" }, maxItems: 6 },
            rhythm: {
              type: "object", properties: {
                kind: { enum: ["sinus", "af", "flutter", "svt", "junctional", "mat", "vt", "idioventricular", "paced", "torsades", "vf", "asystole"] },
                rate: { type: "number", description: "bpm: the sinus rate for sinus rhythms (so 2:1 block halves it), else the ventricular rate." },
                prMs: { type: "number" },
                av: { enum: ["normal", "first", "wenckebach", "mobitz2", "2:1", "complete"], description: "AV conduction of a sinus rhythm." },
                dropEvery: { type: "integer", minimum: 2, maximum: 8, description: "P waves per group in Wenckebach or Mobitz II (4 = 4:3)." },
                escape: { enum: ["junctional", "ventricular"], description: "Escape rhythm in complete block." }, escapeRate: { type: "number" },
                pvcEvery: { type: "integer", minimum: 1, maximum: 10, description: "A PVC after every Nth sinus beat (1 = bigeminy, 2 = trigeminy)." },
                pvcOrigin: { enum: ["rvot", "lv"] },
                atrialRate: { type: "number", description: "Flutter rate (~300), or the dissociated sinus rate under VT, pacing or asystole." },
                flutterRatio: { description: "2, 3, 4 or 'variable'." },
                irregularity: { type: "number", minimum: 0, maximum: 0.6, description: "AF R–R spread." },
                vtMorphology: { enum: ["rbbb", "lbbb"] }, polymorphic: { type: "boolean" }, vfAmplitude: { enum: ["coarse", "fine"] },
                sinusArrhythmia: { type: "boolean" }, alternans: { type: "boolean", description: "Electrical alternans." },
              },
            },
            morph: {
              type: "object", properties: {
                bbb: { enum: ["none", "rbbb", "lbbb"] },
                axisDeg: { type: "number", description: "Target frontal QRS axis (−60 for LAFB, +120 for LPFB)." },
                qrsWidthMs: { type: "number" }, qrsVoltage: { type: "number", description: "× normal: 0.4 low voltage, 2 LVH." },
                pAmplitude: { type: "number", description: "× normal; 0 hides P waves." }, pWide: { type: "boolean" },
                tAmplitude: { type: "number", description: "× normal." }, peakedT: { type: "boolean" },
                qtMultiplier: { type: "number", description: "Repolarization time × (1.5 = long QT, 0.8 = short)." },
                st: { type: "array", items: { type: "object", required: ["territory", "mm"], properties: { territory: { enum: TERRITORIES }, mm: { type: "number", description: "+ elevation / − depression in the lead facing the wall; the opposite leads show the reciprocal." }, shape: { enum: ["plateau", "upsloping", "coved"] } } } },
                tInversion: { type: "array", items: { type: "object", required: ["territory", "mm"], properties: { territory: { enum: TERRITORIES }, mm: { type: "number", description: "Depth of the inverted T." } } } },
                qWaves: { type: "array", items: { enum: TERRITORIES }, description: "Pathological Q waves (old infarct) facing these walls." },
                deltaWave: { type: "boolean", description: "Pre-excitation: short PR, slurred upstroke." },
                osbornMm: { type: "number" }, uWaveMm: { type: "number" }, prDepressionMm: { type: "number" }, tremor: { type: "boolean" },
              },
            },
            lesions: { ...scenarioSchema.properties.lesions, description: "Coronary lesions run through the simulator's coronary model for a physiological ST pattern (and the 3D heart shows the ischemic wall)." },
            exertion: { type: "boolean", description: "With a stenosis: demand (subendocardial) ischemia." },
          },
        },
        quiz: { type: "boolean", description: "Hide the answer on screen; the result's answerKey is for you, not to be read out before the learner commits." },
        rate: { type: "number", minimum: 20, maximum: 240, description: "Override the rate (bpm) of a preset (sinus, AF ventricular response, junctional, SVT, VT, paced)." },
        lead: { type: "string", description: "Lead to highlight first, e.g. 'V2' or 'aVR'." },
      },
    },
    run({ appUrl }, a) {
      const quiz = a.quiz === true, root = appUrl.replace(/\/$/, "").replace(/\/sim$/, ""); // appUrl is the simulator page; /ekg/ sits beside it
      let p: EkgPreset | undefined, warnings: string[] = [], custom: CustomEkg | undefined;
      if (a.custom && typeof a.custom === "object") {
        custom = a.custom as CustomEkg;
        ({ preset: p, warnings } = buildCustom(custom));
      } else {
        p = typeof a.preset === "string" && a.preset ? findPreset(a.preset) : undefined;
        if (!p && typeof a.preset === "string" && a.preset) throw new Error(`No EKG preset matches "${a.preset}". Call corosim_ekg_list for the ids, or describe it with custom.`);
        if (!p) { if (!quiz) throw new Error("Give a preset (see corosim_ekg_list), custom for anything else, or quiz: true for a random one."); p = PRESETS[Math.floor(Math.random() * PRESETS.length)]; }
      }
      let spec: EkgSpec = resolveSpec(p);
      const rate = !custom && typeof a.rate === "number" && Number.isFinite(a.rate) && "rate" in spec.rhythm && spec.rhythm.kind !== "torsades" ? Math.min(240, Math.max(20, Math.round(a.rate))) : undefined;
      if (rate) spec = { ...spec, rhythm: { ...spec.rhythm, rate } as EkgSpec["rhythm"] };
      const m = measure(spec);
      const tracing = {
        name: p.name, category: custom ? "Custom" : p.category, summary: p.summary,
        measurements: { ventricularRateBpm: m.ventricularRate, atrialRate: m.atrialRate, regular: m.regular, prMs: m.prMs, pr: m.prPattern, qrsMs: m.qrsMs, qtcMs: m.qtcMs, axisDeg: m.axisDeg, stMm: m.stMm, stElevation: m.stElevation, stDepression: m.stDepression, meetsStemiCriteria: m.meetsStemiCriteria },
        lookFor: p.features, teachingPoints: p.pearls, alsoLooksLike: p.mimics ?? [], next: p.next ?? null, leadsToLookAt: p.leads ?? [],
        model: p.coronary ? "ST vector from the simulator's coronary model (this lesion, settled)." : custom ? "Built from your description on the dipole model; check the measurements against what you intended." : "Dipole model; morphology set for this pattern.",
      };
      const lead = typeof a.lead === "string" ? a.lead : undefined;
      return {
        ekg: { preset: p.id, custom, quiz, rate, lead }, // what the in-chat EKG viewer draws
        ...(warnings.length ? { warnings } : {}),
        shown: quiz
          ? "A simulated 12-lead is displayed with its name hidden. Ask the learner to read it in order (rate, rhythm, axis, intervals, P/QRS/ST/T) and commit to an answer before revealing answerKey."
          : "The 12-lead and the 3D lead view are displayed in the chat. Describe what to notice briefly; do not paste a link.",
        ...(quiz ? { answerKey: tracing } : { tracing }),
        ...(!custom && simRhythmId(p.id) ? { applyToPatient: { offer: `To see what ${p.name} does to the patient's blood pressure and output, apply it to the patient.`, tool: "corosim_adjust", args: { patch: { patient: { rhythm: simRhythmId(p.id) } } } } } : {}),
        link: custom ? `${root}/ekg/#c=${encodeCustom(custom)}` : `${root}/ekg/#p=${p.id}`,
      };
    },
  },
];

/** OpenAI function-calling format. */
export const openAiTools = () => TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
/** Anthropic Messages API tool format. */
export const anthropicTools = () => TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
export { normalizeScenario };
