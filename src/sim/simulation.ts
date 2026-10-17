import { buildTree, Tree } from "../anatomy/tree";
import { Lesion, analyze, solveNetwork, Analysis } from "../physics/network";
import { FLOW } from "../config/tree";
import { ST } from "../config/ecg";
import { MMHG } from "../config/anatomy";
import { stepSeverity } from "../physics/ischemia";
import { BedSite, bedSites, ischemicBurden, globalSeverity, injuryVector } from "../physics/ecgLink";
import { rhythmState, RhythmState, SinusModulation } from "../physics/rhythm";
import { circulation, Circulation, CIRC } from "../physics/circulation";
import { BeatStream } from "../physics/beatStream";
import { BeatHemodynamics } from "../physics/beatHemo";
import { Autonomic } from "../physics/autonomic";
import { Normalized, Scenario, normalizeScenario, toScenario } from "./scenario";
import { BeatRecord, computeMetrics, Metrics } from "./metrics";

/** Drug and volume changes ramp in over seconds instead of stepping, so interventions play out as transients. */
const DRUG_TAU = 8, VOLUME_TAU = 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MAX_HISTORY = 20000; // beats kept for metrics (~3 h at 70 bpm)

/**
 * The whole model with no DOM and no renderer: anatomy → coronary network → ischemia → rhythm →
 * circulation → beats → pressure → baroreflex → back into rate, contractility and resistance.
 * The browser app, the MCP server and the tests all step this one object, so they cannot disagree.
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
  sev: Record<string, number> = {}; // per-bed ischemia 0..1
  target: Record<string, number> = {};
  t = 0;
  /** Accelerates the slow processes (ischemia kinetics, drug and volume ramps) without touching the heartbeat clock. */
  speed = 1;
  stream!: BeatStream;
  beatHemo = new BeatHemodynamics();
  autonomic!: Autonomic;
  rstate!: RhythmState;
  circ!: Circulation;
  /** Smoothed mean arterial pressure (mmHg) that perfuses the coronaries. */
  map = CIRC.baseMap;
  private solvedMap = CIRC.baseMap;
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
    this.mod = { rate: (t) => this.autonomic.hrScaleAt(t), jitter: () => this.autonomic.jitter() };
    this.reset(input);
  }

  /** Start over from a scenario. `settled` puts ischemia at its steady value and the loop at rest instead of starting from a normal heart. */
  reset(input: Scenario = {}, opts: { settled?: boolean } = {}) {
    const { scenario, warnings } = normalizeScenario(input);
    this.n = scenario; this.warnings = warnings;
    this.t = 0; this.sev = {}; this.history = []; this.beatCount = 0;
    this.map = this.solvedMap = CIRC.baseMap; this.mapClock = 0;
    this.drug = { ...scenario.drugs }; this.bloodLoss = scenario.bloodLoss;
    this.stream = new BeatStream(scenario.seed, Simulation.LOOKAHEAD, 0.05);
    this.beatHemo = new BeatHemodynamics();
    this.autonomic = new Autonomic(scenario.seed);
    this.autonomic.controls = { ...scenario.autonomic };
    this.rebuildAnatomy();
    this.updateCirculation();
    if (opts.settled) { this.sev = { ...this.target }; this.updateCirculation(); }
  }

  /** Change part of the scenario while it runs (add a lesion, give a drug, drop the volume). State carries over. */
  apply(patch: Scenario) {
    const prev = this.n;
    const { scenario, warnings } = normalizeScenario(patch, prev);
    this.warnings = warnings;
    const anatomyChanged = JSON.stringify(scenario.anatomy) !== JSON.stringify(prev.anatomy);
    this.n = scenario;
    this.autonomic.controls = { ...scenario.autonomic };
    if (anatomyChanged) this.rebuildAnatomy(); else this.resolveCoronaries(true);
  }

  private get demand() { return this.n.exertion ? FLOW.exertionDemand : 1; }

  private rebuildAnatomy() {
    this.tree = buildTree(this.n.anatomy);
    this.sites = bedSites(this.tree);
    for (const k of Object.keys(this.sev)) if (!this.sites.some((s) => s.key === k)) delete this.sev[k];
    this.resolveCoronaries(true);
  }

  private resolveCoronaries(full: boolean) {
    const lesions: Lesion[] = this.n.lesions;
    if (full) this.analysis = analyze(this.tree, lesions, this.n.exertion, this.map * MMHG);
    else this.analysis = { ...this.analysis, cond: solveNetwork(this.tree, lesions, this.demand, this.map * MMHG) };
    this.solvedMap = this.map;
    this.target = Object.fromEntries(this.analysis.cond.terminals.map((t) => [t.key, t.severity]));
  }

  private updateCirculation() {
    const g = globalSeverity(ischemicBurden(this.sites, this.sev));
    this.rstate = rhythmState(this.sites, this.sev, g);
    this.circ = circulation(this.sites, this.sev, this.rstate, 1); // the baroreflex is dynamic here
  }

  /** ECG injury vector and T-wave boost for the strip, from the current ischemia. */
  ecgInputs() {
    const g = globalSeverity(ischemicBurden(this.sites, this.sev));
    return { injury: injuryVector(this.sites, this.sev), tBoost: ST.tBoost * g };
  }

  step(dt: number) {
    while (dt > 1e-9) { const h = Math.min(dt, Simulation.DT); this.sub(h); dt -= h; }
  }

  private slew(h: number) {
    const a = 1 - Math.exp(-(h * this.speed) / DRUG_TAU), v = 1 - Math.exp(-(h * this.speed) / VOLUME_TAU);
    for (const k of ["betaBlocker", "atropine", "vasopressor"] as const) this.drug[k] += (this.n.drugs[k] - this.drug[k]) * a;
    this.bloodLoss += (this.n.bloodLoss - this.bloodLoss) * v;
  }

  private sub(h: number) {
    for (const s of this.sites) this.sev[s.key] = stepSeverity(this.sev[s.key] ?? 0, this.target[s.key] ?? 0, h * this.speed);
    this.slew(h);
    this.updateCirculation();
    const ctl = this.autonomic.controls;
    ctl.betaBlock = this.drug.betaBlocker; ctl.vagalBlock = this.drug.atropine; ctl.volumeDeficit = Math.max(0, this.bloodLoss);
    this.autonomic.step(h);
    this.stream.extend(this.t, this.rstate, this.mod);
    this.stream.prune(this.t);
    this.t += h;
    for (const b of this.stream.drain(this.t)) this.handleBeat(b);
    // Coronary perfusion pressure follows the arterial pressure the heart actually generates.
    if ((this.mapClock += h) > 0.5) { this.mapClock = 0; if (Math.abs(this.map - this.solvedMap) > 2) this.resolveCoronaries(false); }
  }

  private handleBeat(b: Parameters<BeatHemodynamics["onBeat"]>[0]) {
    const fx = this.autonomic.effects();
    const vaso = this.drug.vasopressor;
    const volume = clamp(1 - 1.5 * this.bloodLoss, 0.1, 1.3); // preload falls steeply with hemorrhage
    const h = this.beatHemo.onBeat(b, this.circ, {
      contractility: fx.contractility,
      resistance: fx.resistance * (vaso >= 0 ? 1 + 0.5 * vaso : 1 + 0.4 * vaso),
      preload: volume * fx.preloadResp,
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
    const beats = this.history.filter((b) => b.n >= from && b.t > start);
    return beats;
  }

  /** Run without returning beats; used to let the loop settle before looking at it. */
  warmup(seconds: number) { this.step(seconds); }

  metrics(lastSeconds?: number): Metrics {
    const from = lastSeconds ? this.t - lastSeconds : 0;
    const beats = this.history.filter((b) => b.t >= from);
    return computeMetrics(beats, Math.min(this.t, lastSeconds ?? this.t));
  }

  /** Where the patient is right now, in plain numbers. */
  state() {
    const last = this.history[this.history.length - 1];
    const recent = this.history.filter((b) => b.t > this.t - 10);
    const avg = (f: (b: BeatRecord) => number) => (recent.length ? recent.reduce((s, b) => s + f(b), 0) / recent.length : NaN);
    const cond = this.analysis.cond;
    const beds = cond.terminals.map((x) => ({ bed: x.key, artery: x.segId, massPct: +(x.mass * 100).toFixed(1), flowRatio: +x.ratio.toFixed(2), ischemia: +(this.sev[x.key] ?? 0).toFixed(2) }));
    const compromised = beds.filter((b) => b.ischemia > 0.05).sort((a, b) => b.ischemia * b.massPct - a.ischemia * a.massPct);
    return {
      timeS: +this.t.toFixed(1),
      lastBeat: last ?? null,
      rolling10s: { hr: +avg((b) => b.hr).toFixed(0), sbp: +avg((b) => b.sbp).toFixed(0), dbp: +avg((b) => b.dbp).toFixed(0), map: +avg((b) => b.map).toFixed(0), sv: +avg((b) => b.sv).toFixed(0) },
      meanArterialPressure: +this.map.toFixed(0),
      rhythm: {
        sinusRate: +this.rstate.sinusRate.toFixed(0), avBlock: this.rstate.avDegree, pvcSeverity: +this.rstate.pvcSeverity.toFixed(2),
        label: this.rstate.avDegree === 3 ? "complete heart block, junctional escape" : this.rstate.avDegree === 2 ? "Mobitz I (Wenckebach)" : this.rstate.avDegree === 1 ? "first-degree AV block" : "sinus",
      },
      autonomic: { baroreflexGainMsPerMmHg: last ? +this.autonomic.vagalBaroreflexGain(last.interval * 1000).toFixed(1) : null, sympatheticTone: last ? +last.sympathetic.toFixed(2) : null, vagalTone: last ? +last.vagal.toFixed(2) : null, baroreceptorDrive: last ? +last.afferent.toFixed(2) : null },
      circulationState: this.map < CIRC.shockMap ? "shock" : this.map < CIRC.hypotensionMap ? "hypotension" : "stable",
      ischemicMassFraction: +this.analysis.cond.atRisk.toFixed(3),
      compromisedBeds: compromised.slice(0, 8),
      ffr: this.analysis.ffr.map((f, i) => ({ artery: this.n.lesions[i]?.segId, ffr: +f.toFixed(2) })),
    };
  }

  scenario(): Scenario { return toScenario(this.n); }
}
