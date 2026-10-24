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
import { BeatStream } from "../physics/beatStream";
import { BeatHemodynamics } from "../physics/beatHemo";
import { Autonomic, AUTONOMIC, AutonomicEffects } from "../physics/autonomic";
import { LiveHeart, LiveBeat } from "../physics/core/live";
import { PlaceholderImpella } from "../physics/core/devices/placeholder";
import { VolumeExchange } from "../physics/core/volume";
import { NODES } from "../physics/structuralGraph";
import { PATIENTS } from "../config/structural";
import { ACS_CORE, PLACEHOLDER_WARNINGS } from "../config/acsCore";
import { ischemiaFactors } from "../config/ischemia";
import { Normalized, Scenario, normalizeScenario, toScenario, supportSpec } from "./scenario";
import { BeatRecord, computeMetrics, Metrics } from "./metrics";

/** Drug and volume changes ramp in over seconds instead of stepping, so interventions play out as transients. */
const DRUG_TAU = 8, VOLUME_TAU = 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
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
  // ---- core engine state
  private impella?: PlaceholderImpella;
  private exchange?: VolumeExchange;
  private bv0 = 4900;
  private volApplied = 0; // ml added (+) or removed (-) from the circulation so far, by fluids and hemorrhage
  private fluidGiven = 0; // litres of fluid, ramped
  private impellaLevel = 0; // 0..1, ramped
  private delta = NaN; // s: live time = stream time + delta, set when the first beat is aligned
  private fed = new WeakSet<Beat>();
  private fx: AutonomicEffects = NEUTRAL_FX;
  private fxQueue: AutonomicEffects[] = [];
  private liveSeen = false;
  private sm = { sv: 0, co: 0, ef: 0, pcwp: 0, cvp: 0, sbp: 0, dbp: 0, dev: 0 };
  private base!: Circulation; // circulation() of the legacy model: the fractions and demand the core circ borrows

  constructor(input: Scenario = {}, opts: { engine?: EngineKind } = {}) {
    this.engine = opts.engine ?? "legacy";
    this.mod = {
      rate: (t) => (this.paced() ? 1 : this.autonomic.hrScaleAt(t)),
      jitter: () => (this.paced() ? 0 : this.autonomic.jitter()),
    };
    this.reset(input);
  }

  /** Start over from a scenario. `settled` puts ischemia at its steady value instead of starting from a normal heart. */
  reset(input: Scenario = {}, opts: { settled?: boolean } = {}) {
    const { scenario, warnings } = normalizeScenario(input);
    this.live = undefined; this.liveSeen = false;
    this.n = scenario; this.warnings = warnings;
    this.support = { ...scenario.support }; this.patient = { ...scenario.patient }; this.grafts = [];
    this.t = 0; this.clinicalMinutes = 0; this.ischemicMinutes = 0; this.treated = untreated(); this.history = []; this.beatCount = 0;
    for (const k of Object.keys(this.sev)) delete this.sev[k];
    for (const k of Object.keys(this.scar)) delete this.scar[k];
    this.map = this.perfusion = this.solvedPerfusion = CIRC.baseMap; this.solvedDemand = 1; this.mapClock = 0;
    this.drug = { ...scenario.drugs }; this.bloodLoss = scenario.bloodLoss;
    this.stream = new BeatStream(scenario.seed, Simulation.LOOKAHEAD, 0.05);
    this.beatHemo = new BeatHemodynamics();
    this.autonomic = new Autonomic(scenario.seed);
    this.autonomic.controls = { ...scenario.autonomic };
    this.rebuildAnatomy();
    this.updateCirculation();
    if (opts.settled) { Object.assign(this.sev, this.target); this.updateCirculation(); }
    if (this.engine === "core") this.initCore();
  }

  /** Back to a resting heart with the same scenario: no ischemia, no scar, pressure at baseline. */
  resetPhysiology() {
    for (const k of Object.keys(this.sev)) delete this.sev[k];
    for (const k of Object.keys(this.scar)) delete this.scar[k];
    this.map = this.perfusion = this.solvedPerfusion = CIRC.baseMap; this.solvedDemand = 1; this.clinicalMinutes = 0; this.ischemicMinutes = 0;
    this.beatHemo.reset();
    this.resolveCoronaries(true);
    this.updateCirculation();
    if (this.engine === "core") this.initCore();
  }

  /** Change part of the scenario while it runs (add a lesion, give a drug, drop the volume). State carries over. */
  apply(patch: Scenario) {
    const prev = { ...this.n, support: { ...this.support }, patient: { ...this.patient } };
    const { scenario, warnings } = normalizeScenario(patch, prev);
    this.warnings = warnings;
    const anatomyChanged = JSON.stringify(scenario.anatomy) !== JSON.stringify(prev.anatomy);
    this.n = scenario;
    if (patch.support) this.support = { ...scenario.support, atropine: this.support.atropine };
    this.addDeviceWarnings();
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
    this.rstate = supportedRhythm(rhythmState(this.sites, this.sev, g, this.patient), sup);
    const c = circulation(this.sites, this.sev, this.rstate, sup, this.scar, 1); // the baroreflex is dynamic here
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
    const total = opts.minutes ?? dt * this.speed * this.minutesPerSecond;
    let left = dt;
    while (left > 1e-9) { const h = Math.min(left, Simulation.DT); this.sub(h, dt > 0 ? (total * h) / dt : 0); left -= h; }
    return total;
  }

  private slew(h: number) {
    const a = 1 - Math.exp(-(h * this.speed) / DRUG_TAU), v = 1 - Math.exp(-(h * this.speed) / VOLUME_TAU);
    for (const k of ["betaBlocker", "atropine", "vasopressor"] as const) this.drug[k] += (this.n.drugs[k] - this.drug[k]) * a;
    this.bloodLoss += (this.n.bloodLoss - this.bloodLoss) * v;
    this.fluidGiven += (this.support.fluids - this.fluidGiven) * v; // only the core engine reads it
  }

  private sub(h: number, minutes: number) {
    for (const s of this.sites) this.sev[s.key] = stepSeverity(this.sev[s.key] ?? 0, this.target[s.key] ?? 0, h * this.speed);
    if (minutes > 0) {
      for (const s of this.sites) this.scar[s.key] = stepNecrosis(this.scar[s.key] ?? 0, this.sev[s.key] ?? 0, minutes);
      this.clinicalMinutes += minutes;
      if (ischemicBurden(this.sites, this.sev) > 0.005) this.ischemicMinutes += minutes;
    }
    this.slew(h);
    this.updateCirculation();
    const ctl = this.autonomic.controls;
    ctl.betaBlock = this.drug.betaBlocker;
    ctl.vagalBlock = Math.max(this.drug.atropine, this.support.atropine ? 1 : 0);
    ctl.volumeDeficit = Math.max(0, this.live ? this.bloodLoss - (this.fluidGiven * 1000 * ACS_CORE.fluidRetained) / this.bv0 : this.bloodLoss); // core: the net deficit, fluids refill it
    this.autonomic.step(h);
    this.stream.extend(this.t, this.rstate, this.mod);
    this.stream.prune(this.t);
    this.t += h;
    if (this.live) this.coreStep(h); else for (const b of this.stream.drain(this.t)) this.handleBeat(b);
    // Coronary perfusion follows the pressure the heart actually generates (plus any balloon augmentation),
    // and demand follows what drugs and devices do to it.
    const aug = this.support.iabp ? SUPPORT.iabpCoronaryAug : 0;
    this.perfusion += (this.map + aug - this.perfusion) * (1 - Math.exp(-(h * this.speed) / 2));
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
  //    circulation() has: x (1 + 0.2 sympathetic) x (1 - 0.12 vagal), and the vasopressor drug), venous tone 1 + 0.2 (vascular tone - rest) + 0.35 tanh(deficit / 0.2)
  //    (the volume-deficit reflex on the veins; deficit = fraction of blood volume lost net of fluids; the reflex on rate and tone as before); rate arrives as beats;
  //  - support: norepinephrine resistance x (1 + 0.35 d) and venous tone x (1 + 0.3 d); dobutamine Ees x (1 + 0.45 d) and resistance
  //    x (1 - 0.12 d); nitroglycerin venous tone x (1 - 0.2 e_v) (e_v = min(1, d / 0.4)) then resistance x (1 - 0.22 e_a)
  //    (e_a = max(0, (d - 0.2) / 0.8)); fluids add `fluidRetained` x litres of blood (ramped, like the hemorrhage that removes
  //    blood); impella and IABP are PLACEHOLDERS (see PLACEHOLDER_WARNINGS);
  //  - outputs: `circ` is filled from the smoothed beats (see coreCirc).
  // ======================================================================================================================

  private feedFrom = 0; // stream time before which beats belong to a previous heart
  private warmHr = 72;

  /** Blood (ml) the circulation should hold relative to the patient's own: fluids given less blood lost. */
  private targetVolume(): number { return this.fluidGiven * 1000 * ACS_CORE.fluidRetained - this.bloodLoss * this.bv0; }

  private initCore() {
    const p = PATIENTS.adult;
    this.sm = { sv: 0, co: 0, ef: 0, pcwp: 0, cvp: 0, sbp: 0, dbp: 0, dev: 0 };
    this.fed = new WeakSet(); this.fxQueue = []; this.fx = NEUTRAL_FX; this.liveSeen = false; this.delta = NaN; this.feedFrom = this.t;
    this.bv0 = p.bloodMlPerKg * p.weightKg;
    this.fluidGiven = this.support.fluids;
    this.volApplied = Math.max(ACS_CORE.startVolumeMl[0], Math.min(ACS_CORE.startVolumeMl[1], this.targetVolume())); // what the structural spec accepts; the rest follows at the rate limit
    const veins = ["SVC", "IVC", "SPL"].map(NODE), vessels = ["SVC", "IVC", "SPL", "PA", "PV", "AO", "DAO"].map(NODE);
    const impella = (this.impella = new PlaceholderImpella(NODE("LV"), NODE("AO"), { margin: ACS_CORE.impellaMargin, width: ACS_CORE.impellaWidth }));
    this.exchange = new VolumeExchange("volumeExchange", veins, vessels);
    const live = (this.live = new LiveHeart({ volumeMl: this.volApplied }, { extra: [impella, this.exchange] }));
    impella.set({ v0: live.model.chambers[NODE("LV")]!.v0 });
    this.impellaLevel = this.support.impella ? 1 : 0;
    this.pushImpella();
    this.pushInputs();
    this.warmHr = Math.max(20, ventRate(this.rstate));
    live.warm(this.warmHr);
    live.onRecord((b) => this.handleLiveBeat(b));
    this.sensor = { events: [], tStart: NaN, start: 0, peak: 0, armed: false, ao: live.engine.node("AO") };
    live.engine.onSample((smp) => this.senseTick(smp.t, smp.P[this.sensor.ao]));
    this.addDeviceWarnings();
  }

  /** The placeholder devices say what they are in `warnings` whenever one is on. */
  private addDeviceWarnings() {
    if (this.engine !== "core") return;
    for (const [on, msg] of [[this.support.impella, PLACEHOLDER_WARNINGS.impella], [this.support.iabp, PLACEHOLDER_WARNINGS.iabp]] as const)
      if (on && !this.warnings.includes(msg)) this.warnings = [...this.warnings, msg];
  }

  private pushImpella() { this.impella?.set({ flow: (this.impellaLevel * SUPPORT.impellaFlow * 1000) / 60 }); }

  /** Slow inputs of the heart from the ischemia, the autonomic state, the drugs and the devices (see the mapping above). */
  private pushInputs() {
    const live = this.live!, K = ACS_CORE, S = SUPPORT, sup = this.support, fx = this.fx, rs = this.rstate, vaso = this.drug.vasopressor;
    live.setVentricleFactors(ischemiaFactors(this.base.lvIschemia, this.base.rvIschemia));
    const nitroV = Math.min(1, sup.nitro / K.nitroVenousFull), nitroA = Math.max(0, (sup.nitro - K.nitroArterialOnset) / (1 - K.nitroArterialOnset));
    const resistance = fx.resistance * (vaso >= 0 ? 1 + 0.5 * vaso : 1 + 0.4 * vaso)
      * (1 + CIRC.sympatheticSvr * rs.sympathetic) * (1 - CIRC.vagalSvr * rs.vagal)
      * (1 + S.norepiSvr * sup.norepi) * (1 - S.dobSvr * sup.dobutamine) * (1 - S.nitroSvr * nitroA) * (sup.iabp ? 1 - K.iabpAfterload : 1);
    const venousTone = (1 + K.venousToneGain * (fx.vascular - AUTONOMIC.restSympathetic) + K.volumeVenousMax * Math.tanh(this.autonomic.controls.volumeDeficit / K.volumeVenousScale)) * (1 + K.norepiVenousTone * sup.norepi) * (1 - K.nitroVenousTone * nitroV);
    live.setModifiers({ contractility: fx.contractility * (1 + S.dobContractility * sup.dobutamine), resistance, venousTone });
  }

  /** One sub-step: hand over the new beats, set the slow inputs, move blood in or out, and advance the live heart to the simulation's clock. */
  private coreStep(h: number) {
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
    this.impellaLevel += ((this.support.impella ? 1 : 0) - this.impellaLevel) * (1 - Math.exp(-dt / ACS_CORE.impellaTau));
    this.pushImpella();
    this.addDeviceWarnings();
    this.pushInputs();
    const q = Math.max(-ACS_CORE.maxVolumeRate, Math.min(ACS_CORE.maxVolumeRate, (this.targetVolume() - this.volApplied) / dt)); // ml/s, so the circulation holds the (ramped) volume
    this.exchange!.set({ rate: q }); this.volApplied += q * dt;
    live.step(dt);
    if (this.impellaLevel > 1e-3 || this.sm.dev > 1e-3) this.sm.dev += (this.deviceFlowNow() - this.sm.dev) * (1 - Math.exp(-dt / ACS_CORE.deviceFlowTau));
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
    if (t - k.tStart >= ACS_CORE.senseDelay) { this.autonomic.sense(k.peak + ACS_CORE.baroOffset, k.start + ACS_CORE.baroOffset); k.armed = false; }
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

  /**
   * `circ` from the live heart, given the legacy `circulation()` result `c` (which supplies only the ischemic fractions, the
   * rate the rhythm implies, the support's oxygen demand factor). From the smoothed beats (time constant `ACS_CORE.smoothTau`):
   *  - strokeVolume, ml: net volume through the aortic valve; cardiacOutput, L/min: its per-beat rate plus the device flow;
   *  - map, systolic, diastolic, mmHg: the smoothed mean, peak and start-of-beat aortic pressure;
   *  - svr, mmHg·min/L: MAP / CO as BASE_SVR is defined (no venous pressure subtracted);
   *  - deviceFlow, L/min: the Impella placeholder's, smoothed over `deviceFlowTau` (it follows the cardiac cycle);
   *  - congestion, 0..1: from the smoothed PCWP (left atrial mean), 0 up to 12 mmHg, 1 at 25 (`pcwpOnset`, `pcwpFull`);
   *  - ejectionFraction: stroke volume / end-diastolic volume of the LV;
   *  - coronaryPressure: the smoothed MAP plus the IABP placeholder's augmentation;
   *  - state: from the smoothed MAP as `state()` does.
   */
  private coreCirc(c: Circulation): Circulation {
    const K = ACS_CORE, sm = this.sm, dev = sm.dev;
    const co = sm.co + dev;
    return {
      ...c, strokeVolume: sm.sv, cardiacOutput: co, map: this.map, systolic: sm.sbp, diastolic: sm.dbp,
      svr: co > 0.1 ? this.map / co : c.svr, coronaryPressure: this.map + (this.support.iabp ? SUPPORT.iabpCoronaryAug : 0), deviceFlow: dev,
      congestion: Math.min(1, Math.max(0, (sm.pcwp - K.pcwpOnset) / (K.pcwpFull - K.pcwpOnset))), ejectionFraction: sm.ef,
      state: this.map < CIRC.shockMap ? "shock" : this.map < CIRC.hypotensionMap ? "hypotension" : "stable",
    };
  }

  private deviceFlowNow(): number {
    const t = this.live!.engine.sample().taps["impellaPlaceholder"];
    return t ? t.flow : 0;
  }

  /**
   * Catheter-style numbers of the core engine, means over the beats of the last `seconds` (mmHg, ml): CVP (mean RA), PCWP (mean
   * LA), LVEDP and RVEDP (ventricular pressure at the start of the beat), PA systolic/diastolic/mean, LV end-diastolic and
   * end-systolic volume. null with the legacy engine or before the first beat.
   */
  hemo(seconds = 10) {
    const live = this.live;
    if (!live) return null;
    const rs = live.records.filter((b) => b.t - this.delta > this.t - seconds);
    if (!rs.length) return null;
    const mean = (f: (b: LiveBeat) => number) => rs.reduce((s, b) => s + f(b), 0) / rs.length;
    return {
      cvp: mean((b) => b.p.RA.mean), pcwp: mean((b) => b.p.LA.mean), lvedp: mean((b) => b.p.LV.end), rvedp: mean((b) => b.p.RV.end),
      pa: { systolic: mean((b) => b.p.PA.max), diastolic: mean((b) => b.p.PA.min), mean: mean((b) => b.p.PA.mean) },
      lvEdv: mean((b) => b.edv.LV), lvEsv: mean((b) => b.esv.LV), beats: rs.length,
    };
  }

  /** Run for `seconds` of simulated time and return the beats that occurred. */
  run(seconds: number): BeatRecord[] {
    const from = this.history.length ? this.history[this.history.length - 1].n + 1 : 0;
    const start = this.t;
    this.step(seconds);
    return this.history.filter((b) => b.n >= from && b.t > start);
  }

  /** Let the reflex loop settle without returning beats. No clinical time passes, so no muscle is lost while settling. */
  warmup(seconds: number) { this.step(seconds, { minutes: 0 }); }

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
