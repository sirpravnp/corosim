/**
 * A HemoSource with fixed plausible normal-adult values. TEMPORARY: it exists only until the real bridge over today's
 * engines (task P2) lands; then the Simulator page switches to that and this file is deleted. Not physics: it gives
 * panels something to draw. Traces are a synthetic pulse wave per node; beats() is one synthetic beat.
 */
import type { BeatSummary, Chamber, DeviceConsole, HemoNode, HemoNumbers, HemoSource, Saturations, Series } from "./hemoSource";

const NODES: readonly HemoNode[] = ["SVC", "IVC", "RA", "RV", "PA", "PV", "LA", "LV", "AO", "DAO"];
const CHAMBERS: readonly Chamber[] = ["RA", "RV", "LA", "LV"];
const HR = 70;
/** [diastolic, systolic] mmHg per node for the synthetic waveform. */
const RANGE: Record<HemoNode, [number, number]> = {
  SVC: [2, 6], IVC: [2, 6], RA: [2, 8], RV: [3, 25], PA: [10, 25], PV: [6, 10], LA: [4, 12], LV: [6, 120], AO: [70, 120], DAO: [70, 120],
};

/** Pulse shape 0..1 over a beat phase (any real): fast rise, slower fall. */
function pulse(phase: number): number {
  const p = phase - Math.floor(phase);
  return p < 0.15 ? p / 0.15 : Math.exp(-(p - 0.15) / 0.25);
}

export function createStubSource(clock: () => number = () => performance.now() / 1000): HemoSource {
  const t0 = clock();
  const now = () => clock() - t0;
  const rr = 60 / HR;
  const numbers: HemoNumbers = {
    hr: HR, map: 90, systolic: 120, diastolic: 70, cvp: 4,
    pa: { systolic: 25, diastolic: 10, mean: 15 }, pcwp: 8, lvedp: 8, rvedp: 5,
    co: 5, ci: 2.7, svr: 17, pvr: 1.4, lvEf: 0.62, rvEf: 0.55, qpQs: 1,
  };
  const node = {} as Record<HemoNode, number>;
  for (const n of NODES) node[n] = ["PA", "RV", "RA", "SVC", "IVC"].includes(n) ? 0.72 : 0.97;
  const sats: Saturations = {
    node, spo2: 0.98, preductal: 0.98, postductal: 0.98, svo2: 0.72, do2: 1000, vo2: 250, lactate: NaN, bed: {}, bedSource: "ischemia-derived",
  };
  const beatSamples = 50;
  const time = Float32Array.from({ length: beatSamples }, (_, i) => (i / (beatSamples - 1)) * rr);
  const pressure = {} as Record<HemoNode, Float32Array>;
  for (const n of NODES) pressure[n] = Float32Array.from(time, s => RANGE[n][0] + (RANGE[n][1] - RANGE[n][0]) * pulse(s / rr));
  const loops = {} as BeatSummary["loops"];
  for (const c of CHAMBERS) loops[c] = { p: pressure[c], v: Float32Array.from(time, s => 50 + 70 * (1 - pulse(s / rr))) };
  const valve = { forwardMl: 70, regurgMl: 0, openMs: 300 };
  const beat: BeatSummary = {
    t: 0, rr, pvc: false, loops, pressure, time, atrial: Float32Array.of(0),
    edv: { RA: 70, RV: 140, LA: 70, LV: 130 }, esv: { RA: 30, RV: 65, LA: 30, LV: 55 }, strokeVolume: 75,
    valves: { AV: valve, MV: valve, TV: valve, PV: valve },
  };
  return {
    kind: "bridge",
    now,
    nodes: () => NODES,
    trace(nodeName, seconds, opts): Series {
      const max = Math.max(2, opts?.maxPoints ?? 200);
      const n = Math.min(max, Math.max(2, Math.round(seconds * 100)));
      const r = RANGE[nodeName as HemoNode] ?? [0, 1];
      const end = now();
      const t = new Float32Array(n), v = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        t[i] = end - seconds + (seconds * i) / (n - 1);
        v[i] = r[0] + (r[1] - r[0]) * pulse(t[i] / rr);
      }
      return { t, v };
    },
    beats: (count = 1) => Array.from({ length: Math.max(1, count) }, () => beat),
    numbers: () => numbers,
    saturations: () => sats,
    devices: (): readonly DeviceConsole[] => [],
    onBeat: () => () => {},
  };
}
