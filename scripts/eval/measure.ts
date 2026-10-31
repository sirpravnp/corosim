// What the eval harness reads off a Simulation at a moment in time: one flat record of numbers, strings and booleans.
import type { Simulation } from "../../src/sim/simulation";

export type Metrics = Record<string, number | string | boolean>;

const nonFinitePaths = (x: unknown, path = "", out: string[] = []): string[] => {
  if (typeof x === "number") { if (!Number.isFinite(x)) out.push(path); }
  else if (Array.isArray(x)) x.forEach((v, i) => nonFinitePaths(v, `${path}[${i}]`, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) nonFinitePaths(v, `${path}.${k}`, out);
  return out;
};

const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : NaN);

export function measure(s: Simulation, windowS = 20): Metrics {
  const st: any = s.state(), r = s.rolling(windowS), h: any = s.hemo(windowS), e: any = s.ecg();
  const m: Metrics = {};
  const recent = s.history.filter((b) => b.t > s.t - windowS && !(b as any).silent);
  const iv = recent.map((b) => b.interval);
  const mean = iv.reduce((a, b) => a + b, 0) / (iv.length || 1);
  const sd = Math.sqrt(iv.reduce((a, b) => a + (b - mean) ** 2, 0) / (iv.length || 1));
  Object.assign(m, {
    t: st.timeS, clinMin: st.clinicalMinutes, dead: !!st.dead, deathCause: st.deathCause ?? "",
    hr: num(r.hr), sbp: num(r.sbp), dbp: num(r.dbp), map: num(r.map), sv: num(r.sv), co: num(r.cardiacOutput),
    pp: num(r.sbp) - num(r.dbp), rrCv: iv.length > 3 ? sd / mean : NaN, beats: recent.length,
    pvcs: recent.filter((b) => b.pvc).length,
    ef: num(st.ventricle.ejectionFraction), lvInfarct: num(st.ventricle.lvInfarctFraction), lvIsch: num(st.ventricle.lvIschemia),
    rvIsch: num(st.ventricle.rvIschemia), congestion: num(st.ventricle.pulmonaryCongestion),
    ischMass: num(st.ischemicMassFraction), circState: st.circulationState,
    rhythm: st.rhythm.label, avBlock: num(st.rhythm.avBlock), sinusRate: num(st.rhythm.sinusRate),
    ventRate: num(st.rhythm.ventricularRate ?? st.rhythm.sinusRate),
    arrestStatus: st.arrest?.status ?? "none", rhythmClass: st.arrest?.rhythmClass ?? "", noFlowS: num(st.arrest?.noFlowS),
    vtEpisodes: num(st.rhythm.arrhythmia ? st.rhythm.arrhythmia.counts.nsvt + st.rhythm.arrhythmia.counts.mono + st.rhythm.arrhythmia.counts.poly : 0),
    vfEpisodes: num(st.rhythm.arrhythmia?.counts.vf ?? 0),
    lvedp: num(h?.lvedp), pcwp: num(h?.pcwp), cvp: num(h?.cvp), rvedp: num(h?.rvedp), paMean: num(h?.pa?.mean), lvEdv: num(h?.lvEdv), lvEsv: num(h?.lvEsv),
    lysisOk: st.treatment.lysis === true, lysisFailed: st.treatment.lysis === false, stent: !!st.treatment.stent,
    ffr: num(st.ffr[0]?.ffr), deviceFlow: num(st.support.deviceFlowLpm),
    stemi: !!e.meetsStemiCriteria, nStE: e.stElevation.length, nStD: e.stDepression.length, ischPattern: e.ischemia,
    stAnt: Math.max(...["V1", "V2", "V3", "V4"].map((l) => e.stMm[l])), stInf: Math.max(...["II", "III", "aVF"].map((l) => e.stMm[l])),
    stLat: Math.max(...["I", "aVL", "V5", "V6"].map((l) => e.stMm[l])), stPost: Math.max(...["V7", "V8", "V9"].map((l) => e.stMm[l])),
    stMin: Math.min(...Object.values<number>(e.stMm)), stMax: Math.max(...Object.values<number>(e.stMm)),
    warnings: s.warnings.length,
  });
  for (const [l, v] of Object.entries<number>(e.stMm)) m[`st.${l}`] = v;
  // Invariants every state must satisfy whatever was done to the patient.
  const bad: string[] = nonFinitePaths(st).filter((p) => !/\.(ffr|ventricularRate)/.test(p)); // ffr is NaN-free by design; keep strict elsewhere
  bad.push(...nonFinitePaths(h).map((p) => "hemo" + p));
  const pulse = num(r.sbp) > 0 && st.arrest?.status !== "arrest";
  if (pulse && num(r.map) > num(r.sbp) + 0.5) bad.push("map>sbp");
  if (pulse && num(r.map) < num(r.dbp) - 0.5) bad.push("map<dbp");
  if (pulse && num(r.sbp) < num(r.dbp) - 0.5) bad.push("sbp<dbp");
  if (num(r.sbp) < -1 || num(r.dbp) < -1) bad.push("negative pressure");
  if (m.ef !== m.ef || (m.ef as number) < 0 || (m.ef as number) > 1) bad.push("ef out of [0,1]");
  for (const k of ["lvInfarct", "lvIsch", "rvIsch", "ischMass"]) if ((m[k] as number) < 0 || (m[k] as number) > 1.0001) bad.push(`${k} out of [0,1]`);
  m.violations = bad.join("; ");
  return m;
}
