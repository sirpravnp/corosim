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
import { BedSite, bedSites, ischemicBurden, globalSeverity, injuryVector } from "../physics/ecgLink";
import { rhythmState, RhythmState, SinusModulation, Patient } from "../physics/rhythm";
import { circulation, Circulation, CIRC } from "../physics/circulation";
import { Support, supportedRhythm } from "../physics/support";
import { BeatStream } from "../physics/beatStream";
import { BeatHemodynamics } from "../physics/beatHemo";
import { Autonomic } from "../physics/autonomic";
import { Normalized, Scenario, normalizeScenario, toScenario, supportSpec } from "./scenario";
import { BeatRecord, computeMetrics, Metrics } from "./metrics";

/** Drug and volume changes ramp in over seconds instead of stepping, so interventions play out as transients. */
const DRUG_TAU = 8, VOLUME_TAU = 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MAX_HISTORY = 20000; // beats kept for metrics (~3 h at 70 bpm)

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

  constructor(input: Scenario = {}) {
    this.mod = {
      rate: (t) => (this.paced() ? 1 : this.autonomic.hrScaleAt(t)),
      jitter: () => (this.paced() ? 0 : this.autonomic.jitter()),
    };
    this.reset(input);
  }

  /** Start over from a scenario. `settled` puts ischemia at its steady value instead of starting from a normal heart. */
  reset(input: Scenario = {}, opts: { settled?: boolean } = {}) {
    const { scenario, warnings } = normalizeScenario(input);
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
  }

  /** Back to a resting heart with the same scenario: no ischemia, no scar, pressure at baseline. */
  resetPhysiology() {
    for (const k of Object.keys(this.sev)) delete this.sev[k];
    for (const k of Object.keys(this.scar)) delete this.scar[k];
    this.map = this.perfusion = this.solvedPerfusion = CIRC.baseMap; this.solvedDemand = 1; this.clinicalMinutes = 0; this.ischemicMinutes = 0;
    this.beatHemo.reset();
    this.resolveCoronaries(true);
    this.updateCirculation();
  }

  /** Change part of the scenario while it runs (add a lesion, give a drug, drop the volume). State carries over. */
  apply(patch: Scenario) {
    const prev = { ...this.n, support: { ...this.support }, patient: { ...this.patient } };
    const { scenario, warnings } = normalizeScenario(patch, prev);
    this.warnings = warnings;
    const anatomyChanged = JSON.stringify(scenario.anatomy) !== JSON.stringify(prev.anatomy);
    this.n = scenario;
    if (patch.support) this.support = { ...scenario.support, atropine: this.support.atropine };
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
  }

  private updateCirculation() {
    const g = globalSeverity(ischemicBurden(this.sites, this.sev)), sup = this.effSupport();
    this.rstate = supportedRhythm(rhythmState(this.sites, this.sev, g, this.patient), sup);
    this.circ = circulation(this.sites, this.sev, this.rstate, sup, this.scar, 1); // the baroreflex is dynamic here
  }

  /** ECG injury vector and T-wave boost for the strip, from the current ischemia. */
  ecgInputs() {
    const g = globalSeverity(ischemicBurden(this.sites, this.sev));
    return { injury: injuryVector(this.sites, this.sev), tBoost: ST.tBoost * g };
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
    ctl.volumeDeficit = Math.max(0, this.bloodLoss);
    this.autonomic.step(h);
    this.stream.extend(this.t, this.rstate, this.mod);
    this.stream.prune(this.t);
    this.t += h;
    for (const b of this.stream.drain(this.t)) this.handleBeat(b);
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
    const g = globalSeverity(ischemicBurden(this.sites, this.sev)), inj = injuryVector(this.sites, this.sev);
    const st = Object.fromEntries(ALL_LEADS.map((l) => [l, Math.round(stLevelVec(l, beat, [beat], inj, ST.tBoost * g) * 100) / 10])) as Record<LeadName, number>;
    const recent = this.history.filter((b) => b.t > this.t - 10);
    return {
      stMm: st,
      stElevation: ALL_LEADS.filter((l) => st[l] >= 1),
      stDepression: ALL_LEADS.filter((l) => st[l] <= -1),
      rhythm: this.state().rhythm.label,
      ventricularRate: recent.length ? Math.round(recent.reduce((a, b) => a + b.hr, 0) / recent.length) : null,
      pvcsLast10s: recent.filter((b) => b.pvc).length,
      prMs: rs.rhythm === "af" || rs.avDegree === 3 ? null : Math.round(rs.pr * 1000),
      qrs: rs.bbb === "lbbb" ? "wide, left bundle branch block" : rs.bbb === "rbbb" ? "wide, right bundle branch block" : "narrow",
      note: "ST in mm at J+60 ms; V7–V9 are posterior leads. Limb and precordial leads only; no Q waves or T-wave inversion are modelled.",
    };
  }

  /** What the guidelines would say now: problems, harmful choices in progress, and next steps (the app's advisor). */
  assessment(): Assessment {
    const first = this.n.lesionSpecs[0], c = this.circ, roll = this.rolling(10);
    const reperfused = this.treated.stent || this.treated.lysed === true || this.treated.grafts.length > 0;
    return assess({
      hasLesion: !!first && !reperfused, occluded: !!first?.occluded, ds: first?.stenosis ?? 0,
      ffr: first && !first.occluded ? this.analysis.ffr[0] ?? null : null, leftMain: first?.artery === "LM",
      stElevation: LEADS.some((l) => this.ecg().stMm[l] >= 1),
      map: this.map, cardiacOutput: Number.isFinite(roll.cardiacOutput) ? roll.cardiacOutput : c.cardiacOutput,
      lvIschemia: c.lvIschemia, rvIschemia: c.rvIschemia, avDegree: this.rstate.avDegree,
      hr: Number.isFinite(roll.hr) ? roll.hr : c.hr, vagal: this.rstate.vagal, congestion: c.congestion,
      minutesIschemic: this.ischemicMinutes, infarctSize: lvInfarctSize(this.sites, this.scar),
      reperfused, pending: null, grafted: this.treated.grafts.length > 0, support: this.effSupport(),
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
