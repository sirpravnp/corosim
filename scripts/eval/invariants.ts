// Physical invariants of a core-engine run. Independent of any expectation the owner writes.
// A violation here is an engine finding (docs/EVALUATION.md), not a spec miss.
import type { State } from "./states";
import { VARIABLES, type Value } from "./variables";
import type { SeedRun } from "./engine";

export interface Hit { state: string; seed: number; where: string; rule: string }

const FRACTIONS = ["lvEf", "rvEf", "lvEfEstimate", "lvIschemia", "rvIschemia", "lvInfarctFraction", "ischemicMassFraction", "pulmonaryCongestion"];
const POSITIVE = ["lvEdv", "lvEsv", "laVolume", "stressedVolume", "unstressedVolume", "fluid.blood", "fluid.plasma"];
/** Whole groups that are null when that device or sac is not in the patient. A null inside a group that is otherwise present is a violation. */
const ABSENT_GROUPS: string[][] = [
  ["impella.flow", "impella.motorCurrent", "impella.placement", "impella.suctionLevel"],
  ["iabp.coronaryAugmentation", "iabp.peakDiastolic"],
  ["ecmo.flow", "ecmo.rpm", "ecmo.sweep", "ecmo.fio2", "ecmo.returnSat", "ecmo.suction", "ecmo.membraneDp", "ecmo.head"],
  ["impellaRp.flow", "impellaRp.level", "impellaRp.speed", "impellaRp.current", "impellaRp.placement", "impellaRp.suction"],
  ["peri.effusionMl", "peri.pressure", "peri.sacMl"],
];
const CONSERVATION_ML = 1; // fluid.conservation is the water-balance error, ml; "near 0" (zero up to rounding)

const isNum = (x: Value | undefined): x is number => typeof x === "number" && Number.isFinite(x);

const NO_BEAT_HEMO = ["lvEdv", "lvEsv", "msfp", "stressedVolume", "unstressedVolume"];
const LHC_BEAT = ["lhc.lvSystolic", "lhc.peakToPeak", "lhc.meanGradient", "lhc.peakInstant", "lhc.mitralMeanGradient", "lhc.avForwardMl", "lhc.aorticSeverity", "lhc.mitralSeverity"];
const CORONARY_IDX = ["endoSupplyIndex", "epiSupplyIndex", "transmuralRatio", "dpti", "tti", "viabilityRatio", "diastolicFraction"];
const JVP = ["jvp.heightCm", "jvp.meanRa", "jvp.class"];
const LOOP = ["loop.strokeWork", "loop.ea", "loop.ees", "loop.dpdtMax", "loop.dpdtMin", "loop.mvo2"];
const groupNull = (keys: string[], row: Record<string, Value>) => keys.every((k) => row[k] == null);

/** A rhythm the ECG reader gives a PR interval to. AF, VT, VF and complete block have none (simulation.ts, ekg/engine.ts). */
function expectsPr(row: Record<string, Value>): boolean {
  const r = String(row.rhythm ?? "");
  return r === "sinus" || r.startsWith("sinus") || r.includes("first-degree");
}

/** Null is allowed where the source's own contract withholds a number: lactate is not modelled, lysis until treated,
 *  cath fields with no lesion or no dye arrival, a device or sac that is not in the patient, an estimator that abstains
 *  (HRV, baroreflex, pulsus, a Weiss tau with no falling limb and no pulse), and panels that need a beat the heart has
 *  not recorded yet (the instant after a rebuild). A null outside those contracts is a violation. */
export function nullAllowed(id: string, row: Record<string, Value>): boolean {
  if (id === "lactate") return true;
  if (id === "lysisSucceeded") return row[id] == null;
  // The cath reader withholds a Gorlin/Hakki area below its gradient floor (10 mmHg aortic, 2 mmHg mitral). A normal valve is under that floor.
  if ((id === "lhc.aorticAreaGorlin" || id === "lhc.aorticAreaHakki") && row[id] == null) {
    const g = id === "lhc.aorticAreaHakki" ? row["lhc.peakToPeak"] : row["lhc.meanGradient"];
    return !(typeof g === "number" && g >= 10);
  }
  if (id === "lhc.mitralAreaGorlin" && row[id] == null) {
    const g = row["lhc.mitralMeanGradient"];
    return !(typeof g === "number" && g >= 2);
  }
  // HRV needs 10 normal beats (a 5 s window has fewer). Baroreflex sensitivity is null when the window has no sequences.
  if (id === "sdnn" || id === "rmssd" || id === "pnn50" || id === "rsaPeakToTrough" || id === "baroreflexSensitivity") return row[id] == null;
  if ((id.startsWith("cath.") || id === "lesionFfr") && row["cath.diameterStenosisPct"] == null) return true;
  if (id === "lesionFfr" || id === "cath.restPdPa" || id === "cath.ffrCall") return true;
  // TIMI frame count is null when the dye never reaches the end of the vessel (grade 0). cath.ts.
  if (id === "cath.timiFrames" && row[id] == null) return row["cath.timiGrade"] == null || row["cath.timiGrade"] === 0;
  // Gorlin area is undefined when the valve never opened or the mean gradient is ~0 (the helper returns null).
  if (id.endsWith(".eoa") && row[id] == null) {
    const mean = row[id.replace(/\.eoa$/, ".meanGradient")];
    const open = row[id.replace(/\.eoa$/, ".openMs")];
    return !(typeof mean === "number" && mean > 0 && typeof open === "number" && open > 0);
  }
  if (id.endsWith(".regurgFraction") && row[id] == null) {
    const fwd = row[id.replace(/\.regurgFraction$/, ".forwardMl")];
    return !(typeof fwd === "number" && fwd > 1e-6);
  }
  // No consistent PR in AF, VT, VF or complete block. A sinus or first-degree rhythm is expected to have one.
  if (id === "prMs" && row[id] == null) return !expectsPr(row);
  // The a wave is NaN when the representative beat has no atrial marker (rightHeartCath.pullback).
  if (id === "rhc.raA" && row[id] == null) return !expectsPr(row) || row["rhc.rvSystolic"] == null;
  // Pulsus and PPV abstain when a breath has fewer than 3 beats, or the window has fewer than 8 (respiratory.ts, readout.ts).
  if (id === "pulsusParadoxus" || id === "ppv") return row[id] == null;
  // Stroke volume is output/rate. VF has no rate.
  if (id === "sv" && row[id] == null) return !(typeof row.hr === "number" && row.hr > 0);
  // Resistances and Qp:Qs divide by a flow. Zero native output (and VF, where a device can still show a flow) leaves them undefined.
  if ((id === "svr" || id === "pvr" || id === "qpQs") && row[id] == null) return row.hr === 0 || !pulse(row) || !(typeof row.co === "number" && row.co > 0.05);
  // Fick and mixed venous are undefined at no forward output. The panel svo2 is the same gap in VF.
  if ((id === "rhc.fickCo" || id === "rhc.qpQsFick" || id === "rhc.mixedVenousSat" || id === "svo2") && row[id] == null)
    return row.hr === 0 || !pulse(row) || !(typeof row.co === "number" && row.co > 0.05);
  // Stroke-volume CV needs a spread of beats (metrics.ts); one beat or a silent rhythm abstains.
  if (id === "strokeVolumeCv") return row[id] == null;
  // No hemodynamic beat yet (hemo() empty): the instant after the heart is rebuilt, or no ejection.
  if (NO_BEAT_HEMO.includes(id) && row[id] == null && groupNull(NO_BEAT_HEMO, row)) return true;
  if (LHC_BEAT.includes(id) && row[id] == null && row["lhc.lvSystolic"] == null) return true;
  if (CORONARY_IDX.includes(id) && row[id] == null && groupNull(CORONARY_IDX, row)) return true;
  if (JVP.includes(id) && row[id] == null && groupNull(JVP, row)) return true;
  if ((id === "loop.ea" || id === "loop.ees" || id === "loop.mvo2") && row[id] == null) return row["loop.strokeWork"] == null || !pulse(row);
  if (LOOP.includes(id) && row[id] == null && row["loop.strokeWork"] == null) return true;
  // Weiss tau is NaN with no falling limb. A null on a pulsatile beat with a loop is still a violation.
  if (id === "loop.tau" && row[id] == null) return row["loop.strokeWork"] == null || !pulse(row);
  // Shunt flow needs strength>0 beats to integrate. No such beats (VF, empty ring) leaves it unread.
  if (id.startsWith("shunt.") && row[id] == null) {
    const w = row["loop.strokeWork"];
    return row.hr === 0 || !pulse(row) || w == null || (typeof w === "number" && Math.abs(w) < 0.05);
  }
  // No representative hemodynamic beat: the pullback is omitted, while Fick can still be computed from saturations.
  if ((id === "rhc.raV" || id === "rhc.rvSystolic") && row[id] == null && row["rhc.raV"] == null && row["rhc.rvSystolic"] == null) return true;
  if (id.startsWith("rhc.") && row[id] == null && row["rhc.rvSystolic"] == null && row["rhc.fickCo"] == null) return true;
  for (const g of ABSENT_GROUPS) if (g.includes(id) && g.every((k) => row[k] == null)) return true;
  return false;
}

function pulse(row: Record<string, Value>): boolean {
  if (row.dead === true) return false;
  if (row.arrestStatus === "arrest") return false;
  return isNum(row.sbp) && isNum(row.dbp) && row.sbp > 0;
}

export function invariantsOf(st: State, run: SeedRun): Hit[] {
  const hits: Hit[] = [];
  const add = (where: string, rule: string) => hits.push({ state: st.id, seed: run.seed, where, rule });
  if (run.error) { add("run", `threw: ${run.error.split(" | ")[0]}`); return hits; }
  const cps = Object.keys(run.at).sort((a, b) => (a === "base" ? -1 : b === "base" ? 1 : +a - +b));
  let prevInfarct: number | null = null, prevDead: boolean | null = null;
  for (const cp of cps) {
    const row = run.at[cp] ?? {};
    for (const v of VARIABLES) {
      const x = row[v.id];
      if (x === null || x === undefined) { if (!nullAllowed(v.id, row)) add(cp, `${v.id} is null`); continue; }
      if (v.kind === "num" && !isNum(x)) add(cp, `${v.id} is not a finite number (${String(x)})`);
    }
    if (pulse(row)) {
      const { sbp, dbp, map } = row as Record<string, number>;
      if (isNum(dbp) && isNum(map) && isNum(sbp)) {
        if (dbp > map + 0.5) add(cp, `dbp ${dbp.toFixed(1)} > map ${map.toFixed(1)}`);
        if (map > sbp + 0.5) add(cp, `map ${map.toFixed(1)} > sbp ${sbp.toFixed(1)}`);
        if (sbp + 0.5 < dbp) add(cp, `sbp ${sbp.toFixed(1)} < dbp ${dbp.toFixed(1)}`);
      }
      for (const k of ["sbp", "dbp", "map", "paSys", "paDia", "paMean", "pcwp", "cvp", "lvedp"]) {
        const x = row[k]; if (isNum(x) && x < -1) add(cp, `${k} is negative (${x.toFixed(1)})`);
      }
    }
    for (const k of FRACTIONS) { const x = row[k]; if (isNum(x) && (x < -1e-4 || x > 1 + 1e-4)) add(cp, `${k} ${x.toFixed(3)} outside 0..1`); }
    for (const k of POSITIVE) { const x = row[k]; if (isNum(x) && x <= 0) add(cp, `${k} is not positive (${x})`); }
    const cons = row["fluid.conservation"];
    if (isNum(cons) && Math.abs(cons) > CONSERVATION_ML) add(cp, `fluid.conservation ${cons.toFixed(2)} ml (near 0 means within ${CONSERVATION_ML} ml)`);
    const infarct = row.lvInfarctFraction, dead = row.dead;
    if (!st.removesTissue && isNum(infarct) && prevInfarct !== null && infarct < prevInfarct - 1e-4)
      add(cp, `lvInfarctFraction fell ${prevInfarct.toFixed(3)} -> ${infarct.toFixed(3)}`);
    if (prevDead === true && dead === false) add(cp, "dead went from true back to false");
    if (isNum(infarct)) prevInfarct = infarct;
    if (typeof dead === "boolean") prevDead = dead;
  }
  return hits;
}

export function scanInvariants(states: State[], runs: SeedRun[]): Hit[] {
  const by = new Map(states.map((s) => [s.id, s]));
  return runs.flatMap((r) => { const st = by.get(r.state); return st ? invariantsOf(st, r) : []; });
}
