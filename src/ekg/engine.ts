import { ALL_LEADS, BBB, Bbb, LEAD_AXES, LeadName, ST, T_CENTER, T_WIDTH, Vec3, WAVES } from "../config/ecg";
import { fWaves, mulberry32 } from "../physics/ecg";
import { meetsStElevation } from "../physics/ecgLink";

/**
 * The EKG page's generator: the same dipole heart as the simulator's ECG (same lead axes, same P–QRS–T waves, same
 * bundle-branch and injury vectors), with a wider set of pacemakers and conduction patterns (flutter, re-entry,
 * junctional, ventricular, torsades, fibrillation) and morphology changes the coronary model does not make (Q waves,
 * T inversion, delta, Osborn and U waves, peaked T). DOM-free: the page, the in-chat viewer, the MCP tools and the
 * tests all use it. Shapes are teaching approximations, not fitted to recordings.
 */

type V = [number, number, number];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const gauss = (t: number, c: number, w: number) => Math.exp(-0.5 * ((t - c) / w) ** 2);
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const scale = (v: Vec3, k: number): V => [v[0] * k, v[1] * k, v[2] * k];
const norm = (v: Vec3): V => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
/** Rotate in the frontal (x–y) plane; positive degrees turn the axis clockwise on the hexaxial wheel (toward +y, rightward). */
const rotFrontal = (v: Vec3, deg: number): V => {
  if (!deg) return [v[0], v[1], v[2]];
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
};

/** An extra wave added to every supraventricular beat. */
export type Comp =
  /** A Gaussian at `t` s after the R peak (or after the T-wave centre with anchor "T"). */
  | { k: "wave"; v: Vec3; t: number; w: number; anchor?: "R" | "T" }
  /** Current during the ST segment (J point → end of T): level throughout, or largest at J and gone by the T peak. */
  | { k: "st"; v: Vec3; shape?: "plateau" | "jpoint" }
  /** Atrial injury current during the PR segment (end of P → start of QRS). */
  | { k: "pr"; v: Vec3 };

/** How supraventricular (narrow-origin) beats look. Every field optional: omitted = the normal adult. */
export interface Morph {
  p?: number; // P amplitude × (0 = none visible)
  pVec?: Vec3; // replaces the P vector (ectopic atrial focus)
  pWide?: number; // P width ×
  qrs?: number; // QRS voltage ×
  qrsWide?: number; // QRS duration ×
  axisShift?: number; // degrees, rotates the QRS in the frontal plane (fascicular block)
  bbb?: Bbb;
  t?: number; // T amplitude ×
  tNarrow?: number; // T width × (below 1: peaked)
  tVec?: Vec3; // replaces the T vector (primary T-wave change)
  qt?: number; // T-wave timing × (long or short QT)
  injury?: Vec3; // ST injury vector (mV), level through the ST segment: from the coronary model
  tBoost?: number; // hyperacute T: ×(1 + this)
  comps?: Comp[];
}

/** A ventricular-origin complex: main QRS vector (mV), its width σ (s), and its secondary (discordant) T vector. */
export interface VMorph { v: Vec3; w: number; t: Vec3 }

export type AvPattern = "normal" | "wenckebach" | "mobitz2" | "2:1" | "complete";

export type RhythmSpec =
  | {
    kind: "sinus"; rate: number; pr?: number; hrv?: number;
    resp?: number; // respiratory rate swing (fraction): sinus arrhythmia
    av?: AvPattern; cycle?: number; // P waves per group in Wenckebach / Mobitz II (4 = 4:3)
    escape?: { rate: number; vm?: VMorph }; // complete block: junctional (narrow) or ventricular (wide, vm) escape
    ectopy?: { every: number; vm: VMorph; coupling?: number }; // a PVC after every Nth sinus beat (1 = bigeminy)
    alternans?: number; // QRS ×(1 ± this) on alternate beats
  }
  | { kind: "af"; rate: number; irregularity?: number; fMv?: number }
  | { kind: "flutter"; atrial?: number; ratio: number | "variable" }
  | { kind: "svt"; rate: number }
  | { kind: "junctional"; rate: number }
  | { kind: "mat"; rate: number }
  | { kind: "ventricular"; rate: number; vm: VMorph; poly?: boolean; paced?: boolean; atrial?: number }
  | { kind: "torsades"; rate?: number; baseRate?: number }
  | { kind: "vf"; mv: number }
  | { kind: "asystole"; atrial?: number };

export interface EkgSpec {
  rhythm: RhythmSpec;
  morph?: Morph;
  tremor?: number; // muscle tremor (shivering) artifact, mV
}

/** One event: a QRS (supraventricular "sv" or ventricular "v"), or a P wave that did not conduct ("p"). */
export interface EBeat {
  t: number; // R peak (s); for a lone P wave, where its R would have been at its PR
  rr: number; // cycle length (s) for repolarization timing
  kind: "sv" | "v" | "p";
  pr?: number; // s from P peak to R; absent = no P before this complex
  retroP?: number; // retrograde P wave this many s after R (junctional, re-entry)
  pVec?: Vec3; // this beat's P vector (multifocal)
  vm?: VMorph;
  paced?: boolean;
  alt?: number; // QRS voltage × for this beat (electrical alternans)
}

// ---- ventricular complexes [assumed vectors chosen for the classic lead pattern]
export const VM = {
  /** Right-ventricular outflow PVC: LBBB-like (QS in V1), inferior axis. */
  rvot: { v: [0.75, 1.05, -0.95], w: 0.03, t: [-0.3, -0.35, 0.3] } as VMorph,
  /** Monomorphic VT from the left ventricle: RBBB-like (tall R in V1), superior (northwest) axis. */
  vtLv: { v: [-0.8, -1.0, 1.0], w: 0.034, t: [0.25, 0.3, -0.3] } as VMorph,
  /** Slow idioventricular escape. */
  escape: { v: [1.0, -0.5, -0.9], w: 0.04, t: [-0.35, 0.15, 0.3] } as VMorph,
  /** Right-ventricular apical pacing: LBBB-like with a left superior axis. */
  paced: { v: [0.9, -0.85, -0.95], w: 0.036, t: [-0.3, 0.3, 0.3] } as VMorph,
};
const PACER_SPIKE: Vec3 = [0.6, 1.4, 0.9];
const RETRO_P: Vec3 = scale(WAVES.P.v, -0.8); // conducted backward from the junction: inverted in II, III, aVF
const FLUTTER_VEC: Vec3 = [0.05, 0.18, -0.12]; // the circuit runs up the septum: negative sawtooth inferiorly, positive F waves in V1

/** Sawtooth: a sharp negative deflection, then a slow rise (as lead II sees typical flutter). */
function sawtooth(ph: number) { return ph < 0.25 ? 0.5 - 6 * ph : -1 + 2 * (ph - 0.25); }

class Generator {
  private rng: () => number;
  private tP = 0.25; private tV = 0.45; private n = 0; private sv = 0; private ang = 0;
  private seg = 0; private segEnd = 6; private runStart = 0; // torsades: sinus (0) or run (1), and when it ends
  constructor(private spec: EkgSpec, seed: number) { this.rng = mulberry32(seed); }
  private jit(x: number) { return 1 + x * (2 * this.rng() - 1); }

  advance(until: number): EBeat[] {
    const s = this.spec.rhythm, out: EBeat[] = [];
    switch (s.kind) {
      case "sinus": {
        const pr0 = s.pr ?? 0.16, av = s.av ?? "normal", cycle = Math.max(2, s.cycle ?? 4);
        while (this.tP <= until) {
          const tP = this.tP, rate = s.rate * (1 + (s.resp ?? 0) * Math.sin((2 * Math.PI * tP) / 4.5));
          const pp = (60 / rate) * this.jit(s.hrv ?? 0.02);
          this.tP += pp;
          let pr = pr0, conducts = true;
          if (av === "complete") conducts = false;
          else if (av === "wenckebach") { const k = this.n++ % cycle; if (k === cycle - 1) conducts = false; else pr = pr0 + 0.16 * (1 - 0.45 ** k); }
          else if (av === "mobitz2") { if (this.n++ % cycle === cycle - 1) conducts = false; }
          else if (av === "2:1") { if (this.n++ % 2 === 1) conducts = false; }
          if (!conducts) { out.push({ t: tP + pr0, rr: pp, kind: "p", pr: pr0 }); continue; }
          const tR = tP + pr, alt = s.alternans ? (this.sv % 2 ? 1 - s.alternans : 1 + s.alternans) : undefined;
          out.push({ t: tR, rr: pp, kind: "sv", pr, alt });
          this.sv++;
          if (s.ectopy && this.sv % s.ectopy.every === 0) {
            out.push({ t: tR + pp * (s.ectopy.coupling ?? 0.55), rr: pp, kind: "v", vm: s.ectopy.vm });
            // The next sinus P still fires but lands inside the PVC and cannot conduct: a compensatory pause.
            const next = this.tP, pp2 = 60 / s.rate;
            out.push({ t: next + pr0, rr: pp2, kind: "p", pr: pr0 });
            this.tP = next + pp2;
          }
        }
        if (av === "complete") {
          const esc = s.escape ?? { rate: 40 };
          while (this.tV <= until) {
            const rr = (60 / esc.rate) * this.jit(0.01);
            out.push(esc.vm ? { t: this.tV, rr, kind: "v", vm: esc.vm } : { t: this.tV, rr, kind: "sv" });
            this.tV += rr;
          }
        }
        break;
      }
      case "af":
        while (this.tV <= until) {
          const rr = (60 / s.rate) * this.jit(s.irregularity ?? 0.4);
          out.push({ t: this.tV, rr, kind: "sv" }); this.tV += Math.max(0.25, rr);
        }
        break;
      case "flutter": {
        const cyc = 60 / (s.atrial ?? 300);
        while (this.tV <= until) {
          const k = s.ratio === "variable" ? [2, 4, 3, 4, 2, 4, 4][Math.floor(this.rng() * 7)] : s.ratio;
          out.push({ t: this.tV, rr: cyc * k, kind: "sv" }); this.tV += cyc * k; // whole flutter cycles: R stays locked to the F waves
        }
        break;
      }
      case "svt": case "junctional":
        while (this.tV <= until) {
          const rr = (60 / s.rate) * this.jit(s.kind === "svt" ? 0.004 : 0.01);
          out.push({ t: this.tV, rr, kind: "sv", retroP: s.kind === "svt" ? 0.075 : 0.07 }); this.tV += rr;
        }
        break;
      case "mat": {
        const foci: Vec3[] = [WAVES.P.v, [0.13, -0.06, 0.07], [0.02, 0.16, -0.03], [0.14, 0.05, 0.12]];
        while (this.tP <= until) {
          const rr = (60 / s.rate) * this.jit(0.28), pr = 0.12 + 0.08 * this.rng();
          out.push({ t: this.tP + pr, rr, kind: "sv", pr, pVec: foci[Math.floor(this.rng() * foci.length)] });
          this.tP += rr;
        }
        break;
      }
      case "ventricular":
        while (this.tV <= until) {
          const rr = (60 / s.rate) * this.jit(s.poly ? 0.1 : 0.01);
          let vm = s.vm;
          if (s.poly) {
            this.ang += (this.rng() - 0.5) * 1.6;
            vm = { ...vm, v: scale(rotFrontal(vm.v, (this.ang * 180) / Math.PI), 0.7 + 0.6 * this.rng()), t: scale(rotFrontal(vm.t, (this.ang * 180) / Math.PI), 0.5) };
          }
          out.push({ t: this.tV, rr, kind: "v", vm, paced: s.paced }); this.tV += rr;
        }
        if (s.atrial) while (this.tP <= until) { const pp = (60 / s.atrial) * this.jit(0.02); out.push({ t: this.tP + 0.16, rr: pp, kind: "p", pr: 0.16 }); this.tP += pp; }
        break;
      case "torsades": {
        // A long-QT sinus rhythm; a PVC lands on a T wave (R on T) and starts a run whose axis turns about the
        // baseline; the run stops, the sinus rhythm returns, and it happens again.
        const base = s.baseRate ?? 52, rate = s.rate ?? 230;
        while (this.tV <= until) {
          if (this.seg === 0) {
            const rr = (60 / base) * this.jit(0.02);
            out.push({ t: this.tV, rr, kind: "sv", pr: 0.16 });
            if (this.tV + rr > this.segEnd) { this.runStart = this.tV + 0.44; this.tV = this.runStart; this.segEnd = this.runStart + 9; this.seg = 1; }
            else this.tV += rr;
          } else {
            const into = this.tV - this.runStart, th = (Math.PI * into) / 2.4, amp = 1.15 * (0.75 + 0.25 * Math.sin(1.3 * into));
            const e1: Vec3 = [0.55, 0.75, 0.35], e2: Vec3 = [-0.5, 0.15, 0.85], v: V = [0, 0, 0];
            for (let k = 0; k < 3; k++) v[k] = amp * (Math.cos(th) * e1[k] + Math.sin(th) * e2[k]);
            const rr = (60 / rate) * this.jit(0.06);
            out.push({ t: this.tV, rr, kind: "v", vm: { v, w: 0.034, t: scale(v, -0.12) } });
            this.tV += rr;
            if (this.tV > this.segEnd) { this.seg = 0; this.tV += 0.9; this.segEnd = this.tV + 6; }
          }
        }
        break;
      }
      case "vf": this.tV = until; break;
      case "asystole":
        if (s.atrial) while (this.tP <= until) { const pp = (60 / s.atrial) * this.jit(0.02); out.push({ t: this.tP + 0.16, rr: pp, kind: "p", pr: 0.16 }); this.tP += pp; }
        this.tV = until;
        break;
    }
    return out;
  }

  /** Continuous atrial or ventricular activity that is not a beat (mV vector). */
  baseline(t: number): Vec3 {
    const s = this.spec.rhythm;
    if (s.kind === "af") return fWaves(t, s.fMv ?? 0.06);
    if (s.kind === "flutter") { const cyc = 60 / (s.atrial ?? 300), f = 0.16 * sawtooth((((t - 0.45 + 0.12) / cyc) % 1 + 1) % 1); return scale(norm(FLUTTER_VEC), f); }
    if (s.kind === "vf") {
      // Chaotic: a few incommensurate rhythms near 5 Hz, phase-wandering, along a slowly turning axis.
      const d = norm([Math.sin(0.71 * t), Math.cos(0.53 * t + 1), Math.sin(0.37 * t + 2)]);
      const x = Math.sin(2 * Math.PI * 4.6 * t + 1.7 * Math.sin(0.9 * t)) + 0.7 * Math.sin(2 * Math.PI * 5.9 * t + 1.3 * Math.sin(1.37 * t + 1))
        + 0.45 * Math.sin(2 * Math.PI * 3.7 * t + 2.1 * Math.sin(0.47 * t + 2));
      return scale(d, s.mv * x * (0.65 + 0.35 * Math.sin(0.83 * t)));
    }
    return [0, 0, 0];
  }
}

/** A running EKG: beats generated ahead of the clock, sampled into the 15 leads. */
export class EkgEngine {
  beats: EBeat[] = [];
  private gen: Generator;
  private horizon = 0;
  private morph: Required<Pick<Morph, "p" | "pWide" | "qrs" | "qrsWide" | "axisShift" | "t" | "tNarrow" | "qt" | "tBoost">> & Morph;
  private qrsVec: { Q: V; R: V; S: V };

  constructor(readonly spec: EkgSpec, readonly seed = 1) {
    this.gen = new Generator(spec, seed);
    const m = spec.morph ?? {};
    this.morph = { p: 1, pWide: 1, qrs: 1, qrsWide: 1, axisShift: 0, t: 1, tNarrow: 1, qt: 1, tBoost: 0, ...m };
    const k = this.morph.qrs, a = this.morph.axisShift;
    this.qrsVec = { Q: scale(rotFrontal(WAVES.Q.v, a), k), R: scale(rotFrontal(WAVES.R.v, a), k), S: scale(rotFrontal(WAVES.S.v, a), k) };
  }

  /** Beats exist through `until` (s). */
  ensure(until: number) {
    while (this.horizon < until) {
      this.horizon += 0.5;
      this.beats.push(...this.gen.advance(this.horizon));
    }
    this.beats.sort((a, b) => a.t - b.t);
  }
  /** Forget beats more than `keep` s before t. */
  prune(t: number, keep = 15) { if (this.beats.length && this.beats[0].t < t - keep) this.beats = this.beats.filter((b) => b.t > t - keep); }

  /** T-wave centre and width (s after R) for a supraventricular beat. */
  tTiming(rr: number) {
    const m = this.morph;
    return { tc: T_CENTER(rr) * m.qt + (m.qrsWide - 1) * 0.04, tw: T_WIDTH(rr) * m.tNarrow * Math.sqrt(m.qt) };
  }

  private beatVector(dt: number, b: EBeat, out: V) {
    const add = (v: Vec3, k: number) => { if (k) { out[0] += v[0] * k; out[1] += v[1] * k; out[2] += v[2] * k; } };
    const m = this.morph;
    if (b.pr !== undefined && m.p) add(b.pVec ?? m.pVec ?? WAVES.P.v, m.p * gauss(dt, -b.pr, WAVES.P.w * m.pWide));
    if (b.retroP !== undefined) add(RETRO_P, gauss(dt, b.retroP, 0.02));
    if (b.kind === "p") return;
    if (b.kind === "v") {
      const vm = b.vm ?? VM.rvot, w = vm.w;
      add(vm.v, gauss(dt, 0, w)); add(vm.v, -0.35 * gauss(dt, 2 * w, w));
      add(vm.t, gauss(dt, Math.max(0.17, T_CENTER(b.rr) + 0.05), 0.06));
      if (b.paced) add(PACER_SPIKE, gauss(dt, -2.3 * w, 0.0025));
      return;
    }
    const W = m.qrsWide, bbb = m.bbb ?? "none", { tc, tw } = this.tTiming(b.rr), A = b.alt ?? 1;
    const J = (bbb === "lbbb" ? 0.07 : ST.jPoint) * W;
    const win = sigmoid((dt - J) / ST.edge) - sigmoid((dt - (tc + 2 * tw)) / ST.edge);
    if (bbb === "lbbb") {
      const L = BBB.lbbb;
      add(rotFrontal(L.r.v, m.axisShift), A * m.qrs * gauss(dt, L.r.t * W, L.r.w * W));
      add(L.s.v, A * m.qrs * gauss(dt, L.s.t * W, L.s.w * W));
      add(m.tVec ?? L.t, m.t * (1 + m.tBoost) * gauss(dt, tc + 0.03, tw * 1.2));
      add(L.st, win);
    } else {
      const q = this.qrsVec;
      add(q.Q, A * gauss(dt, WAVES.Q.t * W, WAVES.Q.w * W));
      add(q.R, A * gauss(dt, WAVES.R.t * W, WAVES.R.w * W));
      add(q.S, A * gauss(dt, WAVES.S.t * W, WAVES.S.w * W));
      add(m.tVec ?? WAVES.T.v, m.t * (1 + m.tBoost) * gauss(dt, tc, tw));
      if (bbb === "rbbb") {
        const R = BBB.rbbb;
        add(R.rPrime.v, A * gauss(dt, R.rPrime.t * W, R.rPrime.w * W));
        add(R.t, gauss(dt, tc + 0.02, tw));
        add(R.st, win);
      }
    }
    if (m.injury) add(m.injury, win);
    for (const c of m.comps ?? []) {
      if (c.k === "wave") add(c.v, gauss(dt, (c.anchor === "T" ? tc : 0) + c.t, c.w));
      else if (c.k === "st") add(c.v, c.shape === "jpoint" ? win * Math.max(0, Math.min(1, 1 - (dt - J) / Math.max(0.05, tc - J))) : win);
      else if (c.k === "pr" && b.pr !== undefined) {
        const from = -b.pr + 2 * WAVES.P.w * m.pWide, to = -0.045 * W;
        add(c.v, sigmoid((dt - from) / 0.008) - sigmoid((dt - to) / 0.006));
      }
    }
  }

  /** Cardiac dipole (mV) at time t: what the 3D view draws, and what every lead projects. */
  vector(t: number): V {
    this.ensure(t + 1.2);
    const out = [...this.gen.baseline(t)] as V;
    for (const b of this.beats) {
      const dt = t - b.t;
      if (dt < -0.6) break;
      if (dt > 1.0) continue;
      this.beatVector(dt, b, out);
    }
    const tr = this.spec.tremor;
    if (tr) {
      const x = Math.sin(2 * Math.PI * 7.3 * t + 3 * Math.sin(1.1 * t)) * Math.sin(2 * Math.PI * 11.9 * t) + 0.6 * Math.sin(2 * Math.PI * 17.1 * t + Math.sin(2.3 * t));
      out[0] += tr * x * 0.6; out[1] += tr * x * 0.8; out[2] += tr * x * 0.3;
    }
    return out;
  }

  leads(t: number): Record<LeadName, number> {
    const v = this.vector(t), out = {} as Record<LeadName, number>;
    for (const l of ALL_LEADS) out[l] = dot(LEAD_AXES[l], v);
    return out;
  }
}

/** Project a dipole onto a lead. */
export const project = (v: Vec3, lead: LeadName) => dot(LEAD_AXES[lead], v);

export interface Measurements {
  ventricularRate: number | null; // bpm, over the last 10 s
  atrialRate: number | null;
  regular: boolean | null;
  prMs: number | null; // null: no consistent PR
  prPattern: "constant" | "progressive" | "variable" | "dissociated" | "none";
  qrsMs: number | null;
  qtcMs: number | null; // Bazett
  axisDeg: number | null; // frontal QRS axis
  stMm: Record<LeadName, number> | null; // J+60 ms against the TP baseline
  stElevation: LeadName[];
  stDepression: LeadName[];
  meetsStemiCriteria: boolean;
}

/**
 * What a reader would measure: rates, intervals, axis and ST levels, taken from the generated beats and the waveform
 * itself (one representative conducted beat), not from the preset's labels.
 */
export function measure(spec: EkgSpec, seed = 1): Measurements {
  const e = new EkgEngine(spec, seed), T = 14;
  e.ensure(T + 1);
  const win = e.beats.filter((b) => b.t > T - 10 && b.t <= T);
  const qrs = win.filter((b) => b.kind !== "p"), sv = qrs.filter((b) => b.kind === "sv");
  const rate = (xs: EBeat[]) => (xs.length > 1 ? Math.round((60 * (xs.length - 1)) / (xs[xs.length - 1].t - xs[0].t)) : null);
  const r = spec.rhythm, m = spec.morph ?? {};
  const atria = r.kind === "flutter" ? null : win.filter((b) => b.pr !== undefined);
  const rrs = qrs.slice(1).map((b, i) => b.t - qrs[i].t), mean = rrs.reduce((a, b) => a + b, 0) / (rrs.length || 1);
  const regular = rrs.length > 2 ? Math.max(...rrs.map((x) => Math.abs(x - mean))) < 0.12 * mean : null;
  const prs = sv.filter((b) => b.pr !== undefined).map((b) => b.pr!);
  const prPattern: Measurements["prPattern"] = r.kind === "sinus" && r.av === "complete" ? "dissociated"
    : r.kind === "ventricular" && r.atrial ? "dissociated"
    : !prs.length ? "none" : r.kind === "sinus" && r.av === "wenckebach" ? "progressive"
    : Math.max(...prs) - Math.min(...prs) > 0.03 ? "variable" : "constant";
  const W = m.qrsWide ?? 1, wpw = (m.comps ?? []).some((c) => c.k === "wave" && c.t < -0.03 && c.w > 0.015);
  // A representative conducted beat, clear of the others' P and T waves, for ST level, axis and QT.
  const rep = sv.find((b, i) => i > 0 && sv[i - 1] && b.t - sv[i - 1].t > 0.3) ?? sv[1] ?? sv[0];
  let stMm: Record<LeadName, number> | null = null, axisDeg: number | null = null, qtcMs: number | null = null;
  if (rep) {
    // Baseline: the TP segment when there is one (between the last T wave and this P wave), else the PR segment.
    const prev = [...e.beats].reverse().find((b) => b.kind !== "p" && b.t < rep.t - 0.1);
    const uEnd = Math.max(0, ...(m.comps ?? []).map((c) => (c.k === "wave" && c.anchor === "T" ? c.t + 2 * c.w : 0))); // U waves after T
    const prevT = prev ? prev.t + (prev.kind === "v" ? 0.4 : (({ tc, tw }) => tc + Math.max(2.2 * tw, uEnd))(e.tTiming(prev.rr))) : -Infinity;
    const pOn = rep.t - (rep.pr ?? 0) - 0.07, qOn = rep.t - 0.055 * W;
    const tBase = pOn - prevT > 0.08 ? (pOn + Math.max(prevT, pOn - 0.3)) / 2 : rep.pr !== undefined ? qOn - 0.005 : qOn;
    const base = e.vector(tBase), J = (m.bbb === "lbbb" ? 0.07 : ST.jPoint) * W, at = e.vector(rep.t + J + 0.06);
    stMm = {} as Record<LeadName, number>;
    for (const l of ALL_LEADS) stMm[l] = Math.round((project(at, l) - project(base, l)) * 100) / 10;
    let a1 = 0, aF = 0;
    // Frontal axis from the net QRS area in I and aVF (in RBBB from the initial forces: the late r′ is not the axis).
    for (let t = rep.t - 0.07 * W; t <= rep.t + (m.bbb === "lbbb" ? 0.11 : m.bbb === "rbbb" ? 0.035 : 0.07) * W; t += 0.002) { const v = e.vector(t); a1 += project(v, "I") - project(base, "I"); aF += project(v, "aVF") - project(base, "aVF"); }
    axisDeg = Math.round((Math.atan2(aF, a1) * 180) / Math.PI);
    const { tc, tw } = e.tTiming(rep.rr), qt = tc + 2.2 * tw + 0.05 * W + (m.bbb && m.bbb !== "none" ? 0.03 : 0);
    qtcMs = Math.round((qt / Math.sqrt(Math.max(0.3, rep.rr))) * 1000);
  }
  const vOnly = qrs.length > 0 && !sv.length;
  const stOk = stMm && !vOnly;
  return {
    ventricularRate: rate(qrs) ?? (r.kind === "vf" || r.kind === "asystole" ? 0 : null),
    atrialRate: r.kind === "flutter" ? (r.atrial ?? 300) : atria && atria.length > 1 ? rate(atria) : null,
    regular,
    prMs: prPattern === "constant" ? Math.round((prs.reduce((a, b) => a + b, 0) / prs.length) * 1000) : null,
    prPattern,
    qrsMs: vOnly ? 160 : sv.length ? Math.round((m.bbb && m.bbb !== "none" ? 140 : 90) * W + (wpw ? 30 : 0)) : null,
    qtcMs: vOnly ? null : qtcMs,
    axisDeg: vOnly ? null : axisDeg,
    stMm: stOk ? stMm : null,
    stElevation: stOk ? ALL_LEADS.filter((l) => stMm![l] >= 1) : [],
    stDepression: stOk ? ALL_LEADS.filter((l) => stMm![l] <= -1) : [],
    meetsStemiCriteria: stOk ? meetsStElevation(stMm!) : false,
  };
}
