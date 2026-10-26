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
        epinephrine: { type: "number", minimum: 0, maximum: 1, description: "Core engine only." }, milrinone: { type: "number", minimum: 0, maximum: 1, description: "Core engine only." }, vasopressin: { type: "number", minimum: 0, maximum: 1, description: "Core engine only." },
        nitroprusside: { type: "number", minimum: 0, maximum: 1, description: "Core engine only." }, furosemide: { type: "number", minimum: 0, maximum: 1, description: "Core engine only." },
        pacing: { type: "boolean" }, paceRate: { type: "number", minimum: 40, maximum: 120 },
        iabp: { type: "boolean", description: "Intra-aortic balloon pump." }, impella: { type: "boolean", description: "Microaxial left-ventricular pump." },
      },
    },
    seed: { type: "integer", description: "Random seed. The same scenario and seed reproduce the same beats." },
  },
} as const;

const numP = (min: number, max: number, description?: string) => ({ type: "number", minimum: min, maximum: max, ...(description ? { description } : {}) });
/** The Scenario schema plus the PatientSpec fields (src/sim/patient.ts). The core engine reads `devices` (Impella model, P-level and position; IABP ratio, timing offsets and volume); the legacy engine ignores it and keeps the on/off toggles. */
const patientSchema = {
  ...scenarioSchema,
  description: "Patient and intervention description (a Scenario plus kind, heart, pericardium, septum, fluids, ventilation and devices). Every field optional; omitted fields keep the typical resting adult. The additional fields are accepted and validated. `kind` and `heart` shape the readings of corosim_heart_cath, corosim_jvp, corosim_oxygen and corosim_loop_metrics (the monitor, ECG and coronary physiology stay the adult ACS model); `devices` is read by the core engine only (P-level, IABP ratio and timing; the legacy engine ignores it).",
  properties: {
    ...scenarioSchema.properties,
    kind: { enum: ["adult", "neonate"], description: "Baseline physiology. Neonates have no coronary view." },
    heart: { type: "object", description: "Structural lesions as in the structural page: valves {av|mv|tv|pv: {open 0..1, reg 0..10}}, pda|asd|vsd|bt {diameterMm 0..40}, tof, pvri, svrScale, satLung, volumeMl, lvSize|laSize|rvSize|raSize, rvContractility. See the reference for ranges." },
    pericardium: { type: "object", properties: { effusionMl: numP(0, 2000), effusionRateMlMin: numP(0, 100), stiffness: numP(0.2, 10, "1 normal, > 1 constrictive"), open: { type: "boolean", description: "Pericardium opened (post cardiac surgery)." }, drainMl: numP(0, 2000, "Pericardiocentesis, an action for corosim_adjust: ml of effusion to remove now (50-100 ml relieves a tamponade); it is subtracted from the effusion and never stored.") } },
    septum: { type: "boolean", description: "Ventricular interdependence through the septum (core engine): a failing right ventricle bows the septum into the left. Switch it on for RV infarct and tamponade." },
    fluids: { type: "object", properties: { given: { type: "array", maxItems: 20, items: { type: "object", required: ["kind", "ml"], properties: { kind: { enum: ["crystalloid", "colloid", "albumin", "blood"] }, ml: numP(0, 5000), atMin: numP(0, 1440), overMin: numP(0, 1440) } } }, hemorrhageMlMin: numP(0, 500), capillaryLeak: numP(0, 1), legRaise: { type: "boolean" } } },
    ventilation: { type: "object", properties: { mode: { enum: ["spontaneous", "positive"] }, peep: numP(0, 25, "cmH2O"), tidalMlKg: numP(2, 15) } },
    devices: {
      type: "object", description: "Mechanical support with settings. support.iabp / support.impella (true) mean the defaults: IABP 1:1 at correct timing, 40 ml; Impella CP at P6, correct position.",
      properties: {
        impella: { type: "object", properties: { model: { enum: ["2.5", "CP", "5.5"] }, level: numP(0, 9, "P-level"), position: { enum: ["correct", "aortic", "deep"] } } },
        impellaRp: { type: "object", properties: { level: numP(0, 9) } },
        iabp: { type: "object", properties: { ratio: { enum: [1, 2, 3] }, inflateMs: numP(-100, 100), deflateMs: numP(-100, 100), volumeMl: numP(0, 50) } },
        ecmo: { type: "object", properties: { flowLpm: numP(0, 7), sweepLpm: numP(0, 10), fio2: numP(0.21, 1) } },
      },
    },
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

/** What a clinician at the bedside would have: monitor, 12-lead ECG, and where the guidelines stand. */
function bedside(sim: Simulation) {
  const a = sim.assessment();
  return {
    scenario: sim.scenario(), // also what the in-chat viewer replays
    state: sim.state(),
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
    description: `Return the Scenario JSON schema, valid artery ids for the current anatomy, units and what every knob does. Call this first when you are asked to build a patient. Not for showing a rhythm or EKG pattern (AF, flutter, SVT, blocks, VT, torsades, VF, STEMI mimics, electrolytes): use corosim_ekg_show, which draws any of them. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run({ sim }) {
      return {
        reference: SCENARIO_REFERENCE, schema: patientSchema,
        ekg: "The patient makes only the rhythms its coronary physiology causes (ischemic ST change, PVCs, AV block, AF if given). To show or teach any other rhythm or 12-lead pattern (flutter, SVT, WPW, VT, polymorphic VT, torsades, VF, long QT, hyperkalemia, Brugada, pericarditis, de Winter, Wellens...), call corosim_ekg_show (a preset, or custom for anything else): it does not touch this patient.",
        arteriesInCurrentAnatomy: buildTree(sim.n.anatomy).segments.map((s) => ({ id: s.id, name: s.name, supplies: `${(s.subMass * 100).toFixed(0)}% of myocardium` })),
        referenceAdult: { hr: 72, strokeVolumeMl: 70, mapMmHg: 90, bp: "120/72" },
        howItWorks: "Pressure of each beat is sensed by baroreceptors; a fast vagal arm (~0.6 s) and a slow sympathetic arm (~2 s) change heart rate, contractility and resistance. Respiration gates vagal tone (RSA). Noise in tone makes every beat different. Coronary lesions cause ischemia over ~20 s, which causes AV block, ectopy and pump failure; pressure then feeds back on coronary perfusion.",
      };
    },
  },
  {
    name: "corosim_set_scenario", title: "Build a patient", readOnly: false,
    description: `Replace the current patient with this scenario, then run a warm-up so the reflexes have settled. Returns the monitor, the 12-lead ECG, the guideline assessment and a grounded explanation, plus warnings listing anything that was clamped or dropped (read them: they tell you what actually ran). Use settled=false to watch an occlusion develop from a healthy start. The warm-up does not advance the infarct clock; corosim_run and corosim_adjust do (2 clinical minutes per simulated second), so a closed artery loses muscle as you run it. Not for showing a rhythm or EKG pattern (AF, flutter, SVT, blocks, VT, torsades, VF, STEMI mimics, electrolytes): use corosim_ekg_show, which draws any of them. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: { scenario: patientSchema, engine: { enum: ["legacy", "core"], description: "Hemodynamic engine for this patient. Omit to keep the current one (a new server starts on legacy). 'core' is the beat-by-beat engine and adds the Impella and IABP consoles (devices) to every report; slower." }, settled: { type: "boolean", description: "Start with ischemia already at its steady value (default true). False = ischemia develops over ~20 s." }, warmupSeconds: { type: "number", minimum: 0, maximum: 300, description: "Simulated seconds to run before returning (default 45)." } } },
    run({ sim }, a) {
      if (a.engine !== undefined && a.engine !== "legacy" && a.engine !== "core") throw new Error("engine must be legacy or core.");
      if (a.engine) sim.engine = a.engine as "legacy" | "core"; // takes effect at the reset below
      sim.reset((a.scenario ?? {}) as PatientSpec, { settled: a.settled !== false });
      rememberPatient(sim, (a.scenario ?? {}) as PatientSpec);
      sim.warmup(num(a.warmupSeconds, 45, 0, 300));
      return { warnings: sim.warnings, ...bedside(sim), explanation: explain(sim) };
    },
  },
  {
    name: "corosim_adjust", title: "Change the patient while it runs", readOnly: false,
    description: `Apply a change to the running patient (give a drug, start a hemorrhage, occlude an artery) and optionally run on to watch the response. Fields you leave out are unchanged; drug and volume changes ramp in over ~10 s like a real bolus. Returns the response time course. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", required: ["patch"], properties: { patch: patientSchema, runSeconds: { type: "number", minimum: 0, maximum: 600, description: "Simulated seconds to run after the change (default 60)." } } },
    run(ctx, a) {
      ctx.sim.apply((a.patch ?? {}) as PatientSpec);
      patchPatient(ctx.sim, (a.patch ?? {}) as PatientSpec);
      const rep = runReport(ctx, num(a.runSeconds, 60, 0, 600), "none", 0);
      return { applied: currentPatient(ctx.sim), ...rep };
    },
  },
  {
    name: "corosim_run", title: "Advance the simulation", readOnly: false,
    description: `Run the current patient forward (the infarct clock runs: 2 clinical minutes per second) and return rate, pressures, stroke volume and ectopy, a time course, the monitor, ECG and guideline assessment at the end, and optionally the individual beats. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: { seconds: { type: "number", minimum: 1, maximum: 900, description: "Simulated seconds (default 60)." }, beats: { enum: ["none", "all"], description: "'all' adds a beat-by-beat table (decimated to maxBeats)." }, maxBeats: { type: "integer", minimum: 5, maximum: 500, description: "Row cap for the beat table (default 120)." }, autonomic: { type: "boolean", description: "Also return heart-rate variability and baroreflex-sensitivity statistics. Only for autonomic-physiology questions." } } },
    run(ctx, a) { return runReport(ctx, num(a.seconds, 60, 1, 900), a.beats === "all" ? "all" : "none", Math.trunc(num(a.maxBeats, 120, 5, 500)), a.autonomic === true); },
  },
  {
    name: "corosim_get_state", title: "Current hemodynamic state", readOnly: true,
    description: `The patient right now, as at the bedside: monitor (10 s rolling vitals), 12-lead ECG ST levels by lead, rhythm, ventricle and infarct size, support running, ischemic beds, FFR, and the guideline assessment (problems, anything harmful being done, next steps in order). Does not advance time. Read this first. ${NOT_CLINICAL}`,
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
    description: `Display the patient visually, right here in the chat: an interactive 3D heart (ischemic wall darkened, infarct darker, narrowing marked), a live 12-lead ECG and a bedside monitor with the guideline next steps. Call this whenever the user wants to see, show, view, visualize or look at the patient, the heart or the ECG. Does not advance time. For a rhythm strip or EKG pattern on its own, use corosim_ekg_show instead. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run({ sim }) { return { ...bedside(sim), shown: "The patient is displayed in the chat. Describe what it shows briefly; do not paste a link." }; },
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
    description: `Cath-lab readings for the current patient (does not advance time or change the patient). RIGHT: RA (mean, a, v), RV (systolic, end-diastolic), PA and wedge pressures; the oximetry run (SVC, IVC, RA, RV, PA saturation) with step-ups by level (atrial >= 7, ventricular >= 5, great vessel >= 5 points); Fick and thermodilution output; Qp, Qs, Qp:Qs, PVR, SVR, TPG, DPG, PAPi, cardiac power output. LEFT: LV, aortic and wedge pressures, aortic peak-to-peak, mean and peak-instantaneous gradients, mitral gradient, Gorlin and Hakki valve areas and the grade (none/mild/moderate/severe), graded against the normal valve of the patient's kind (a neonate's 0.5 cm2 aortic valve is normal, not severe). Use side to get one half. Build the patient with corosim_set_scenario (heart lesions, shunts, kind: neonate); use for hemodynamic profiles, shock phenotypes (low PAPi and RA/PCWP >= 0.8 = RV failure), shunts and valve disease. Output format corosim.heart_cath/1. The first call after a patient change runs a structural solve (about 1 s); later calls are instant. ${NOT_CLINICAL}`,
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
    description: `List the simulated 12-lead EKG presets by category: sinus rhythms, atrial fibrillation and flutter, junctional and re-entrant rhythms (SVT, WPW), AV blocks (first degree, Wenckebach, Mobitz II, 2:1, complete), bundle branch and fascicular blocks, ventricular rhythms (PVCs, AIVR, monomorphic and polymorphic VT, torsades, VF, asystole, paced), acute coronary patterns (anterior, inferior, lateral and posterior STEMI, hyperacute T, de Winter, Wellens, NSTEMI, aVR elevation, Sgarbossa) and STEMI mimics (pericarditis, early repolarization, LVH, Brugada, Takotsubo, PE, LV aneurysm, hyperkalemia, hypothermia). Does not touch the patient. ${NOT_CLINICAL}`,
    inputSchema: { type: "object", properties: {} },
    run() {
      return { categories: CATEGORIES.map((c) => ({ category: c, presets: PRESETS.filter((p) => p.category === c).map((p) => ({ id: p.id, name: p.name })) })), use: "Show one with corosim_ekg_show { preset: id }; add quiz: true to hide the answer. For anything not listed, build it with corosim_ekg_show { custom: {...} }." };
    },
  },
  {
    name: "corosim_ekg_show", title: "Show any EKG rhythm or 12-lead pattern", readOnly: true, stateless: true, viewer: "ekg",
    description: `Show any heart rhythm or EKG pattern (arrhythmia, block, ischemia, STEMI mimic, electrolyte or drug effect) as a simulated 12-lead right here in the chat. Use this for any request to see, draw, show or practise a rhythm or EKG: torsades, VT, VF, flutter, SVT, heart block, hyperkalemia and so on. It displays the tracing writing itself on paper, and a 3D heart with every lead drawn as an axis through it and the heart's electrical vector moving in real time, so the learner sees why each lead looks as it does. Returns the measurements (rates, PR, QRS, QTc, axis, ST by lead) taken from the waveform, so you can check what was drawn, and the teaching notes. Either name a library preset (an id from corosim_ekg_list or a common name: "afib", "torsades", "de winter", "inferior stemi"), or build any other tracing with custom: a rhythm, its conduction and what the complexes look like by territory (e.g. sinus 110 with LBBB and 3 mm inferior ST elevation; AF at 180 with a delta wave; Wenckebach 3:2 with anterior Q waves), optionally starting from a preset with custom.base. It does not change the patient (use corosim_show for that). quiz: true hides the name on screen and returns the answer as answerKey: do not reveal it until the learner has read the tracing and committed. ${NOT_CLINICAL}`,
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
