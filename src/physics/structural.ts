import { ACTIVATION, BRONCHIAL, O2_PER_G_HB, WU_TO_MMHG_S_ML, PATIENTS, PatientBaseline, PatientKind, SOLVER, VESSELS } from "../config/structural";

import { engineFromModel, resolveCore, type FromModelOptions } from "./core/fromModel";
import { fillingOf, type Filling } from "./core/vessels";
import { BeatRecorder } from "./core/recorder";
import { NODES, CATH_NODES, type NodeName, type CathNode } from "./structuralGraph";

/**
 * Closed-loop compartment model of the circulation, defined as a graph so a lesion is an edit to the graph.
 *
 * Nodes: superior and inferior vena cava (upper- and lower-body return), RA, RV, pulmonary artery, pulmonary veins, LA, LV,
 * upper aorta (arch: head, arms, coronaries) and descending aorta (lower body). The aorta is split at the duct so pre- and
 * post-ductal saturations differ. Chambers are time-varying elastances; vessels are compliances. Edges are valves (one-way
 * orifices, optionally leaky), defects (two-way orifices: ASD, VSD, ductus) and resistances (vascular beds, lungs). Orifice
 * flow follows Gorlin, Q = 44.3·A·√ΔP. Oxygen is solved after the hemodynamics, from each edge's mean forward and backward flow.
 *
 * The model is designed around the *patient's* resting state (config/structural.ts): resistances, contractility and volumes
 * come from the baseline heart rate and pulmonary resistance, never from a lesion or an override. A lesion or an override
 * (heart rate, pulmonary resistance, systemic resistance) then changes only its own parameter, so the circulation answers it.
 * There are no reflexes: pressure does not defend itself against a shunt or a vasodilator. Constants are teaching values.
 */
export { NODES, CATH_NODES };
export type { NodeName, CathNode };
const [SVC, IVC, RA, RV, PA, PV, LA, LV, AO, DAO, SPL] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const NN = NODES.length;

type EdgeType = "valve" | "orifice" | "resistor";
type Role = "bedU" | "bedL" | "lung";
/** `zc`: characteristic impedance (mmHg·s/ml) of the artery a valve ejects into, in series with the valve (core `OneWayValve.params.Zc`). */
interface Edge { name: string; from: number; to: number; type: EdgeType; area?: number; reg?: number; R?: number; zc?: number; role?: Role }
interface Chamber { v0: number; ees: number; a: number; b: number; atrial: boolean }
export interface Model {
  patient: PatientBaseline; hr: number; T: number;
  chambers: (Chamber | null)[]; comp: number[]; edges: Edge[]; start: number[]; // start: volumes the run begins from, ml
  /** Unstressed volume of each vessel node, ml (0 where a vessel has none): P = (V − Vu)/C. Chambers: 0. */
  vu: number[];
  vo2U: number; vo2L: number; // ml O₂ / s
  qDesign: number; // ml/s, the baseline systemic flow
}

/** One valve's lesion: `open` is its opening as a fraction of normal (0 = atretic); `reg` is a regurgitant orifice area, cm². */
export interface ValveLesion { open?: number; reg?: number }

/** What the page and tests set. Everything is optional; no lesion is a normal heart. */
export interface StructuralSpec {
  patient?: PatientKind;
  hr?: number;
  pvri?: number; // Wood units · m²: the lungs' resistance, overriding the patient's (the rest of the model stays as designed)
  svrScale?: number; // multiplies systemic resistance (a spell, sepsis, a vasodilator)
  satLung?: number; // saturation of blood leaving the lungs (hypoventilation, edema)
  volumeMl?: number; // extra blood volume given, ml
  valves?: { tv?: ValveLesion; pv?: ValveLesion; mv?: ValveLesion; av?: ValveLesion };
  pda?: { diameterMm: number };
  asd?: { diameterMm: number };
  vsd?: { diameterMm: number };
  bt?: { diameterMm: number }; // modified Blalock–Taussig shunt, aorta to pulmonary artery
  lvSize?: number; laSize?: number; // the same, for the left side
  lvEes?: number; rvEes?: number; // multiply a ventricle's end-systolic elastance only (passive filling unchanged): ischemic or stunned muscle
  lvStiffness?: number; rvStiffness?: number; // multiply a ventricle's passive stiffness (the diastolic pressure-volume curve) only: ischemic muscle relaxes and fills poorly
  rvContractility?: number; // multiplies right ventricular contractility and stiffness (a pressure-loaded, thick right ventricle)
  rvSize?: number; // right ventricle's volume as a fraction of normal (hypoplastic RV, Ebstein's functional RV); same pressures, smaller cavity
  raSize?: number; // right atrium's volume as a multiple of normal (Ebstein's atrialized RV, tricuspid atresia)
  tof?: { vsdMm: number; rvotFrac: number; spasm?: number; override?: number; rvHypertrophy?: number };
}

/** Pressure drop across the isthmus at the design flow, mmHg. The arch has no inertance here, so a duct that feeds the descending aorta also pushes some blood back up the arch. */
const ISTH_R = 0.2;
const areaFromMm = (d: number) => Math.PI * (d / 20) ** 2; // cm²

// ---- building ---------------------------------------------------------------------------------
const passive = (P: number, v0: number, b: number, a: number) => v0 + Math.log(1 + P / a) / b;

/** A finite number inside [lo, hi], or undefined (NaN, Infinity and missing values all become "not set"). */
const clamp = (x: number | undefined, lo: number, hi: number) => (x === undefined || !Number.isFinite(x) ? undefined : Math.min(hi, Math.max(lo, x)));
const frac = (x: number | undefined) => clamp(x, 0, 1);
const diam = (d: { diameterMm: number } | undefined) => (d && Number.isFinite(d.diameterMm) ? { diameterMm: clamp(d.diameterMm, 0, 40)! } : undefined);
const valveLesion = (l: ValveLesion | undefined): ValveLesion | undefined => (l ? { open: frac(l.open), reg: clamp(l.reg, 0, 10) } : undefined);

/** The spec as the engine will use it: every number clamped to the engine's own range, non-finite numbers unset. Pure; `buildModel` applies it first. */
export function clampStructuralSpec(input: StructuralSpec = {}): StructuralSpec {
  return {
    ...input, hr: clamp(input.hr, 20, 300), pvri: clamp(input.pvri, 0.2, 60), svrScale: clamp(input.svrScale, 0.1, 5),
    rvSize: clamp(input.rvSize, 0.05, 4), raSize: clamp(input.raSize, 0.05, 4), lvSize: clamp(input.lvSize, 0.05, 4), laSize: clamp(input.laSize, 0.05, 4),
    rvContractility: clamp(input.rvContractility, 0.2, 5), lvEes: clamp(input.lvEes, 0.2, 5), rvEes: clamp(input.rvEes, 0.2, 5), lvStiffness: clamp(input.lvStiffness, 0.2, 5), rvStiffness: clamp(input.rvStiffness, 0.2, 5), satLung: clamp(input.satLung, 0.3, 1), volumeMl: clamp(input.volumeMl, -1000, 5000),
    valves: input.valves && { tv: valveLesion(input.valves.tv), pv: valveLesion(input.valves.pv), mv: valveLesion(input.valves.mv), av: valveLesion(input.valves.av) },
    pda: diam(input.pda), asd: diam(input.asd), vsd: diam(input.vsd), bt: diam(input.bt),
    tof: input.tof && { vsdMm: clamp(input.tof.vsdMm, 0, 40) ?? 0, rvotFrac: frac(input.tof.rvotFrac) ?? 1, spasm: frac(input.tof.spasm), override: frac(input.tof.override), rvHypertrophy: clamp(input.tof.rvHypertrophy, 0.2, 5) },
  };
}

/**
 * What the model design includes beyond the plain compartments; every flag defaults to the current baseline. `LEGACY_BUILD` turns
 * them all off (the circulation of the frozen reference fixture: no impedance, no unstressed volume, one lower-body venous
 * compartment, the atrium as first designed).
 */
export interface BuildOptions {
  /** Characteristic impedance Zc in front of the aorta and pulmonary artery (default true). */
  zc?: boolean;
  /** Unstressed volume in the venous compartments, so total blood volume exceeds the stressed volume (default true). */
  unstressed?: boolean;
  /** Splanchnic reservoir between the lower-body bed and the IVC (default true; false leaves the SPL node empty and unconnected). */
  splanchnic?: boolean;
  /** Bronchial/Thebesian return, a resistor AO → PV carrying `BRONCHIAL.frac` of the design flow (default true; false leaves the edge out, as the frozen reference was built). */
  bronchial?: boolean;
  /** Factor on the atrial active elastance (default `ACTIVATION.atrialEesScale`; 1 = the designed 6 mmHg of active pressure). */
  atrialEesScale?: number;
  /** Overrides of a patient baseline in `config/structural.ts` (the pin keeps the adult atrial pressures the reference was made with). */
  baseline?: Partial<Record<PatientKind, Partial<PatientBaseline>>>;
}
export const LEGACY_BUILD: Readonly<BuildOptions> = { zc: false, unstressed: false, splanchnic: false, bronchial: false, atrialEesScale: 1, baseline: { adult: { rap: 4, lap: 8 } } };

export function buildModel(input: StructuralSpec = {}, volumeOffset = 0, build: BuildOptions = {}): Model {
  const spec = clampStructuralSpec(input), useZc = build.zc !== false, useVu = build.unstressed !== false, useSpl = build.splanchnic !== false;
  const p = { ...PATIENTS[spec.patient ?? "adult"], ...build.baseline?.[spec.patient ?? "adult"] };
  const W = p.weightKg, T = 60 / (spec.hr ?? p.hr);
  const sv = p.svPerKg * W, q = (p.hr * sv) / 60; // ml, ml/s: the design point, at the baseline rate
  const K = 2.8; // exponent of the passive pressure-volume curve at end-diastole

  // pressures the baseline is designed around
  const rp = (p.pvri / p.bsa) * WU_TO_MMHG_S_ML;
  const ppv = p.lap + 1, mpap = ppv + q * rp;
  const psv = p.rap + 2;
  const sysRv = mpap + 0.6 * p.ppPa + 3, sysLv = p.map + 0.65 * p.ppSys + 5;

  const ventricle = (edv: number, sys: number, edp: number): Chamber => {
    const v0 = 0.08 * edv, esv = edv - sv;
    const b = K / (edv - v0), a = edp / (Math.exp(K) - 1);
    return { v0, ees: sys / (esv - v0), a, b, atrial: false };
  };
  const atrium = (vm: number, pm: number): Chamber => {
    const v0 = 0.35 * vm, b = K / (vm - v0), a = pm / (Math.exp(K) - 1);
    return { v0, ees: (6 * (build.atrialEesScale ?? ACTIVATION.atrialEesScale)) / (vm - v0), a, b, atrial: true };
  };
  const lv = ventricle(sv / p.lvEf, sysLv, p.lap), rv = ventricle(sv / p.rvEf, sysRv, p.rap);
  const la = atrium(0.55 * W, p.lap), ra = atrium(0.65 * W, p.rap);
  const chambers: (Chamber | null)[] = [null, null, ra, rv, null, null, la, lv, null, null, null];

  const ca = (sv / p.ppSys) * (useZc ? VESSELS.arterialC.sys : 1), cpa = (sv / p.ppPa) * (useZc ? VESSELS.arterialC.pul : 1);
  const V = VESSELS.compliance;
  const comp = [(useSpl ? V.svc : 0.25) * W, (useSpl ? V.ivc : 0.75) * W, 0, 0, cpa, 0.15 * W, 0, 0, 0.35 * ca, 0.65 * ca, useSpl ? V.spl * W : 1];
  const pspl = psv + VESSELS.splanchnicRise; // mean pressure of the splanchnic reservoir
  // characteristic impedance in front of each artery: a fixed share of the resistance behind it
  const zcAo = useZc ? VESSELS.zcFrac.sys * ((p.map - p.rap) / q) : 0, zcPa = useZc ? VESSELS.zcFrac.pul * rp : 0;

  // starting state, from the baseline only: every chamber at its mean pressure, every vessel at its design pressure
  const start = new Array(NN).fill(0);
  start[RA] = passive(p.rap, ra.v0, ra.b, ra.a); start[LA] = passive(p.lap, la.v0, la.b, la.a);
  start[RV] = passive(p.rap + 2, rv.v0, rv.b, rv.a); start[LV] = passive(p.lap + 2, lv.v0, lv.b, lv.a);
  start[SVC] = comp[SVC] * psv; start[IVC] = comp[IVC] * psv + volumeOffset + (spec.volumeMl ?? 0);
  start[PA] = comp[PA] * mpap; start[PV] = comp[PV] * ppv; start[AO] = comp[AO] * p.map; start[DAO] = comp[DAO] * (p.map - 1);
  start[SPL] = useSpl ? comp[SPL] * pspl : 0;
  // unstressed volume: what the patient's total blood volume holds beyond the stressed volumes designed above, shared among the veins
  const vu = new Array(NN).fill(0);
  if (useVu) {
    const added = volumeOffset + (spec.volumeMl ?? 0), rest = p.bloodMlPerKg * W - (start.reduce((a, b) => a + b, 0) - added), share = VESSELS.vuShare, tot = share.svc + share.ivc + (useSpl ? share.spl : 0);
    vu[SVC] = (rest * share.svc) / tot; vu[IVC] = (rest * share.ivc) / tot; if (useSpl) vu[SPL] = (rest * share.spl) / tot;
    for (const i of [SVC, IVC, SPL]) start[i] += vu[i];
  }

  const qU = p.upperFlow * q, qL = (1 - p.upperFlow) * q, svr = spec.svrScale ?? 1;
  const pdao = p.map - 1;
  const A = p.valveAreas;
  const edges: Edge[] = [
    { name: "TV", from: RA, to: RV, type: "valve", area: A.tv, reg: 0 },
    { name: "PVL", from: RV, to: PA, type: "valve", area: A.pv, reg: 0, zc: zcPa },
    { name: "MV", from: LA, to: LV, type: "valve", area: A.mv, reg: 0 },
    { name: "AV", from: LV, to: AO, type: "valve", area: A.av, reg: 0, zc: zcAo },
    { name: "RVAO", from: RV, to: AO, type: "valve", area: 0, reg: 0, zc: zcAo }, // the overriding aorta's share of the right ventricle
    { name: "ISTH", from: AO, to: DAO, type: "resistor", R: ISTH_R / qL },
    { name: "BEDU", from: AO, to: SVC, type: "resistor", R: ((p.map - psv) / qU) * svr, role: "bedU" },
    // the lower-body bed drains through the splanchnic reservoir (pressure pspl) to the IVC; without it, straight to the IVC
    { name: "BEDL", from: DAO, to: useSpl ? SPL : IVC, type: "resistor", R: ((pdao - (useSpl ? pspl : psv)) / qL) * svr, role: "bedL" },
    ...(useSpl ? [{ name: "SPLV", from: SPL, to: IVC, type: "resistor" as const, R: (pspl - psv) / qL }] : []),
    { name: "VRU", from: SVC, to: RA, type: "resistor", R: (psv - p.rap) / qU },
    { name: "VRL", from: IVC, to: RA, type: "resistor", R: (psv - p.rap) / qL },
    { name: "LUNG", from: PA, to: PV, type: "resistor", R: ((spec.pvri ?? p.pvri) / p.bsa) * WU_TO_MMHG_S_ML, role: "lung" },
    { name: "PVLA", from: PV, to: LA, type: "resistor", R: (ppv - p.lap) / q },
    ...(build.bronchial !== false ? [{ name: "BRON", from: AO, to: PV, type: "resistor" as const, R: (p.map - ppv) / (BRONCHIAL.frac * q) }] : []), // bronchial/Thebesian return: systemic arterial blood into the left heart
    { name: "ASD", from: LA, to: RA, type: "orifice", area: 0 },
    { name: "VSD", from: LV, to: RV, type: "orifice", area: 0 },
    { name: "PDA", from: DAO, to: PA, type: "orifice", area: 0 },
    { name: "BT", from: AO, to: PA, type: "orifice", area: 0 },
  ];
  const E = (n: string) => edges.find((e) => e.name === n)!;

  // lesions
  const VALVE_EDGE = { tv: "TV", pv: "PVL", mv: "MV", av: "AV" } as const;
  for (const k of Object.keys(VALVE_EDGE) as (keyof typeof VALVE_EDGE)[]) {
    const l = spec.valves?.[k]; if (!l) continue;
    const e = E(VALVE_EDGE[k]); e.area! *= l.open ?? 1; e.reg = l.reg ?? 0;
  }
  if (spec.pda) E("PDA").area = areaFromMm(spec.pda.diameterMm);
  if (spec.asd) E("ASD").area = areaFromMm(spec.asd.diameterMm);
  if (spec.vsd) E("VSD").area = areaFromMm(spec.vsd.diameterMm);
  if (spec.bt) E("BT").area = areaFromMm(spec.bt.diameterMm);
  if (spec.tof) {
    const t = spec.tof, spasm = t.spasm ?? 0, over = t.override ?? 0.5, h = t.rvHypertrophy ?? 1.5;
    E("VSD").area = areaFromMm(t.vsdMm);
    E("PVL").area! *= t.rvotFrac * (1 - 0.8 * spasm);
    E("RVAO").area = E("AV").area! * over;
    E("AV").area! *= 1 - over;
    chambers[RV]!.ees *= h; chambers[RV]!.a *= h;
  }

  // chamber size: the same pressures in a smaller or larger cavity. The blood the cavity no longer holds goes to the inferior vena cava, so the total is the patient's.
  const resize = (i: number, f: number) => {
    const c = chambers[i]!; c.v0 *= f; c.b /= f; c.ees /= f; start[IVC] += start[i] * (1 - f); start[i] *= f;
  };
  for (const [i, f] of [[RV, spec.rvSize], [RA, spec.raSize], [LV, spec.lvSize], [LA, spec.laSize]] as [number, number | undefined][])
    if (f !== undefined && f !== 1) resize(i, f);
  if (spec.rvContractility) { chambers[RV]!.ees *= spec.rvContractility; chambers[RV]!.a *= spec.rvContractility; }
  if (spec.lvEes) chambers[LV]!.ees *= spec.lvEes;
  if (spec.rvEes) chambers[RV]!.ees *= spec.rvEes;
  if (spec.lvStiffness) chambers[LV]!.a *= spec.lvStiffness;
  if (spec.rvStiffness) chambers[RV]!.a *= spec.rvStiffness;

  const vo2 = (p.vo2PerKg * W) / 60;
  const m: Model = { patient: { ...p, satLung: spec.satLung ?? p.satLung }, hr: 60 / T, T, chambers, comp, edges, start, vu, vo2U: vo2 * p.upperVo2, vo2L: vo2 * (1 - p.upperVo2), qDesign: q };
  return m;
}

// ---- hemodynamics -----------------------------------------------------------------------------
/** Pressure (mmHg) or volume over the last beat; `end` is the value at the end of the beat, the instant before the next activation (end-diastolic pressure for a ventricle). */
export interface NodeStat { min: number; max: number; mean: number; end: number }
export interface ValveStat { peakGradient: number; meanGradient: number; forwardMl: number; regurgMl: number; openMs: number; regurgPeakGradient: number }
export interface Hemodynamics {
  beats: number; converged: boolean;
  p: Record<NodeName, NodeStat>;
  vol: { RA: NodeStat; RV: NodeStat; LA: NodeStat; LV: NodeStat };
  /** ml per beat flowing forward (from→to) and backward through each edge */
  fwd: Record<string, number>; bwd: Record<string, number>;
  valves: Record<string, ValveStat>;
  volume: number; // ml, total in the circulation at the end of the last beat
  /** Systemic vessels (SVC, IVC, SPL, AO, DAO) at the end of the last beat: blood, stressed volume, compliance and mean systemic filling pressure. */
  filling: Filling;
  wave: Waveform;
}
/** The last beat, sampled every couple of milliseconds: time (s), pressure at every node (mmHg), ventricular volumes (ml). */
export interface Waveform { t: number[]; p: Record<NodeName, number[]>; vLV: number[]; vRV: number[]; vLA: number[]; vRA: number[]; q: Record<string, number[]> }
/** Vessels that make up the systemic circulation for the filling pressure: the veins, including the splanchnic reservoir, and the two aortic segments. */
const SYSTEMIC = ["SVC", "IVC", "SPL", "AO", "DAO"] as const;
const WAVE_EDGES = ["TV", "PVL", "MV", "AV", "RVAO", "ASD", "VSD", "PDA", "BT"];

/**
 * Run the model to a periodic state on the core engine and report the last beat. With `waveform: false` the waveform capture is
 * skipped (faster) and `wave` comes back with empty arrays in the same shape. `core` overrides how the model becomes a core
 * graph (relaxation, atrial drive, PR; see `FromModelOptions`); the defaults are the current baseline.
 */
export function simulate(m: Model, opts: { waveform?: boolean; core?: FromModelOptions } = {}): Hemodynamics {
  const eng = engineFromModel(m, opts.core), withWave = opts.waveform !== false;
  const nSteps = Math.max(50, Math.round(m.T / SOLVER.dt));
  const rec = new BeatRecorder(eng, m.T, m.edges.filter((e) => e.type === "valve" && (e.name !== "RVAO" || e.area)).map((e) => e.name), withWave ? { dt: m.T / nSteps, every: 0.002, flows: WAVE_EDGES } : undefined);
  const { beats, converged } = eng.periodic(m.hr);
  const last = rec.beat(), fv = eng.flowVolumes();
  const w: NonNullable<typeof last.wave> = last.wave ?? { t: [], p: Object.fromEntries(NODES.map((n) => [n, [] as number[]])), v: { LV: [], RV: [], LA: [], RA: [] }, q: Object.fromEntries(WAVE_EDGES.map((n) => [n, [] as number[]])) };
  rec.dispose();
  const p = {} as Record<NodeName, NodeStat>;
  const wp = {} as Record<NodeName, number[]>;
  for (const n of NODES) { p[n] = last.p[n]; wp[n] = w.p[n]; }
  const vol = { RA: last.v.RA, RV: last.v.RV, LA: last.v.LA, LV: last.v.LV };
  const wave: Waveform = { t: w.t, p: wp, vLV: w.v.LV, vRV: w.v.RV, vLA: w.v.LA, vRA: w.v.RA, q: w.q };
  let volume = 0;
  const V = eng.sample().V;
  for (const x of V) volume += x;
  return { beats, converged, p, vol, fwd: fv.fwd, bwd: fv.bwd, valves: last.valves, volume, filling: fillingOf(eng.nodes, V, SYSTEMIC), wave };
}

// ---- oxygen -----------------------------------------------------------------------------------
/**
 * Steady-state oxygen content (ml O₂ per ml blood) of every node. Each node mixes everything that flows into it in a
 * beat (forward and backward through every edge), each stream carrying its donor node's content. The systemic beds take
 * oxygen out, the lungs put it back to `satLung`. Gauss–Seidel around the loop. A node nothing flows into has no content (NaN).
 */
/** A pump stream into the oxygen solve (VA-ECMO): `flow` ml/s net from node `from` to node `to`, its content set from the content drained by `oxygenate(cIn, capacity)`. */
export interface O2Stream { from: number; to: number; flow: number; oxygenate: (cIn: number, capacity: number) => number }
export function solveOxygen(m: Model, h: Pick<Hemodynamics, "fwd" | "bwd">, stream?: O2Stream): { content: Float64Array; capacity: number; starved: boolean; converged: boolean } {
  const cap = (O2_PER_G_HB * m.patient.hb) / 100, T = m.T, ne = m.edges.length;
  const c = new Float64Array(NN).fill(0.6 * cap);
  const inflow = new Float64Array(NN);
  for (let i = 0; i < ne; i++) { const e = m.edges[i]; inflow[e.to] += h.fwd[e.name] / T; inflow[e.from] += h.bwd[e.name] / T; }
  const sf = stream && stream.flow > 1e-9 ? stream.flow : 0;
  if (stream && sf) inflow[stream.to] += sf;
  let starved = false;
  const out = (i: number, from: number) => {
    const e = m.edges[i], f = (h.fwd[e.name] - h.bwd[e.name]) / T;
    if (e.role === "lung") return cap * m.patient.satLung;
    if (e.role === "bedU" || e.role === "bedL") {
      const use = e.role === "bedU" ? m.vo2U : m.vo2L;
      if (f <= 1e-9) { starved = true; return 0; }
      const x = c[from] - use / f;
      if (x < 0) { starved = true; return 0; }
      return x;
    }
    return c[from];
  };
  let converged = false;
  for (let it = 0; it < 800 && !converged; it++) {
    starved = false; let change = 0;
    for (let n = 0; n < NN; n++) {
      let num = 0, den = 0;
      for (let i = 0; i < ne; i++) {
        const e = m.edges[i], f = h.fwd[e.name] / T, b = h.bwd[e.name] / T;
        if (e.to === n && f > 0) { num += f * out(i, e.from); den += f; }
        if (e.from === n && b > 0) { num += b * c[e.to]; den += b; }
      }
      if (stream && sf && stream.to === n) { num += sf * stream.oxygenate(c[stream.from], cap); den += sf; }
      if (den > 1e-9) { const nc = num / den; change = Math.max(change, Math.abs(nc - c[n])); c[n] = nc; }
    }
    converged = change < 1e-10;
  }
  for (let n = 0; n < NN; n++) if (inflow[n] <= 1e-9) c[n] = NaN;
  return { content: c, capacity: cap, starved, converged };
}

// ---- report -----------------------------------------------------------------------------------
export interface StructuralReport {
  spec: StructuralSpec;
  hr: number; converged: boolean; beats: number;
  pressure: Record<NodeName, NodeStat>;
  saturation: Record<NodeName, number>; // 0..1; NaN where no blood reaches the node
  /** L/min through the body's beds, the lungs, and the effective pulmonary flow (Fick: what is oxygenated and then used) */
  qs: number; qp: number; qep: number; qpQs: number; qpQsFick: number;
  /** L/min of blood that goes round the body without passing the lungs, and of blood that goes round the lungs twice */
  rightToLeft: number; leftToRight: number;
  /** L/min ejected by each ventricle (net through its valves) */
  lvOutput: number; rvOutput: number;
  /** ml: total volume change of the ventricle in a beat (EDV − ESV), and what leaves through its own valve(s) */
  lvStrokeMl: number; rvStrokeMl: number; lvForwardMl: number; rvForwardMl: number;
  lvEf: number; rvEf: number;
  lvEdv: number; lvEsv: number; rvEdv: number; rvEsv: number;
  /** ml: largest volume of each chamber over the beat */
  maxVolume: { RA: number; LA: number; RV: number; LV: number };
  /** Wood units, and Wood units × m² */
  svr: number; pvr: number; svri: number; pvri: number;
  /** ml/s through each defect, net; positive = left to right (for the ductus, aorta to pulmonary artery). `rvao` is the right ventricle's own outflow into an overriding aorta: right to left. */
  shunt: { pda: number; asd: number; vsd: number; bt: number; rvao: number };
  valves: Record<string, ValveStat>;
  preductalSat: number; postductalSat: number;
  /** total blood in the circulation, ml, for conservation checks */
  bloodVolume: number;
  /** Systemic vessels: stressed volume (ml) and mean systemic filling pressure (mmHg, stressed volume / total systemic compliance, the stop-flow estimate). */
  filling: Filling;
  waveform?: Waveform;
  warnings: string[];
}

export function analyze(spec: StructuralSpec = {}, opts: { waveform?: boolean } = {}): StructuralReport {
  const m = buildModel(spec, volumeOffsetFor(spec)), h = simulate(m, { waveform: opts.waveform !== false }), T = m.T;
  const ox = solveOxygen(m, h), net = (n: string) => (h.fwd[n] - h.bwd[n]) / T;
  const c = ox.content, sat = {} as Record<NodeName, number>;
  NODES.forEach((n, i) => (sat[n] = c[i] / ox.capacity));
  const qu = net("BEDU"), ql = net("BEDL"), qsMl = qu + ql, qpMl = net("LUNG");
  // Fick, with each bed's own arterial and venous content: one arterial sample is wrong once pre- and post-ductal blood differ.
  // Venous content is what leaves the beds (the cava nodes also hold blood that refluxed from the right atrium).
  const cArt = (qu * c[AO] + ql * c[DAO]) / qsMl, cVen = cArt - (m.vo2U + m.vo2L) / qsMl;
  // pulmonary venous blood is what the lungs put out; the PV node itself also holds blood that refluxed from the left atrium
  const cPv = ox.capacity * m.patient.satLung;
  const qpQsFick = (cArt - cVen) / (cPv - c[PA]);
  const qepMl = (m.vo2U + m.vo2L) / (cPv - cVen);
  const lmin = (ml: number) => (ml * 60) / 1000;
  const lv = h.vol.LV, rv = h.vol.RV, perBeat = m.hr / 1000;
  const lvFwd = h.fwd.AV - h.bwd.AV, rvFwd = h.fwd.PVL - h.bwd.PVL + (h.fwd.RVAO - h.bwd.RVAO);
  const qsL = lmin(qsMl), qpL = lmin(qpMl), bsa = m.patient.bsa;
  const svr = (h.p.AO.mean - h.p.RA.mean) / qsL, pvr = (h.p.PA.mean - h.p.LA.mean) / qpL;

  const warnings: string[] = [];
  if (!h.converged) warnings.push("The circulation did not settle to a periodic state.");
  if (!ox.converged) warnings.push("The oxygen balance did not settle.");
  if (qsMl < 0.2 * m.qDesign) warnings.push("Systemic flow is under a fifth of normal: this circulation cannot sustain life without another route for blood.");
  if (qpMl < 0.2 * m.qDesign) warnings.push("Less than a fifth of normal blood flow reaches the lungs: this circulation cannot sustain life without another route to them (a duct, a VSD or a shunt).");
  const dead = NODES.filter((n, i) => Number.isNaN(c[i]));
  if (dead.length) warnings.push(`No blood reaches ${dead.join(", ")}.`);
  if (sat.AO < 0.6) warnings.push("Arterial saturation is under 60%: critical hypoxemia.");
  if (ox.starved) warnings.push("Oxygen delivery cannot meet use in at least one bed; saturations there are floored at zero.");
  const starving = ox.starved || dead.length > 0 || qsMl < 0.2 * m.qDesign || qpMl < 0.2 * m.qDesign; // the Fick check means nothing when a circuit is empty
  if (!starving && Number.isFinite(qpQsFick) && Number.isFinite(qpMl / qsMl) && Math.abs(qpQsFick - qpMl / qsMl) > 0.1 * (qpMl / qsMl)) warnings.push("Qp:Qs by oxygen and by flow disagree by more than 10%.");

  return {
    spec, hr: m.hr, converged: h.converged, beats: h.beats, pressure: h.p, saturation: sat,
    qs: qsL, qp: qpL, qep: lmin(qepMl), qpQs: qpMl / qsMl, qpQsFick,
    rightToLeft: lmin(qsMl - qepMl), leftToRight: lmin(qpMl - qepMl),
    lvOutput: lvFwd * perBeat, rvOutput: rvFwd * perBeat,
    lvStrokeMl: lv.max - lv.min, rvStrokeMl: rv.max - rv.min, lvForwardMl: lvFwd, rvForwardMl: rvFwd,
    lvEf: (lv.max - lv.min) / lv.max, rvEf: (rv.max - rv.min) / rv.max,
    lvEdv: lv.max, lvEsv: lv.min, rvEdv: rv.max, rvEsv: rv.min,
    maxVolume: { RA: h.vol.RA.max, LA: h.vol.LA.max, RV: rv.max, LV: lv.max },
    svr, pvr, svri: svr * bsa, pvri: pvr * bsa,
    shunt: { pda: net("PDA"), asd: net("ASD"), vsd: net("VSD"), bt: net("BT"), rvao: net("RVAO") },
    valves: h.valves, preductalSat: sat.AO, postductalSat: sat.DAO, bloodVolume: h.volume, filling: h.filling, waveform: opts.waveform === false ? undefined : h.wave, warnings,
  };
}

// ---- calibration ------------------------------------------------------------------------------
/**
 * Blood volume (ml, added to the inferior vena cava) that puts the normal patient's mean aortic pressure on its target. The
 * total blood volume belongs to the patient, not the lesion, so it is found once per baseline with no lesion or override, and
 * every case starts from it. Cached by the baseline's contents, so a different weight or age finds its own.
 */
const offsets = new Map<string, number>();
export function volumeOffsetFor(spec: StructuralSpec, core?: FromModelOptions, build?: BuildOptions): number {
  // everything the calibration depends on, with defaults filled in, so a changed default recalibrates by itself
  const kind = spec.patient ?? "adult", key = JSON.stringify([PATIENTS[kind], resolveCore(core), { zc: true, unstressed: true, splanchnic: true, bronchial: true, atrialEesScale: ACTIVATION.atrialEesScale, ...build }, VESSELS, ACTIVATION, SOLVER, ISTH_R, BRONCHIAL]), hit = offsets.get(key);
  if (hit !== undefined) return hit;
  const target = PATIENTS[kind].map;
  const err = (off: number) => simulate(buildModel({ patient: kind }, off, build), { waveform: false, core: core && (core.thorax || core.pericardium) ? { ...core, thorax: undefined, pericardium: undefined } : core }).p.AO.mean - target; // the blood volume is calibrated at the model's zero intrathoracic pressure (no breathing) and with no effusion: the cache key ignores both, so the first caller must not decide it
  let x0 = 0, f0 = err(x0), x1 = 0.1 * target * PATIENTS[kind].weightKg, f1 = err(x1);
  for (let i = 0; i < 8 && Math.abs(f1) > 0.1; i++) {
    const x2 = x1 - (f1 * (x1 - x0)) / (f1 - f0 || 1e-9);
    x0 = x1; f0 = f1; x1 = x2; f1 = err(x1);
  }
  if (Math.abs(f1) > 0.5) throw new Error(`Blood-volume calibration for ${kind} did not reach its target pressure (off by ${f1.toFixed(2)} mmHg)`);
  offsets.set(key, x1);
  return x1;
}
