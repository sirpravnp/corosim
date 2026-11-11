import { analyze, StructuralReport, StructuralSpec } from "../physics/structural";
import { morphFor } from "../structural/morph";
import { EchoCase } from "./cases";
import { FrameMotion, longShortening, solveShortening } from "./motion";
import { EchoFrame, EchoHeart, makeHeart } from "./tissue";

/**
 * One heartbeat of an echo patient, from the structural engine: the LV, RV and atrial volumes and the valve flows through the beat,
 * resampled to evenly spaced frames, each turned into wall motion (`motion.ts`) and leaflet opening. DOM-free; about a third of a second
 * of engine time per patient, so the page runs it once per case.
 */
export interface BeatFrame extends EchoFrame {
  /** Seconds from the start of the beat (end-diastole). */
  t: number;
  /** Chamber volumes, ml. */
  lv: number; rv: number; la: number; ra: number;
}

export interface EchoBeat {
  hr: number;
  /** Seconds per beat. */
  period: number;
  frames: BeatFrame[];
  /** Frame indices of end-diastole (largest LV) and end-systole (smallest LV). */
  ed: number; es: number;
  /** The engine's own numbers, for the readout and to check the echo's measurements against. */
  lvEdv: number; lvEsv: number; lvEf: number; rvEdv: number; rvEsv: number; rvEf: number; laMax: number;
  heart: EchoHeart;
  report: StructuralReport;
}

/** Frames per beat. A real machine shows 30 to 60 per second; this many is smooth at resting rates and keeps the cine cheap to draw. */
export const FRAMES = 24;

let normal: StructuralReport | null = null;
const normalReport = () => (normal ??= analyze({}, { waveform: false }));

const smooth = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

/** Linear resample of a waveform sampled at `t` onto `n` evenly spaced times over [0, period). */
function resample(t: number[], y: number[], period: number, n: number): number[] {
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const ti = (period * i) / n + t[0];
    while (j < t.length - 2 && t[j + 1] < ti) j++;
    const k = Math.min(1, Math.max(0, (ti - t[j]) / Math.max(1e-9, t[j + 1] - t[j])));
    out.push(y[j] + (y[j + 1] - y[j]) * k);
  }
  return out;
}

/**
 * Opening of a valve, 0..1, from its forward flow: it is open while blood goes forward, and opens wider with more flow (so the mitral
 * valve opens fully on the E wave and partly again on the atrial kick). A valve with no forward flow at all stays shut.
 */
function openings(q: number[] | undefined): number[] {
  if (!q || q.length === 0) return [];
  const peak = Math.max(...q);
  if (!(peak > 1)) return q.map(() => 0);
  return q.map((v) => smooth(v / (0.35 * peak)));
}

export function beatOf(c: EchoCase, nFrames = FRAMES): EchoBeat {
  return beatOfSpec(c.spec, c.look, nFrames);
}

export function beatOfSpec(spec: StructuralSpec, look: EchoCase["look"] = {}, nFrames = FRAMES): EchoBeat {
  const r = analyze(spec, { waveform: true }), w = r.waveform!;
  const period = 60 / r.hr, n = nFrames;
  const lv = resample(w.t, w.vLV, period, n), rv = resample(w.t, w.vRV, period, n), la = resample(w.t, w.vLA, period, n), ra = resample(w.t, w.vRA, period, n);
  const mv = openings(resample(w.t, w.q.MV, period, n)), av = openings(resample(w.t, w.q.AV, period, n)), tv = openings(resample(w.t, w.q.TV, period, n));
  const pv = openings(resample(w.t, w.q.PVL, period, n));
  const lvEdv = Math.max(...lv), lvEsv = Math.min(...lv), rvEdv = Math.max(...rv), rvEsv = Math.min(...rv);
  const nr = normalReport();
  // the echo LV is sized from the engine's end-diastolic volume against a normal heart's (linear scale = volume^(1/3))
  const lvScale = Math.min(1.45, Math.max(0.8, Math.cbrt(lvEdv / nr.lvEdv)));
  const morph = morphFor(spec, r);
  // the other chambers' sizes from the same volumes (morphFor gives linear scales; its RV term is a square root of the volume ratio)
  const chamberScale = { rv: Math.pow(morph.rvBulge ?? 1, 2 / 3), ra: morph.raScale ?? 1, la: morph.laScale ?? 1 };
  const heart = makeHeart({ ...look, morph, lvScale, chamberScale });
  const frames: BeatFrame[] = [];
  for (let i = 0; i < n; i++) {
    const s = solveShortening(lv[i] / lvEdv, heart.shape.map);
    const motion: FrameMotion = { s, long: longShortening(s, heart.shape.map), rv: 0.55 * (1 - rv[i] / rvEdv) };
    frames.push({ t: (period * i) / n, lv: lv[i], rv: rv[i], la: la[i], ra: ra[i], motion, open: { mv: mv[i] ?? 0, av: av[i] ?? 0, tv: tv[i] ?? 0, pv: pv[i] ?? 0 } });
  }
  const ed = lv.indexOf(lvEdv), es = lv.indexOf(lvEsv);
  return {
    hr: r.hr, period, frames, ed, es,
    lvEdv, lvEsv, lvEf: (lvEdv - lvEsv) / lvEdv, rvEdv, rvEsv, rvEf: (rvEdv - rvEsv) / rvEdv, laMax: Math.max(...la),
    heart, report: r,
  };
}
