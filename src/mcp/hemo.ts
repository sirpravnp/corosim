import type { Simulation } from "../sim/simulation";
import type { PatientSpec } from "../sim/patient";
import { BridgeSource } from "../sim/bridgeSource";
import { syncSolver } from "../sim/bridgeSolver";
import { rightHeartCath, type RightHeartCath } from "../sim/rightHeartCath";
import { leftHeartCath } from "../sim/leftHeartCath";
import { oxygenReadout } from "../sim/oxygenReadout";
import { analyzeJvp, jvpWords, type JvpResult } from "../physics/jvp";
import { loopMetrics, cardiacPowerOutput } from "../physics/loopMetrics";
import { buildModel } from "../physics/structural";
import { ENERGETICS } from "../config/energetics";
import { PATIENTS } from "../config/structural";

/**
 * The hemodynamic readings the MCP tools add (task P15): right- and left-heart cath, JVP, oxygen, PV-loop metrics. They read the
 * same `BridgeSource` the playground panels read, over the server's headless `Simulation` with the synchronous solver.
 *
 * Output versions: every result carries `format: "corosim.<name>/<n>"`. Bump n when a field is renamed or changes unit.
 *
 * Patient: `Simulation` keeps only the normalised Scenario, not the PatientSpec fields (kind, heart, pericardium, fluids,
 * ventilation, devices). The tools remember them here, per Simulation, so the structural lesions survive between calls and
 * go into share links.
 *
 * Cost: a solve is up to ~13 `analyze` calls (hundreds of ms cold). The bridge is cached per Simulation and re-solved only when
 * the patient (Scenario or the remembered fields) changed, the simulation was reloaded, or the bridge's own input thresholds trip
 * as the simulation runs (HR, ischemia, MAP, SVR, CO). Reading twice in a row costs microseconds.
 */

// ---------------------------------------------------------------- the remembered PatientSpec
const EXTRA = ["kind", "heart", "pericardium", "septum", "fluids", "ventilation", "devices"] as const;
const extras = new WeakMap<Simulation, PatientSpec>();

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Merge a patch into a base, objects recursively, anything else replaced. */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObj(base) || !isObj(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? out[k] : deepMerge(out[k], v);
  return out;
}

/** A new patient: remember the PatientSpec-only fields of `spec` (replaces what was remembered). */
export function rememberPatient(sim: Simulation, spec: PatientSpec) {
  const e: Record<string, unknown> = {};
  for (const k of EXTRA) if (spec[k] !== undefined) e[k] = JSON.parse(JSON.stringify(spec[k]));
  extras.set(sim, e as PatientSpec);
  hemoCache.get(sim)?.markDirty();
}
/** A change to the running patient: merge the PatientSpec-only fields of `patch` into what is remembered. */
export function patchPatient(sim: Simulation, patch: PatientSpec) {
  const e = { ...(extras.get(sim) ?? {}) } as Record<string, unknown>;
  for (const k of EXTRA) if (patch[k] !== undefined) e[k] = deepMerge(e[k], JSON.parse(JSON.stringify(patch[k])));
  // pericardiocentesis is an action: it comes off the remembered effusion and is not kept
  const peri = e.pericardium as Record<string, unknown> | undefined;
  if (peri && "drainMl" in peri) {
    const drain = Number(peri.drainMl) || 0;
    delete peri.drainMl;
    if (peri.effusionMl !== undefined) peri.effusionMl = Math.max(0, Number(peri.effusionMl) - drain);
    if (!Object.keys(peri).length) delete e.pericardium;
  }
  extras.set(sim, e as PatientSpec);
}
/** The whole current patient: the Scenario as the simulation holds it plus the remembered PatientSpec fields. What a share link encodes. */
export function currentPatient(sim: Simulation): PatientSpec { return { ...(extras.get(sim) ?? {}), ...sim.scenario() }; }

// ---------------------------------------------------------------- the cached bridge
class Entry {
  readonly bridge: BridgeSource;
  private opts: { patient?: PatientSpec; solver: typeof syncSolver };
  private key = ""; private lastT = 0; private dirty = true;
  /** Wall-clock ms of the last re-solve, for the latency report. */
  lastSolveMs = 0; resolves = 0;
  constructor(private sim: Simulation) {
    this.opts = { patient: currentPatient(sim), solver: syncSolver };
    this.bridge = new BridgeSource(sim, this.opts);
  }
  markDirty() { this.dirty = true; }
  /** Bring the bridge up to date with the patient; returns it. */
  ready(): BridgeSource {
    const { sim, bridge } = this, p = currentPatient(sim), key = JSON.stringify(p);
    if (sim.t < this.lastT - 1e-6) this.dirty = true; // reloaded
    if (key !== this.key) this.dirty = true;
    if (this.dirty || bridge.beats(1).length === 0) {
      const t0 = performance.now();
      this.opts.patient = p;
      const solves = bridge.solves;
      if (bridge.beats(1).length === 0 || sim.t < this.lastT - 1e-6) sim.warmup(6); // beats to replay; no clinical time passes. The first beat solves.
      if (bridge.solves === solves) { bridge.refresh(); sim.warmup(3); } // nothing solved on the way (a patient change with beats already held): the replayed beats must be the new waveform, which takes a beat to blend in
      this.lastSolveMs = performance.now() - t0; this.resolves++;
      this.key = key; this.dirty = false;
    }
    this.lastT = sim.t;
    return bridge;
  }
}
const hemoCache = new WeakMap<Simulation, Entry>();
function entry(sim: Simulation): Entry { let e = hemoCache.get(sim); if (!e) { e = new Entry(sim); hemoCache.set(sim, e); } return e; }
/** The up-to-date bridge for this simulation (cached; see the file comment). */
export function bridgeFor(sim: Simulation): BridgeSource { return entry(sim).ready(); }
/** Re-solve counters of the cache, for tests and latency reports. */
export function hemoStats(sim: Simulation) { const e = hemoCache.get(sim); return { resolves: e?.resolves ?? 0, lastSolveMs: e ? +e.lastSolveMs.toFixed(0) : 0 }; }

// ---------------------------------------------------------------- output helpers
const fin = Number.isFinite;
/** Round; null for NaN/Infinity so the JSON says "no value" rather than 0. */
const r = (x: number | undefined, d = 1): number | null => (x !== undefined && fin(x) ? +x.toFixed(d) : null);
const pct = (x: number | undefined): number | null => (x !== undefined && fin(x) ? +(x * 100).toFixed(1) : null);
const trouble = (src: BridgeSource) => fin(src.numbers().map) ? null : "No solve yet (the simulation has produced no beat).";
const header = (name: string, src: BridgeSource) => ({
  format: `corosim.${name}/1`,
  patientKind: src.patientKind,
  source: src.standalone
    ? "Structural engine solved on the patient's own baseline (a non-adult patient is not tied to the adult monitor)."
    : "Structural engine solved and calibrated to the monitor's MAP and cardiac output (a steady-state solve replayed, not beat-by-beat physiology).",
});

// ---------------------------------------------------------------- heart cath
function rightSide(c: RightHeartCath) {
  const p = c.pullback, o = c.oximetry, co = c.output, d = c.derived;
  return {
    pressuresMmHg: p ? {
      ra: { mean: r(p.ra.mean), a: r(p.ra.a), v: r(p.ra.v) },
      rv: { systolic: r(p.rv.systolic), endDiastolic: r(p.rv.endDiastolic) },
      pa: { systolic: r(p.pa.systolic), diastolic: r(p.pa.diastolic), mean: r(p.pa.mean) },
      pcwp: r(p.pcwp),
    } : null,
    oximetry: {
      satPct: Object.fromEntries(o.sites.map((s) => [s.site, pct(s.sat)])),
      mixedVenousPct: pct(o.mixedVenous),
      deltasPctPoints: { atrial: pct(o.deltas.atrial), ventricular: pct(o.deltas.ventricular), greatVessel: pct(o.deltas.greatVessel) },
      stepUp: o.stepUp ? { level: o.stepUp.level, from: o.stepUp.from, to: o.stepUp.to, deltaPctPoints: pct(o.stepUp.delta) } : null,
      allStepUps: o.stepUps.map((s) => s.level),
      thresholds: "atrial >= 7, ventricular >= 5, great vessel >= 5 percentage points",
    },
    output: { fickLmin: r(co.fick, 2), thermodilutionLmin: r(co.thermodilution, 2), qpLmin: r(co.qp, 2), qsLmin: r(co.qs, 2), qpQs: r(co.qpQs, 2), vo2MlMin: r(co.vo2, 0), hbGdl: r(co.hb, 1) },
    derived: { pvrWood: r(d.pvr, 2), svrWood: r(d.svr, 2), qpQs: r(d.qpQs, 2), tpgMmHg: r(d.tpg), dpgMmHg: r(d.dpg), papi: r(d.papi, 2), cpoW: r(d.cpo, 2), ci: r(d.ci, 2), bsaM2: r(d.bsa, 2) },
  };
}

/** Right- and left-heart cath of the current patient. */
export function heartCath(sim: Simulation, side: "both" | "right" | "left" = "both") {
  const src = bridgeFor(sim), bad = trouble(src);
  if (bad) return { ...header("heart_cath", src), error: bad };
  const kind = src.patientKind;
  const out: Record<string, unknown> = { ...header("heart_cath", src), units: "mmHg, L/min, Wood units, cm2, saturation in percent", note: "Fick and thermodilution disagree with a shunt or tricuspid regurgitation; Qp:Qs comes from oximetry." };
  if (side !== "left") { const rc = rightHeartCath(src); out.right = rc ? rightSide(rc) : null; }
  if (side !== "right") {
    const l = leftHeartCath(src.numbers(), src.beats(1)[0], kind);
    if (!l) out.left = null;
    else {
      const normal = PATIENTS[kind].valveAreas;
      out.left = {
        hrBpm: r(l.hr, 0), coLmin: r(l.co, 2),
        lvMmHg: { systolic: r(l.lv.systolic), lvedp: r(l.lv.lvedp) },
        aoMmHg: { systolic: r(l.ao.systolic), diastolic: r(l.ao.diastolic), mean: r(l.ao.mean) },
        aorticGradientMmHg: { peakToPeak: r(l.gradient.peakToPeak), mean: r(l.gradient.mean), peakInstantaneous: r(l.gradient.peakInstant) },
        mitral: { meanGradientMmHg: r(l.mitral.meanGradient), wedgeMeanMmHg: r(l.mitral.wedgeMean) },
        valveAreasCm2: { aorticGorlin: r(l.area.aorticGorlin, 2), aorticHakki: r(l.area.aorticHakki, 2), mitralGorlin: r(l.area.mitralGorlin, 2), mitralEngine: r(l.area.mitralEngine, 2), mitralHakki: r(l.area.mitralHakki, 2) },
        normalAreasCm2: { aortic: normal.av, mitral: normal.mv, for: kind },
        grade: { aortic: l.severity.aortic, mitral: l.severity.mitral, basis: `area as a fraction of the ${kind} normal valve (not adult cm2 cut-offs); adult aortic also uses the mean gradient` },
        ejectionTimeS: r(l.sep, 3), fillingTimeS: r(l.dfp, 3),
      };
    }
  }
  return out;
}

// ---------------------------------------------------------------- JVP
const waveOut = (w: { t: number; p: number } | null) => (w ? { tS: r(w.t, 3), mmHg: r(w.p) } : null);
export function jvp(sim: Simulation) {
  const src = bridgeFor(sim), beat = src.beats(1)[0];
  if (!beat) return { ...header("jvp", src), error: "No beat yet." };
  const j: JvpResult = analyzeJvp({ p: beat.pressure.RA, t: beat.time, atrial: beat.atrial, rr: beat.rr });
  const present = (["a", "c", "x", "v", "y"] as const).filter((k) => j[k]);
  return {
    ...header("jvp", src),
    heightCm: r(j.heightCm), heightNote: "cm above the sternal angle, patient at 45 degrees; normal is up to about 3 (mean RA 6)",
    meanRaMmHg: r(j.meanRA),
    wavesPresent: present, aWaveAbsent: !j.a,
    waves: { a: j.a ? { ...waveOut(j.a), riseMmHg: r(j.a.rise), cannon: j.a.cannon } : null, c: waveOut(j.c), x: waveOut(j.x), v: waveOut(j.v), y: j.y ? { ...waveOut(j.y), depthMmHg: r(j.y.depth) } : null },
    aWaveCount: j.aWaves.length,
    classes: j.classes, words: jvpWords(j.classes) || "normal waveform",
    rrS: r(beat.rr, 3),
  };
}

// ---------------------------------------------------------------- oxygen
export function oxygen(sim: Simulation) {
  const src = bridgeFor(sim), o = oxygenReadout(src.saturations(), src.numbers(), src.devices());
  if (!o.ready) return { ...header("oxygen", src), error: "No solve yet." };
  const s = src.saturations();
  return {
    ...header("oxygen", src),
    satPct: { spo2: pct(o.spo2), preductal: pct(o.pre), postductal: pct(o.post), mixedVenousPA: pct(o.svo2) },
    ductalDifference: { prePostPctPoints: r(o.diff.points), significant: o.diff.significant, ...(o.diff.explanation ? { why: o.diff.explanation } : {}) },
    do2MlMin: r(o.do2, 0), vo2MlMin: r(o.vo2, 0), extractionRatio: r(o.extraction, 2), qpQs: r(o.qpQs, 2), lactate: r(o.lactate, 1),
    nodeSatPct: Object.fromEntries(Object.entries(s.node).map(([k, v]) => [k, pct(v)])),
    ...(o.hasEcmo ? { ecmoReturnSatPct: pct(o.ecmoReturn) } : {}),
    cues: o.cues,
    note: "DO2 = CO x Hb x 1.34 x SaO2; VO2 is the patient's assumed baseline (no metabolic cart). Extraction = VO2/DO2 (normal about 0.25).",
  };
}

// ---------------------------------------------------------------- loop metrics (E1)
export function loopMetricsReport(sim: Simulation) {
  const src = bridgeFor(sim), beat = src.beats(1)[0], n = src.numbers();
  if (!beat) return { ...header("loop_metrics", src), error: "No beat yet." };
  const kind = src.patientKind, lvSize = (currentPatient(sim).heart?.lvSize ?? 1);
  const v0 = buildModel({ patient: kind, lvSize }).chambers[7]!.v0; // index 7 = LV (structural.ts node order)
  const massG = ENERGETICS.lvMassG * (PATIENTS[kind].weightKg / PATIENTS.adult.weightKg);
  const { p, v } = beat.loops.LV;
  const m = loopMetrics(p, v, { v0, hr: n.hr, t: beat.time, massG });
  return {
    ...header("loop_metrics", src),
    chamber: "LV, the last beat",
    volumesMl: { edv: r(m.edv, 0), esv: r(m.esv, 0), sv: r(m.sv, 0), v0: r(v0, 1) }, ef: r(m.ef, 2),
    strokeWork: { mmHgMl: r(m.strokeWork, 0), joules: r(m.strokeWorkJ, 2) },
    pva: { mmHgMl: r(m.pva, 0), joules: r(m.pvaJ, 2) }, potentialEnergyMmHgMl: r(m.pe, 0), efficiency: r(m.efficiency, 2),
    elastanceMmHgPerMl: { ea: r(m.ea, 2), ees: r(m.ees, 2), coupling: r(m.coupling, 2) },
    mvo2: { mlPerBeat: r(m.mvo2.perBeatMl, 3), mlPerMin: r(m.mvo2.perMinMl, 1), mlPer100gPerMin: r(m.mvo2.per100gPerMinMl, 1) },
    cpoW: r(cardiacPowerOutput(n.map, n.co), 2), dpdtMmHgPerS: { max: r(m.dpdtMax, 0), min: r(m.dpdtMin, 0) },
    note: `Ees here is Pes/(Ves-V0) at the maximum-elastance point (V0 from the baseline ventricle). LV mass assumed ${r(massG, 0)} g. Ea/Ees about 1 is matched coupling; CPO < 0.6 W in shock predicts death.`,
  };
}
