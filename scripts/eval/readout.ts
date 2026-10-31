// Quantities the panels compute outside Simulation.state(): PV-loop metrics, JVP, respiratory variation,
// live valve and shunt numbers. One canonical source each. HeartSpec is private on Simulation; the murmur
// grader needs the spec the heart was built from, so it is read off the instance (the harness does not change src/).
import type { Simulation } from "../../src/sim/simulation";
import type { LiveSource } from "../../src/sim/liveSource";
import type { HeartSpec } from "../../src/sim/patient";
import type { LiveBeat } from "../../src/physics/core/live";
import type { StructuralReport, StructuralSpec, ValveStat } from "../../src/physics/structural";
import { NODES } from "../../src/physics/structuralGraph";
import { loopMetrics, cardiacPowerOutput } from "../../src/physics/loopMetrics";
import { analyzeJvp, jvpWords } from "../../src/physics/jvp";
import { pulsusParadoxus, pulsePressureVariation } from "../../src/physics/respiratory";
import { gorlinArea, gradeValves } from "../../src/sim/structural";
import { murmurOf } from "../../src/sim/valves";
import { ENERGETICS } from "../../src/config/energetics";

const LV = (NODES as readonly string[]).indexOf("LV");
const VALVE_IDS = ["AV", "MV", "TV", "PV"] as const;
export type ValveId = (typeof VALVE_IDS)[number];
const SHUNTS = ["pda", "asd", "vsd", "bt"] as const;

export interface ValveRead {
  forwardMl: number | null; regurgMl: number | null; regurgFraction: number | null; openMs: number | null;
  peakGradient: number | null; meanGradient: number | null; eoa: number | null;
}
export interface Readout {
  strokeWork: number | null; ea: number | null; ees: number | null; dpdtMax: number | null; dpdtMin: number | null;
  tau: number | null; mvo2: number | null; cpo: number | null;
  jvpHeightCm: number | null; jvpMeanRa: number | null; jvpClass: string | null;
  pulsusParadoxus: number | null; ppv: number | null;
  valve: Record<ValveId, ValveRead>;
  shunt: Record<(typeof SHUNTS)[number], number | null>;
  murmur: string | null; laVolume: number | null; lvPeakSys: number | null;
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const EMPTY_VALVE: ValveRead = { forwardMl: null, regurgMl: null, regurgFraction: null, openMs: null, peakGradient: null, meanGradient: null, eoa: null };
const ZERO_STAT: ValveStat = { peakGradient: 0, meanGradient: 0, forwardMl: 0, regurgMl: 0, openMs: 0, regurgPeakGradient: 0 };

function steadyBeat(src: LiveSource) {
  const beats = src.beats(12);
  for (let i = beats.length - 1; i >= 0; i--) if (!beats[i].pvc && !beats[i].prematureNext) return beats[i];
  return beats[beats.length - 1] ?? null;
}

function steadyRecord(s: Simulation): LiveBeat | null {
  const live = s.live;
  const recs = live?.records ?? [];
  for (let i = recs.length - 1; i >= 0; i--) if (recs[i].strength > 0 && !recs[i].pvc) return recs[i];
  return recs[recs.length - 1] ?? live?.warmBeat ?? null;
}

function heartSpec(s: Simulation): HeartSpec {
  return (s as unknown as { heartSpec?: HeartSpec }).heartSpec ?? {};
}

export function readout(s: Simulation, src: LiveSource, map: number | null, co: number | null): Readout {
  const valve = { AV: { ...EMPTY_VALVE }, MV: { ...EMPTY_VALVE }, TV: { ...EMPTY_VALVE }, PV: { ...EMPTY_VALVE } };
  const shunt = { pda: null, asd: null, vsd: null, bt: null } as Readout["shunt"];
  const out: Readout = {
    strokeWork: null, ea: null, ees: null, dpdtMax: null, dpdtMin: null, tau: null, mvo2: null, cpo: num(map) !== null && num(co) !== null ? cardiacPowerOutput(map as number, co as number) : null,
    jvpHeightCm: null, jvpMeanRa: null, jvpClass: null, pulsusParadoxus: null, ppv: null,
    valve, shunt, murmur: null, laVolume: null, lvPeakSys: null,
  };
  try {
    const beat = steadyBeat(src);
    const rec = steadyRecord(s);
    const v0 = s.live?.model.chambers[LV]?.v0;
    if (beat && beat.loops.LV.p.length > 4 && typeof v0 === "number") {
      const hr = beat.rr > 0 ? 60 / beat.rr : 70;
      const m = loopMetrics(beat.loops.LV.p, beat.loops.LV.v, { v0, hr, t: beat.time, tauMs: rec?.tauMs?.LV, massG: ENERGETICS.lvMassG });
      out.strokeWork = num(m.strokeWork); out.ea = num(m.ea); out.ees = num(m.ees);
      out.dpdtMax = num(m.dpdtMax); out.dpdtMin = num(m.dpdtMin); out.tau = num(m.tauMs); out.mvo2 = num(m.mvo2.perMinMl);
    }
    if (beat && beat.pressure.RA.length >= 8) {
      const j = analyzeJvp({ p: beat.pressure.RA, t: beat.time, atrial: beat.atrial, rr: beat.rr });
      out.jvpHeightCm = num(j.heightCm); out.jvpMeanRa = num(j.meanRA); out.jvpClass = jvpWords(j.classes);
    }
    const rate = s.autonomic?.controls?.respRate;
    const period = rate && rate > 0 ? 60 / rate : 4;
    const respBeats = (s.live?.records ?? []).filter((b) => b.strength > 0).map((b) => ({ t: b.t, systolic: b.systolic, diastolic: b.diastolic, strokeVolume: b.strokeVolume }));
    if (respBeats.length >= 8) {
      out.pulsusParadoxus = num(pulsusParadoxus(respBeats, period).value);
      out.ppv = num(pulsePressureVariation(respBeats, period).value);
    }
    const stats: Record<string, ValveStat> = { AV: { ...ZERO_STAT }, MV: { ...ZERO_STAT }, TV: { ...ZERO_STAT }, PVL: { ...ZERO_STAT } };
    if (rec) {
      for (const id of ["AV", "MV", "TV", "PVL"] as const) if (rec.valves[id]) stats[id] = rec.valves[id];
      out.lvPeakSys = num(rec.p.LV?.max);
      out.laVolume = num(rec.v.LA?.max);
      const recent = (s.live?.records ?? []).slice(-12).filter((b) => b.strength > 0);
      const T = recent.reduce((x, b) => x + b.interval, 0);
      if (T > 0) for (const k of SHUNTS) {
        const name = k.toUpperCase();
        const ml = recent.reduce((x, b) => x + (b.flows.fwd[name] ?? 0) - (b.flows.bwd[name] ?? 0), 0);
        shunt[k] = num((ml / T) * 0.06);
      }
    }
    const summary = beat?.valves;
    for (const id of VALVE_IDS) {
      const key = id === "PV" ? "PVL" : id;
      const live = summary?.[id];
      const st = stats[key];
      const forward = live?.forwardMl ?? st.forwardMl, regurg = live?.regurgMl ?? st.regurgMl, open = live?.openMs ?? st.openMs;
      const mean = st.meanGradient, peak = st.peakGradient;
      valve[id] = {
        forwardMl: num(forward), regurgMl: num(regurg),
        regurgFraction: forward > 1e-6 ? num(regurg / forward) : (forward === 0 ? 0 : null),
        openMs: num(open), peakGradient: num(peak), meanGradient: num(mean), eoa: gorlinArea(forward, open, mean),
      };
    }
    const spec: StructuralSpec = { ...heartSpec(s), patient: "adult" };
    out.murmur = murmurOf(gradeValves(spec, { valves: stats } as StructuralReport));
  } catch { /* a missing beat leaves the nulls; the invariant pass reports them */ }
  return out;
}
