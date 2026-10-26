// Shared by scripts/regen-fixtures.ts (writes the fixtures) and tests/regression.test.ts (recomputes and compares).
// Fixtures are only ever produced by running the script; never edit the JSON by hand.
import { LESIONS, defaults, assess } from "../../src/sim/structural";
import { NODES } from "../../src/physics/structural";
import { Simulation } from "../../src/sim/simulation";
import { Scenario } from "../../src/sim/scenario";
import { CASE_BY_ID } from "../../src/cath/cases";

export type Flat = Record<string, number | string | boolean | null>;

const rnd = (x: number, d: number): number | null => (Number.isFinite(x) ? +x.toFixed(d) : null);

// ---- structural -----------------------------------------------------------------------------------------------------
/** Compact snapshot of analyze() at default sliders plus the graded findings from assess(). Waveform is never computed. */
export function structuralSnapshot(id: string): Flat {
  const def = LESIONS.find((l) => l.id === id)!;
  const f = assess(def.id, defaults(def), { waveform: false });
  const r = f.report, o: Flat = {};
  o["hr"] = rnd(r.hr, 2); o["converged"] = r.converged;
  for (const n of NODES) {
    const p = r.pressure[n];
    o[`pressure.${n}.mean`] = rnd(p.mean, 2); o[`pressure.${n}.min`] = rnd(p.min, 2); o[`pressure.${n}.max`] = rnd(p.max, 2); o[`pressure.${n}.end`] = rnd(p.end, 2);
    o[`saturation.${n}`] = rnd(r.saturation[n], 4);
  }
  for (const k of ["qs", "qp", "qpQs", "qpQsFick", "lvOutput", "rvOutput"] as const) o[k] = rnd(r[k], 3);
  for (const k of ["lvEdv", "lvEsv", "rvEdv", "rvEsv"] as const) o[k] = rnd(r[k], 2);
  for (const k of ["lvEf", "rvEf"] as const) o[k] = rnd(r[k], 4);
  for (const k of ["svr", "pvr"] as const) o[k] = rnd(r[k], 3);
  for (const k of ["pda", "asd", "vsd", "bt", "rvao"] as const) o[`shunt.${k}`] = rnd(r.shunt[k], 3);
  for (const [v, s] of Object.entries(r.valves)) {
    o[`valve.${v}.peakGradient`] = rnd(s.peakGradient, 2); o[`valve.${v}.meanGradient`] = rnd(s.meanGradient, 2);
    o[`valve.${v}.forwardMl`] = rnd(s.forwardMl, 2); o[`valve.${v}.regurgMl`] = rnd(s.regurgMl, 2);
  }
  // assess(): deterministic strings (pure functions of the report), so they are compared exactly.
  for (const v of f.valves) { o[`finding.${v.valve}.stenosis`] = v.stenosis; o[`finding.${v.valve}.regurgitation`] = v.regurgitation; o[`finding.${v.valve}.grade`] = v.grade; }
  o["finding.murmur"] = f.murmur; o["finding.headline"] = f.headline;
  return o;
}

export const structuralFixtures = (): Record<string, Flat> => Object.fromEntries(LESIONS.map((l) => [l.id, structuralSnapshot(l.id)]));

// ---- ACS ------------------------------------------------------------------------------------------------------------
export const ACS_SEED = 3;
export const ACS_WARMUP_S = 60;
export const ACS_TRACE_S = 60;

/** Scenarios chosen to cover the circulation model's branches. The RCA case goes into complete heart block with RV ischemia by itself. */
export const ACS_SCENARIOS: Record<string, Scenario> = {
  normal: {},
  "lad-occlusion": CASE_BY_ID.ladocc.scenario,
  "rca-occlusion-chb-rv": CASE_BY_ID.rcaocc.scenario,
  "lad-occlusion-all-support": { lesions: [{ artery: "LAD", occluded: true, position: 0.2 }], support: { fluids: 1, norepinephrine: 0.5, iabp: true, impella: true } },
  "hemorrhage-fluids-norepi": { bloodLoss: 0.15, support: { fluids: 1, norepinephrine: 0.5 } },
};

export interface AcsSample { t: number; map: number | null; sbp: number | null; dbp: number | null; hr: number | null; sv: number | null; co: number | null; circulation: string; rhythm: string }

/**
 * Settled start, 60 s of warmup (no clinical time), then 60 s stepped one second at a time. Each sample is the 5 s rolling mean
 * the monitor shows. Noise is left at the default: the Simulation is deterministic for a fixed seed, so no noise override is needed.
 */
export function acsTrace(sc: Scenario): AcsSample[] {
  const s = new Simulation();
  s.reset({ seed: ACS_SEED, ...sc }, { settled: true });
  s.warmup(ACS_WARMUP_S); s.history = [];
  const out: AcsSample[] = [];
  for (let i = 1; i <= ACS_TRACE_S; i++) {
    s.step(1);
    const r = s.rolling(5), st = s.state();
    out.push({ t: i, map: rnd(r.map, 1), sbp: rnd(r.sbp, 1), dbp: rnd(r.dbp, 1), hr: rnd(r.hr, 1), sv: rnd(r.sv, 1), co: rnd(r.cardiacOutput, 2), circulation: st.circulationState, rhythm: st.rhythm.label });
  }
  return out;
}

export const acsFixtures = () => ({
  seed: ACS_SEED, warmupS: ACS_WARMUP_S, traceS: ACS_TRACE_S, sample: "5 s rolling mean once per simulated second; noise left at default (deterministic per seed)",
  scenarios: Object.fromEntries(Object.entries(ACS_SCENARIOS).map(([k, sc]) => [k, { scenario: sc, trace: acsTrace(sc) }])),
});
