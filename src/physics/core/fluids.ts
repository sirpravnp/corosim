import { FLUIDS } from "../../config/fluids";

/**
 * Fluid compartments (task C2): plasma, red cells and interstitium, a slow ODE in clinical minutes (the simulation's clinical clock,
 * not the beat clock). The engine holds the blood; this model decides how much blood there should be, from what is given, lost and
 * exchanged with the interstitium, and the simulation moves that volume in and out of the engine's veins through `VolumeExchange`.
 * The engine's pressures come back in through `setPressures` (mean aortic and mean venous pressure of the last beats).
 *
 * States (ml unless noted): plasma Vp, red cells Vr, interstitium Vi; plasma oncotic protein Mp (g; albumin and the other plasma
 * proteins), synthetic colloid Mc (g, protein-equivalent), interstitial protein Mi (g). Blood volume = Vp + Vr, hematocrit
 * Vr/(Vp + Vr), Hb = hematocrit · mchc. Transcapillary flow (Starling, revised by Levick and Michel):
 *
 *   Pc  = Pv + f·(Pa − Pv)                              capillary hydrostatic pressure, mmHg
 *   Jv  = Kf·[(Pc − Pi) − σ·(πp − πi)]                  filtration out of the plasma, ml/min (negative: absorption)
 *   πx  = 2.1·c + 0.16·c² + 0.009·c³                    oncotic pressure of c g/dl (Landis and Pappenheimer); πp from (Mp + Mc)/Vp, πi from Mi/Vi
 *   Pi  = Pi0 + x/ciHigh + span·tanh(x/(span·ciLow))    interstitial pressure at the volume x = Vi − Vi0 above rest (x > 0; the stiff term is absent below rest)
 *   L   = L0·exp(lymphSlope·(Pi − Pi0))                 lymph flow back to the plasma, ml/min, at most lymphMax·L0
 *   E   = kE·Mp                                         escape of protein to the interstitium (returned by lymph at Mi/Vi)
 *
 * Pi0 and kE are set from the resting state so that the resting patient is in balance (Jv = L, E = L·Mi/Vi): the model neither
 * drifts nor needs a settling period. Water is conserved: Vp + Vr + Vi = W0 + given − lost − urine + maintenance, exactly (every
 * flow leaves one state and enters another, and the accumulators are integrated with the states), see `balance()`.
 *
 *  - give(kind, ml) or a scheduled `Dose`: crystalloid (water into the plasma; it stays only as long as the Starling forces hold it:
 *    it dilutes the plasma protein, so the oncotic pressure falls and the water leaves), colloid (protein-equivalent mass that only
 *    leaves with its half-life), albumin (5 %: protein joins Mp, and leaks at the capillary's rate) and blood (red cells, hematocrit
 *    `bloodHct`, with a little protein).
 *  - hemorrhage (ml/min of whole blood, plasma and red cells in proportion), `bleed(ml)` for a sudden loss.
 *  - diuresis: urine = urineRest · volume term · pressure term · `diuretic` (a multiplier, 1 = none); water taken in at the same
 *    rate as the resting urine (`maintenance`) keeps the resting patient level.
 *  - capillary leak (0..1): Kf up, σ down, protein escape up (config/fluids.ts).
 *  - lung water (C3): a fourth compartment Vl, the extravascular water of the lung, filled from the plasma by the same Starling law with the
 *    lung's own constants (`FLUIDS.lung`): Pc = PCWP + 0.4·(PAP − PCWP) (Gaar), a lower Kf and σ, the interstitial oncotic pressure from the
 *    lung lymph protein, a lymph flow that rises with the interstitial pressure (5-10 fold before edema accumulates) and clears the lung when
 *    Pc falls. Its water comes from and returns to the plasma, so the total water balance still closes. The excess lung water lowers the
 *    pulmonary venous saturation (`satDrop`).
 * Units: volumes ml, masses g, pressures mmHg, time clinical minutes, flows ml/min.
 */
export type FluidKind = "crystalloid" | "colloid" | "albumin" | "blood";

/** A fluid run in from clinical minute `start` over `dur` minutes. `delivered` is what has gone in so far (ml). */
export interface FluidDose { kind: FluidKind; ml: number; start: number; dur: number; delivered: number; key: string }
/** A dose as the patient spec writes it: `atMin` is the clinical minute it starts (default 0), `overMin` how long it runs (default: the bolus time). */
export interface DoseSpec { kind: FluidKind; ml: number; atMin?: number; overMin?: number }
const doseKey = (d: DoseSpec) => `${d.kind}|${d.ml}|${d.atMin ?? 0}|${d.overMin ?? 0}`;

/** Oncotic pressure (mmHg) of a protein solution of `c` g/dl (Landis and Pappenheimer 1963). */
export function oncotic(c: number): number {
  const { a, b, d } = FLUIDS.oncotic, x = Math.max(c, 0);
  return a * x + b * x * x + d * x * x * x;
}

/** Starling filtration (ml/min, positive out of the capillary): Kf·[(Pc − Pi) − σ·(πp − πi)]. Pressures mmHg. Shared with the lung (C3). */
export function starling(kf: number, sigma: number, pc: number, pi: number, piP: number, piI: number): number {
  return kf * (pc - pi - sigma * (piP - piI));
}

export interface FluidPatient {
  /** Total blood volume, ml. */
  bloodMl: number;
  /** Hemoglobin, g/dl. */
  hb: number;
  weightKg: number;
}

/** What the model reports. Volumes ml, concentrations g/dl, pressures mmHg, flows ml/min, cumulative amounts ml since the start. */
export interface FluidReadout {
  /** Plasma volume, ml. */
  plasma: number;
  redCells: number;
  /** Blood volume (plasma + red cells), ml. */
  blood: number;
  /** Interstitial fluid, ml, and its change from rest. */
  interstitial: number;
  interstitialExcess: number;
  /** Hematocrit (0..1) and hemoglobin (g/dl). */
  hematocrit: number;
  hb: number;
  /** Plasma protein (including colloid, as protein) in g/dl, and the oncotic pressures, mmHg. */
  plasmaProtein: number;
  oncoticPlasma: number;
  oncoticInterstitial: number;
  /** Capillary and interstitial hydrostatic pressure, mmHg. */
  capillaryPressure: number;
  interstitialPressure: number;
  /** Filtration Jv out of the plasma, lymph flow back, and the net flow out of the vessels (Jv − lymph), ml/min. Negative: the interstitium refills the plasma. */
  filtration: number;
  lymph: number;
  netTranscapillary: number;
  urineRate: number;
  /** Cumulative: all fluid and blood given, whole blood lost, urine made, maintenance water taken in. */
  given: number;
  lost: number;
  urine: number;
  maintenance: number;
  /** Capillary leak factor (0..1) and hemorrhage rate (ml/min) in force. */
  leak: number;
  hemorrhage: number;
  /** Lung water (C3): extravascular lung water ml, its excess over rest ml, the index (ml per kg of body weight), the pulmonary capillary pressure and the interstitial pressure of the lung (mmHg), lung filtration and lymph (ml/min), and the fall of the pulmonary venous saturation it causes (a fraction). */
  lungWater: number;
  lungWaterExcess: number;
  lungWaterIndex: number;
  lungCapillaryPressure: number;
  lungInterstitialPressure: number;
  lungFiltration: number;
  lungLymph: number;
  lungSatDrop: number;
}

const N = 11;
const [VP, VR, VI, MP, MI, MC, GIVEN, LOST, URINE, MAINT, VL] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export class FluidCompartments {
  /** Capillary leak (0..1), hemorrhage rate (ml/min of whole blood), diuretic multiplier of the urine flow. Set between steps. */
  leak = 0; hemorrhage = 0; diuretic = 1;
  /** Clinical minutes since the start. */
  time = 0;
  readonly doses: FluidDose[] = [];
  private y = new Float64Array(N);
  private pa: number; private pv: number; private pcwp: number; private pap: number;
  // resting values and scaled constants
  private readonly s: number; // weight / 70
  private readonly v0: { vp: number; vr: number; vi: number; blood: number };
  private readonly pi0: number; private readonly kE: number; private readonly kf: number; private readonly l0: number;
  private readonly ciLow: number; private readonly ciHigh: number; private readonly u0: number;
  // the lung
  private readonly vl0: number; private readonly piL0: number; private readonly kfL: number; private readonly lL0: number; private readonly ciLowL: number; private readonly ciHighL: number; private readonly ciDryL: number;

  constructor(patient: FluidPatient, pa = FLUIDS.mapRest, pv = 6) {
    const F = FLUIDS, s = (this.s = patient.weightKg / 70), hct = patient.hb / F.mchc;
    const vr = patient.bloodMl * hct, vp = patient.bloodMl - vr, vi = F.interstitialMlPerKg * patient.weightKg;
    this.v0 = { vp, vr, vi, blood: patient.bloodMl };
    this.y[VP] = vp; this.y[VR] = vr; this.y[VI] = vi;
    this.y[MP] = (F.plasmaProtein / 100) * vp; this.y[MI] = (F.interstitialProtein / 100) * vi; this.y[MC] = 0;
    this.pa = pa; this.pv = pv;
    this.kf = F.kf * s; this.l0 = F.lymphRest * s; this.u0 = F.urineRest * s; this.ciLow = F.ciLow * s; this.ciHigh = F.ciHigh * s;
    // rest: Jv = L0 at the resting capillary pressure fixes the interstitial pressure Pi0; E = L0·ci0 fixes the protein escape rate
    this.pi0 = F.pcRest - F.sigma * (oncotic(F.plasmaProtein) - oncotic(F.interstitialProtein)) - this.l0 / this.kf;
    this.kE = (this.l0 * F.interstitialProtein / 100) / this.y[MP];
    // the lung, in balance at the resting wedge and PA pressures
    const Lg = F.lung;
    this.pcwp = Lg.pcwpRest; this.pap = Lg.papRest;
    this.vl0 = this.y[VL] = Lg.evlwMlPerKg * patient.weightKg;
    this.kfL = Lg.kf * s; this.lL0 = Lg.lymphRest * s; this.ciLowL = Lg.ciLow * s; this.ciHighL = Lg.ciHigh * s; this.ciDryL = Lg.ciDry * s;
    this.piL0 = this.pcLungOf() - Lg.sigma * (oncotic(F.plasmaProtein) - this.piLungOncotic(F.plasmaProtein)) - this.lL0 / this.kfL;
  }

  // ---- inputs ---------------------------------------------------------------------------------------------------
  /** The engine's pressures, mmHg: mean aortic pressure `pa` and mean venous pressure `pv` (of SVC, IVC and the splanchnic reservoir). Non-finite values are ignored. */
  setPressures(pa: number, pv: number) { if (Number.isFinite(pa)) this.pa = pa; if (Number.isFinite(pv)) this.pv = pv; }

  /** The engine's pressures in the lung, mmHg: mean left atrial (the wedge) and mean pulmonary artery pressure. Non-finite values are ignored. */
  setLungPressures(pcwp: number, pap: number) { if (Number.isFinite(pcwp)) this.pcwp = pcwp; if (Number.isFinite(pap)) this.pap = pap; }

  /** Schedule a dose: `ml` of `kind` from clinical minute `start`, run in over `dur` minutes (0: the bolus time of the config). A dose that should have started already starts now. */
  schedule(kind: FluidKind, ml: number, start = 0, dur = 0): FluidDose {
    const d = this.newDose({ kind, ml, atMin: start, overMin: dur });
    this.doses.push(d);
    return d;
  }
  private newDose(x: DoseSpec): FluidDose {
    return { kind: x.kind, ml: Math.max(0, x.ml), start: Math.max(x.atMin ?? 0, this.time), dur: Math.max(x.overMin ?? 0, 0) || FLUIDS.bolusMin, delivered: 0, key: doseKey(x) };
  }
  /**
   * Replace the schedule by `list` (a patient spec's `fluids.given`). A dose already in the schedule (same kind, amount and times)
   * keeps its progress; a new one is scheduled; one that has begun and is no longer listed stops where it is (what went in stays
   * given); one that has not begun is dropped.
   */
  setDoses(list: readonly DoseSpec[]) {
    const pool = [...this.doses], keep: FluidDose[] = [];
    for (const x of list) {
      const i = pool.findIndex((d) => d.key === doseKey(x));
      keep.push(i >= 0 ? pool.splice(i, 1)[0] : this.newDose(x));
    }
    for (const d of pool) if (d.delivered > 0) { d.ml = d.delivered; keep.push(d); }
    this.doses.splice(0, this.doses.length, ...keep);
  }

  /** Put the whole dose in at once (the plasma takes it before the next step). */
  give(kind: FluidKind, ml: number) { this.add(this.y, kind, ml); }

  /** Whole blood lost at once, ml (negative: whole blood of the patient's own composition given back). */
  bleed(ml: number) {
    const y = this.y, vb = y[VP] + y[VR];
    if (vb <= 0 || !Number.isFinite(ml)) return;
    const floor = FLUIDS.hemorrhage.floor * this.v0.blood; // a loss stops at the floor (FLUIDS.hemorrhage); blood given back (ml < 0) is not limited
    const f = ml > 0 ? Math.min(ml, Math.max(0, vb - floor)) / vb : ml / vb, p = y[VP] * f, r = y[VR] * f;
    y[MP] -= y[MP] * f; y[MC] -= y[MC] * f; y[VP] -= p; y[VR] -= r; y[LOST] += p + r;
  }

  private add(y: Float64Array, kind: FluidKind, ml: number) {
    const F = FLUIDS;
    if (kind === "blood") {
      const r = ml * F.bloodHct, p = ml - r;
      y[VR] += r; y[VP] += p; y[MP] += (p * F.bloodProteinGdl) / 100;
    } else {
      y[VP] += ml;
      if (kind === "albumin") y[MP] += (ml * F.albuminGdl) / 100;
      else if (kind === "colloid") y[MC] += (ml * F.colloidGdl) / 100;
    }
    y[GIVEN] += ml;
  }

  // ---- the model ------------------------------------------------------------------------------------------------
  private pcOf() { return Math.max(0, this.pv + FLUIDS.postcapillaryShare * (this.pa - this.pv)); }
  private piOf(vi: number) {
    const x = vi - this.v0.vi, span = FLUIDS.stiffSpan;
    return this.pi0 + x / this.ciHigh + (x > 0 ? span * Math.tanh(x / (span * this.ciLow)) : 0);
  }
  private pcLungOf() { return Math.max(0, this.pcwp + FLUIDS.lung.pcShare * (this.pap - this.pcwp)); }
  private piLungOncotic(cp: number) { return oncotic(FLUIDS.lung.proteinRatio * cp); }
  private piLungOf(vl: number) {
    const x = vl - this.vl0, span = FLUIDS.lung.stiffSpan;
    return x < 0 ? this.piL0 + x / this.ciDryL : this.piL0 + x / this.ciHighL + span * Math.tanh(x / (span * this.ciLowL)); // the lung does not dry out: below rest the interstitium is stiff
  }
  /** Fall of the pulmonary venous saturation (a fraction) with the lung water `vl` (ml). */
  private satDropOf(vl: number) {
    const Lg = FLUIDS.lung, x = Math.max(0, vl - this.vl0) / (this.s * 70);
    const h = Math.pow(x / Lg.dropMlPerKg50, Lg.dropHill);
    return (Lg.satDropMax * h) / (1 + h);
  }
  private urineOf(vb: number) {
    const F = FLUIDS;
    const p = Math.min(2.5, Math.max(0, (this.pa - F.mapAnuria) / (F.mapRest - F.mapAnuria)));
    return this.u0 * Math.exp(F.volumeGain * (vb / this.v0.blood - 1)) * p * Math.max(this.diuretic, 0);
  }
  /** Flows at state `y`: filtration, lymph, protein escape, urine, and the two oncotic and interstitial pressures. */
  private flows(y: ArrayLike<number>) {
    const F = FLUIDS, L = Math.min(Math.max(this.leak, 0), 1), vp = Math.max(y[VP], 1), vi = Math.max(y[VI], 1);
    const piP = oncotic((100 * (y[MP] + y[MC])) / vp), piI = oncotic((100 * y[MI]) / vi), pi = this.piOf(vi), pc = this.pcOf();
    const kf = this.kf * (1 + F.leak.kfGain * L), sigma = F.sigma * (1 - F.leak.sigmaLoss * L);
    const jv = starling(kf, sigma, pc, pi, piP, piI);
    const lymph = Math.min(this.l0 * Math.exp(F.lymphSlope * (pi - this.pi0)), F.lymphMax * this.l0);
    const escape = this.kE * (1 + F.leak.proteinGain * L) * y[MP];
    const vl = Math.max(y[VL], 1), cp = (100 * (y[MP] + y[MC])) / vp, piL = this.piLungOf(vl), pcL = this.pcLungOf();
    const jvL = starling(this.kfL, F.lung.sigma, pcL, piL, piP, this.piLungOncotic(cp));
    const lymphL = Math.min(this.lL0 * Math.exp(F.lung.lymphSlope * (piL - this.piL0)), F.lung.lymphMax * this.lL0);
    return { jv, lymph, escape, urine: this.urineOf(y[VP] + y[VR]), piP, piI, pi, pc, ci: y[MI] / vi, jvL, lymphL, piL, pcL };
  }

  /** Bleeding rate (ml/min) at blood volume `vb`: the set rate, tapering to nothing between `FLUIDS.hemorrhage.taperFrom` and `floor` of the resting volume. */
  private hemorrhageRate(vb: number): number {
    const H = FLUIDS.hemorrhage, v0 = this.v0.blood, rate = Math.max(this.hemorrhage, 0);
    if (!(rate > 0)) return 0;
    return rate * Math.min(1, Math.max(0, (vb - H.floor * v0) / ((H.taperFrom - H.floor) * v0)));
  }
  /** The bleeding rate in force now, ml/min (the set rate, tapered near the floor). */
  get hemorrhageNow(): number { return this.hemorrhageRate(this.y[VP] + this.y[VR]); }

  /** d(state)/dt at `y` with the infusion rates `inf` (ml/min per kind), clinical minutes. */
  private deriv(y: Float64Array, inf: Record<FluidKind, number>, out: Float64Array) {
    const F = FLUIDS, f = this.flows(y), vb = Math.max(y[VP] + y[VR], 1), hem = this.hemorrhageRate(y[VP] + y[VR]), hemP = (hem * Math.max(y[VP], 0)) / vb, hemR = (hem * Math.max(y[VR], 0)) / vb;
    const bloodP = inf.blood * (1 - F.bloodHct), bloodR = inf.blood * F.bloodHct, vp = Math.max(y[VP], 1), m0 = this.u0;
    const give = inf.crystalloid + inf.colloid + inf.albumin + inf.blood;
    out[VP] = inf.crystalloid + inf.colloid + inf.albumin + bloodP - f.jv + f.lymph - f.jvL + f.lymphL - hemP - f.urine + m0;
    out[VR] = bloodR - hemR;
    out[VI] = f.jv - f.lymph;
    out[VL] = f.jvL - f.lymphL;
    out[MP] = (inf.albumin * F.albuminGdl) / 100 + (bloodP * F.bloodProteinGdl) / 100 - f.escape + f.lymph * f.ci - (y[MP] * hemP) / vp;
    out[MC] = (inf.colloid * F.colloidGdl) / 100 - (y[MC] * Math.LN2) / F.colloidHalfLifeMin - (y[MC] * hemP) / vp;
    out[MI] = f.escape - f.lymph * f.ci;
    out[GIVEN] = give; out[LOST] = hemP + hemR; out[URINE] = f.urine; out[MAINT] = m0;
  }

  /** Advance `minutes` of clinical time (doses run in, hemorrhage, Starling exchange, urine). RK4 in steps of at most `maxStepMin`. */
  advance(minutes: number) {
    if (!(minutes > 0)) return;
    const n = Math.max(1, Math.ceil(minutes / FLUIDS.maxStepMin)), h = minutes / n;
    const k1 = new Float64Array(N), k2 = new Float64Array(N), k3 = new Float64Array(N), k4 = new Float64Array(N), t = new Float64Array(N), prev = new Float64Array(N);
    for (let i = 0; i < n; i++) {
      prev.set(this.y);
      const inf = this.infusion(this.time, this.time + h);
      this.deriv(this.y, inf, k1);
      for (let j = 0; j < N; j++) t[j] = this.y[j] + 0.5 * h * k1[j];
      this.deriv(t, inf, k2);
      for (let j = 0; j < N; j++) t[j] = this.y[j] + 0.5 * h * k2[j];
      this.deriv(t, inf, k3);
      for (let j = 0; j < N; j++) t[j] = this.y[j] + h * k3[j];
      this.deriv(t, inf, k4);
      for (let j = 0; j < N; j++) this.y[j] += (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]);
      // volumes and protein masses cannot go below zero; a step that came out non-finite is undone (the state stays where it was, never NaN)
      let finite = true;
      for (let j = 0; j < N; j++) { if (!Number.isFinite(this.y[j])) finite = false; else if (j <= MC && this.y[j] < 0) this.y[j] = 0; }
      if (!finite) this.y.set(prev);
      this.time += h;
    }
  }

  /** Infusion rates (ml/min) of each kind over [t0, t1], and record what is delivered. */
  private infusion(t0: number, t1: number): Record<FluidKind, number> {
    const r: Record<FluidKind, number> = { crystalloid: 0, colloid: 0, albumin: 0, blood: 0 };
    for (const d of this.doses) {
      const left = d.ml - d.delivered;
      if (left <= 0) continue;
      const over = Math.min(t1, d.start + d.dur) - Math.max(t0, d.start);
      if (over <= 0) continue;
      const ml = Math.min(left, (d.ml * over) / d.dur);
      d.delivered += ml; r[d.kind] += ml / (t1 - t0);
    }
    return r;
  }

  // ---- outputs --------------------------------------------------------------------------------------------------
  /** Blood volume the circulation should hold, ml: the simulation moves the engine's blood to this. */
  get bloodVolume(): number { return this.y[VP] + this.y[VR]; }
  /** Blood volume at rest, ml. */
  get restBloodVolume(): number { return this.v0.blood; }

  /** Fall of the pulmonary venous saturation from the lung water now (a fraction, 0 at rest): what the oxygen solve takes off `satLung`. */
  get satDrop(): number { return this.satDropOf(this.y[VL]); }

  /** Total water error, ml: (Vp + Vr + Vi + Vl) − (W0 + given − lost − urine + maintenance). Zero up to rounding. */
  balance(): number {
    const y = this.y, v = this.v0;
    return y[VP] + y[VR] + y[VI] + y[VL] - (v.vp + v.vr + v.vi + this.vl0 + y[GIVEN] - y[LOST] - y[URINE] + y[MAINT]);
  }

  read(): FluidReadout {
    const y = this.y, f = this.flows(y), vb = y[VP] + y[VR], hct = vb > 0 ? y[VR] / vb : 0;
    return {
      plasma: y[VP], redCells: y[VR], blood: vb, interstitial: y[VI], interstitialExcess: y[VI] - this.v0.vi,
      hematocrit: hct, hb: hct * FLUIDS.mchc,
      plasmaProtein: (100 * (y[MP] + y[MC])) / Math.max(y[VP], 1), oncoticPlasma: f.piP, oncoticInterstitial: f.piI,
      capillaryPressure: f.pc, interstitialPressure: f.pi,
      filtration: f.jv, lymph: f.lymph, netTranscapillary: f.jv - f.lymph, urineRate: f.urine,
      given: y[GIVEN], lost: y[LOST], urine: y[URINE], maintenance: y[MAINT], leak: this.leak, hemorrhage: this.hemorrhage,
      lungWater: y[VL], lungWaterExcess: y[VL] - this.vl0, lungWaterIndex: y[VL] / (this.s * 70), lungCapillaryPressure: f.pcL, lungInterstitialPressure: f.piL,
      lungFiltration: f.jvL, lungLymph: f.lymphL, lungSatDrop: this.satDropOf(y[VL]),
    };
  }
}
