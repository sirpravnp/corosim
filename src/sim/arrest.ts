// Cardiac-arrest state machine (task B4a). Pure, seeded, deterministic TypeScript: no dependence on Simulation or the physics engine.
// The engine feeds in its current cardiac output (fraction of normal) and rhythm class each tick; this module keeps the no-flow clock,
// irreversible injury, CPR, shocks, drugs and the status (arrest | rosc | dead). Constants and citations: src/config/arrest.ts.
// step(), shock(), give() and setCpr() mutate the state they are given; use cloneArrest() to branch.
import { ARREST as C } from "../config/arrest";

export type RhythmClass = "vf" | "pulselessVt" | "asystole" | "pea" | "perfusing";
export type ArrestStatus = "arrest" | "rosc" | "dead";
export type ArrestDrug = "epinephrine" | "amiodarone" | "lidocaine";

export interface CprState { on: boolean; rate: number; depthCm: number; quality: number }
export interface ShockRecord { tS: number; joules: number; sync: boolean; success: boolean }
export interface DrugRecord { drug: ArrestDrug; dose: number; tS: number }

export interface ArrestState {
  tS: number;
  rhythmClass: RhythmClass;
  /** True when a perfusing rhythm is a tachyarrhythmia (cardioversion target); set by the engine through step input. */
  tachyarrhythmia: boolean;
  /** Seconds with effectively no output, reduced by CPR credit. */
  noFlowS: number;
  cpr: CprState;
  lastShock: ShockRecord | null;
  /** Irreversible injury 0..1; rises with no-flow and never recovers. */
  injury: number;
  status: ArrestStatus;
  drugs: DrugRecord[];
  /** Seconds of VF / pulseless VT, discounted by CPR (the "untreated" clock that drives defibrillation success). */
  vfUntreatedS: number;
  /** Smoothed compression duty 0..1 (interruptions lower CPR output). */
  cprDuty: number;
  /** Smoothed recent CPR quality 0..1 (used for shock odds and the VF clock). */
  cprRecent: number;
  roscTimerS: number;
  rearrestTimerS: number;
  /** Seconds since the arrest began (or since last restart). */
  arrestS: number;
}

export interface StepInput { output: number; rhythmClass?: RhythmClass; tachyarrhythmia?: boolean }
export interface ShockResult {
  success: boolean;
  newRhythmClass: RhythmClass;
  /** False when the device could not discharge (synchronized mode on a rhythm with no R wave). */
  discharged: boolean;
  note?: string;
}
export type Rng = () => number;

/** mulberry32: small seeded generator returning [0,1). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const isShockable = (r: RhythmClass) => r === "vf" || r === "pulselessVt";

export function createArrest(rhythmClass: RhythmClass = "vf"): ArrestState {
  return {
    tS: 0, rhythmClass, tachyarrhythmia: false, noFlowS: 0,
    cpr: { on: false, rate: 110, depthCm: 5.5, quality: 1 },
    lastShock: null, injury: 0, status: "arrest", drugs: [],
    vfUntreatedS: 0, cprDuty: 0, cprRecent: 0, roscTimerS: 0, rearrestTimerS: 0, arrestS: 0,
  };
}

export function cloneArrest(s: ArrestState): ArrestState {
  return { ...s, cpr: { ...s.cpr }, drugs: s.drugs.map((d) => ({ ...d })), lastShock: s.lastShock ? { ...s.lastShock } : null };
}

/** Start again from a fresh arrest (the only way out of "dead"). */
export function restart(s: ArrestState, rhythmClass: RhythmClass = "vf"): ArrestState {
  Object.assign(s, createArrest(rhythmClass));
  return s;
}

export function setCpr(s: ArrestState, p: Partial<CprState>): void {
  const c = s.cpr;
  if (s.status === "dead") return;
  if (p.on !== undefined) c.on = p.on;
  if (p.rate !== undefined) c.rate = clamp(p.rate, C.cpr.rateMin, C.cpr.rateMax);
  if (p.depthCm !== undefined) c.depthCm = clamp(p.depthCm, C.cpr.depthMin, C.cpr.depthMax);
  if (p.quality !== undefined) c.quality = clamp(p.quality, 0, 1);
}

function band(x: number, lo: number, hi: number, minX: number, maxX: number, fLow: number, fHigh: number): number {
  if (x >= lo && x <= hi) return 1;
  if (x < lo) return fLow + (1 - fLow) * clamp((x - minX) / (lo - minX), 0, 1);
  return fHigh + (1 - fHigh) * clamp((maxX - x) / (maxX - hi), 0, 1);
}

/** Rate x depth x quality technique factor 0..1 (1 at 100-120/min, 5-6 cm, quality 1). */
export function cprTechnique(c: CprState): number {
  const k = C.cpr;
  const rate = band(c.rate, k.rateBest[0], k.rateBest[1], k.rateMin, k.rateMax, k.rateEdgeFactor, k.rateEdgeFactor);
  const depth = band(c.depthCm, k.depthBest[0], k.depthBest[1], k.depthMin, k.depthMax, k.depthLowFactor, k.depthHighFactor);
  return rate * depth * clamp(c.quality, 0, 1);
}

function epiActive(s: ArrestState): boolean {
  for (let i = s.drugs.length - 1; i >= 0; i--) {
    if (s.drugs[i].drug === "epinephrine") return s.tS - s.drugs[i].tS <= C.drugs.epinephrine.windowS;
  }
  return false;
}

/** Cardiac output (fraction of normal) delivered by CPR right now: 0 when off, about 0.3 at best, lower for poor technique or pauses. */
export function perfusion(s: ArrestState): number {
  if (!s.cpr.on) return 0;
  const duty = clamp(s.cprDuty, 0, 1);
  const tech = cprTechnique(s.cpr);
  const boost = epiActive(s) ? C.drugs.epinephrine.cprOutputBoost * tech : 0;
  return (C.cpr.maxOutput * tech + boost) * duty;
}

export function step(s: ArrestState, dtS: number, input: StepInput, rng?: Rng): ArrestState {
  if (s.status === "dead" || dtS <= 0) return s;
  s.tS += dtS;
  if (input.rhythmClass) s.rhythmClass = input.rhythmClass;
  if (input.tachyarrhythmia !== undefined) s.tachyarrhythmia = input.tachyarrhythmia;

  // CPR memories: duty (fast) and recent quality (slow).
  s.cprDuty += ((s.cpr.on ? 1 : 0) - s.cprDuty) * (1 - Math.exp(-dtS / C.cpr.dutyTauS));
  const instQ = s.cpr.on ? cprTechnique(s.cpr) : 0;
  s.cprRecent += (instQ - s.cprRecent) * (1 - Math.exp(-dtS / C.cpr.recentTauS));

  const out = Math.max(clamp(input.output, 0, 1.5), perfusion(s));
  const perfusing = s.rhythmClass === "perfusing";

  // No-flow clock with CPR credit.
  if (out >= C.noFlowRecoverOutput && perfusing) {
    s.noFlowS = Math.max(0, s.noFlowS - C.noFlowRecoverRate * dtS);
  } else {
    s.noFlowS += Math.max(C.noFlowMinRate, 1 - out / C.noFlowCreditRef) * dtS;
  }

  // Irreversible injury: onset at injuryOnsetNoFlowS, reaches 1 at deathAfterNoFlowS (smoothstep), never recovers.
  const u = clamp((s.noFlowS - C.injuryOnsetNoFlowS) / (C.deathAfterNoFlowS - C.injuryOnsetNoFlowS), 0, 1);
  s.injury = Math.max(s.injury, u * u * (3 - 2 * u));

  if (s.status === "arrest") s.arrestS += dtS;
  if (isShockable(s.rhythmClass) && s.status === "arrest") {
    s.vfUntreatedS += dtS * (1 - C.cpr.vfClockProtection * s.cprRecent);
  }

  if (s.noFlowS > C.deathAfterNoFlowS || s.injury >= 1) {
    s.status = "dead";
    s.cpr.on = false;
    return s;
  }

  // Spontaneous ROSC from PEA / asystole under CPR (never from a shock); epinephrine raises it.
  if (s.status === "arrest" && rng && (s.rhythmClass === "pea" || s.rhythmClass === "asystole") && s.cpr.on) {
    const perMin = C.spontaneousRoscPerMin * s.cprRecent * (epiActive(s) ? C.drugs.epinephrine.roscMultiplier : 1);
    if (rng() < 1 - Math.exp(-(perMin / 60) * dtS)) s.rhythmClass = "perfusing";
  }

  // ROSC: perfusing rhythm with output >= roscOutput sustained. Re-arrest if lost.
  const good = s.rhythmClass === "perfusing" && out >= C.roscOutput;
  if (s.status === "arrest") {
    s.roscTimerS = good ? s.roscTimerS + dtS : 0;
    if (s.roscTimerS >= C.roscSustainS) { s.status = "rosc"; s.rearrestTimerS = 0; s.vfUntreatedS = 0; }
  } else if (s.status === "rosc") {
    s.rearrestTimerS = good ? 0 : s.rearrestTimerS + dtS;
    if (s.rearrestTimerS >= C.rearrestAfterS) { s.status = "arrest"; s.roscTimerS = 0; s.vfUntreatedS = 0; }
  }
  return s;
}

/** Drug bonus on shock success. Amiodarone and lidocaine do not stack (the larger wins). */
function drugShockBonus(s: ArrestState): number {
  const k = C.drugs;
  let amioMg = 0, lido = false;
  for (const d of s.drugs) { if (d.drug === "amiodarone") amioMg += d.dose; else if (d.drug === "lidocaine") lido = true; }
  const amio = k.amiodarone.firstBonus * clamp(amioMg / k.amiodarone.firstMg, 0, 1) +
    k.amiodarone.secondBonus * clamp((amioMg - k.amiodarone.firstMg) / k.amiodarone.secondMg, 0, 1);
  const lidoB = lido ? k.lidocaine.bonus : 0;
  return Math.max(amio, lidoB) + (epiActive(s) ? k.epinephrine.shockBonus : 0);
}

/** Probability that an unsynchronized shock of this energy converts VF / pulseless VT right now. */
export function defibSuccessProbability(s: ArrestState, joules: number): number {
  const k = C.shock;
  const ef = joules >= k.energyHigh ? 1
    : joules >= k.energyLow ? k.energyFactorAtLow + (1 - k.energyFactorAtLow) * (joules - k.energyLow) / (k.energyHigh - k.energyLow)
    : k.energyFactorAtLow * Math.max(0, joules) / k.energyLow;
  const p = k.baseSuccess * ef - k.declinePerMin * (s.vfUntreatedS / 60) + k.cprBonus * s.cprRecent + drugShockBonus(s);
  return clamp(p, k.minSuccess, k.maxSuccess);
}

/** Deliver a shock. Mutates state (rhythm class on success, lastShock). Asystole/PEA never convert. */
export function shock(s: ArrestState, opts: { joules: number; sync: boolean }, rng: Rng): ShockResult {
  const { joules, sync } = opts;
  const k = C.shock;
  const rec = (success: boolean) => { s.lastShock = { tS: s.tS, joules, sync, success }; };
  if (s.status === "dead") return { success: false, newRhythmClass: s.rhythmClass, discharged: false, note: "patient is dead" };
  const r = s.rhythmClass;

  if (isShockable(r)) {
    if (sync) { // no R wave to sync to: the device does not discharge
      rec(false);
      return { success: false, newRhythmClass: r, discharged: false, note: "synchronized mode cannot discharge in VF/pulseless VT; use unsynchronized defibrillation" };
    }
    const ok = rng() < defibSuccessProbability(s, joules);
    rec(ok);
    if (ok) { s.rhythmClass = "perfusing"; s.tachyarrhythmia = false; s.vfUntreatedS = 0; }
    return { success: ok, newRhythmClass: s.rhythmClass, discharged: true };
  }

  if (r === "perfusing") {
    if (sync && s.tachyarrhythmia) {
      const ok = joules >= k.cardioversionMinJoules && rng() < k.cardioversionSuccess * Math.max(0.5, clamp(joules / k.energyLow, 0, 1));
      rec(ok);
      if (ok) s.tachyarrhythmia = false;
      return { success: ok, newRhythmClass: "perfusing", discharged: true };
    }
    if (sync) { rec(false); return { success: false, newRhythmClass: r, discharged: true, note: "no tachyarrhythmia to cardiovert" }; }
    // Unsynchronized shock through a perfusing rhythm may land on the T wave and induce VF.
    const pInduce = s.tachyarrhythmia ? k.unsyncedInduceVfTachy : k.unsyncedInduceVfNormal;
    rec(false);
    if (rng() < pInduce) {
      s.rhythmClass = "vf"; s.vfUntreatedS = 0;
      return { success: false, newRhythmClass: "vf", discharged: true, note: "unsynchronized shock on a perfusing rhythm induced VF" };
    }
    return { success: false, newRhythmClass: r, discharged: true, note: "unsynchronized shock on a perfusing rhythm" };
  }

  // asystole / PEA: not shockable, never ROSC.
  rec(false);
  return { success: false, newRhythmClass: r, discharged: true, note: "non-shockable rhythm" };
}

/** Give a drug (dose in mg; defaults to the standard dose, amiodarone 300 then 150). Returns a note about timing problems, if any. */
export function give(s: ArrestState, drug: ArrestDrug, dose?: number): { ok: boolean; note?: string } {
  if (s.status === "dead") return { ok: false, note: "patient is dead" };
  const k = C.drugs;
  const d = dose ?? (drug === "epinephrine" ? k.epinephrine.doseMg
    : drug === "amiodarone" ? (s.drugs.some((x) => x.drug === "amiodarone") ? k.amiodarone.secondMg : k.amiodarone.firstMg)
    : k.lidocaine.doseMg);
  if (!(d > 0)) return { ok: false, note: "dose must be positive" };
  if (drug === "epinephrine") {
    const last = [...s.drugs].reverse().find((x) => x.drug === "epinephrine");
    if (last && s.tS - last.tS < k.epinephrine.minIntervalS) {
      // Recorded for history, but the effect window does not restart.
      s.drugs.push({ drug, dose: d, tS: last.tS });
      return { ok: true, note: "epinephrine given sooner than every 3 min; no added benefit" };
    }
  }
  s.drugs.push({ drug, dose: d, tS: s.tS });
  return { ok: true };
}
