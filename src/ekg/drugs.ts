import { MORPH, PROFILES, type Antiarrhythmic, type ChannelDrive } from "../config/antiarrhythmics";
import type { Comp, EkgSpec, Morph, RhythmSpec, VMorph } from "./engine";
import type { Vec3 } from "../config/ecg";

export { ANTIARRHYTHMICS, DRUG_LABEL, MORPH, PROFILES, type Antiarrhythmic, type ChannelDrive } from "../config/antiarrhythmics";

/**
 * Apply one antiarrhythmic to an EKG spec. The drug is a channel mix (INa, IKr, ICaL, beta); Vaughan–Williams is a label.
 * Rhythm maneuvers (adenosine on AVNRT, flecainide 1:1 flutter, AV-nodal blockers in preexcited AF) are the teaching point;
 * QRS / QT / PR / rate scales are [assumed] sizes from `src/config/antiarrhythmics.ts`. Does not mutate the input spec.
 */

export type DrugEvent = "terminated" | "unmasked" | "one-to-one" | "slowed" | "widened" | "prolonged-qt" | "no-effect" | "dangerous";

export interface DrugResult {
  spec: EkgSpec;
  drug: Antiarrhythmic;
  notes: string[]; // what changed, sentence case, for a one-line readout
  warnings: string[]; // teaching cautions (not UI chrome)
  events: DrugEvent[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const vec = (v: Vec3): Vec3 => [v[0], v[1], v[2]];
const vm = (m: VMorph): VMorph => ({ v: vec(m.v), w: m.w, t: vec(m.t) });
const comp = (c: Comp): Comp => ({ ...c, v: vec(c.v) });

function cloneMorph(m: Morph): Morph {
  return {
    ...m,
    pVec: m.pVec ? vec(m.pVec) : undefined,
    tVec: m.tVec ? vec(m.tVec) : undefined,
    injury: m.injury ? vec(m.injury) : undefined,
    comps: m.comps?.map(comp),
  };
}

function cloneRhythm(r: RhythmSpec): RhythmSpec {
  if (r.kind === "sinus") {
    return {
      ...r,
      escape: r.escape ? { rate: r.escape.rate, vm: r.escape.vm ? vm(r.escape.vm) : undefined } : undefined,
      ectopy: r.ectopy ? { every: r.ectopy.every, vm: vm(r.ectopy.vm), coupling: r.ectopy.coupling } : undefined,
    };
  }
  if (r.kind === "ventricular") return { ...r, vm: vm(r.vm) };
  return { ...r };
}

function cloneSpec(spec: EkgSpec): EkgSpec {
  const out: EkgSpec = { rhythm: cloneRhythm(spec.rhythm) };
  if (spec.morph) out.morph = cloneMorph(spec.morph);
  if (spec.tremor) out.tremor = spec.tremor;
  return out;
}

function morphOf(spec: EkgSpec): Morph {
  return (spec.morph ??= {});
}

/** True if a WPW-style delta wave is present, or AF with a wide QRS (preexcited AF). */
export function isPreexcited(spec: EkgSpec): boolean {
  const delta = (spec.morph?.comps ?? []).some((c) => c.k === "wave" && c.t < -0.03 && c.w > 0.015);
  if (delta) return true;
  return spec.rhythm.kind === "af" && (spec.morph?.qrsWide ?? 1) >= 1.25;
}

/**
 * Rate used for use-dependent INa block. `override` wins when given. Flutter uses ventricular = atrial / ratio
 * (variable block ≈ 3:1). Rhythms without a pacemaker rate return null.
 */
export function effectiveRateBpm(spec: EkgSpec, override?: number): number | null {
  if (override != null && Number.isFinite(override)) return override;
  const r = spec.rhythm;
  if (r.kind === "flutter") {
    const atrial = r.atrial ?? 300;
    return r.ratio === "variable" ? atrial / 3 : atrial / r.ratio;
  }
  if (r.kind === "torsades") return r.rate ?? 230;
  if ("rate" in r && typeof r.rate === "number") return r.rate;
  return null;
}

function push(xs: string[], s: string) { if (!xs.includes(s)) xs.push(s); }
function event(xs: DrugEvent[], e: DrugEvent) { if (!xs.includes(e)) xs.push(e); }

function applyInaQrs(spec: EkgSpec, p: ChannelDrive, dose: number, rateBpm: number | null, notes: string[], events: DrugEvent[]) {
  if (!(p.ina > 0)) return;
  const u = rateBpm == null ? 0 : clamp((rateBpm - 60) / 90, 0, 1);
  const factor = Math.max(0, 1 + p.useDependence * (u - 0.3));
  const mult = 1 + MORPH.qrs * p.ina * dose * factor;
  if (mult <= 1.002) return;
  const m = morphOf(spec);
  m.qrsWide = (m.qrsWide ?? 1) * mult;
  push(notes, "QRS widened.");
  event(events, "widened");
}

function applyIkr(spec: EkgSpec, p: ChannelDrive, dose: number, notes: string[], events: DrugEvent[]) {
  if (!(p.ikr > 0)) return;
  const m = morphOf(spec);
  m.qt = (m.qt ?? 1) * (1 + MORPH.qt * p.ikr * dose);
  m.tNarrow = (m.tNarrow ?? 1) * (1 + MORPH.tNarrow * p.ikr * dose);
  push(notes, "QT prolonged.");
  event(events, "prolonged-qt");
}

function applyAvNodal(spec: EkgSpec, p: ChannelDrive, dose: number, notes: string[], events: DrugEvent[]) {
  const nodal = p.ical + 0.7 * p.beta;
  if (nodal <= 0) return;
  const r = spec.rhythm;
  if (r.kind === "sinus") {
    r.pr = (r.pr ?? 0.16) + MORPH.pr * (p.ical + 0.6 * p.beta) * dose;
    r.rate *= 1 - MORPH.sinus * nodal * dose;
    push(notes, "PR lengthened.");
    push(notes, "Sinus rate slowed.");
    event(events, "slowed");
  } else if (r.kind === "af") {
    r.rate *= 1 - Math.min(0.55, (MORPH.afIcal * p.ical + MORPH.afBeta * p.beta) * dose);
    push(notes, "Ventricular rate slowed.");
    event(events, "slowed");
  } else if (r.kind === "flutter") {
    if (r.ratio !== "variable" && r.ratio < 4) r.ratio = 4;
    push(notes, "AV block increased.");
    event(events, "slowed");
  } else if (r.kind === "junctional" || r.kind === "mat") {
    r.rate *= 1 - MORPH.sinus * nodal * dose;
    push(notes, "Rate slowed.");
    event(events, "slowed");
  }
}

export function applyDrug(spec: EkgSpec, drug: Antiarrhythmic, opts?: { dose?: number; rateBpm?: number }): DrugResult {
  const out = cloneSpec(spec);
  const dose = clamp(opts?.dose ?? 1, 0, 1);
  const notes: string[] = [];
  const warnings: string[] = [];
  const events: DrugEvent[] = [];
  if (dose === 0) {
    notes.push("Nothing was given.");
    return { spec: out, drug, notes, warnings, events };
  }

  const p = PROFILES[drug];
  const r = out.rhythm;
  const pre = isPreexcited(out);

  // 5. AV-nodal blockers in preexcitation (especially AF): never convert to VF; do not slow the ventricle.
  if (pre && (drug === "adenosine" || drug === "diltiazem" || drug === "metoprolol")) {
    warnings.push("AV-nodal block in preexcited AF can force conduction down the accessory pathway and risk VF.");
    event(events, "dangerous");
    if (r.kind === "af") {
      r.rate *= 1 + MORPH.preAfRise * dose;
      morphOf(out).qrsWide = (out.morph?.qrsWide ?? 1) * (1 + MORPH.preAfWide * dose);
      push(notes, "Ventricular rate rose as accessory-pathway conduction increased.");
    } else {
      push(notes, "AV-nodal block in a preexcited rhythm is unsafe.");
    }
    return { spec: out, drug, notes, warnings, events };
  }

  // Adenosine is a bolus maneuver, not a standing morph scale.
  if (drug === "adenosine") {
    if (r.kind === "svt") {
      out.rhythm = { kind: "sinus", rate: 72 };
      push(notes, "AVNRT terminated.");
      event(events, "terminated");
      return { spec: out, drug, notes, warnings, events };
    }
    if (r.kind === "flutter") {
      r.ratio = 8;
      push(notes, "Flutter unmasked: F waves at 8:1 conduction.");
      event(events, "unmasked");
      return { spec: out, drug, notes, warnings, events };
    }
    if (r.kind === "ventricular" || r.kind === "torsades" || r.kind === "vf") {
      push(notes, "Wide-complex tachycardia unchanged.");
      event(events, "no-effect");
      return { spec: out, drug, notes, warnings, events };
    }
    if (r.kind === "af") {
      push(notes, "Brief pause then AF continues.");
      event(events, "no-effect");
      return { spec: out, drug, notes, warnings, events };
    }
    push(notes, "Adenosine had no lasting effect.");
    event(events, "no-effect");
    return { spec: out, drug, notes, warnings, events };
  }

  // 6. Procainamide slows the accessory pathway in preexcited AF.
  if (drug === "procainamide" && pre && r.kind === "af") {
    r.rate *= 1 - MORPH.preProcSlow * dose;
    const w0 = out.morph?.qrsWide ?? 1;
    morphOf(out).qrsWide = w0 + (1.15 - w0) * dose;
    push(notes, "Accessory pathway slowed.");
    event(events, "slowed");
    applyIkr(out, p, dose, notes, events);
    return { spec: out, drug, notes, warnings, events };
  }

  // 7. Class Ic in flutter: atrial rate falls, AV still conducts 1:1, QRS widens at the new ventricular rate.
  if (drug === "flecainide" && r.kind === "flutter") {
    r.atrial = (r.atrial ?? 300) - MORPH.icAtrial * dose;
    r.ratio = 1;
    push(notes, "Atrial rate slowed; 1:1 AV conduction.");
    event(events, "one-to-one");
    warnings.push("Class Ic in flutter can produce 1:1 conduction with a wide QRS.");
    applyInaQrs(out, p, dose, r.atrial, notes, events);
    applyIkr(out, p, dose, notes, events);
    return { spec: out, drug, notes, warnings, events };
  }

  // 8. Diltiazem terminates SVT; metoprolol only slows it.
  if (drug === "diltiazem" && r.kind === "svt") {
    out.rhythm = { kind: "sinus", rate: 72 };
    push(notes, "SVT terminated.");
    event(events, "terminated");
    return { spec: out, drug, notes, warnings, events };
  }
  if (drug === "metoprolol" && r.kind === "svt") {
    r.rate *= 1 - 0.15 * dose;
    push(notes, "SVT slowed. A calcium blocker is more likely to terminate.");
    event(events, "slowed");
    return { spec: out, drug, notes, warnings, events };
  }

  // 10. Amiodarone may terminate SVT; on VT it slows the rate.
  if (drug === "amiodarone" && r.kind === "svt") {
    out.rhythm = { kind: "sinus", rate: 72 };
    push(notes, "SVT terminated.");
    event(events, "terminated");
    return { spec: out, drug, notes, warnings, events };
  }

  if (drug === "sotalol") {
    warnings.push("Pause-dependent torsades; worse with low potassium.");
  }

  // Ventricular-origin QRS is not a morph.qrsWide scale: slow VT a little and widen vm.w.
  if (r.kind === "ventricular") {
    if (drug === "lidocaine" || drug === "amiodarone" || drug === "procainamide") {
      r.rate *= 1 - MORPH.vtSlow * dose;
      r.vm = { ...r.vm, w: r.vm.w * (1 + MORPH.vmW * dose) };
      push(notes, "Ventricular rate slowed.");
      event(events, "slowed");
    }
    applyIkr(out, p, dose, notes, events);
    return { spec: out, drug, notes, warnings, events };
  }

  const rateBpm = effectiveRateBpm(out, opts?.rateBpm);
  applyInaQrs(out, p, dose, rateBpm, notes, events);
  applyIkr(out, p, dose, notes, events);
  applyAvNodal(out, p, dose, notes, events);
  return { spec: out, drug, notes, warnings, events };
}
