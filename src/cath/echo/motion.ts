/**
 * Wall motion and the cardiac cycle.
 *
 * Wall motion works by reference-position sampling: for a point on the image, ask how far its tissue has moved toward the axis at this
 * moment of systole, step back to where that tissue sat in the end-diastolic volume, and read the label (and speckle) there. So the
 * baked volume never deforms; the image does, and an akinetic segment simply does not move while its neighbours do.
 *
 * The cycle comes from the Simulation's beat stream (`beatClockFromSim`), not a clock of its own, so a PVC, AF or heart block
 * shows in the echo as it does in the ECG strip.
 */
import { NSEG } from "./ids";
import { D2R } from "./vec";

const sstep = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

/** Where the heart is in its cycle. */
export interface BeatClock {
  /** Seconds since the last ventricular beat began. */
  since: number;
  /** Length of this cycle, s. */
  rr: number;
  /** The beat that began this cycle was a PVC (weaker). */
  pvc: boolean;
}

/** Structural slice of a Simulation, so tests can feed a plain object. */
export interface BeatSource {
  t: number;
  stream: { beats: ReadonlyArray<{ t: number; rr: number; pvc?: boolean; pOnly?: boolean }> };
}

/** Phase of the last ventricular beat the sim has handed out, from its beat stream (which looks ahead a little, so the next beat is known). */
export function beatClockFromSim(sim: BeatSource): BeatClock {
  let prev: { t: number; rr: number; pvc?: boolean } | null = null, next: { t: number } | null = null;
  for (const b of sim.stream.beats) {
    if (b.pOnly) continue;
    if (b.t <= sim.t) { if (!prev || b.t > prev.t) prev = b; } else if (!next || b.t < next.t) next = b;
  }
  if (!prev) return { since: 0.5, rr: 0.8, pvc: false };
  const rr = next ? next.t - prev.t : prev.rr;
  return { since: sim.t - prev.t, rr: Math.max(0.2, rr), pvc: !!prev.pvc };
}

/** What the cycle looks like right now. */
export interface Cycle {
  /** Systolic shortening, 0 (end-diastole) .. 1 (end-systole). */
  sys: number;
  mvOpen: boolean; tvOpen: boolean; avOpen: boolean; pvOpen: boolean;
}

/** Valve timing in seconds is mostly fixed (systole shortens little with rate), so a fast rate eats diastole, as it does. TEACHING ASSUMPTION, not fitted. */
export function cycleAt(clock: BeatClock): Cycle {
  const { since, rr } = clock;
  const ts = Math.min(0.62 * rr, Math.max(0.18, 0.12 + 0.21 * rr)); // ejection plus isovolumic phases
  const t = Math.min(since, rr);
  const sys = t < ts ? Math.sin((t / ts) * Math.PI * 0.5) ** 1.3 : Math.cos(Math.min(1, (t - ts) / Math.max(0.05, rr - ts)) * Math.PI * 0.5) ** 2;
  const avOpen = since > 0.04 && since < ts, mvOpen = since > ts + 0.03 && since < rr;
  return { sys, mvOpen, tvOpen: mvOpen, avOpen, pvOpen: avOpen };
}

/** The end-diastolic cycle, for stills. */
export const DIASTOLE: Cycle = { sys: 0, mvOpen: true, tvOpen: true, avOpen: false, pvOpen: false };

/**
 * Segment dysfunction (0 normal .. 1 no thickening) and paradoxical bulging (0..1) per AHA segment, in volume order (see ids.ts).
 * The field is smooth around the wall (a von Mises kernel about the axis) so adjacent segments blend instead of stepping.
 */
export interface MotionField {
  /** Peak shortening fraction at a position (angle `ui`, degrees 0..360 from the septum going +anterior shifted by 180; height `zf`, 0 apex .. 1 base), at sys = 1. */
  peak(ui: number, zf: number): number;
  /** Mean dysfunction of the segment, for the territory overlay and tests. */
  segment: Float32Array;
  worst: number;
  /** Base contractility scale from the ejection fraction. */
  gShort: number;
}

const BASAL_CENTRES = [150, 90, 30, -30, -90, -150]; // anterolateral, anterior, anteroseptal, inferoseptal, inferior, inferolateral
const APICAL_CENTRES = [90, 0, -90, 180]; // anterior, septal, inferior, lateral

function ring(vals: number[], centres: number[], kappa: number): Float32Array {
  const o = new Float32Array(361);
  for (let a = 0; a <= 360; a++) {
    let w = 0, v = 0;
    for (let i = 0; i < centres.length; i++) { const k = Math.exp(kappa * Math.cos((a - 180 - centres[i]) * D2R)); w += k; v += k * vals[i]; }
    o[a] = v / w;
  }
  return o;
}

/**
 * @param dysfunction 17 values 0..1 (ischemia or scar; 0 moves normally, 1 does not thicken)
 * @param bulge 17 values 0..1, dyskinesis: the wall bulges outward in systole
 * @param ef ejection fraction 0..1; sets how hard the healthy walls contract
 */
export function motionField(dysfunction: ArrayLike<number>, bulge: ArrayLike<number>, ef: number): MotionField {
  if (dysfunction.length !== NSEG || bulge.length !== NSEG) throw new Error("motionField needs 17 segment values");
  const d = Array.from(dysfunction), b = Array.from(bulge);
  const at = (v: number[]) => ({
    basal: ring(v.slice(0, 6), BASAL_CENTRES, 6),
    mid: ring(v.slice(6, 12), BASAL_CENTRES, 6),
    apical: ring(v.slice(12, 16), APICAL_CENTRES, 5),
    apex: v[16],
  });
  const D = at(d), B = at(b);
  const worst = Math.max(...d);
  const level = (r: ReturnType<typeof at>, ui: number, zf: number) => {
    const sixRing = (r.mid[ui] * (1 - sstep((zf - 0.45) / 0.25))) + r.basal[ui] * sstep((zf - 0.45) / 0.25);
    const t = sstep((0.40 - zf) / 0.15);
    const v = sixRing * (1 - t) + r.apical[ui] * t;
    const c = sstep((0.14 - zf) / 0.08);
    return v * (1 - c) + r.apex * c;
  };
  const gShort = 0.30 * Math.min(1, Math.max(0.35, ef / 0.6));
  return {
    peak(ui, zf) {
      const i = Math.min(360, Math.max(0, Math.round(ui)));
      const sv = level(D, i, zf), bu = level(B, i, zf);
      // healthy walls squeeze a little harder to make up for the dead ones; dyskinetic ones are pushed out
      return gShort * ((1 - 0.96 * sv) * (1 + 0.22 * (1 - sv) * worst) - 0.5 * bu);
    },
    segment: Float32Array.from(d),
    worst,
    gShort,
  };
}

/** A field with every segment normal. */
export const normalMotion = (ef = 0.62) => motionField(new Float32Array(NSEG), new Float32Array(NSEG), ef);
