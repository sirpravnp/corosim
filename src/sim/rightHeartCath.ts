/**
 * Right-heart catheterisation from a HemoSource snapshot (task P7). Pure: no DOM, no engine. Works on any source because
 * it reads only `numbers()`, `saturations()` and `beats()`.
 *
 * Units: mmHg, L/min, ml O2/min, Wood units (mmHg/(L/min)), saturations 0..1.
 *
 * FORMULAS AND CONVENTIONS
 *  - O2 content (ml/L) = 1.34 * Hb(g/dl) * 10 * Sat   (dissolved O2 ignored). 1.34 ml O2 per g Hb, as the engine uses.
 *    Hb: the source does not report it, so it is recovered from the source's own oxygen delivery,
 *    Hb = DO2 / (CO * 10 * 1.34 * SpO2) (the bridge defines DO2 that way); if that is not available, `opts.hb`, else 14 g/dl
 *    (the adult baseline). The Hb used is returned in `hb`.
 *  - Mixed venous saturation for shunt calculation, Flamm: SvO2 = (3*SVC + IVC)/4.
 *  - Step-up (jump in saturation between consecutive sites): atrial = RA - mixed venous >= 7 %; ventricular = RV - RA >= 5 %;
 *    great vessel = PA - RV >= 5 %. The level of the most proximal step-up found is `stepUp.level`.
 *  - Fick systemic flow  Qs = VO2 / (CaO2 - CmvO2), arterial = pre-ductal (aortic) sat, venous = Flamm mixed venous.
 *    Fick pulmonary flow Qp = VO2 / (CpvO2 - CpaO2), pulmonary vein = the PV node saturation (assumed 0.98 if absent), PA = PA sat.
 *    Qp:Qs = Qp / Qs by Fick (equivalent to (SaO2 - SmvO2)/(SpvO2 - SpaO2)).
 *    VO2 is the source's (`saturations().vo2`), i.e. assumed, as in a cath lab without a metabolic cart.
 *  - Thermodilution CO = the source's `numbers().co` (the flow a thermodilution curve in the PA reports). Unreliable with
 *    tricuspid regurgitation (indicator washes back and forth) and with intracardiac shunts (indicator lost or recirculated).
 *  - PVR (Wood units) = (mPAP - PCWP) / Qp, Qp = the Fick pulmonary flow.   SVR = (MAP - RA mean) / Qs, Qs = the thermodilution CO
 *    (the source's systemic flow; the Fick Qs when that is not available). The Fick Qs rests on the Flamm mixed venous sample,
 *    which in this model reads a few percent off the true flow-weighted venous blood, so the measured CO is used for SVR. Transpulmonary gradient TPG = mPAP - PCWP. Diastolic pulmonary gradient DPG = PADP - PCWP.
 *  - PAPi = (PASP - PADP) / RA mean (pulmonary artery pulsatility index; < 1.0 is the classic threshold for RV failure in
 *    acute inferior MI).
 *  - Cardiac power output CPO (W) = MAP * CO / 451 (CO = the source's thermodilution CO). Cardiac index CI = CO / BSA, with
 *    BSA = CO / CI of the source.
 *
 * PULLBACK. One representative beat per site: the latest non-premature beat of `beats()` (or the latest). RA, RV and PA are
 * that beat's node pressures unchanged. The wedge is the LA trace as a wedge tracing shows it: delayed by WEDGE_DELAY_S
 * (0.04 s, the transmission through the pulmonary capillaries) and damped by a first-order low-pass of time constant
 * WEDGE_TAU_S (0.03 s), applied circularly (a periodic beat) and then re-centred so the wedge mean equals the reported PCWP.
 * Modest on purpose: a real wedge is more damped, but peaks must stay readable.
 * RA a and v: a = the peak RA pressure within A_WINDOW_S after the atrial activation time (NaN when the beat has none, as in
 * AF); v = the peak RA pressure outside that window. (The bridge replays a solved waveform, so its a wave persists in AF.)
 */
import type { BeatSummary, HemoNumbers, HemoSource, Saturations } from "./hemoSource";
import { O2_PER_G_HB } from "../config/structural";

export const WEDGE_DELAY_S = 0.04;
export const WEDGE_TAU_S = 0.03;
export const A_WINDOW_S = 0.14;
export const STEP_UP = { atrial: 0.07, ventricular: 0.05, greatVessel: 0.05 } as const;
export const DEFAULT_HB = 14;
export const DEFAULT_PV_SAT = 0.98;

/** What the module reads from a source; any `HemoSource` satisfies it. */
export type RhcSnapshot = Pick<HemoSource, "numbers" | "saturations" | "beats">;

export type PullbackSite = "RA" | "RV" | "PA" | "Wedge";
export interface PullbackSegment { site: PullbackSite; label: string; t: Float32Array; p: Float32Array }
export interface Pullback {
  segments: PullbackSegment[]; // RA, RV, PA, wedge
  rr: number;
  ra: { mean: number; a: number; v: number };
  rv: { systolic: number; endDiastolic: number };
  pa: { systolic: number; diastolic: number; mean: number };
  pcwp: number;
}

export type StepUpLevel = "atrial" | "ventricular" | "great vessel";
export interface OximetrySite { site: "SVC" | "IVC" | "RA" | "RV" | "PA"; sat: number }
export interface StepUp { level: StepUpLevel; from: string; to: string; delta: number }
export interface Oximetry {
  sites: OximetrySite[];
  mixedVenous: number; // Flamm
  /** Change in saturation into RA (from mixed venous), into RV, into PA. */
  deltas: { atrial: number; ventricular: number; greatVessel: number };
  stepUps: StepUp[];
  stepUp: StepUp | null; // most proximal
}

export interface CardiacOutput { fick: number; thermodilution: number; qp: number; qs: number; qpQs: number; vo2: number; hb: number; caO2: number; cmvO2: number; cpvO2: number; cpaO2: number }
export interface Derived { pvr: number; svr: number; qpQs: number; tpg: number; dpg: number; papi: number; cpo: number; ci: number; bsa: number }
export interface RightHeartCath { pullback: Pullback | null; oximetry: Oximetry; output: CardiacOutput; derived: Derived; numbers: HemoNumbers }

const fin = Number.isFinite;
const content = (hb: number, sat: number) => O2_PER_G_HB * hb * 10 * sat; // ml O2 per L

/** Flamm formula. */
export function mixedVenous(svc: number, ivc: number): number { return (3 * svc + ivc) / 4; }

/** Hb (g/dl) implied by the source's DO2, CO and SpO2, else the option, else 14. */
export function haemoglobin(n: HemoNumbers, s: Saturations, hb?: number): number {
  const h = s.do2 / (n.co * 10 * O2_PER_G_HB * s.spo2);
  if (fin(h) && h > 3 && h < 25) return h;
  return hb !== undefined && fin(hb) ? hb : DEFAULT_HB;
}

export function oximetry(s: Saturations): Oximetry {
  const n = s.node, sites: OximetrySite[] = (["SVC", "IVC", "RA", "RV", "PA"] as const).map((k) => ({ site: k, sat: n[k] }));
  const mv = mixedVenous(n.SVC, n.IVC);
  const deltas = { atrial: n.RA - mv, ventricular: n.RV - n.RA, greatVessel: n.PA - n.RV };
  const eps = 1e-9; // a step exactly at the threshold must not be lost to rounding
  const stepUps: StepUp[] = [];
  if (deltas.atrial >= STEP_UP.atrial - eps) stepUps.push({ level: "atrial", from: "mixed venous", to: "RA", delta: deltas.atrial });
  if (deltas.ventricular >= STEP_UP.ventricular - eps) stepUps.push({ level: "ventricular", from: "RA", to: "RV", delta: deltas.ventricular });
  if (deltas.greatVessel >= STEP_UP.greatVessel - eps) stepUps.push({ level: "great vessel", from: "RV", to: "PA", delta: deltas.greatVessel });
  return { sites, mixedVenous: mv, deltas, stepUps, stepUp: stepUps[0] ?? null };
}

/** Delay and damp a periodic beat into a wedge-like tracing, mean-preserving (see header). */
export function wedgeFromLA(la: Float32Array, rr: number, pcwp?: number): Float32Array {
  const n = la.length, out = new Float32Array(n);
  if (n < 2) return Float32Array.from(la);
  const dt = rr / n, shift = Math.round(WEDGE_DELAY_S / dt), alpha = dt / (WEDGE_TAU_S + dt);
  let y = la[0];
  for (let k = 0; k < 3 * n; k++) { // three periods so the last is in steady state
    y += alpha * (la[(((k - shift) % n) + n) % n] - y);
    if (k >= 2 * n) out[k - 2 * n] = y;
  }
  if (pcwp !== undefined && fin(pcwp)) {
    let m = 0;
    for (let i = 0; i < n; i++) m += out[i];
    const off = pcwp - m / n;
    for (let i = 0; i < n; i++) out[i] += off;
  }
  return out;
}

function peak(x: Float32Array, from: number, to: number): number {
  let m = -Infinity;
  for (let i = from; i < to; i++) if (x[i] > m) m = x[i];
  return m;
}

function representative(beats: readonly BeatSummary[]): BeatSummary | null {
  for (let i = beats.length - 1; i >= 0; i--) if (!beats[i].pvc) return beats[i];
  return beats.length ? beats[beats.length - 1] : null;
}

export function pullback(beats: readonly BeatSummary[], n: HemoNumbers): Pullback | null {
  const b = representative(beats);
  if (!b || !fin(n.pcwp)) return null;
  const { time, pressure } = b, N = time.length, dt = b.rr / N;
  const wedge = wedgeFromLA(pressure.LA, b.rr, n.pcwp);
  const seg = (site: PullbackSite, label: string, p: Float32Array): PullbackSegment => ({ site, label, t: time, p });
  let a = NaN, v: number;
  if (b.atrial.length) {
    const lo = Math.min(N - 1, Math.round(b.atrial[0] / dt)), hi = Math.min(N, lo + Math.max(1, Math.round(A_WINDOW_S / dt)));
    a = peak(pressure.RA, lo, hi);
    v = -Infinity;
    for (let i = 0; i < N; i++) if ((i < lo || i >= hi) && pressure.RA[i] > v) v = pressure.RA[i];
    if (!fin(v)) v = NaN;
  } else v = peak(pressure.RA, 0, N);
  return {
    segments: [seg("RA", "RA", pressure.RA), seg("RV", "RV", pressure.RV), seg("PA", "PA", pressure.PA), seg("Wedge", "PCWP", wedge)],
    rr: b.rr,
    ra: { mean: n.cvp, a, v },
    rv: { systolic: peak(pressure.RV, 0, N), endDiastolic: n.rvedp },
    pa: { ...n.pa }, pcwp: n.pcwp,
  };
}

export function cardiacOutput(n: HemoNumbers, s: Saturations, opts: { hb?: number } = {}): CardiacOutput {
  const hb = haemoglobin(n, s, opts.hb), c = (x: number) => content(hb, x);
  const mv = mixedVenous(s.node.SVC, s.node.IVC), pv = fin(s.node.PV) ? s.node.PV : DEFAULT_PV_SAT;
  const caO2 = c(s.preductal), cmvO2 = c(mv), cpvO2 = c(pv), cpaO2 = c(s.node.PA);
  const qs = s.vo2 / (caO2 - cmvO2), qp = s.vo2 / (cpvO2 - cpaO2);
  return { fick: qs, thermodilution: n.co, qp, qs, qpQs: qp / qs, vo2: s.vo2, hb, caO2, cmvO2, cpvO2, cpaO2 };
}

export function derive(n: HemoNumbers, o: CardiacOutput): Derived {
  const qs = fin(n.co) && n.co > 0 ? n.co : o.qs, qp = fin(o.qp) && o.qp > 0 ? o.qp : n.co;
  const tpg = n.pa.mean - n.pcwp;
  return {
    pvr: tpg / qp, svr: (n.map - n.cvp) / qs, qpQs: o.qpQs, tpg, dpg: n.pa.diastolic - n.pcwp,
    papi: (n.pa.systolic - n.pa.diastolic) / n.cvp, cpo: (n.map * n.co) / 451, ci: n.ci, bsa: n.co / n.ci,
  };
}

/** The whole report; null until the source has solved (its numbers are NaN before that). */
export function rightHeartCath(src: RhcSnapshot, opts: { hb?: number } = {}): RightHeartCath | null {
  const n = src.numbers(), s = src.saturations();
  if (!fin(n.map) || !fin(n.co) || !fin(s.node.PA)) return null;
  const out = cardiacOutput(n, s, opts);
  return { pullback: pullback(src.beats(4), n), oximetry: oximetry(s), output: out, derived: derive(n, out), numbers: n };
}
