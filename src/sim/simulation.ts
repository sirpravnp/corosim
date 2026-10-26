import { buildTree, Tree } from "../anatomy/tree";
import { Lesion, Graft, analyze, solveNetwork, Analysis } from "../physics/network";
import { FLOW } from "../config/tree";
import { ST, LEADS, ALL_LEADS, LeadName } from "../config/ecg";
import { stLevelVec, Beat } from "../physics/ecg";
import { assess, Assessment } from "../physics/advice";
import { Treated, untreated, applyProcedure } from "../physics/revasc";
import { MMHG } from "../config/anatomy";
import { INFARCT, SUPPORT, PROCEDURE, Procedure } from "../config/management";
import { stepSeverity } from "../physics/ischemia";
import { stepNecrosis, lvInfarctSize } from "../physics/infarct";
import { BedSite, bedSites, ischemicBurden, globalSeverity, injuryVector, transmurality, meetsStElevation } from "../physics/ecgLink";
import { rhythmState, RhythmState, SinusModulation, Patient } from "../physics/rhythm";
import { circulation, Circulation, CIRC } from "../physics/circulation";
import { Support, supportedRhythm } from "../physics/support";
import { Drugs, DrugDoses, DrugEffects } from "../physics/core/drugs";
import type { DrugName } from "../config/drugs";
import { BeatStream } from "../physics/beatStream";
import { BeatHemodynamics } from "../physics/beatHemo";
import { Autonomic, AUTONOMIC, AutonomicEffects } from "../physics/autonomic";
import { LiveHeart, LiveBeat, endDiastolicBeats } from "../physics/core/live";
import { Iabp } from "../physics/core/devices/iabp";
import { CoronaryCoupling, BeatSupply, supplyIndex } from "../physics/core/coronary";
import { COUPLING } from "../config/coronary";
import { ImpellaConsole } from "../physics/core/devices/impella";
import { ImpellaRp } from "../physics/core/devices/impellaRp";
import { Ecmo } from "../physics/core/devices/ecmo";
import type { Pericardium } from "../physics/core/pericardium";
import { Thorax } from "../physics/core/thorax";
import type { FromModelOptions } from "../physics/core/fromModel";
import { THORAX } from "../config/thorax";
import { alternansAmplitude } from "../config/pericardium";
import { IABP } from "../config/devices";
import { SwitchableImpella, DevicesReadout } from "./coreDevices";
import { PatientSpec, DeviceSpec, HeartSpec, PericardiumSpec, FluidSpec, VentilationSpec, normalizePatient, effectiveDevices, DEFAULT_IMPELLA, DEFAULT_IABP } from "./patient";
import { VolumeExchange } from "../physics/core/volume";
import { FluidCompartments, FluidReadout } from "../physics/core/fluids";
import { FLUIDS } from "../config/fluids";
import { Compliance } from "../physics/core/vessels";
import { NODES } from "../physics/structuralGraph";
import type { Model } from "../physics/structural";
import { PATIENTS } from "../config/structural";
import { ACS_CORE, AUTONOMIC_CORE } from "../config/acsCore";
import { ischemiaFactors } from "../config/ischemia";
import { Normalized, Scenario, normalizeScenario, toScenario, supportSpec } from "./scenario";
import { BeatRecord, computeMetrics, Metrics } from "./metrics";

/** Drug and volume changes ramp in over seconds instead of stepping, so interventions play out as transients. */
const DRUG_TAU = 8, VOLUME_TAU = 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const WARM_CHUNK = 12 * 0.02; // s of reflex warm-up between yields of a deferred build: whole sub-steps (Simulation.DT), so the chunking does not change the numbers
const MAX_HISTORY = 20000; // beats kept for metrics (~3 h at 70 bpm)

/** Which hemodynamic engine runs the circulation: today's algebraic `circulation()` + `BeatHemodynamics`, or the core engine's `LiveHeart` (A7). */
export type EngineKind = "legacy" | "core";
const NODE = (name: string) => NODES.indexOf(name as (typeof NODES)[number]);
const NEUTRAL_FX: AutonomicEffects = { sympathetic: AUTONOMIC.restSympathetic, vagal: AUTONOMIC.restVagal, hrScale: 1, contractility: 1, resistance: 1, preloadResp: 1, vascular: AUTONOMIC.restSympathetic, afferent: 0, respPhase: 0 };
/** Ventricular rate the rhythm implies, bpm (the warm-up rate of the live heart; atrial fibrillation conducts at its own rate). */
const ventRate = (r: RhythmState) => (r.avDegree === 3 ? r.escapeRate : r.rhythm === "af" ? r.afRate : r.avDegree === 2 ? r.sinusRate * 0.75 : r.sinusRate);

/**
 * The whole model with no DOM and no renderer: anatomy → coronary network → ischemia and infarction → rhythm →
 * circulation (with the team's support) → beats → pressure → baroreflex → back into rate, contractility and
 * resistance. The browser app, the MCP server and the tests all step this one object, so they cannot disagree.
 *
 * Time advances in fixed sub-steps of at most `DT` seconds. Everything random is seeded.
 */
export class Simulation {
  static readonly DT = 0.02;
  static readonly LOOKAHEAD = 0.5; // s; the ECG needs the P wave before the R wave. Autonomic delays account for it.

  n!: Normalized["scenario"];
  warnings: string[] = [];
  tree!: Tree;
  sites: BedSite[] = [];
  analysis!: Analysis;
  sev: Record<string, number> = {}; // per-bed ischemia 0..1 (cleared in place, so callers may hold the reference)
  scar: Record<string, number> = {}; // per-bed irreversible injury 0..1
  target: Record<string, number> = {};
  /** Per bed, how far through the wall its ischemia reaches (0 subendocardial … 1 transmural), from supply/demand. */
  transmural: Record<string, number> = {};
  t = 0;
  /** Accelerates the slow processes (ischemia kinetics, drug and volume ramps) without touching the heartbeat clock. */
  speed = 1;
  /** Clinical minutes of infarct evolution per simulated second at speed 1. */
  minutesPerSecond = INFARCT.minutesPerSecond;
  clinicalMinutes = 0;
  /** Clinical minutes during which some myocardium was ischemic (what the guidelines' clock counts). */
  ischemicMinutes = 0;
  /** What has been done to the culprit artery. */
  treated: Treated = untreated();
  /** Live inputs. The app's controls write these directly; `apply()` sets them from a scenario. */
  support!: Support;
  patient!: Patient;
  grafts: Graft[] = [];
  stream!: BeatStream;
  beatHemo = new BeatHemodynamics();
  autonomic!: Autonomic;
  rstate!: RhythmState;
  circ!: Circulation;
  /** Smoothed mean arterial pressure (mmHg) from the beats. */
  map = CIRC.baseMap;
  /** Smoothed coronary driving pressure: MAP plus any balloon-pump diastolic augmentation. */
  perfusion = CIRC.baseMap;
  private solvedPerfusion = CIRC.baseMap;
  private solvedDemand = 1;
  private mapClock = 0;
  history: BeatRecord[] = [];
  private beatCount = 0;
  // current (slewed) drug and volume levels
  private drug = { betaBlocker: 0, atropine: 0, vasopressor: 0 };
  /** Receptor-level drugs of the core engine (E4): effect-site levels in clinical minutes. The legacy engine slews `drug` and reads `SUPPORT`. */
  private pk = new Drugs();
  private bloodLoss = 0;
  private mod: SinusModulation;
  /** Called with each new ventricular beat (UI hooks, tests). */
  onBeat?: (b: BeatRecord) => void;

  /**
   * Which engine computes the circulation. "legacy" (default) is `circulation()` + `BeatHemodynamics`, untouched. "core" runs the
   * ACS patient on the core engine (`LiveHeart`), see the section "Core engine" below. Takes effect at the next `reset()`.
   */
  engine: EngineKind;
  /** The live heart of the core engine (undefined with "legacy"). */
  live?: LiveHeart;
  /** Simulation clock minus stream time of the live heart (live time = `t` + delta); NaN until the first beat has aligned them (core engine). A source reading the live heart maps its stream times to the simulation clock with it. */
  get liveDelta(): number { return this.delta; }
  // ---- core engine state
  private impella?: SwitchableImpella;
  private iabp?: Iabp;
  private impConsole?: ImpellaConsole;
  private rp?: ImpellaRp;
  private rpConsole?: ImpellaConsole;
  private ecmo?: Ecmo;
  /** Devices the patient has (core engine): settings of the real Impella and IABP, ECMO and Impella RP, from the spec (booleans mean the defaults). */
  private devSpec: DeviceSpec = {};
  // ---- the PatientSpec fields the core engine builds (task P16), see `setPatient`
  private heartSpec: HeartSpec = {};
  private periSpec?: PericardiumSpec;
  private ventSpec?: VentilationSpec;
  private builtSig = "";
  private septumSpec = false;
  private hasSac = false; private hasThorax = false; private hasSeptum = false; // what the live heart was built with
  private appliedEffusion = NaN; // the spec's effusion as last handed to a running sac
  /** The kind of the PatientSpec the core engine was given. It runs the adult ACS patient whatever the kind: a neonate's structural fields are not applied to it (the bridge solves a neonate on its own baseline). */
  patientKind: "adult" | "neonate" = "adult";
  /** Why the core engine runs a plain adult instead of the patient specified (its structural fields would not settle); "" when it runs the patient as specified. Pages fall back to the bridge when this is set. */
  coreNote = "";
  /** Per-beat aortic measurements of the diastole (valve closed) and the IABP console numbers, see `onDiastoleSample` / `handleLiveBeat`. */
  private dia = { t: NaN, aoT: 0, aoSum: 0, dT: 0, dSum: 0, peak: -Infinity, sys: -Infinity, closed: false, opened: false, balloon: 0, fill: 0 };
  /** Coronary coupling of the core engine (E2): the per-beat driving pressures of the subendocardium and subepicardium from the aortic and LV pressure traces. */
  private cor = new CoronaryCoupling();
  private dx = { rho: NaN, aug: 0, peak: 0, mean: 0, sys: 0, balloon: 0 };
  private exchange?: VolumeExchange;
  private bv0 = 4900;
  private volApplied = 0; // ml added (+) or removed (-) from the circulation so far, by fluids and hemorrhage
  private fluidGiven = 0; // litres of fluid, ramped
  /** The fluid compartments of the core engine (C2); undefined with the legacy engine. They decide the blood volume the circulation holds. */
  private fluidModel?: FluidCompartments;
  private fluidSpec: FluidSpec = {};
  private fluidP: { pa: number; pv: number; pcwp: number; pap: number } | null = null; // smoothed mean aortic and venous pressure the compartments read
  private delta = NaN; // s: live time = stream time + delta, set when the first beat is aligned
  private fed = new WeakSet<Beat>();
  private fx: AutonomicEffects = NEUTRAL_FX;
  private fxQueue: AutonomicEffects[] = [];
  private liveSeen = false;
  private sm = { sv: 0, co: 0, ef: 0, pcwp: 0, cvp: 0, sbp: 0, dbp: 0, dev: 0 };
  private base!: Circulation; // circulation() of the legacy model: the fractions and demand the core circ borrows

  constructor(input: Scenario = {}, opts: { engine?: EngineKind; deferCore?: boolean } = {}) {
    this.engine = opts.engine ?? "legacy";
    this.defer = !!opts.deferCore;
    this.mod = {
      rate: (t) => (this.paced() ? 1 : this.autonomic.hrScaleAt(t)),
      jitter: () => (this.paced() ? 0 : this.autonomic.jitter()),
    };
    this.reset(input);
  }

  /** Start over from a scenario. `settled` puts ischemia at its steady value instead of starting from a normal heart. */
  reset(input: PatientSpec = {}, opts: { settled?: boolean; warmup?: number } = {}) {
    const { scenario, warnings } = normalizeScenario(input);
    this.job = null; this.building = null; this.jobWarm = 0;
    this.live = undefined; this.fluidModel = undefined; this.liveSeen = false;
    this.n = scenario; this.warnings = warnings;
    this.support = { ...scenario.support }; this.patient = { ...scenario.patient }; this.grafts = [];
    if (this.engine === "core") { this.readPatient(input); this.fluidSpec = normalizePatient(input).spec.fluids ?? {}; }
    this.t = 0; this.clinicalMinutes = 0; this.ischemicMinutes = 0; this.treated = untreated(); this.history = []; this.beatCount = 0;
    for (const k of Object.keys(this.sev)) delete this.sev[k];
    for (const k of Object.keys(this.scar)) delete this.scar[k];
    this.map = this.perfusion = this.solvedPerfusion = CIRC.baseMap; this.solvedDemand = 1; this.mapClock = 0;
    this.drug = { ...scenario.drugs }; this.bloodLoss = scenario.bloodLoss;
    this.pk.set(this.drugDoses()); // a drug in the scenario is already running
    if (this.engine === "legacy") for (const [k, v] of [["epinephrine", this.support.epi], ["milrinone", this.support.milrinone], ["vasopressin", this.support.vasopressin], ["nitroprusside", this.support.nitroprusside], ["furosemide", this.support.furosemide]] as const)
      if (v > 0) this.warnings = [...this.warnings, `support.${k} is modelled on the core engine only; the legacy engine ignores it.`];
    this.stream = new BeatStream(scenario.seed, Simulation.LOOKAHEAD, 0.05);
    this.beatHemo = new BeatHemodynamics();
    this.autonomic = new Autonomic(scenario.seed, this.engine === "core" ? { ...AUTONOMIC, ...AUTONOMIC_CORE } : AUTONOMIC);
    this.autonomic.controls = { ...scenario.autonomic };
    this.rebuildAnatomy();
    this.updateCirculation();
    if (opts.settled) { Object.assign(this.sev, this.target); this.updateCirculation(); }
    if (this.engine === "core") this.initCore(opts.warmup ?? 0);
  }

  /**
   * The PatientSpec fields the core engine reads (task P16), from a spec. Devices: `effectiveDevices` folds the legacy booleans into
   * the defaults (Impella CP, P6, correct position; IABP 1:1, correct timing, 40 ml); a `devices.impella` / `devices.iabp` also
   * switches that device on; `devices.ecmo` / `devices.impellaRp` are on by being present. Structural heart, pericardium and
   * ventilation are built into the heart (`initCore`); the core runs the adult ACS patient, so for `kind: "neonate"` they are left
   * out (the bridge solves a neonate on its own baseline).
   */
  private readPatient(input: PatientSpec) {
    const np = normalizePatient(input).spec, adult = (np.kind ?? "adult") === "adult";
    const d = effectiveDevices({ support: input.support, devices: np.devices });
    this.devSpec = { impella: d.impella && { ...d.impella }, iabp: d.iabp && { ...d.iabp }, ecmo: d.ecmo && { ...d.ecmo }, impellaRp: d.impellaRp && { ...d.impellaRp } };
    if (d.impella) this.support.impella = true;
    if (d.iabp) this.support.iabp = true;
    this.patientKind = np.kind ?? "adult";
    this.heartSpec = adult && np.heart ? JSON.parse(JSON.stringify(np.heart)) : {};
    this.periSpec = adult && np.pericardium ? { ...np.pericardium } : undefined;
    if (this.periSpec) { delete this.periSpec.drainMl; if (!Object.keys(this.periSpec).length) this.periSpec = undefined; } // an action, not a state: a spec in force never carries it
    this.septumSpec = adult && !!np.septum;
    this.ventSpec = adult && np.ventilation ? { ...np.ventilation } : undefined;
  }

  /**
   * Change the patient's PatientSpec fields while it runs (core engine only; a no-op with the legacy engine). What the heart is built
   * from is rebuilt and settled again (a short pause, about a third of a second, the state of the ACS loop carries over): the structural
   * heart, the presence of a pericardial sac, of the thorax (any `ventilation`), of ECMO or an Impella RP, and
   * the Impella's model and position. Everything else is applied between steps without a rebuild: pericardium effusion, stiffness and
   * `open`; ventilation mode, PEEP and tidal volume; Impella P-level; IABP ratio, timing and volume; ECMO flow, sweep and FiO2; Impella RP
   * level. Calling it with the spec already in force does nothing, so a page may call it on every edit (and should debounce slider drags).
   * The Scenario part of the spec (lesions, rhythm, drugs) is not read here: `apply` / `reset` take that.
   */
  setPatient(spec: PatientSpec) {
    if (this.engine !== "core") return;
    this.readPatient(spec);
    this.patchFluids(spec);
    if (this.structureSig(true) !== this.builtSig) this.initCore();
    else this.pushPatient();
  }

  /** A patch of `heart`, `pericardium`, `septum`, `ventilation` or `kind` merged into the patient in force (objects field by field, anything else replaced), as `apply` takes it. */
  private patchStructure(patch: PatientSpec) {
    const merge = (base: unknown, add: unknown): unknown => {
      if (!add || typeof add !== "object" || Array.isArray(add) || !base || typeof base !== "object" || Array.isArray(base)) return add;
      const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
      for (const [k, v] of Object.entries(add)) out[k] = v === undefined ? out[k] : merge(out[k], v);
      return out;
    };
    const kind = patch.kind ?? this.patientKind, adult = kind === "adult", cur = { heart: this.heartSpec, pericardium: this.periSpec, ventilation: this.ventSpec };
    const np = normalizePatient({ kind, heart: merge(cur.heart, patch.heart) as HeartSpec, pericardium: merge(cur.pericardium, patch.pericardium) as PericardiumSpec, septum: patch.septum ?? this.septumSpec, ventilation: merge(cur.ventilation, patch.ventilation) as VentilationSpec }).spec;
    // pericardiocentesis: `drainMl` comes off the effusion in force (the sac's, which includes what has accumulated since the spec was set), then it is forgotten
    const drain = np.pericardium?.drainMl ?? 0;
    if (np.pericardium) {
      delete np.pericardium.drainMl;
      if (drain > 0 && !this.sac() && !cur.pericardium) delete np.pericardium; // nothing to drain: do not build a sac for it
      else if (drain > 0) np.pericardium.effusionMl = Math.max(0, (patch.pericardium?.effusionMl !== undefined ? np.pericardium.effusionMl ?? 0 : this.sac()?.effusionMl ?? cur.pericardium?.effusionMl ?? 0) - drain);
      if (np.pericardium && !Object.keys(np.pericardium).length) delete np.pericardium;
    }
    this.patientKind = kind;
    this.heartSpec = adult && np.heart ? JSON.parse(JSON.stringify(np.heart)) : {};
    this.periSpec = adult ? np.pericardium : undefined;
    this.septumSpec = adult && !!np.septum;
    this.ventSpec = adult ? np.ventilation : undefined;
    if (this.structureSig(true) !== this.builtSig) this.initCore(); else this.pushPatient();
  }

  /** Everything the heart is built from: when this changes, the heart is rebuilt. */
  private structureSig(sticky = false): string {
    const d = this.devSpec, im = { ...DEFAULT_IMPELLA, ...d.impella };
    // the sac and the thorax stay once built (a removed spec makes them neutral, see `pushPatient`), so only adding one rebuilds
    return JSON.stringify([this.heartSpec, !!this.periSpec || (sticky && this.hasSac), !!this.ventSpec || (sticky && this.hasThorax), !!d.ecmo, !!d.impellaRp, im.model, im.position, this.septumSpec || (sticky && this.hasSeptum)]);
  }

  /** Back to a resting heart with the same scenario: no ischemia, no scar, pressure at baseline. */
  resetPhysiology() {
    for (const k of Object.keys(this.sev)) delete this.sev[k];
    for (const k of Object.keys(this.scar)) delete this.scar[k];
    this.map = this.perfusion = this.solvedPerfusion = CIRC.baseMap; this.solvedDemand = 1; this.clinicalMinutes = 0; this.ischemicMinutes = 0;
    this.beatHemo.reset();
    this.resolveCoronaries(true);
    this.updateCirculation();
    if (this.engine === "core") { this.fluidModel = undefined; this.initCore(); }
  }

  /** Change part of the scenario while it runs (add a lesion, give a drug, drop the volume). State carries over. */
  apply(patch: PatientSpec) {
    const prev = { ...this.n, support: { ...this.support }, patient: { ...this.patient } };
    const { scenario, warnings } = normalizeScenario(patch, prev);
    this.warnings = warnings;
    const anatomyChanged = JSON.stringify(scenario.anatomy) !== JSON.stringify(prev.anatomy);
    this.n = scenario;
    if (patch.support) this.support = { ...scenario.support, atropine: this.support.atropine };
    if (this.engine === "core" && patch.devices) this.patchDevices(patch);
    if (this.engine === "core" && patch.fluids !== undefined) this.patchFluids(patch);
    if (this.engine === "core" && (patch.heart || patch.pericardium || patch.septum !== undefined || patch.ventilation || patch.kind)) this.patchStructure(patch);
    if (patch.patient) this.patient = { ...scenario.patient };
    this.autonomic.controls = { ...scenario.autonomic };
    if (anatomyChanged) { this.grafts = []; this.rebuildAnatomy(); } else this.resolveCoronaries(true);
  }

  /** Bypass grafts change the network; they belong to the anatomy they were sewn on. */
  setGrafts(g: Graft[]) { this.grafts = g; this.resolveCoronaries(true); }

  private get demand() { return this.n.exertion ? FLOW.exertionDemand : 1; }

  /** Support as the physiology sees it: the atropine switch is on with either the app's toggle or the scenario's dose. */
  private effSupport(): Support { return { ...this.support, atropine: this.support.atropine || this.n.drugs.atropine >= 0.5 }; }

  private paced(): boolean {
    const s = this.support;
    if (!s.pacing || !this.rstate) return false;
    return this.rstate.rhythm === "af" ? this.rstate.afRate <= s.paceRate + 1e-6 : this.rstate.sinusRate <= s.paceRate + 1e-6;
  }

  private rebuildAnatomy() {
    this.tree = buildTree(this.n.anatomy);
    this.sites = bedSites(this.tree);
    for (const r of [this.sev, this.scar]) for (const k of Object.keys(r)) if (!this.sites.some((s) => s.key === k)) delete r[k];
    this.resolveCoronaries(true);
  }

  private resolveCoronaries(full: boolean) {
    const lesions: Lesion[] = this.n.lesions, Pa = this.perfusion * MMHG;
    if (full) this.analysis = analyze(this.tree, lesions, this.n.exertion, Pa, this.grafts, this.solvedDemand);
    else this.analysis = { ...this.analysis, cond: solveNetwork(this.tree, lesions, this.demand * this.solvedDemand, Pa, this.grafts) };
    this.solvedPerfusion = this.perfusion;
    this.target = Object.fromEntries(this.analysis.cond.terminals.map((t) => [t.key, t.severity]));
    this.transmural = Object.fromEntries(this.analysis.cond.terminals.map((t) => [t.key, transmurality(t.blocked ? 0 : t.ratio)]));
  }

  private updateCirculation() {
    const g = globalSeverity(ischemicBurden(this.sites, this.sev)), sup = this.effSupport();
    // core: the drugs act through `pk` (receptor level), so what `circulation()` and the rhythm read from the old multipliers is switched off; devices stay
    const fx = this.engine === "core" ? this.pk.effects() : null, csup = fx ? { ...sup, fluids: 0, norepi: 0, dobutamine: 0, nitro: 0 } : sup;
    this.rstate = supportedRhythm(rhythmState(this.sites, this.sev, g, this.patient), csup, fx ?? undefined);
    const c = circulation(this.sites, this.sev, this.rstate, csup, this.scar, 1); // the baroreflex is dynamic here
    this.base = c;
    this.circ = this.live && this.liveSeen ? this.coreCirc(c) : c;
  }

  /** ECG injury vector and T-wave boost for the strip, from the current ischemia. */
  ecgInputs() {
    const g = globalSeverity(ischemicBurden(this.sites, this.sev));
    return { injury: injuryVector(this.sites, this.sev, this.transmural), tBoost: ST.tBoost * g };
  }

  /**
   * Advance `dt` seconds of heartbeat time. `minutes` overrides the clinical minutes of infarct evolution over
   * that span (a game runs its own clinical clock, or stops it); by default it is dt × speed × minutesPerSecond.
   * Returns the clinical minutes that elapsed.
   */
  step(dt: number, opts: { minutes?: number } = {}): number {
    if (this.job && !this.inJob) return 0; // the core engine is still being built: the clock holds
    const total = opts.minutes ?? dt * this.speed * this.minutesPerSecond;
    let left = dt;
    while (left > 1e-9) { const h = Math.min(left, Simulation.DT); this.sub(h, dt > 0 ? (total * h) / dt : 0); left -= h; }
    return total;
  }

  /** The doses the receptor-level drugs are heading for (core engine): the support dials, the scenario's beta-blocker and its "vasopressor" dial (above 0 an alpha agonist, below 0 a nitroprusside-type vasodilator). */
  private drugDoses(): DrugDoses {
    const s = this.support, vaso = this.n.drugs.vasopressor;
    return {
      norepinephrine: s.norepi, epinephrine: s.epi, dobutamine: s.dobutamine, milrinone: s.milrinone, vasopressin: s.vasopressin,
      phenylephrine: Math.max(0, vaso), nitroglycerin: s.nitro, nitroprusside: Math.min(1, s.nitroprusside + Math.max(0, -vaso)),
      betaBlocker: this.n.drugs.betaBlocker, furosemide: s.furosemide,
    };
  }

  private slew(h: number) {
    const a = 1 - Math.exp(-(h * this.speed) / DRUG_TAU), v = 1 - Math.exp(-(h * this.speed) / VOLUME_TAU);
    for (const k of ["betaBlocker", "atropine", "vasopressor"] as const) this.drug[k] += (this.n.drugs[k] - this.drug[k]) * a;
    const loss0 = this.bloodLoss, fluid0 = this.fluidGiven;
    this.bloodLoss += (this.n.bloodLoss - this.bloodLoss) * v;
    this.fluidGiven += (this.support.fluids - this.fluidGiven) * v; // only the core engine reads it
    if (this.fluidModel) { // the core engine: what the dials add this step is blood lost and crystalloid given, then the compartments decide where it goes
      this.fluidModel.bleed((this.bloodLoss - loss0) * this.bv0);
      if (this.fluidGiven > fluid0) this.fluidModel.give("crystalloid", (this.fluidGiven - fluid0) * 1000); // fluid cannot be taken back out by turning the dial down
    }
  }

  /** Congestion (0..1) from the lung water of the fluid compartments (core engine; 0 without them). */
  private lungCongestion(): number {
    const fm = this.fluidModel;
    return fm ? Math.min(1, Math.max(0, fm.read().lungWaterIndex - FLUIDS.lung.evlwMlPerKg) / FLUIDS.lung.congestionMlPerKg) : 0;
  }

  /**
   * Fall of the pulmonary venous saturation caused by the lung water now (C3), a fraction: 0 with the legacy engine and with dry lungs.
   * The oxygen solves take it off `satLung` (`LiveSource.saturations`, and the bridge's spec for the panels and the MCP oxygen tool).
   */
  lungSatDrop(): number { return this.fluidModel ? this.fluidModel.satDrop : 0; }

  /** The compartments take the engine's pressures and advance `minutes` of clinical time (core engine). */
  private stepFluids(minutes: number) {
    const fm = this.fluidModel!, live = this.live, b = live && (live.last ?? live.warmBeat);
    if (!live) return; // the heart is being built: the compartments wait with the clock
    if (b) {
      const pa = b.map, pv = (b.p.SVC.mean + b.p.IVC.mean + b.p.SPL.mean) / 3, pcwp = b.p.LA.mean, pap = b.p.PA.mean, k = this.fluidP && minutes > 0 ? 1 - Math.exp(-minutes / FLUIDS.pressureTauMin) : 1; // a stopped clinical clock follows the engine as it is
      const f0 = this.fluidP;
      this.fluidP = f0 ? { pa: f0.pa + (pa - f0.pa) * k, pv: f0.pv + (pv - f0.pv) * k, pcwp: f0.pcwp + (pcwp - f0.pcwp) * k, pap: f0.pap + (pap - f0.pap) * k } : { pa, pv, pcwp, pap }; // the beat-to-beat swing is not the capillary's pressure
      fm.setPressures(this.fluidP.pa, this.fluidP.pv); fm.setLungPressures(this.fluidP.pcwp, this.fluidP.pap);
    }
    fm.advance(minutes);
  }

  private sub(h: number, minutes: number) {
    for (const s of this.sites) this.sev[s.key] = stepSeverity(this.sev[s.key] ?? 0, this.target[s.key] ?? 0, h * this.speed);
    if (minutes > 0) {
      for (const s of this.sites) this.scar[s.key] = stepNecrosis(this.scar[s.key] ?? 0, this.sev[s.key] ?? 0, minutes);
      this.clinicalMinutes += minutes;
      if (ischemicBurden(this.sites, this.sev) > 0.005) this.ischemicMinutes += minutes;
    }
    this.slew(h);
    if (this.engine === "core") { this.pk.step(minutes, this.drugDoses()); if (this.fluidModel) this.fluidModel.diuretic = this.pk.effects().diuretic; }
    if (this.fluidModel) this.stepFluids(minutes);
    this.updateCirculation();
    const ctl = this.autonomic.controls;
    ctl.betaBlock = this.engine === "core" ? this.pk.effects().betaBlock : this.drug.betaBlocker;
    ctl.vagalBlock = Math.max(this.drug.atropine, this.support.atropine ? 1 : 0);
    ctl.volumeDeficit = Math.max(0, this.fluidModel ? 1 - this.fluidModel.bloodVolume / this.bv0 : this.bloodLoss); // core: the blood volume short of the patient's own, whatever its cause or refill
    this.autonomic.step(h);
    this.stream.alternans = alternansAmplitude(this.sac()?.effusionMl, this.periSpec?.open);
    this.stream.extend(this.t, this.rstate, this.mod);
    this.stream.prune(this.t);
    this.t += h;
    if (this.live) this.coreStep(h, minutes); else for (const b of this.stream.drain(this.t)) this.handleBeat(b);
    // Coronary perfusion follows the pressure the heart actually generates (plus any balloon augmentation),
    // and demand follows what drugs and devices do to it.
    // core (E2): the aortic-equivalent pressure of the subendocardium from the beat's traces (diastolic pressure, diastolic time, LVEDP, intramyocardial
    // pressure; a balloon's augmentation is in the aortic trace), in place of the mean pressure plus a measured augmentation
    const cpp = this.live ? this.cor.last : null;
    const drive = cpp ? cpp.endo + COUPLING.offset : this.live ? this.map + this.dx.aug : this.map + (this.support.iabp ? SUPPORT.iabpCoronaryAug : 0);
    this.perfusion += (drive - this.perfusion) * (1 - Math.exp(-(h * this.speed) / COUPLING.smoothS));
    if ((this.mapClock += h) > 0.5) {
      this.mapClock = 0;
      if (Math.abs(this.perfusion - this.solvedPerfusion) > 2 || Math.abs(this.circ.demandFactor - this.solvedDemand) > 0.02) {
        this.solvedDemand = this.circ.demandFactor;
        this.resolveCoronaries(false);
      }
    }
  }

  private handleBeat(b: Parameters<BeatHemodynamics["onBeat"]>[0]) {
    const fx = this.autonomic.effects();
    const vaso = this.drug.vasopressor;
    const volume = clamp(1 - 1.5 * this.bloodLoss, 0.1, 1.3); // preload falls steeply with hemorrhage
    const h = this.beatHemo.onBeat(b, this.circ, {
      contractility: fx.contractility,
      resistance: fx.resistance * (vaso >= 0 ? 1 + 0.5 * vaso : 1 + 0.4 * vaso),
      preload: volume * fx.preloadResp,
      deviceFlow: (this.circ.deviceFlow * 1000) / 60,
    });
    this.autonomic.sense(h.systolic, h.diastolic);
    const map = h.diastolic + (h.systolic - h.diastolic) / 3;
    this.map += (map - this.map) * (1 - Math.exp(-h.interval / 2));
    const rec: BeatRecord = {
      n: this.beatCount++, t: +h.t.toFixed(3), interval: +h.interval.toFixed(4), hr: 60 / h.interval,
      sbp: h.systolic, dbp: h.diastolic, map, sv: h.strokeVolume, pvc: h.pvc, atrialKick: h.atrialKick,
      sympathetic: fx.sympathetic, vagal: fx.vagal, afferent: fx.afferent, respPhase: fx.respPhase,
    };
    this.history.push(rec);
    if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY);
    this.onBeat?.(rec);
  }


  // ======================================================================================================================
  // Core engine (engine === "core", task A7)
  //
  // The beat stream feeds `LiveHeart` (every beat, with its atrial event, ahead of time); the live heart is stepped with the
  // simulation's clock (live time = stream time + delta, delta fixed when the first beat is aligned with the end of the warm-up).
  // Mapping, all constants in config/acsCore.ts and config/ischemia.ts:
  //  - ischemia -> ventricles: with L, R the ischemic (or scarred) fractions circulation() computes, LV Ees x max(0.2, 1 - 1.25 L),
  //    RV Ees x max(0.2, 1 - 0.8 R), passive stiffness (the `a` of the end-diastolic curve) x (1 + 1.5 L), x (1 + 2 R)
  //    (`LiveHeart.setVentricleFactors`, separate from the autonomic contractility, so they multiply);
  //  - autonomic -> engine: contractility x effects.contractility, resistance x effects.resistance (and the ischemic reflex terms
  //    circulation() has: x (1 + 0.2 sympathetic) x (1 - 0.12 vagal), and the vasopressor drug), venous tone 1 + 0.75 (vascular tone - rest)
  //    (the volume reflex reaches the veins through the vascular tone: core autonomic calibration `AUTONOMIC_CORE`, config/acsCore.ts; deficit = fraction of blood volume lost net of fluids); rate arrives as beats;
  //  - drugs (E4, physics/core/drugs.ts, config/drugs.ts): norepinephrine, epinephrine, dobutamine, milrinone, vasopressin, nitroglycerin,
  //    nitroprusside, the beta-blocker and furosemide go through receptor drives (alpha-1, beta-1, beta-2, V1, PDE3, NO) to arteriolar
  //    resistance, venous tone, Ees, tau, sinus rate and the urine multiplier, with first-order onset and offset in clinical minutes; the
  //    `SUPPORT` multipliers of the old dials are not read on this path; fluids and blood loss go to the fluid compartments (C2: `FluidCompartments`, which decide how much of it stays in the
  //    vessels, and the engine holds that volume through `VolumeExchange`; the spec's `fluids` section drives them); impella and IABP are PLACEHOLDERS (see PLACEHOLDER_WARNINGS);
  //  - outputs: `circ` is filled from the smoothed beats (see coreCirc).
  // ======================================================================================================================

  private feedFrom = 0; // stream time before which beats belong to a previous heart
  private warmHr = 72;

  /** Blood (ml) the circulation should hold relative to the patient's own: what the fluid compartments keep in the vessels (C2). */
  private targetVolume(): number { return this.fluidModel!.bloodVolume - this.bv0; }

  /**
   * Build the live heart for the patient (and settle it). The spec's structural heart, pericardium, ventilation, ECMO and Impella RP
   * go into the build (`buildCore`); if the core cannot settle that patient (it throws, or the settled beat has no finite pressure) it
   * runs a plain adult instead and `coreNote` says why, so a page can fall back to the bridge for the patient it cannot represent.
   */
  private initCore(warmup = 0) {
    this.jobWarm = Math.max(this.jobWarm, warmup);
    if (this.defer) this.queueCore(); else this.finishJob(this.initCoreSteps());
  }

  /** The build in chunks (see `settleStep`): the same steps as `initCore`, with a yield after each beat of the heart's warm-up and each quarter second of reflex warm-up. */
  private *initCoreSteps(): Generator<void> {
    const sig = this.structureSig();
    try { yield* this.buildCoreSteps(); this.coreNote = ""; }
    catch (e) {
      this.coreNote = `the core engine could not settle this patient (${e instanceof Error ? e.message : String(e)}); showing a plain adult`;
      this.heartSpec = {}; this.periSpec = undefined; this.ventSpec = undefined;
      this.devSpec = { ...this.devSpec, ecmo: undefined, impellaRp: undefined };
      this.building = null;
      yield* this.buildCoreSteps();
    }
    this.builtSig = sig; // the requested structure, so an identical request does not rebuild again
    if (this.defer) this.pushPatient(); // edits made while it was being built
    for (let left = this.jobWarm; left > 1e-9; left -= WARM_CHUNK) { this.inJob = true; try { this.step(Math.min(WARM_CHUNK, left), { minutes: 0 }); } finally { this.inJob = false; } yield; } // the reflex loop settles with no clinical time passing
    this.jobWarm = 0;
  }

  // ---- building in chunks (a page keeps its thread: the heart's warm-up is ~0.5 s and the reflex warm-up ~0.6 s of work)
  private defer = false;
  private job: Generator<void> | null = null;
  private jobWarm = 0;
  private inJob = false;
  private building: LiveHeart | null = null; // the heart being built: not `live` until it is settled
  private runJob(it: Generator<void>) { this.job = it; }
  private finishJob(it: Generator<void>) { while (!it.next().done); }
  /** Queue the build (with `jobWarm` s of reflex warm-up after it; `warmup()` while it is pending adds to that). A build already queued is replaced, its warm-up kept. While it is pending the simulation does not advance (`step` does nothing) and `live` is undefined. */
  private queueCore() {
    this.live = undefined; this.liveSeen = false; this.building = null;
    this.builtSig = this.structureSig(); // the request in hand, so an identical one does not queue another
    this.job = this.initCoreSteps();
  }
  /** True while the core engine's heart is being built and settled in chunks (`deferCore`): the panels have no live heart yet and the simulation holds its clock. */
  get settling(): boolean { return this.job !== null; }
  /** Do chunks of the pending build for about `budgetMs` (at least one chunk); true when it is done. */
  settleStep(budgetMs = 8): boolean {
    const it = this.job;
    if (!it) return true;
    const t0 = performance.now();
    do {
      let r: IteratorResult<void>;
      try { r = it.next(); } catch (e) { this.job = null; this.jobWarm = 0; throw e; }
      if (r.done) { this.job = null; this.jobWarm = 0; return true; }
    } while (performance.now() - t0 < budgetMs);
    return false;
  }
  /** Finish a pending build now (a caller that needs the live heart at once: the AI tools, tests). */
  settleNow() { while (!this.settleStep(1e9)); }

  private buildCore() { this.finishJob(this.buildCoreSteps()); }

  private *buildCoreSteps(): Generator<void> {
    const p = PATIENTS.adult, hv = this.heartSpec.volumeMl ?? 0;
    this.sm = { sv: 0, co: 0, ef: 0, pcwp: 0, cvp: 0, sbp: 0, dbp: 0, dev: 0 };
    this.fed = new WeakSet(); this.fxQueue = []; this.fx = NEUTRAL_FX; this.liveSeen = false; this.delta = NaN; this.feedFrom = this.t;
    this.bv0 = p.bloodMlPerKg * p.weightKg;
    this.fluidGiven = this.support.fluids;
    if (!this.fluidModel) { // a rebuild of the heart (setPatient, patchStructure) keeps the compartments: what was bled and given is in them already
      this.fluidP = null;
      const fm = (this.fluidModel = new FluidCompartments({ bloodMl: this.bv0, hb: p.hb, weightKg: p.weightKg }));
      this.setFluidSpec(this.fluidSpec);
      fm.bleed(this.bloodLoss * this.bv0); // the scenario starts after the loss and the fluid: both in at once, the compartments redistribute them from here
      fm.give("crystalloid", this.fluidGiven * 1000);
    }
    // the structural spec accepts [-1000, 5000] ml in all, the lesion's own volume included; the rest follows at the rate limit
    this.volApplied = Math.max(ACS_CORE.startVolumeMl[0] - hv, Math.min(ACS_CORE.startVolumeMl[1] - hv, this.targetVolume()));
    const veins = ["SVC", "IVC", "SPL"].map(NODE), vessels = ["SVC", "IVC", "SPL", "PA", "PV", "AO", "DAO"].map(NODE);
    const di = { ...DEFAULT_IMPELLA, ...this.devSpec.impella }, lvN = NODE("LV"), aoN = NODE("AO");
    this.impella = this.iabp = this.ecmo = this.rp = undefined;
    const impellaEl = (m: Model) => (this.impella = new SwitchableImpella("impella", di.position === "aortic" ? aoN : lvN, aoN, { model: di.model, level: di.level, position: di.position, v0: m.chambers[lvN]!.v0 }));
    const iabpEl = (m: Model) => (this.iabp = Iabp.forModel(m, { ...DEFAULT_IABP, ...this.devSpec.iabp, volumeMl: 0 })); // off during the warm-up
    const ecmoEl = (m: Model) => (this.ecmo = Ecmo.forModel(m, { ...this.devSpec.ecmo }));
    const rpEl = (m: Model) => (this.rp = ImpellaRp.forModel(m, { ...this.devSpec.impellaRp }));
    this.exchange = new VolumeExchange("volumeExchange", veins, vessels, (n, v) => { const m = (this.building ?? this.live!).engine.nodes[n].model; return m instanceof Compliance ? m.stressed(v) : v; });
    const core: FromModelOptions = {}, pe = this.periSpec, ve = this.ventSpec;
    if (pe) core.pericardium = { effusionMl: pe.effusionMl ?? 0, stiffness: pe.stiffness ?? 1, open: pe.open ?? false };
    if (ve) core.thorax = { mode: ve.mode ?? "spontaneous", peep: ve.peep ?? 0, tidalMlKg: ve.tidalMlKg ?? THORAX.defaultTidalMlKg, rate: (ve.mode ?? "spontaneous") === "spontaneous" ? this.autonomic.controls.respRate : THORAX.defaultRate, depth: this.autonomic.controls.respDepth };
    if (this.septumSpec) core.septum = true;
    this.appliedEffusion = pe?.effusionMl ?? 0; this.hasSac = !!pe; this.hasThorax = !!ve; this.hasSeptum = this.septumSpec;
    this.live = undefined;
    const live = (this.building = new LiveHeart({ ...this.heartSpec, volumeMl: hv + this.volApplied }, { core, extra: [impellaEl, iabpEl, this.exchange, ...(this.devSpec.ecmo ? [ecmoEl] : []), ...(this.devSpec.impellaRp ? [rpEl] : [])] }));
    this.impConsole?.dispose(); this.impConsole = new ImpellaConsole(live.engine);
    this.rpConsole?.dispose(); this.rpConsole = this.rp ? new ImpellaConsole(live.engine, "impellaRp") : undefined;
    this.dia = { t: NaN, aoT: 0, aoSum: 0, dT: 0, dSum: 0, peak: -Infinity, sys: -Infinity, closed: false, opened: false, balloon: 0, fill: 0 };
    this.dx = { rho: NaN, aug: 0, peak: 0, mean: 0, sys: 0, balloon: 0 };
    const aoIdx = live.engine.node("AO"), lvIdx = live.engine.node("LV");
    this.cor.reset();
    live.engine.onSample((smp) => this.onDiastoleSample(smp, aoIdx, lvIdx)); // before the warm-up: it also measures the unassisted diastolic ratio
    this.pushDevices(true);
    this.pushInputs();
    // Breathing makes the beats non-periodic, which `periodic()` cannot settle (it would run to its beat limit, seconds): settle with the
    // thorax off at the breathing pattern's mean load, then start the breaths.
    const th = this.thorax();
    const breathing = th ? { ...th.params } : null;
    if (th && breathing) th.set({ mode: "off", offsetMmHg: Thorax.meanChest(breathing) });
    this.warmHr = Math.max(20, ventRate(this.rstate));
    yield* live.warmSteps(this.warmHr);
    if (th && breathing) th.set({ mode: breathing.mode, offsetMmHg: 0 });
    this.live = live; this.building = null;
    const w = live.warmBeat!;
    if (![w.map, w.systolic, w.strokeVolume, w.p.RA.mean, w.p.LA.mean].every(Number.isFinite)) throw new Error("the settled beat has no finite pressures");
    this.dx.rho = this.dia.dT > 0 && this.dia.aoT > 0 ? this.dia.dSum / this.dia.dT / (this.dia.aoSum / this.dia.aoT) : ACS_CORE.diastolicRatio;
    this.dia = { ...this.dia, t: NaN, aoT: 0, aoSum: 0, dT: 0, dSum: 0, peak: -Infinity, sys: -Infinity, closed: false, opened: false, balloon: 0, fill: 0 };
    this.cor.reset();
    this.seedFromWarm(w);
    this.stepFluids(0);
    live.onRecord((b) => this.handleLiveBeat(b));
    this.sensor = { events: [], tStart: NaN, start: 0, peak: 0, armed: false, ao: live.engine.node("AO") };
    live.engine.onSample((smp) => this.senseTick(smp.t, smp.P[this.sensor.ao]));
    for (const cb of [...this.coreBuilt]) cb(live);
  }

  private coreBuilt = new Set<(live: LiveHeart) => void>();
  /** Called with the new live heart each time the core engine builds one (a reset, a patient change that rebuilds). A source that reads the live heart attaches here. Returns the unsubscribe function. */
  onCoreBuilt(cb: (live: LiveHeart) => void): () => void { this.coreBuilt.add(cb); return () => { this.coreBuilt.delete(cb); }; }

  /** Settings that need no rebuild, from the spec in force: sac (effusion, stiffness, open), thorax (mode, PEEP, tidal volume), and through `pushDevices` the devices. */
  private pushPatient() {
    const live = this.live;
    if (!live) return;
    const sac = this.sac(), pe = this.periSpec;
    if (sac) {
      if (pe) {
        if ((pe.effusionMl ?? 0) !== this.appliedEffusion) { sac.setEffusion(pe.effusionMl ?? 0); this.appliedEffusion = pe.effusionMl ?? 0; }
        sac.set({ stiffness: pe.stiffness ?? 1, open: pe.open ?? false });
      } else { sac.setEffusion(0); this.appliedEffusion = 0; sac.set({ stiffness: 1, open: false, effusionRateMlS: 0 }); } // spec removed: a normal sac
    }
    const th = this.thorax(), ve = this.ventSpec;
    if (th) {
      if (ve) { const mode = ve.mode ?? "spontaneous"; th.set({ mode, peep: ve.peep ?? 0, tidalMlKg: ve.tidalMlKg ?? THORAX.defaultTidalMlKg, rate: mode === "spontaneous" ? this.autonomic.controls.respRate : THORAX.defaultRate }); }
      else th.set({ mode: "off" });
    }
    this.pushDevices();
  }
  private sac(): Pericardium | null { try { return (this.building ?? this.live)?.engine.element<Pericardium>("pericardium") ?? null; } catch { return null; } }
  private thorax(): Thorax | null { try { return (this.building ?? this.live)?.engine.element<Thorax>("thorax") ?? null; } catch { return null; } }

  /** The warm-up's steady state is the first smoothed beat: `circ` shows the core's numbers from the first instant, never the legacy ones (A7b). */
  private seedFromWarm(lb: LiveBeat) {
    const sm = this.sm;
    this.map = lb.map;
    sm.sv = lb.strokeVolume; sm.co = (lb.strokeVolume / lb.interval) * 0.06; sm.ef = lb.strokeVolume / lb.edv.LV;
    sm.pcwp = lb.p.LA.mean; sm.cvp = lb.p.RA.mean; sm.sbp = lb.systolic; sm.dbp = lb.diastolic;
    this.liveSeen = true;
    this.circ = this.coreCirc(this.base);
  }

  /**
   * Switch and set the devices from the support toggles and the device settings, between steps. Impella: inserted and running when
   * `support.impella` is on and the P-level is above 0; P-level from the spec (live: `setImpellaLevel`). IABP: the balloon is full-size
   * (`volumeMl`) when `support.iabp` is on, else 0 (it empties); ratio and timing offsets from the spec (live: `setIabp`).
   */
  private pushDevices(warm = false) {
    const im = this.impella, ia = this.iabp;
    if (!im || !ia) return;
    const di = this.devSpec.impella ?? DEFAULT_IMPELLA, dI = { ...DEFAULT_IABP, ...this.devSpec.iabp }, level = di.level ?? DEFAULT_IMPELLA.level;
    im.enabled = this.support.impella && level > 0;
    if (im.level !== Math.min(9, Math.max(0, Math.round(level)))) im.set({ level });
    const ec = this.devSpec.ecmo, rp = this.devSpec.impellaRp;
    if (this.ecmo && ec) this.ecmo.set({ flowLpm: ec.flowLpm ?? 4, sweepLpm: ec.sweepLpm ?? 3, fio2: ec.fio2 ?? 1 });
    if (this.rp && rp) this.rp.set({ level: rp.level ?? 6 });
    ia.set({ ratio: dI.ratio, inflateMs: dI.inflateMs, deflateMs: dI.deflateMs, volumeMl: this.support.iabp && !warm ? dI.volumeMl : 0 });
  }

  /** Change the Impella's P-level (0..9; 0 is off) while it runs. The model and position are fixed at `reset`. */
  setImpellaLevel(level: number) {
    if (!Number.isFinite(level)) return;
    this.devSpec = { ...this.devSpec, impella: { ...DEFAULT_IMPELLA, ...this.devSpec.impella, level: Math.min(9, Math.max(0, Math.round(level))) } };
    this.pushDevices();
  }

  /** Change the IABP's ratio (1..3), timing offsets (ms, negative early) or balloon volume (ml) while it runs. Core engine only. */
  setIabp(patch: NonNullable<DeviceSpec["iabp"]>) {
    this.patchDevices({ devices: { iabp: patch } });
  }

  private patchDevices(patch: PatientSpec) {
    const dv = normalizePatient({ devices: patch.devices }).spec.devices;
    if (!dv) return;
    if (dv.impella) {
      const cur = this.devSpec.impella ?? DEFAULT_IMPELLA;
      this.devSpec = { ...this.devSpec, impella: { ...cur, ...dv.impella } };
      this.support.impella = true;
      if ((dv.impella.model && dv.impella.model !== cur.model) || (dv.impella.position && dv.impella.position !== cur.position))
        this.warnings = [...this.warnings, "Impella model and position change at the next reset(); the P-level changed now."];
    }
    if (dv.iabp) { this.devSpec = { ...this.devSpec, iabp: { ...DEFAULT_IABP, ...this.devSpec.iabp, ...dv.iabp } }; this.support.iabp = true; }
    if (dv.ecmo || dv.impellaRp) { // a patch changes the settings of a circuit that is there; adding one is a rebuild, which setPatient does
      if (dv.ecmo && this.devSpec.ecmo) this.devSpec = { ...this.devSpec, ecmo: { ...this.devSpec.ecmo, ...dv.ecmo } };
      if (dv.impellaRp && this.devSpec.impellaRp) this.devSpec = { ...this.devSpec, impellaRp: { ...this.devSpec.impellaRp, ...dv.impellaRp } };
    }
    this.pushDevices();
  }

  /** Slow inputs of the heart from the ischemia, the autonomic state, the drugs and the devices (see the mapping above). */
  private pushInputs() {
    const live = (this.building ?? this.live)!, K = ACS_CORE, fx = this.fx, rs = this.rstate, d = this.pk.effects();
    live.setVentricleFactors(ischemiaFactors(this.base.lvIschemia, this.base.rvIschemia));
    const resistance = fx.resistance * d.resistance * (1 + CIRC.sympatheticSvr * rs.sympathetic) * (1 - CIRC.vagalSvr * rs.vagal);
    const venousTone = (1 + K.venousToneGain * (fx.vascular - AUTONOMIC.restSympathetic)) * d.venousTone;
    live.setModifiers({ contractility: fx.contractility * d.contractility, resistance, venousTone, relax: d.relax });
  }

  /** One sub-step: hand over the new beats, set the slow inputs, move blood in or out, and advance the live heart to the simulation's clock. */
  private coreStep(h: number, minutes = 0) {
    const live = this.live!;
    const fresh = this.stream.beats.filter((b) => !this.fed.has(b) && b.t >= this.feedFrom - 1e-9).sort((a, b) => a.t - b.t);
    if (Number.isNaN(this.delta)) {
      const first = fresh.find((b) => !b.pOnly);
      if (!first) return; // no ventricular beat yet: the live heart waits in diastole
      this.delta = -first.t; // the first beat falls at live time 0: it follows the warm-up (which ends just before an event) at the steady rate
    }
    for (const b of fresh) {
      this.fed.add(b);
      if (!b.pOnly) { this.fx = this.autonomic.effects(); this.fxQueue.push(this.fx); }
      live.onBeat({ ...b, t: b.t + this.delta });
      if (!b.pOnly) this.sensor.events.push(b.t + this.delta + (live.engine.t - live.time));
    }
    const dt = this.t + this.delta - live.time;
    if (dt <= 1e-9) return;
    this.pushDevices();
    this.pushInputs();
    const sac = this.sac(), pe = this.periSpec;
    if (sac && pe) sac.set({ effusionRateMlS: h > 0 ? ((pe.effusionRateMlMin ?? 0) * minutes) / h : 0 }); // ml per clinical minute, on the clinical minutes this sub-step stands for
    const th = this.thorax();
    if (th && this.ventSpec && (this.ventSpec.mode ?? "spontaneous") === "spontaneous") { th.set({ depth: this.autonomic.controls.respDepth }); th.setPhase(this.autonomic.phase, live.engine.t + dt); } // the pleural swing runs with the respiratory sinus arrhythmia of the baroreflex loop
    const q = Math.max(-ACS_CORE.maxVolumeRate, Math.min(ACS_CORE.maxVolumeRate, (this.targetVolume() - this.volApplied) / dt)); // ml/s, so the circulation holds the (ramped) volume
    this.exchange!.set({ rate: q }); this.volApplied += q * dt;
    live.step(dt);
    if (this.impella?.enabled || this.ecmo || this.sm.dev > 1e-3) this.sm.dev += (this.deviceFlowNow() - this.sm.dev) * (1 - Math.exp(-dt / ACS_CORE.deviceFlowTau));
    if (this.liveSeen) this.circ = this.coreCirc(this.base);
  }

  /**
   * The baroreceptors read each beat's pressure shortly after systole, not when the beat record closes (a beat later): the
   * aortic pressure at the ventricular event is the diastolic, the highest value in the next `senseDelay` seconds the systolic.
   */
  private sensor = { events: [] as number[], tStart: NaN, start: 0, peak: 0, armed: false, ao: 0 };
  private senseTick(t: number, ao: number) {
    const k = this.sensor;
    while (k.events.length && k.events[0] <= t + 1e-9) { k.tStart = k.events.shift()!; k.start = ao; k.peak = ao; k.armed = true; }
    if (!k.armed) return;
    if (ao > k.peak) k.peak = ao;
    if (t - k.tStart >= ACS_CORE.senseDelay) { this.autonomic.sense(k.peak, k.start); k.armed = false; }
  }

  /** A completed beat of the live heart: baroreflex, smoothed pressure and output, history. */
  private handleLiveBeat(lb: LiveBeat) {
    const fx = this.fxQueue.shift() ?? this.fx;
    const a = (tau: number) => (this.liveSeen ? 1 - Math.exp(-lb.interval / tau) : 1);
    const sm = this.sm, tau = ACS_CORE.smoothTau, co = (lb.strokeVolume / lb.interval) * 0.06;
    this.map += (lb.map - this.map) * a(2);
    sm.sv += (lb.strokeVolume - sm.sv) * a(tau); sm.co += (co - sm.co) * a(tau);
    sm.ef += (lb.strokeVolume / lb.edv.LV - sm.ef) * a(tau);
    sm.pcwp += (lb.p.LA.mean - sm.pcwp) * a(tau); sm.cvp += (lb.p.RA.mean - sm.cvp) * a(tau);
    sm.sbp += (lb.systolic - sm.sbp) * a(tau); sm.dbp += (lb.diastolic - sm.dbp) * a(tau);
    this.liveSeen = true;
    this.diastolicBeat(lb, a(2));
    const rec: BeatRecord = {
      n: this.beatCount++, t: +(lb.t - this.delta).toFixed(3), interval: +lb.interval.toFixed(4), hr: 60 / lb.interval,
      sbp: lb.systolic, dbp: lb.diastolic, map: lb.map, sv: lb.strokeVolume, pvc: lb.pvc, atrialKick: lb.atrialKick,
      sympathetic: fx.sympathetic, vagal: fx.vagal, afferent: fx.afferent, respPhase: fx.respPhase,
    };
    this.history.push(rec);
    if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY);
    this.circ = this.coreCirc(this.base);
    this.onBeat?.(rec);
  }

  /** Sample hook: the aortic pressure with the aortic valve closed (after it opened) is the diastole; also the balloon's pressure and fill. */
  private onDiastoleSample(smp: { t: number; P: Readonly<Float64Array>; q: Readonly<Record<string, number>>; taps: Readonly<Record<string, Record<string, number>>> }, ao: number, lv: number) {
    const d = this.dia, h = Number.isFinite(d.t) ? Math.min(smp.t - d.t, 0.05) : 0, p = smp.P[ao], q = smp.q.AV ?? 0;
    d.t = smp.t;
    if (h > 0) { d.aoT += h; d.aoSum += p * h; }
    if (q > IABP.openFlow) d.opened = true;
    else if (d.opened && q < IABP.closedFlow && h > 0) { d.closed = true; d.dT += h; d.dSum += p * h; if (p > d.peak) d.peak = p; }
    if (d.opened && !d.closed && p > d.sys) d.sys = p; // the ejection peak: before the valve closes
    const b = smp.taps.iabp;
    if (b) { if (b.augmentation > d.balloon) d.balloon = b.augmentation; if (b.fill > d.fill) d.fill = b.fill; }
    this.cor.sample(h, p, smp.P[lv], d.closed);
  }

  /**
   * Diastolic measurements of a completed beat. D = time-mean aortic pressure with the valve closed. The unassisted diastolic ratio
   * rho = D / (time-mean aortic pressure) is learned on beats without balloon assistance (and from the warm-up); on an assisted beat the
   * measured augmentation, in mean-pressure terms, is D - rho * mean, smoothed with factor `k` into `dx.aug` (0 on unassisted beats, so
   * 1:2 shows half). `circ.coronaryPressure` = MAP + dx.aug. Without a balloon pump aug is 0 and coronary pressure is MAP.
   */
  private diastolicBeat(lb: LiveBeat, k: number) {
    const d = this.dia, x = this.dx;
    this.cor.endBeat();
    if (d.dT > 0.05 && d.aoT > 0) {
      const D = d.dSum / d.dT, mean = d.aoSum / d.aoT, assisted = d.fill > 0.5;
      if (assisted) x.aug += (Math.max(0, D - x.rho * mean) - x.aug) * k;
      else { x.rho += (D / mean - x.rho) * Math.min(1, k * 0.5); x.aug += (0 - x.aug) * k; }
      if (d.sys > 0) x.sys += (d.sys - x.sys) * (x.sys ? k : 1);
      x.peak += (d.peak - x.peak) * (x.peak ? k : 1); x.mean += (D - x.mean) * (x.mean ? k : 1);
      if (assisted) x.balloon += (d.balloon - x.balloon) * k;
    } else x.aug += (0 - x.aug) * k;
    if (d.fill <= 0.5 && x.balloon > 0) x.balloon += (0 - x.balloon) * k * 0.5;
    this.dia = { ...d, aoT: 0, aoSum: 0, dT: 0, dSum: 0, peak: -Infinity, sys: -Infinity, closed: false, opened: false, balloon: 0, fill: 0 };
  }

  /**
   * The device consoles in plain numbers (types and keys: `ImpellaReadout`, `IabpReadout` in sim/coreDevices.ts). null with the legacy
   * engine. `impella` / `iabp` are always present on the core engine; `on` says whether they are running.
   */
  devices(): DevicesReadout | null {
    const im = this.impella, ia = this.iabp, live = this.live;
    if (!live || !im || !ia) return null;
    const c = this.impConsole?.last, t = live.engine.sample().taps, ti = t.impella, tb = t.iabp, x = this.dx, p = ia.params, on = im.enabled;
    const te = t.ecmo, tr = t.impellaRp, cr = this.rpConsole?.last, rp = this.rp, ec = this.ecmo;
    return {
      ...(ec && te ? { ecmo: { on: true, drain: ec.drain, flowLpm: te.flow, targetLpm: te.targetLpm, rpm: te.rpm, sweepLpm: te.sweepLpm, fio2: te.fio2, suctionLevel: te.suctionLevel, suctionAlarm: te.suctionAlarm > 0, membraneDpMmHg: te.membraneDp, headMmHg: te.head } } : {}),
      ...(rp && tr ? { impellaRp: { on: rp.level > 0, level: rp.level, speedKrpm: rp.params.speed, flowLpm: cr?.flow.mean ?? tr.flow, motorCurrentMa: cr?.current.mean ?? tr.current, placementMmHg: cr?.placement.mean ?? tr.placement, suctionAlarm: !!cr?.suctionAlarm || tr.suctionAlarm > 0 } } : {}),
      impella: {
        on, model: im.model, position: im.position, level: im.level, speedKrpm: on ? im.params.speed : 0,
        flowLpm: on ? c?.flow.mean ?? ti.flow : 0, flowMinLpm: on ? c?.flow.min ?? ti.flow : 0, flowMaxLpm: on ? c?.flow.max ?? ti.flow : 0,
        motorCurrentMa: on ? c?.current.mean ?? ti.current : 0, currentPulsatilityMa: on ? c?.pulsatility ?? 0 : 0,
        placementMmHg: on ? c?.placement.mean ?? ti.placement : 0, placementAmplitudeMmHg: on ? c?.placement.amplitude ?? 0 : 0,
        suctionLevel: on ? c?.suctionLevel ?? ti.suctionLevel : 0, suctionFraction: on ? c?.suctionFraction ?? 0 : 0, suctionAlarm: on && !!c?.suctionAlarm,
        inletMeanMmHg: on ? c?.inlet.mean ?? ti.pIn : 0, inletMinMmHg: on ? c?.inlet.min ?? ti.pIn : 0, inletMaxMmHg: on ? c?.inlet.max ?? ti.pIn : 0, inletAmplitudeMmHg: on ? c?.inlet.amplitude ?? 0 : 0,
        positionAlarm: on && !!c?.positionAlarm,
        alarms: on ? [...(c?.positionAlarm ? ["IMPELLA POSITION WRONG: the inflow is in the aorta"] : []), ...(c?.suctionAlarm ? ["SUCTION: the inflow is collapsing onto the ventricular wall"] : [])] : [],
      },
      iabp: {
        on: this.support.iabp, ratio: p.ratio, inflateMs: p.inflateMs, deflateMs: p.deflateMs, volumeMl: { ...DEFAULT_IABP, ...this.devSpec.iabp }.volumeMl,
        balloonVolumeMl: tb.vb, fill: tb.fill, assisted: tb.assisted > 0,
        balloonPressureMmHg: x.balloon, peakDiastolicMmHg: x.peak, diastolicMeanMmHg: x.mean, endDiastolicMmHg: this.sm.dbp, systolicMmHg: x.sys,
        coronaryAugmentationMmHg: x.aug,
      },
    };
  }

  /**
   * `circ` from the live heart, given the legacy `circulation()` result `c` (which supplies only the ischemic fractions, the
   * rate the rhythm implies, the support's oxygen demand factor). From the smoothed beats (time constant `ACS_CORE.smoothTau`):
   *  - hr, bpm: the ventricular rate the rhythm implies (AF: the AF rate, complete block: the escape rate), not the sinus rate;
   *  - strokeVolume, ml: net volume through the aortic valve; cardiacOutput, L/min: its per-beat rate plus the device flow;
   *  - map, systolic, diastolic, mmHg: the smoothed mean, peak and start-of-beat aortic pressure;
   *  - svr, mmHg·min/L: MAP / CO as BASE_SVR is defined (no venous pressure subtracted);
   *  - deviceFlow, L/min: the Impella's, smoothed over `deviceFlowTau` (it follows the cardiac cycle);
   *  - congestion, 0..1: the larger of the smoothed PCWP (left atrial mean) ramp, 0 up to 12 mmHg, 1 at 25 (`pcwpOnset`, `pcwpFull`), and the lung
   *    water (C3: the excess over rest as a share of `FLUIDS.lung.congestionMlPerKg`), which keeps a flooded lung congested after the wedge pressure falls.
   *    The legacy `congestionGain` (litres of fluid × LV ischemia) lives on the legacy engine only;
   *  - ejectionFraction: stroke volume / end-diastolic volume of the LV;
   *  - coronaryPressure: the smoothed MAP plus the diastolic augmentation measured on the aortic trace (0 without a balloon pump);
   *  - state: from the smoothed MAP as `state()` does.
   */
  private coreCirc(c: Circulation): Circulation {
    const K = ACS_CORE, sm = this.sm, dev = sm.dev;
    const co = sm.co + dev;
    return {
      ...c, demandFactor: this.coreDemand(), hr: ventRate(this.rstate), strokeVolume: sm.sv, cardiacOutput: co, map: this.map, systolic: sm.sbp, diastolic: sm.dbp,
      svr: co > 0.1 ? this.map / co : c.svr, coronaryPressure: this.map + this.dx.aug, deviceFlow: dev,
      congestion: Math.min(1, Math.max(Math.max(0, (sm.pcwp - K.pcwpOnset) / (K.pcwpFull - K.pcwpOnset)), this.lungCongestion())), ejectionFraction: sm.ef,
      state: this.map < CIRC.shockMap ? "shock" : this.map < CIRC.hypotensionMap ? "hypotension" : "stable",
    };
  }

  /**
   * The receptor-level drugs of the core engine now (E4), null with the legacy engine: `level` is each drug's effect-site level as a
   * fraction of a full dose (it follows the dose with the first-order kinetics of `config/drugs.ts`, in clinical minutes), `effects`
   * the factors on the design point they give (`DrugEffects`, core/drugs.ts).
   */
  drugState(): { level: Record<DrugName, number>; effects: DrugEffects } | null {
    return this.engine === "core" ? { level: { ...this.pk.level }, effects: this.pk.effects() } : null;
  }

  /**
   * Coronary supply of the last beat (E2), null with the legacy engine or before the first beat. `endo` / `epi` are the driving pressures of
   * the subendocardial and subepicardial layer (mmHg, see `BeatSupply`), `endoIndex` / `epiIndex` those over the default patient's (1 = normal),
   * `bed` the pressure the network is solved at for the layer (the aortic equivalent) and `beds` each bed's flow-to-demand ratio at the two layers
   * (`endo`, `epi`; 1 = demand met) and its ischemia severity at the subendocardium. Solves the network twice, so it costs a few ms.
   */
  coronarySupply() {
    const c = this.engine === "core" ? this.cor.last : null;
    if (!c || !this.analysis) return null;
    const solve = (p: number) => solveNetwork(this.tree, this.n.lesions, this.demand * this.solvedDemand, (p + COUPLING.offset) * MMHG, this.grafts);
    const en = solve(c.endo), ep = solve(c.epi);
    const beds = Object.fromEntries(en.terminals.map((t, i) => [t.key, { endo: +t.ratio.toFixed(3), epi: +ep.terminals[i].ratio.toFixed(3), severity: +t.severity.toFixed(3) }]));
    return {
      endo: c.endo, epi: c.epi, endoIndex: supplyIndex(c.endo, "endo"), epiIndex: supplyIndex(c.epi, "epi"), transmural: c.transmural,
      dpti: c.dpti, tti: c.tti, viability: c.tti > 0 ? c.dpti / c.tti : 0, diastolicFraction: c.diastolicFraction, lvedp: c.lvedp, perfusion: this.perfusion, beds,
    };
  }

  /** Myocardial oxygen demand relative to the patient's own: the drug effects on the ventricle (`DEMAND`), times the unloading of the devices (`SUPPORT`). */
  private coreDemand(): number {
    const K = SUPPORT, s = this.support;
    return Math.max(0.5, this.pk.effects().demand * (1 - K.impellaDemand * +s.impella - K.iabpDemand * +s.iabp));
  }

  /** Flow the circulation gets from its pumps now, L/min: the Impella's (LV to aorta) and the ECMO circuit's (RA to descending aorta); the Impella RP is in series with the lungs and adds nothing. */
  private deviceFlowNow(): number {
    const taps = this.live!.engine.sample().taps;
    // an Impella with its inflow in the aorta only recirculates aorta to aorta: it adds nothing to the output
    return (this.impella?.position === "aortic" ? 0 : taps["impella"]?.flow ?? 0) + (taps["ecmo"]?.flow ?? 0);
  }

  /**
   * Catheter-style numbers of the core engine, means over the beats of the last `seconds` (mmHg, ml): CVP (mean RA), PCWP (mean
   * LA), LVEDP and RVEDP (ventricular pressure at the start of the beat), PA systolic/diastolic/mean, LV end-diastolic and
   * end-systolic volume, and `filling` (C1): stressed and unstressed blood volume per node and in total, ml, and the mean systemic
   * filling pressure `filling.msfp`, mmHg (see `filling()`). null with the legacy engine or before the first beat.
   */
  hemo(seconds = 10) {
    const live = this.live;
    if (!live) return null;
    const rs = live.records.filter((b) => b.t - this.delta > this.t - seconds);
    if (!rs.length) return null;
    const mean = (f: (b: LiveBeat) => number) => rs.reduce((s, b) => s + f(b), 0) / rs.length;
    const ed = endDiastolicBeats(rs, (b) => b.pvc), meanEd = (f: (b: LiveBeat) => number) => ed.reduce((s, b) => s + f(b), 0) / ed.length; // not cut short by a premature beat
    return {
      cvp: mean((b) => b.p.RA.mean), pcwp: mean((b) => b.p.LA.mean), lvedp: meanEd((b) => b.p.LV.end), rvedp: meanEd((b) => b.p.RV.end),
      pa: { systolic: mean((b) => b.p.PA.max), diastolic: mean((b) => b.p.PA.min), mean: mean((b) => b.p.PA.mean) },
      lvEdv: meanEd((b) => b.edv.LV), lvEsv: meanEd((b) => b.esv.LV), beats: rs.length, filling: live.filling(),
    };
  }

  /**
   * Stressed volume and mean systemic filling pressure of the core engine now (C1), null with the legacy engine: total, stressed
   * and unstressed blood volume (ml), the same per node (`nodes`), `msfp` (mmHg, the pressure every vessel and chamber would settle
   * to after a stop-flow, from the compliances and the total volume) and `systemic` (the estimate from the systemic vessels alone).
   * Venous tone moves blood from the unstressed to the stressed volume and raises `msfp`; blood given or lost changes the total.
   */
  filling() { return this.live ? this.live.filling() : null; }

  /**
   * The fluid compartments of the core engine now (C2), null with the legacy engine (`FluidReadout`, core/fluids.ts): plasma, red cell,
   * blood and interstitial volume (ml), hematocrit and Hb (g/dl), plasma protein and the oncotic pressures, capillary and interstitial
   * pressure (mmHg), filtration, lymph and the net transcapillary flow out of the vessels (ml per clinical minute; negative while the
   * interstitium refills the plasma), urine, and the cumulative fluid given, blood lost and urine (ml). `conservation` is the error of
   * the total water balance, ml (zero up to rounding). Lung water (C3): `lungWater` (extravascular lung water, ml), `lungWaterExcess`,
   * `lungWaterIndex` (ml per kg), the pulmonary capillary and lung interstitial pressures, lung filtration and lymph (ml/min) and
   * `lungSatDrop`, the fall of the pulmonary venous saturation (a fraction).
   */
  fluids(): (FluidReadout & { conservation: number }) | null {
    return this.fluidModel ? { ...this.fluidModel.read(), conservation: this.fluidModel.balance() } : null;
  }

  /** Apply the `fluids` section of a spec to the compartments: doses (kept, added or stopped), the bleeding rate and the capillary leak. Absent fields are off. */
  private setFluidSpec(f: FluidSpec) {
    const fm = this.fluidModel!;
    fm.setDoses(f.given ?? []);
    fm.hemorrhage = f.hemorrhageMlMin ?? 0;
    fm.leak = f.capillaryLeak ?? 0;
  }
  private patchFluids(patch: PatientSpec) {
    this.fluidSpec = normalizePatient({ fluids: patch.fluids }).spec.fluids ?? {};
    if (this.fluidModel) this.setFluidSpec(this.fluidSpec);
  }

  /** The pericardial sac now (core engine with a `pericardium` in the spec): effusion ml, pericardial pressure mmHg, sac volume ml. null without a sac. */
  pericardium(): { effusionMl: number; pressureMmHg: number; sacVolumeMl: number } | null {
    const live = this.live;
    if (!live || !this.sac()) return null;
    const t = live.engine.sample().taps.pericardium;
    return { effusionMl: t.effusionMl, pressureMmHg: t.pericardialPressure, sacVolumeMl: t.sacVolumeMl };
  }

  /**
   * Pericardiocentesis (core engine with a sac): remove up to `ml` of effusion from the running patient now. The effusion comes off the sac's own
   * (including what has accumulated since the spec was set), the spec in force keeps what is left, and the rate of accumulation is unchanged
   * (a bleed that continues refills the sac). Returns the ml removed (0 without a sac or with the legacy engine). `apply({ pericardium: { drainMl } })`
   * does the same through a patch, which is how `corosim_adjust` and the playground ask for it.
   */
  drainPericardium(ml: number): number {
    const before = this.sac()?.effusionMl;
    if (this.engine !== "core" || before === undefined || !(ml > 0)) return 0;
    this.patchStructure({ pericardium: { drainMl: ml } });
    return before - (this.sac()?.effusionMl ?? 0);
  }

  /** Run for `seconds` of simulated time and return the beats that occurred. */
  run(seconds: number): BeatRecord[] {
    const from = this.history.length ? this.history[this.history.length - 1].n + 1 : 0;
    const start = this.t;
    this.step(seconds);
    return this.history.filter((b) => b.n >= from && b.t > start);
  }

  /** Let the reflex loop settle without returning beats. No clinical time passes, so no muscle is lost while settling. */
  warmup(seconds: number) { if (this.job) this.jobWarm = Math.max(this.jobWarm, seconds); else this.step(seconds, { minutes: 0 }); } // while the core engine is being built, the warm-up follows the build

  metrics(lastSeconds?: number): Metrics {
    const from = lastSeconds ? this.t - lastSeconds : 0;
    const beats = this.history.filter((b) => b.t >= from);
    return computeMetrics(beats, Math.min(this.t, lastSeconds ?? this.t));
  }

  /** Mean of the last `seconds` of beats: what a monitor shows. Device flow is added to cardiac output. */
  rolling(seconds = 10) {
    const recent = this.history.filter((b) => b.t > this.t - seconds);
    const avg = (f: (b: BeatRecord) => number) => (recent.length ? recent.reduce((s, b) => s + f(b), 0) / recent.length : NaN);
    const hr = avg((b) => b.hr), sv = avg((b) => b.sv);
    return { hr, sbp: avg((b) => b.sbp), dbp: avg((b) => b.dbp), map: avg((b) => b.map), sv, cardiacOutput: (hr * sv) / 1000 + this.circ.deviceFlow };
  }

  /** Where the patient is right now, in plain numbers. */
  state() {
    const last = this.history[this.history.length - 1];
    const roll = this.rolling(10), r0 = (x: number) => (Number.isFinite(x) ? Math.round(x) : null);
    const cond = this.analysis.cond, rs = this.rstate, c = this.circ;
    const beds = cond.terminals.map((x) => ({ bed: x.key, artery: x.segId, massPct: +(x.mass * 100).toFixed(1), flowRatio: +x.ratio.toFixed(2), ischemia: +(this.sev[x.key] ?? 0).toFixed(2), infarcted: +(this.scar[x.key] ?? 0).toFixed(2) }));
    const compromised = beds.filter((b) => b.ischemia > 0.05 || b.infarcted > 0.05).sort((a, b) => b.ischemia * b.massPct - a.ischemia * a.massPct);
    const af = rs.rhythm === "af";
    const label = (af ? (rs.avDegree === 3 ? "atrial fibrillation with complete heart block, junctional escape" : "atrial fibrillation")
      : rs.avDegree === 3 ? "complete heart block, junctional escape" : rs.avDegree === 2 ? "Mobitz I (Wenckebach)" : rs.avDegree === 1 ? "first-degree AV block" : "sinus")
      + (rs.bbb === "rbbb" ? ", right bundle branch block" : rs.bbb === "lbbb" ? ", left bundle branch block" : "") + (this.paced() ? ", paced" : "");
    return {
      timeS: +this.t.toFixed(1),
      clinicalMinutes: Math.round(this.clinicalMinutes),
      lastBeat: last ?? null,
      rolling10s: { hr: r0(roll.hr), sbp: r0(roll.sbp), dbp: r0(roll.dbp), map: r0(roll.map), sv: r0(roll.sv), cardiacOutput: Number.isFinite(roll.cardiacOutput) ? +roll.cardiacOutput.toFixed(1) : null },
      meanArterialPressure: Math.round(this.map),
      coronaryPerfusionPressure: Math.round(this.perfusion),
      rhythm: { label, sinusRate: Math.round(rs.sinusRate), avBlock: rs.avDegree, pvcSeverity: +rs.pvcSeverity.toFixed(2), baseline: { ...this.patient } },
      treatment: {
        ischemicMinutes: Math.round(this.ischemicMinutes),
        stent: this.treated.stent, lysis: this.treated.lysed, grafted: this.treated.grafts.length > 0,
      },
      ventricle: { ejectionFraction: +c.ejectionFraction.toFixed(2), lvInfarctFraction: +lvInfarctSize(this.sites, this.scar).toFixed(3), lvIschemia: +c.lvIschemia.toFixed(2), rvIschemia: +c.rvIschemia.toFixed(2), pulmonaryCongestion: +c.congestion.toFixed(2) },
      support: { ...supportSpec(this.support), deviceFlowLpm: +c.deviceFlow.toFixed(1), atropine: this.support.atropine || this.n.drugs.atropine >= 0.5 },
      circulationState: this.map < CIRC.shockMap ? "shock" : this.map < CIRC.hypotensionMap ? "hypotension" : "stable",
      ischemicMassFraction: +cond.atRisk.toFixed(3),
      compromisedBeds: compromised.slice(0, 8),
      ffr: this.analysis.ffr.map((f, i) => ({ artery: this.n.lesions[i]?.segId, ffr: +f.toFixed(2) })),
    };
  }

  /**
   * The 12-lead ECG as a reader would report it: ST level (mm, at J + 60 ms) in every lead including V7–V9, the
   * leads with ≥ 1 mm elevation or depression, rhythm and QRS conduction. Computed from the same injury currents the
   * app's ECG strip draws.
   */
  ecg() {
    const rs = this.rstate, last = this.history[this.history.length - 1];
    const beat: Beat = { t: 10, rr: last ? last.interval : 60 / CIRC.baseRate, pvc: false, pr: rs.pr, bbb: rs.bbb === "none" ? undefined : rs.bbb, noP: rs.rhythm === "af" };
    const g = globalSeverity(ischemicBurden(this.sites, this.sev)), inj = injuryVector(this.sites, this.sev, this.transmural);
    const st = Object.fromEntries(ALL_LEADS.map((l) => [l, Math.round(stLevelVec(l, beat, [beat], inj, ST.tBoost * g) * 100) / 10])) as Record<LeadName, number>;
    const recent = this.history.filter((b) => b.t > this.t - 10);
    return {
      stMm: st,
      stElevation: ALL_LEADS.filter((l) => st[l] >= 1),
      meetsStemiCriteria: meetsStElevation(st),
      stDepression: ALL_LEADS.filter((l) => st[l] <= -1),
      rhythm: this.state().rhythm.label,
      ventricularRate: recent.length ? Math.round(recent.reduce((a, b) => a + b.hr, 0) / recent.length) : null,
      pvcsLast10s: recent.filter((b) => b.pvc).length,
      prMs: rs.rhythm === "af" || rs.avDegree === 3 ? null : Math.round(rs.pr * 1000),
      electricalAlternans: alternansAmplitude(this.sac()?.effusionMl, this.periSpec?.open), // QRS alternates 1 +/- this on alternate beats (large pericardial effusion); 0 = none
      qrs: rs.bbb === "lbbb" ? "wide, left bundle branch block" : rs.bbb === "rbbb" ? "wide, right bundle branch block" : "narrow",
      ischemia: this.ischemiaPattern(),
      note: "ST in mm at J+60 ms; V7–V9 are posterior leads. Subendocardial (demand) ischemia gives non-localizing ST depression; transmural ischemia gives localizing ST elevation. No Q waves or T-wave inversion are modelled.",
    };
  }

  /** Whether the ischemia is subendocardial, transmural or mixed, by mass. */
  private ischemiaPattern(): "none" | "subendocardial" | "mixed" | "transmural" {
    let w = 0, tm = 0;
    for (const s of this.sites) { const x = (this.sev[s.key] ?? 0) * s.mass; w += x; tm += x * (this.transmural[s.key] ?? 1); }
    if (w < 0.005) return "none";
    const f = tm / w;
    return f < 0.25 ? "subendocardial" : f > 0.75 ? "transmural" : "mixed";
  }

  /** What the guidelines would say now: problems, harmful choices in progress, and next steps (the app's advisor). */
  assessment(): Assessment {
    const first = this.n.lesionSpecs[0], c = this.circ, roll = this.rolling(10), ecg = this.ecg();
    const reperfused = this.treated.stent || this.treated.lysed === true || this.treated.grafts.length > 0;
    return assess({
      hasLesion: !!first && !reperfused, occluded: !!first?.occluded, ds: first?.stenosis ?? 0,
      ffr: first && !first.occluded ? this.analysis.ffr[0] ?? null : null, leftMain: first?.artery === "LM",
      stElevation: meetsStElevation(ecg.stMm), // two contiguous leads; aVR alone does not count
      diffuseDepressionAvr: ecg.stMm.aVR >= 1 && LEADS.filter((l) => ecg.stMm[l] <= -1).length >= 4,
      map: this.map, cardiacOutput: Number.isFinite(roll.cardiacOutput) ? roll.cardiacOutput : c.cardiacOutput,
      lvIschemia: c.lvIschemia, rvIschemia: c.rvIschemia, avDegree: this.rstate.avDegree,
      hr: Number.isFinite(roll.hr) ? roll.hr : c.hr, vagal: this.rstate.vagal, congestion: c.congestion,
      minutesIschemic: this.ischemicMinutes, infarctSize: lvInfarctSize(this.sites, this.scar),
      reperfused, pending: null, grafted: this.treated.grafts.length > 0, support: this.effSupport(), exertion: this.n.exertion,
    });
  }

  /**
   * Revascularize the culprit (the first lesion). The order's clinical delay runs first on the infarct clock
   * (muscle keeps dying while the team gets there), then the procedure lands as in the app: PCI stents the lesion
   * open, a fibrinolytic opens an occlusion in about half of patients and leaves a stenosis, CABG grafts beyond it.
   */
  revascularize(kind: Procedure) {
    const first = this.n.lesionSpecs[0];
    if (!first) throw new Error("There is no lesion to treat.");
    const lvBefore = lvInfarctSize(this.sites, this.scar), delay = PROCEDURE[kind].delayMin;
    this.step(delay / this.minutesPerSecond, { minutes: delay }); // the wait, in heartbeats and clinical minutes
    const lvAtArrival = lvInfarctSize(this.sites, this.scar);
    const lesion = this.n.lesions.find((l) => l.segId === first.artery) ?? null;
    const r = applyProcedure(kind, lesion, this.tree, this.n.seed + 11);
    const others = this.n.lesionSpecs.slice(1);
    let result: string;
    if (kind === "pci") { this.treated.stent = true; this.apply({ lesions: others }); result = `Stent placed in the ${first.artery}; flow restored.`; }
    else if (kind === "cabg") { this.treated.grafts = r.graft ?? []; this.setGrafts(this.treated.grafts); result = `Graft sewn onto the ${first.artery} beyond the lesion; the native lesion remains.`; }
    else if (r.lysed === undefined) result = "No clot to lyse: fibrinolysis does nothing for a fixed stenosis.";
    else if (r.lysed) { this.treated.lysed = true; this.apply({ lesions: [{ ...first, occluded: false, stenosis: r.lesion!.ds }, ...others] }); result = `The clot lysed; a ${Math.round(r.lesion!.ds * 100)}% stenosis remains.`; }
    else { this.treated.lysed = false; result = "Fibrinolysis failed: the artery is still closed. Rescue PCI is the next step."; }
    return { procedure: PROCEDURE[kind].label, delayMinutes: delay, result, lvInfarctBefore: +lvBefore.toFixed(3), lvInfarctAtArrival: +lvAtArrival.toFixed(3) };
  }

  /** The serialisable scenario, including what the app's controls have changed since it was loaded. */
  scenario(): Scenario {
    const s = toScenario({ ...this.n, support: this.support, patient: this.patient });
    if (this.support.atropine) s.drugs = { ...s.drugs, atropine: Math.max(s.drugs?.atropine ?? 0, 1) };
    return s;
  }
}
