import { AF, RHYTHM, Vec3 } from "../config/ecg";
import { ECTOPY } from "../config/ectopy";
import { RHYTHM_MECH as M } from "../config/rhythms";
import { BeatPainter, EBeat, EkgSpec, RhythmGenerator } from "../ekg/engine";
import { Category, EkgPreset, PRESETS } from "../ekg/library";
import type { Beat } from "./ecg";
import type { EctopySource } from "./ectopy";
import type { RhythmState, SinusModulation } from "./rhythm";
import type { Bbb } from "../config/ecg";

/**
 * Rhythms of the EKG library running in the Simulator (task B2). ONE rhythm source: the EKG page's own generator
 * (ekg/engine.ts `RhythmGenerator`) makes the beat events, and this file turns each event into a `Beat` that carries both what the
 * ECG strip draws (the event and its painter, so the strip shows the library's own complexes) and what the hemodynamic engine needs
 * (origin, atrial event, mechanical strength). The beat stream hands the same beats to the strip and to the live heart, so the
 * ECG shows exactly the beats the heart ejects.
 *
 * Event -> beat (the live heart, core/live.ts, turns a beat into chamber events):
 *  - conducted supraventricular beat (P before it): atrial event at R - PR, ventricular event at R (sinus, MAT, AV blocks);
 *  - supraventricular beat with no P (AF, flutter, junctional, AV re-entry, narrow escape): ventricular only (no atrial kick); a
 *    retrograde P (junctional, AVNRT) adds an atrial event just after R, so the atria contract against closed AV valves (cannon waves);
 *  - flutter: an atrial event at every flutter wave, weak (`RHYTHM_MECH.flutterAtrial`), not drawn (the sawtooth is the baseline);
 *  - blocked P wave: atrial event only (AV block, AV dissociation in VT, asystole with P waves);
 *  - ventricular beat: no atrial event, strength by kind (monomorphic VT, AIVR, escape: `ventricular`; polymorphic VT and torsades:
 *    `polymorphic`; paced: `paced`); a library PVC (bigeminy) is a premature beat (`pvc`), with the live heart's PVC rule;
 *  - VF and asystole: no ventricular beat at all; a silent tick every `RHYTHM_MECH.tickS` with strength 0 closes a hemodynamic
 *    record (pressure falls toward the mean filling pressure, no output), drawn as nothing and not counted in the heart rate.
 * Rate: the sinus-node rhythms (sinus and its blocks, MAT, the sinus beats between torsades runs) and the AV node's response in AF
 * follow the coronary model's rate (ischemic sympathetic and vagal drive, SA-node ischemia, drugs) and the baroreflex, as the
 * patient's own sinus rhythm does; re-entrant and ventricular rhythms keep the library's rate.
 * Ischemic ectopy (physics/ectopy.ts) acts on every beat the ventricles take from the conduction system (supraventricular beats,
 * escape and paced beats), as with the coronary model's own rhythm; the next beat inside the PVC's refractory period is dropped (a
 * P wave that would have conducted is drawn blocked: a compensatory pause). Not in VT, torsades, VF or asystole.
 * Not modelled: ischemic AV block on top of a library rhythm (the library rhythm's own conduction holds), the patient's bundle
 * branch block on a library rhythm that sets its own conduction, external pacing over a library rhythm.
 */

/** The library categories the Simulator's rhythm picker offers (plan decision D4). STEMI mimics become an ECG overlay later (C3). */
export const SIM_RHYTHM_CATEGORIES: readonly Category[] = ["Sinus", "Atrial", "Junctional & re-entry", "AV block", "Bundle branch & fascicular", "Ventricular", "Electrolytes, drugs & other"];
/** Library ids that ARE the coronary model's own rhythms: "nsr" is "sinus", "af" is the patient's own atrial fibrillation. */
const OWN: Record<string, "sinus" | "af"> = { nsr: "sinus", sinus: "sinus", af: "af" };
/** Every rhythm the Simulator runs (D4): the library presets of those categories. */
export const SIM_RHYTHMS: readonly EkgPreset[] = PRESETS.filter((p) => SIM_RHYTHM_CATEGORIES.includes(p.category));
const BY_ID: Record<string, EkgPreset> = Object.fromEntries(SIM_RHYTHMS.map((p) => [p.id, p]));

/** The patient rhythm a library id stands for: "sinus" or "af" (the coronary model's own), the id itself (a library rhythm), or null (not a Simulator rhythm). */
export function simRhythmId(id: string): string | null {
  if (OWN[id]) return OWN[id];
  return BY_ID[id] ? id : null;
}
/** True for a rhythm that comes from the EKG library (not the coronary model's own sinus or AF). */
export const isLibraryRhythm = (rhythm: string | undefined): boolean => !!rhythm && !OWN[rhythm] && !!BY_ID[rhythm];
/** The library preset behind a library rhythm id (undefined for "sinus", "af" or an unknown id). */
export const libraryRhythm = (rhythm: string | undefined): EkgPreset | undefined => (rhythm && !OWN[rhythm] ? BY_ID[rhythm] : undefined);

const rateCache = new Map<string, number>();
/**
 * Mean ventricular rate (beats/min) of a library rhythm at its own rate (no autonomic modulation): counted over 60 s of the
 * generator, so it is exactly what the strip and the heart get (2:1 block halves the sinus rate, flutter 2:1 is 150, VF 0).
 */
export function libraryVentricularRate(id: string): number {
  const hit = rateCache.get(id);
  if (hit !== undefined) return hit;
  const p = BY_ID[id];
  if (!p) return NaN;
  const g = new RhythmGenerator(p.spec, 1), T = 60;
  const v = g.advance(T + 5).filter((e) => e.kind !== "p" && e.t > 5 && e.t <= T + 5).length;
  const r = (60 * v) / T;
  rateCache.set(id, r);
  return r;
}

/** One library rhythm, running: its generator, painter and the conversion of its events (see the file comment). */
export class LibraryRhythm {
  readonly preset: EkgPreset;
  readonly spec: EkgSpec;
  readonly painter: BeatPainter;
  private gen: RhythmGenerator;
  private state: RhythmState | null = null;
  private mod?: SinusModulation;
  private refractoryUntil = -Infinity;
  private nextTick: number;
  private nextF: number;
  /** Ischemic ectopy (core engine); unset, none. */
  ectopy?: EctopySource;

  /**
   * Start the rhythm at stream time `t0` (its first ventricular beat about 0.45 s later). `bbb` is the patient's bundle branch block,
   * drawn when the library rhythm sets none of its own. `spec`, when given, replaces the preset's (an arrhythmia episode runs the
   * library's VT at its own rate, physics/arrhythmia.ts).
   */
  constructor(readonly id: string, seed: number, readonly t0: number, readonly bbb: Bbb = "none", spec?: EkgSpec) {
    const p = BY_ID[id];
    if (!p) throw new Error(`"${id}" is not a Simulator rhythm`);
    this.preset = p; this.spec = spec ?? p.spec;
    const k = this.spec.rhythm.kind;
    const follows = k === "sinus" || k === "mat" || k === "torsades" ? "sinus" : k === "af" ? "af" : null;
    this.gen = new RhythmGenerator(this.spec, (seed * 7919 + 17) >>> 0, { t0, rate: follows ? (t) => this.rateScale(t, follows) : undefined });
    const m = this.spec.morph ?? {};
    this.painter = new BeatPainter(m.bbb || bbb === "none" ? m : { ...m, bbb });
    this.nextTick = t0 + 0.45;
    this.nextF = t0 + 0.45 - 0.12; // the flutter wave's sharp downstroke (engine.ts baseline phase), one atrial depolarization per cycle
  }

  /** The coronary model's rate relative to its resting design, times the baroreflex's beat-to-beat scale. */
  private rateScale(t: number, follows: "sinus" | "af"): number {
    const s = this.state, m = this.mod;
    const own = s ? (follows === "sinus" ? s.sinusRate / RHYTHM.baseHr : s.afRate / AF.baseRate) : 1;
    return own * (m ? m.rate(t) : 1);
  }

  /** Continuous activity between beats (flutter sawtooth, fibrillatory waves, VF), mV. */
  baseline(t: number): Vec3 { return this.gen.baseline(t); }

  private origin(e: EBeat): NonNullable<Beat["origin"]> {
    const k = this.spec.rhythm.kind;
    if (e.kind === "v") return e.paced ? "paced" : "ventricular";
    if (k === "af" || k === "flutter" || k === "mat") return "atrial";
    if (k === "svt" || k === "junctional" || e.pr === undefined) return "junctional";
    return "sinus";
  }

  private strength(e: EBeat): number | undefined {
    if (e.kind !== "v" || e.pvc) return undefined; // supraventricular: normal (and the live heart's potentiation rule); a PVC: its PVC rule
    if (e.paced) return M.paced;
    const r = this.spec.rhythm;
    return r.kind === "torsades" || (r.kind === "ventricular" && r.poly) ? M.polymorphic : M.ventricular;
  }

  /** Beats the ventricles take from the conduction system or a pacemaker: the ones ischemic ectopy may follow. */
  private eligible(e: EBeat): boolean {
    const k = this.spec.rhythm.kind;
    if (e.pvc) return false;
    if (e.kind === "sv") return k !== "torsades";
    return e.kind === "v" && (!!e.paced || k === "sinus"); // paced beats and the escape of complete heart block
  }

  /** Beats through `until`, from the rhythm state now (its rates) and the baroreflex `mod`. Time order. */
  advance(until: number, state: RhythmState, mod?: SinusModulation): Beat[] {
    this.state = state; this.mod = mod;
    const out: Beat[] = [], k = this.spec.rhythm.kind, painter = this.painter;
    const evs = this.gen.advance(until).sort((a, b) => a.t - b.t);
    for (const e of evs) {
      if (e.kind === "p") { out.push({ t: e.t, rr: e.rr, pvc: false, pr: e.pr, pOnly: true, origin: "sinus", ekg: { beat: e, painter } }); continue; }
      if (e.t < this.refractoryUntil) {
        // inside an ischemic PVC's refractory period: the ventricles cannot respond; a P wave still shows, blocked
        if (e.pr !== undefined) { const pe: EBeat = { t: e.t, rr: e.rr, kind: "p", pr: e.pr, pVec: e.pVec }; out.push({ t: e.t, rr: e.rr, pvc: false, pr: e.pr, pOnly: true, origin: "sinus", ekg: { beat: pe, painter } }); }
        continue;
      }
      const b: Beat = { t: e.t, rr: e.rr, pvc: !!e.pvc, origin: this.origin(e), ekg: { beat: e, painter } };
      if (e.pr !== undefined) b.pr = e.pr; else b.noP = true;
      if (e.retroP !== undefined) b.retroP = e.retroP;
      const st = this.strength(e);
      if (st !== undefined) { b.strength = st; b.systole = e.paced ? M.pacedSystole : st === M.polymorphic ? M.polymorphicSystole : M.ventricularSystole; }
      out.push(b);
      if (this.ectopy && this.eligible(e)) {
        const pv = this.ectopy.decide(e.t, e.rr);
        for (const tv of pv) out.push({ t: tv, rr: e.rr, pvc: true, origin: "ventricular" });
        if (pv.length) this.refractoryUntil = pv[pv.length - 1] + ECTOPY.refractoryS;
      }
    }
    if (k === "flutter") {
      const cyc = 60 / (this.spec.rhythm.kind === "flutter" ? this.spec.rhythm.atrial ?? 300 : 300), pr = 0.12;
      for (; this.nextF <= until; this.nextF += cyc) out.push({ t: this.nextF + pr, rr: cyc, pvc: false, pr, pOnly: true, silent: true, atrialStrength: M.flutterAtrial, origin: "atrial" });
    }
    if (k === "vf" || k === "asystole") {
      for (; this.nextTick <= until; this.nextTick += M.tickS) out.push({ t: this.nextTick, rr: M.tickS, pvc: false, noP: true, silent: true, strength: 0, origin: "ventricular" });
    }
    return out.sort((a, b) => a.t - b.t);
  }
}
