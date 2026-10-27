import { ARRHYTHMIA } from "../config/arrhythmia";
import { ECTOPY } from "../config/ectopy";
import type { EkgSpec } from "../ekg/engine";
import { Ectopy, RunTrigger, couplingVsT, tWaveEnd } from "./ectopy";
import { libraryRhythm } from "./rhythmSource";
import { mulberry32 } from "./ecg";
import { gaussian } from "./autonomic";

/**
 * Ischemic ventricular tachyarrhythmias of the core engine (task B3b). DOM-free; constants and their sources in config/arrhythmia.ts,
 * targets and measured rates in docs/ARRHYTHMIA.md. Sits on top of the ectopy model (physics/ectopy.ts, B3a), whose burden, time since
 * onset, reperfusion store, tone and coupling it reads, and hooks into its beat decisions (`Ectopy.trigger`) and into the beat stream
 * (`BeatStream.arrhythmia`). The legacy engine has none of this.
 *
 * 1. Hazard of an initiating event, per clinical minute:
 *      lambda = A x tendency x sympathetic x drugs x K x Mg x [ kI H(b) T(age)  +  kR H(burst)  +  kS H(scar) M(scar age) ]
 *    b the ectopy model's weighted burden, H a steep Hill curve, T the time since onset (hyperacute peak, fast decay), burst the
 *    reperfusion store, scar the necrotic mass (late scar VT once healed), A the patient's seeded susceptibility.
 * 2. An event waits for the next beat the ventricles take from the conduction system and rides on a premature beat whose coupling is
 *    set against the live T wave (the end of the T wave after that beat's RR): R on T in most cases, late-coupled otherwise. An ordinary
 *    ischemic PVC that lands on the T wave can also start a run (rarely). The coupling weights what the run becomes: non-sustained VT
 *    (3 or more beats, returned to the generator as premature beats), or a sustained rhythm that takes over the beat stream: monomorphic
 *    VT, polymorphic VT, VF (the EKG library's own rhythms, so the strip and the live heart show them).
 * 3. Course, in heartbeat time: polymorphic VT stops or degenerates to VF; monomorphic VT degenerates to VF when the pressure collapses
 *    (or rarely stops); VF stays (defibrillation is task B4).
 * 4. Accelerated idioventricular rhythm after reperfusion: its own hazard from the burst store; it takes over when faster than the
 *    sinus node and ends after a while or when the sinus overtakes it.
 */

export type RunKind = "nsvt" | "mono" | "poly" | "vf" | "aivr";
export type RunCause = "ischemia" | "reperfusion" | "scar" | "degeneration" | "induced";
type Sustained = Exclude<RunKind, "nsvt">;

/** One arrhythmia event: a run that started (and, once over, when it ended). Times in stream (heartbeat) seconds, `minute` on the clinical clock. */
export interface ArrhythmiaEvent {
  kind: RunKind; cause: RunCause; t: number; minute: number;
  /** The trigger beat's coupling over the end of the preceding T wave (< 1: R on T). Absent for AIVR and degeneration. */
  couplingVsT?: number;
  /** Beats/min of the run. */
  rate: number;
  /** Beats of a non-sustained run. */
  beats?: number;
  /** When a sustained rhythm ended (stopped, degenerated, terminated), stream seconds. */
  end?: number;
  /** How it ended. */
  outcome?: "stopped" | "degenerated" | "overdriven" | "terminated";
}

/** What the beat stream runs while a sustained arrhythmia lasts: a library rhythm (its id and a spec with the episode's rate), from `firstBeat`. */
export interface EpisodeRhythm { key: string; id: string; spec: EkgSpec; kind: Sustained; firstBeat?: number }

interface Episode { n: number; kind: Sustained; cause: RunCause; rate: number; start: number; firstBeat?: number; until?: number; scar?: boolean; event: ArrhythmiaEvent }

const A = ARRHYTHMIA;
const LIB: Record<Sustained, string> = { mono: "vt-mono", poly: "vt-poly", vf: "vf-coarse", aivr: "aivr" };
export const RUN_LABEL: Record<RunKind, string> = {
  nsvt: "non-sustained ventricular tachycardia", mono: "sustained monomorphic ventricular tachycardia", poly: "polymorphic ventricular tachycardia",
  vf: "ventricular fibrillation", aivr: "accelerated idioventricular rhythm",
};
const hill = (x: number) => { const y = Math.max(0, x) ** A.hill; return y / (1 + y); };
/** Dose-response of the VT/VF hazard on the weighted ischemic burden (steeper than the PVCs'). */
export const substrateEffect = (b: number) => hill((b - A.floor) / A.half);
/** Time-since-onset multiplier of the ischemic VT/VF hazard (clinical minutes): a hyperacute peak in the first hour, then a fast fall. */
export const arrhythmiaCourse = (min: number) =>
  (1 - Math.exp(-Math.max(0, min) / A.riseMin)) * (Math.exp(-min / A.tauMin) + A.sub * Math.exp(-min / A.subTauMin) + A.late);
/** Hazard multiplier of serum potassium (mmol/l): 1 between `lowFrom` and `highFrom`, rising on either side. */
export const potassiumFactor = (k: number) => { const P = A.potassium; return Math.exp(P.lowGain * Math.max(0, P.lowFrom - k)) * Math.exp(P.highGain * Math.max(0, k - P.highFrom)); };
/** Hazard multiplier of serum magnesium (mmol/l): 1 above `lowFrom`, rising below it. */
export const magnesiumFactor = (mg: number) => Math.exp(A.magnesium.lowGain * Math.max(0, A.magnesium.lowFrom - mg));

/** Inputs of `Arrhythmia.update` from the rest of the model. */
export interface ArrhythmiaInputs {
  /** Smoothed mean arterial pressure (mmHg): drives degeneration of a VT that drops the pressure. */
  map?: number;
  /** Scar burden: sum over beds of necrosis x mass (0..1). */
  scar?: number;
  /** The sinus rate now (beats/min): sets AIVR's rate and the dissociated P waves of a VT. */
  sinusRate?: number;
  /** The patient's rhythm is the coronary model's own sinus rhythm (AIVR competes with the sinus node only). */
  sinus?: boolean;
}

export class Arrhythmia implements RunTrigger {
  /** The patient's fixed VT/VF susceptibility (seeded, lognormal, correlated with the ectopy susceptibility). */
  readonly susceptibility: number;
  /** Teaching override (`arrhythmiaTendency`, 0..3): multiplies every hazard; 0 = no VT, VF or AIVR ever (PVCs still come). */
  tendency: number;
  private k = A.potassium.normal; private mg = A.magnesium.normal;
  /** Clinical minutes this model has run, the scar's age (minutes above the floor) and the inputs last given. */
  minutes = 0; scarAge = 0;
  private inp: Required<ArrhythmiaInputs> = { map: 90, scar: 0, sinusRate: 75, sinus: true };
  private t = 0;
  private rng: () => number;
  private pending: { cause: RunCause; at: number; kind?: RunKind } | null = null;
  private episode: Episode | null = null;
  private n = 0;
  private cut: number | undefined;
  /** Every run so far (most recent last, at most `logSize`). */
  readonly log: ArrhythmiaEvent[] = [];

  constructor(seed: number, readonly ectopy: Ectopy, tendency = 1) {
    this.rng = mulberry32((((seed >>> 0) * 2246822519) ^ 0x68e31da4) >>> 0);
    this.rng();
    const zS = Math.log(ectopy.susceptibility) / ECTOPY.susceptibilitySigma, r = A.ectopyCorrelation;
    this.susceptibility = Math.exp(A.susceptibilitySigma * (r * zS + Math.sqrt(1 - r * r) * gaussian(this.rng)));
    this.tendency = tendency;
    ectopy.trigger = this;
  }

  /** Serum potassium, mmol/l (also the ectopy model's potassium hook). */
  get potassium() { return this.k; }
  set potassium(v: number) { this.k = Math.min(A.potassium.max, Math.max(A.potassium.min, v)); this.ectopy.potassium = potassiumFactor(this.k); }
  /** Serum magnesium, mmol/l (also the ectopy model's magnesium hook). */
  get magnesium() { return this.mg; }
  set magnesium(v: number) { this.mg = Math.min(A.magnesium.max, Math.max(A.magnesium.min, v)); this.ectopy.magnesium = magnesiumFactor(this.mg); }

  /** Back to a heart with no arrhythmia and no history (the patient, tendency and electrolytes stay). */
  reset() { this.pending = null; this.episode = null; this.cut = undefined; this.minutes = this.scarAge = 0; this.log.length = 0; }

  /** Multiplier from the patient, the tone, the drugs and the electrolytes. */
  gain(): number {
    const t = this.ectopy.tone, s = t.sympathetic * (1 - t.betaBlock);
    return this.susceptibility * this.tendency * Math.exp(A.sympatheticGain * (s - A.restSympathetic)) * (1 + A.drugGain * t.drugDrive) * potassiumFactor(this.k) * magnesiumFactor(this.mg);
  }
  /** Hazards now, per clinical minute: ischemic, reperfusion and scar initiating events, and AIVR. */
  hazards(): { ischemia: number; reperfusion: number; scar: number; aivr: number } {
    const e = this.ectopy, g = this.gain();
    const ischemia = e.active ? g * A.ischemicPerMin * substrateEffect(e.burden) * arrhythmiaCourse(e.age) : 0;
    const rep = hill(e.burst / A.half);
    const scar = g * A.scarPerMin * hill((this.inp.scar - A.scarFloor) / A.half) * (1 - Math.exp(-this.scarAge / A.scarMatureMin));
    return { ischemia, reperfusion: g * A.reperfusionPerMin * rep, scar, aivr: this.susceptibility * this.tendency * A.aivrPerMin * rep };
  }

  /** The sustained arrhythmia running now (null: none). */
  get current(): { kind: Sustained; cause: RunCause; since: number; rate: number } | null {
    const e = this.episode;
    return e ? { kind: e.kind, cause: e.cause, since: e.start, rate: e.rate } : null;
  }

  /**
   * Advance `minutes` of clinical time and `dt` heartbeat seconds to stream time `t`, after the ectopy model has taken this sub-step's
   * burden and tone. Draws initiating events and AIVR onsets, and runs the course of a sustained arrhythmia.
   */
  update(minutes: number, dt: number, t: number, inp: ArrhythmiaInputs = {}) {
    this.inp = { ...this.inp, ...inp };
    this.t = t;
    this.minutes += minutes;
    if (this.inp.scar > A.scarFloor) this.scarAge += minutes;
    if (this.episode) { this.pending = null; this.course(dt, t); return; }
    if (this.pending && t - this.pending.at > A.pendingMaxS) this.pending = null;
    if (minutes <= 0) return;
    const h = this.hazards(), runs = h.ischemia + h.reperfusion + h.scar;
    if (!this.pending && runs > 0 && this.rng() < 1 - Math.exp(-runs * minutes)) {
      const u = this.rng() * runs;
      this.pending = { cause: u < h.ischemia ? "ischemia" : u < h.ischemia + h.reperfusion ? "reperfusion" : "scar", at: t };
    }
    if (!this.pending && h.aivr > 0 && this.rng() < 1 - Math.exp(-h.aivr * minutes)) this.startAivr(t, "reperfusion");
  }

  private startAivr(t: number, cause: RunCause): boolean {
    const C = A.aivr, s = this.inp.sinusRate;
    if (!this.inp.sinus || s * C.rateOver[0] > C.maxRate) return false; // AIVR competes with the sinus node; a fast sinus hides it
    const rate = Math.min(C.maxRate, Math.max(C.minRate, s * (C.rateOver[0] + (C.rateOver[1] - C.rateOver[0]) * this.rng())));
    const dur = Math.min(C.maxS, C.durMedianS * Math.exp(C.durSigma * gaussian(this.rng)));
    this.begin({ kind: "aivr", cause, rate, start: t, until: t + dur }, {});
    return true;
  }

  private begin(e: Omit<Episode, "n" | "event">, extra: Partial<ArrhythmiaEvent>) {
    const event: ArrhythmiaEvent = { kind: e.kind, cause: e.cause, t: e.start, minute: +this.minutes.toFixed(1), rate: Math.round(e.rate), ...extra };
    this.episode = { ...e, n: ++this.n, event };
    this.record(event);
  }
  private record(ev: ArrhythmiaEvent) { this.log.push(ev); if (this.log.length > A.logSize) this.log.splice(0, this.log.length - A.logSize); }

  private end(t: number, outcome: NonNullable<ArrhythmiaEvent["outcome"]>) {
    const e = this.episode;
    if (!e) return;
    e.event.end = +t.toFixed(3); e.event.outcome = outcome;
    this.episode = null;
  }

  /** The course of a sustained arrhythmia over `dt` heartbeat seconds. */
  private course(dt: number, t: number) {
    const e = this.episode!;
    if (t < e.start) return;
    const p = (rate: number) => 1 - Math.exp(-rate * dt);
    if (e.kind === "poly") {
      const stop = A.polyEndPerS, vf = A.polyToVfPerS;
      if (this.rng() < p(stop + vf)) { if (this.rng() < vf / (stop + vf)) this.degenerate(t); else this.end(t, "stopped"); }
    } else if (e.kind === "mono") {
      const c = Math.min(1, Math.max(0, (A.okMap - this.inp.map) / (A.okMap - A.floorMap))), vf = A.collapseToVfPerS * c * c, stop = A.monoEndPerS;
      if (this.rng() < p(stop + vf)) { if (this.rng() < vf / (stop + vf)) this.degenerate(t); else this.end(t, "stopped"); }
    } else if (e.kind === "aivr") {
      if (t >= (e.until ?? Infinity)) this.end(t, "stopped");
      else if (this.inp.sinusRate > e.rate * A.aivr.overdrive) this.end(t, "overdriven");
    }
  }

  private degenerate(t: number) {
    this.end(t, "degenerated");
    this.begin({ kind: "vf", cause: "degeneration", rate: 0, start: t }, {});
  }

  /** Stop any sustained arrhythmia now (the patient's rhythm was set, a later item's shock). */
  terminate(t = this.t) { this.pending = null; this.end(t, "terminated"); }

  /**
   * Start an arrhythmia on purpose (teaching, tests, later the MCP tools): "aivr" starts at once (when the sinus is slow enough), any
   * other kind rides on the next beat as an initiating event; "scar" is a scar-related monomorphic VT. Returns false when it cannot start.
   */
  induce(kind: RunKind | "scar"): boolean {
    if (this.episode) return false;
    if (kind === "aivr") return this.startAivr(this.t, "induced");
    this.pending = kind === "scar" ? { cause: "scar", at: this.t, kind: "mono" } : { cause: "induced", at: this.t, kind };
    return true;
  }

  /** Ectopy hook: the beat at `tR` (sinus interval `rr`) and the PVC times the ectopy model chose; returns the times to use. */
  onBeat(tR: number, rr: number, pvcs: number[]): number[] {
    if (this.episode) return pvcs;
    if (this.pending) { const pd = this.pending; this.pending = null; return this.initiate(tR, rr, pvcs, pd.cause, pd.kind, false); }
    if (pvcs.length && couplingVsT(pvcs[0] - tR, rr) < 1) {
      // an ordinary ischemic PVC on the T wave: rarely, it finds the ventricle vulnerable
      const h = this.hazards(), sub = (h.ischemia + h.reperfusion) / A.ischemicPerMin;
      if (sub > 0 && this.rng() < Math.min(1, A.natural * sub)) return this.initiate(tR, rr, pvcs, h.ischemia >= h.reperfusion ? "ischemia" : "reperfusion", undefined, true);
    }
    return pvcs;
  }

  private initiate(tR: number, rr: number, pvcs: number[], cause: RunCause, forced: RunKind | undefined, natural: boolean): number[] {
    const R = A.ronT;
    let c: number;
    if (natural) c = pvcs[0] - tR;
    else if (this.rng() < R.share) c = tWaveEnd(rr) * (R.vsTMin + (R.vsTMax - R.vsTMin) * this.rng());
    else c = pvcs.length ? pvcs[0] - tR : rr * Math.min(ECTOPY.couplingMax, Math.max(ECTOPY.couplingMin, ECTOPY.coupling * (1 + ECTOPY.couplingSpread * gaussian(this.rng))));
    const x = couplingVsT(c, rr), tv = tR + c;
    let kind: RunKind = forced ?? "nsvt";
    if (!forced) {
      const m = A.mix[cause === "scar" ? "scar" : cause === "reperfusion" ? "reperfusion" : "ischemia"], fw = x < 1 ? R.fastWeight : R.lateWeight;
      const w: [RunKind, number][] = [["nsvt", m.nsvt], ["mono", m.mono], ["poly", m.poly * fw], ["vf", m.vf * fw]];
      let u = this.rng() * w.reduce((s, [, v]) => s + v, 0);
      for (const [k, v] of w) { if ((u -= v) <= 0) { kind = k; break; } }
    }
    const pick = (r: readonly [number, number]) => r[0] + (r[1] - r[0]) * this.rng();
    const vsT = +x.toFixed(3);
    if (kind === "nsvt") {
      const N = A.nsvt, rate = pick(N.rate), cyc = 60 / rate;
      let beats = N.minBeats;
      const q = N.extraMean / (1 + N.extraMean);
      while (beats < N.maxBeats && this.rng() < q) beats++;
      const out: number[] = [];
      for (let i = 0; i < beats; i++) out.push(tv + i * cyc * (1 + 0.03 * (2 * this.rng() - 1)));
      this.record({ kind, cause, t: +tv.toFixed(3), minute: +this.minutes.toFixed(1), couplingVsT: vsT, rate: Math.round(rate), beats });
      return out;
    }
    if (kind === "aivr") { this.startAivr(tv, cause); return pvcs; }
    const scar = cause === "scar";
    const rate = kind === "mono" ? pick(scar ? A.scarRate : A.monoRate) : kind === "poly" ? pick(A.polyRate) : 0;
    const first = kind === "vf" ? tv + A.vfAfterS : tv + 60 / rate;
    this.begin({ kind, cause, rate, start: tv, firstBeat: first, scar }, { couplingVsT: vsT });
    this.cut = tv;
    return [tv];
  }

  /** For the beat stream: the time after which the beats it just generated no longer stand (a run took over at the trigger beat), once. */
  takeCut(): number | undefined { const c = this.cut; this.cut = undefined; return c; }

  /** For the beat stream: the library rhythm to run at stream time `from` (null: the patient's own rhythm). */
  rhythmAt(from: number): EpisodeRhythm | null {
    const e = this.episode;
    if (!e || from < e.start - 1e-9) return null;
    const base = libraryRhythm(LIB[e.kind])!.spec, r = base.rhythm, sinus = Math.round(this.inp.sinusRate);
    const spec: EkgSpec = r.kind === "ventricular" ? { ...base, rhythm: { ...r, rate: e.rate, atrial: sinus } } : base;
    return { key: `arrhythmia#${e.n}`, id: LIB[e.kind], spec, kind: e.kind, firstBeat: e.firstBeat };
  }

  /** The arrhythmia part of Simulation.state().rhythm. */
  state(t: number) {
    const h = this.hazards(), e = this.episode, last = this.log[this.log.length - 1];
    const count = (k: RunKind) => this.log.filter((x) => x.kind === k).length;
    return {
      current: e ? { kind: e.kind, label: RUN_LABEL[e.kind], cause: e.cause, forS: +Math.max(0, t - e.start).toFixed(1), rate: Math.round(e.rate) } : null,
      last: last ? { ...last, label: RUN_LABEL[last.kind] } : null,
      counts: { nsvt: count("nsvt"), mono: count("mono"), poly: count("poly"), vf: count("vf"), aivr: count("aivr") },
      hazardPerHour: { ischemia: +(h.ischemia * 60).toFixed(4), reperfusion: +(h.reperfusion * 60).toFixed(4), scar: +(h.scar * 60).toFixed(6), aivr: +(h.aivr * 60).toFixed(4) },
      potassium: this.k, magnesium: this.mg,
    };
  }
}
