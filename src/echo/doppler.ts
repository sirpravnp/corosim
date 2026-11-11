import { V3 } from "../anatomy/curve";
import { ctToHeart, heartDirToCt } from "../anatomy/ctHeart";
import { Pose, toHeart, toPatient } from "./poses";
import { SECTOR } from "./poses";
import { ctHeart, ctGeom } from "./ctEcho";
import { EchoBeat, frameAt } from "./beat";
import { JetOptions, annulusVelocity, jetsAt, velocityAt } from "./flow";
import { FrameSample, Tissue, classifyFrame } from "./tissue";

/**
 * Spectral Doppler: the distribution of blood (or tissue) velocities along the beam, over time, as the scanner's spectrogram shows it.
 *
 * - Pulsed wave (PW): velocities in a small sample volume at one depth. The pulse repetition frequency is limited by the time sound needs
 *   to reach the gate and come back, so the highest velocity it can show unambiguously (the Nyquist limit) falls with depth:
 *   v = c^2 / (8 f0 d). Faster flow wraps around (aliasing).
 * - Continuous wave (CW): every velocity along the whole line, with no depth and no aliasing: the way to measure fast jets.
 * - Tissue Doppler (TDI): pulsed wave on the mitral annulus, whose slow, strong motion is the LV's longitudinal shortening and lengthening.
 *
 * Velocities come from flow.ts (and, for TDI, the annulus motion); positive is toward the probe, drawn above the baseline.
 */
export type SpectralMode = "pw" | "cw" | "tdi";

export interface SpectralRequest {
  pose: Pose;
  mode: SpectralMode;
  /** The Doppler line: angle from the sector's centre line (radians, positive toward the image's right) and, for PW and TDI, the gate depth (mm). */
  lineAngle: number;
  gateDepth: number;
  /** Sample volume length, mm (PW and TDI). */
  gateMm?: number;
  /** Beats shown, and columns per beat. */
  beats?: number;
  columns?: number;
  /** Velocity scale: the display runs from -scale to +scale m/s about the baseline. Defaults: PW the Nyquist limit, CW 6, TDI 0.2. */
  scale?: number;
  /** Baseline position, 0 (top) to 1 (bottom) of the display; defaults to the middle. */
  baseline?: number;
  /** Transducer frequency, MHz (sets the PW Nyquist limit). */
  f0?: number;
}

export interface Spectrum {
  /** Columns (time) by bins (velocity): intensity 0..1, row-major by bin from the top (fastest toward) to the bottom (fastest away). */
  img: Float32Array; columns: number; bins: number;
  /** Displayed velocity range, m/s: the top row is `top`, the bottom `bottom`. */
  top: number; bottom: number;
  /** Seconds per column. */
  dt: number;
  /** The modal (strongest) velocity and the peak velocity toward (+) and away (-) per column, m/s, as a sonographer would trace them. */
  peakToward: Float32Array; peakAway: Float32Array;
  /** The PW Nyquist limit at this depth, m/s (Infinity for CW). */
  nyquist: number;
  /** Beat start times (s) within the shown span, for measurements per beat. */
  period: number;
}

const C = 1540;
/** PW Nyquist velocity (m/s) at depth d (mm) for a transducer of f0 MHz: PRF = c / (2 d), v = PRF c / (4 f0). */
export const pwNyquist = (depthMm: number, f0 = 2.5) => (C * C) / (8 * f0 * 1e6 * (depthMm / 1000));

function hash(a: number, b: number, c: number) { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

/** Compute a spectrum for a patient's beat. */
export function spectrum(beat: EchoBeat, req: SpectralRequest, jetOpt: JetOptions = {}): Spectrum {
  const h = ctHeart(), g = ctGeom();
  if (!h || !g) throw new Error("spectrum: the CT heart is not installed");
  const beats = req.beats ?? 2, perBeat = req.columns ?? 160, cols = beats * perBeat, dt = beat.period / perBeat;
  const nyq = req.mode === "cw" ? Infinity : pwNyquist(req.gateDepth, req.f0 ?? 2.5);
  const scale = req.scale ?? (req.mode === "cw" ? 6 : req.mode === "tdi" ? 0.2 : Math.min(nyq, 1.5));
  const base = req.baseline ?? 0.5, top = scale * 2 * base, bottom = -scale * 2 * (1 - base);
  const bins = 160, img = new Float32Array(cols * bins), peakToward = new Float32Array(cols), peakAway = new Float32Array(cols);
  const a = Math.max(-SECTOR.halfAngle, Math.min(SECTOR.halfAngle, req.lineAngle)), ca = Math.cos(a), sa = Math.sin(a), P = req.pose;
  const dir: V3 = [P.beam[0] * ca + P.lateral[0] * sa, P.beam[1] * ca + P.lateral[1] * sa, P.beam[2] * ca + P.lateral[2] * sa];
  const dirCt = heartDirToCt(h, toHeart(dir));
  // sample points along the line: the gate (PW, TDI) or the whole line (CW)
  const gate = req.gateMm ?? 3, depths: number[] = [];
  if (req.mode === "cw") for (let d = 5; d < P.depth; d += 1) depths.push(d);
  else for (let d = req.gateDepth - gate / 2; d <= req.gateDepth + gate / 2 + 1e-9; d += 0.5) depths.push(d);
  const hit: FrameSample = { tissue: Tissue.Outside, part: null, sdf: 0, ref: [0, 0, 0] }, v: V3 = [0, 0, 0], tb = { value: 0 };
  const hist = new Float32Array(bins), sigmaBins = (s: number) => (s / (top - bottom)) * bins;
  const add = (vel: number, w: number, spread: number) => {
    // a Gaussian of spectral broadening around this velocity (aliased into the display window for PW)
    let u = vel;
    if (Number.isFinite(nyq)) { const span = top - bottom; while (u > top) u -= span; while (u < bottom) u += span; }
    const c = ((top - u) / (top - bottom)) * bins, sg = Math.max(0.8, sigmaBins(spread));
    for (let k = Math.max(0, Math.floor(c - 3 * sg)); k <= Math.min(bins - 1, Math.ceil(c + 3 * sg)); k++) hist[k] += w * Math.exp(-0.5 * ((k - c) / sg) ** 2);
  };
  // TDI: the annulus moves along the LV axis (the CT z axis), toward the apex (-z) in systole; the component toward the probe is
  // -(motion . beam) = annulus speed * beam_z
  const axisDot = dirCt[2];
  for (let col = 0; col < cols; col++) {
    const t = col * dt, fr = frameAt(beat, t), jets = req.mode === "tdi" ? [] : jetsAt(beat.wave, t, jetOpt);
    hist.fill(0);
    let pT = 0, pA = 0;
    if (req.mode === "tdi") {
      const va = annulusVelocity(beat.wave, t, g.length) * axisDot;
      add(va, 6, 0.006 + 0.08 * Math.abs(va));
      pT = Math.max(0, va); pA = Math.min(0, va);
    } else {
      for (const d of depths) {
        const pt: V3 = [P.probe[0] + dir[0] * d, P.probe[1] + dir[1] * d, P.probe[2] + dir[2] * d];
        classifyFrame(toHeart(pt), beat.heart, fr, hit);
        if (hit.tissue !== Tissue.Blood) {
          // moving walls and valves leave low-velocity, high-intensity clutter that the wall filter mostly removes
          if (hit.tissue !== Tissue.Outside) add(0, 0.25, 0.03);
          continue;
        }
        velocityAt(hit.ref, hit.part ?? -1, jets, v, tb);
        const vel = -(v[0] * dirCt[0] + v[1] * dirCt[1] + v[2] * dirCt[2]);
        // CW sums the whole line; a fast jet returns strong Doppler power, so its envelope stands out over the many slow samples
        add(vel, req.mode === "cw" ? 0.3 + 1.2 * Math.abs(vel) : 1, 0.03 + 0.06 * Math.abs(vel) + 0.35 * tb.value * Math.abs(vel));
        if (vel > pT) pT = vel; if (vel < pA) pA = vel;
      }
    }
    peakToward[col] = pT; peakAway[col] = pA;
    // display: log-compressed, with a little noise, the wall filter cutting the band around zero (not for TDI, which wants it)
    // normalize to a high percentile of the column, not its single brightest bin (a narrow spike would dim everything else)
    const sorted = Array.from(hist).sort((p, q) => p - q), mx = Math.max(1e-9, sorted[Math.floor(0.97 * (bins - 1))]);
    const zero = (top / (top - bottom)) * bins;
    for (let k = 0; k < bins; k++) {
      let val = Math.min(1, Math.log1p(12 * hist[k] / mx) / Math.log1p(12));
      if (req.mode !== "tdi" && Math.abs(k - zero) < 1.2) val *= 0.15;
      val = val * (0.75 + 0.5 * hash(col, k, 7)) + 0.05 * hash(col, k, 11);
      img[k * cols + col] = Math.min(1, val);
    }
  }
  return { img, columns: cols, bins, top, bottom, dt, peakToward, peakAway, nyquist: nyq, period: beat.period };
}

/** Peak, time integral and mean gradient of one direction's envelope over the first beat (the measurements a sonographer traces). */
export function envelopeMeasures(s: Spectrum, toward: boolean, minV = 0.1): { vmax: number; vti: number; meanGradient: number; peakGradient: number; durationMs: number } {
  const per = Math.round(s.period / s.dt), env = toward ? s.peakToward : s.peakAway;
  let vmax = 0, vti = 0, g = 0, n = 0;
  for (let i = 0; i < per; i++) {
    const v = Math.abs(env[i]);
    if (v < minV) continue;
    vmax = Math.max(vmax, v); vti += v * s.dt; g += 4 * v * v; n++;
  }
  return { vmax, vti: vti * 100, meanGradient: n ? g / n : 0, peakGradient: 4 * vmax * vmax, durationMs: n * s.dt * 1000 };
}

// ---- standard measurements, with the sample volume placed as a sonographer would ------------------------------------------------

/** The line angle (radians) and depth (mm) at which a pose's Doppler line passes through a patient-frame point. */
export function aimAt(pose: Pose, p: V3): { lineAngle: number; gateDepth: number } {
  const d: V3 = [p[0] - pose.probe[0], p[1] - pose.probe[1], p[2] - pose.probe[2]];
  const b = d[0] * pose.beam[0] + d[1] * pose.beam[1] + d[2] * pose.beam[2], l = d[0] * pose.lateral[0] + d[1] * pose.lateral[1] + d[2] * pose.lateral[2];
  return { lineAngle: Math.atan2(l, b), gateDepth: Math.hypot(b, l) };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scaleV = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** A CT-frame point (mm) in the patient frame. */
const ctPoint = (c: V3): V3 => toPatient(ctToHeart(ctHeart()!, c));

/** Mitral inflow: E and A peaks (m/s), their ratio and the E deceleration time (ms), from a PW envelope toward the apical probe. */
export function mitralInflow(s: Spectrum): { e: number; a: number; ea: number; dtMs: number } {
  const per = Math.round(s.period / s.dt), env = Array.from(s.peakToward.slice(0, per));
  // smooth a little, then the first and last local maxima of the diastolic envelope are E and A
  const sm = env.map((_, i) => { let t = 0, c = 0; for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < per) { t += env[j]; c++; } } return t / c; });
  const peaks: number[] = [];
  for (let i = 1; i < per - 1; i++) if (sm[i] > 0.15 && sm[i] >= sm[i - 1] && sm[i] > sm[i + 1]) peaks.push(i);
  if (!peaks.length) return { e: 0, a: 0, ea: 0, dtMs: 0 };
  const iE = peaks[0], iA = peaks.length > 1 ? peaks[peaks.length - 1] : -1, e = sm[iE], a = iA >= 0 && iA - iE > 4 ? sm[iA] : 0;
  // deceleration time: the E downslope, from its steepest stretch, extrapolated to zero
  let iEnd = iE; while (iEnd + 1 < per && sm[iEnd + 1] < sm[iEnd] && sm[iEnd + 1] > 0.05) iEnd++;
  const slope = (sm[iE] - sm[Math.max(iE + 1, iEnd)]) / Math.max(1, Math.max(iE + 1, iEnd) - iE);
  const dtMs = slope > 1e-6 ? (e / slope) * s.dt * 1000 : 0;
  return { e, a, ea: a > 0 ? e / a : 0, dtMs };
}

/** e' from a TDI spectrum: the first away peak after systole (s' is toward the probe; e' and a' are away, e' first). */
function earlyDiastolicAway(s: Spectrum): number {
  const per = Math.round(s.period / s.dt), env = s.peakAway;
  let i = 0;
  while (i < per && s.peakToward[i] < 0.02) i++;   // into systole (s')
  while (i < per && s.peakToward[i] >= 0.02) i++;  // past it
  let best = 0;
  for (; i < per; i++) { const v = -env[i]; if (v > best) best = v; else if (best > 0.02 && v < 0.6 * best) break; }
  return best;
}

export interface DopplerReport {
  mitral: { e: number; a: number; ea: number; dtMs: number; meanGradient: number };
  annulus: { septalE: number; lateralE: number; eOverEprime: number };
  lvot: { vti: number; diameterCm: number; strokeVolume: number };
  aortic: { vmax: number; peakGradient: number; meanGradient: number; vti: number; ava: number };
  tricuspid: { vmax: number; rvsp: number | null };
}

/**
 * The standard Doppler set, measured on the simulated spectra (not read off the engine): mitral inflow by PW at the leaflet tips and
 * the annulus by TDI (apical four-chamber), the LV outflow by PW and the aortic valve by CW (apical five-chamber), tricuspid
 * regurgitation by CW. Stroke volume and the aortic valve area use the LVOT diameter of the CT heart's aortic ring (continuity equation).
 */
export function standardDoppler(beat: EchoBeat, poses: Record<string, Pose>, jetOpt: JetOptions = {}): DopplerReport {
  const h = ctHeart()!, V = h.meta.valves, g = ctGeom()!, cm0 = (v: V3): V3 => [v[0] * 10, v[1] * 10, v[2] * 10];
  // The valves ride on the base, which descends toward the apex in systole and returns in diastole: aim at where a valve is at the
  // moment its flow peaks (the base's descent along the LV axis, the CT z axis), as a sonographer aims at the valve on screen.
  const w = beat.wave, peakAt = (q: Float32Array, forward: boolean) => { let bi = 0; for (let i = 0; i < w.n; i++) if ((forward ? q[i] : -q[i]) > (forward ? q[bi] : -q[bi])) bi = i; return bi; };
  const shift = (i: number) => w.long[i] * g.length;
  const at = (v: V3, i: number): V3 => [v[0], v[1], v[2] - shift(i)];
  const cm = cm0;
  const iMv = peakAt(w.q.MV, true), iAv = peakAt(w.q.AV, true), iTr = peakAt(w.q.TV, false);
  const mv = at(cm(V.MV.c), iMv), av = at(cm(V.AV.c), iAv), tv = at(cm(V.TV.c), iTr), nMv = V.MV.n, nAv = V.AV.n;
  const along = (c: V3, n: V3, k: number): V3 => [c[0] + n[0] * k, c[1] + n[1] * k, c[2] + n[2] * k];
  // Each measurement uses a Doppler line laid along the flow it measures (as a sonographer hunts for the window that aligns the beam
  // with the jet, or uses a dedicated pencil CW probe): from `from` mm back along the flow direction `n`, through `target`. `toward`
  // says whether the flow comes toward that line's probe. The interactive Doppler, by contrast, keeps the user's own line and angle.
  const line = (target: V3, n: V3, toward: boolean): Pose => {
    const tp = ctPoint(target), np = unit(sub(ctPoint([target[0] + n[0], target[1] + n[1], target[2] + n[2]]), tp));
    const beam = toward ? scaleV(np, -1) : np, probe: V3 = [tp[0] - beam[0] * 110, tp[1] - beam[1] * 110, tp[2] - beam[2] * 110];
    const lateral = unit(cross(beam, Math.abs(beam[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    return { probe, beam, lateral, marker: lateral, target: tp, depth: 200 };
  };
  const run = (pose: Pose, mode: SpectralMode, extra: Partial<SpectralRequest> = {}) => spectrum(beat, { pose, mode, lineAngle: 0, gateDepth: 110, beats: 1, columns: 200, ...extra }, jetOpt);
  const zAxis: V3 = [0, 0, 1];
  // mitral inflow at the leaflet tips, 8 mm into the LV, toward an apical probe; the CW line through the valve for its gradient
  const inflow = mitralInflow(run(line(along(mv, nMv, 8), nMv, true), "pw", { scale: 1.6, baseline: 0.75 }));
  const mvCw = envelopeMeasures(run(line(mv, nMv, true), "cw"), true);
  // annulus: septal and lateral hinge points (x is septum to free wall in the CT frame), along the LV axis from the apex
  // e' is the early-diastolic recoil, away from an apical probe (the annulus returns toward the base)
  const R = 0.86 * V.MV.R * 10, tdiSpec = (x: number) => run(line([mv[0] + x, mv[1], mv[2] - 2], zAxis, false), "tdi", { scale: 0.25 });
  const tdi = (x: number) => earlyDiastolicAway(tdiSpec(x));
  const septalE = tdi(-R), lateralE = tdi(R);
  // LV outflow, 8 mm below the aortic valve, and the valve itself by CW: flow away from an apical probe
  const lvot = envelopeMeasures(run(line(along(av, nAv, -8), nAv, false), "pw", { scale: 1.6, baseline: 0.25 }), false);
  const avCw = envelopeMeasures(run(line(along(av, nAv, 4), nAv, false), "cw", { baseline: 0.15 }), false);
  const lvotD = 2.2, lvotArea = Math.PI * (lvotD / 2) ** 2;
  // tricuspid regurgitation by CW, along the regurgitant jet (from the RV into the RA, away from an apical probe)
  const nTv = V.TV.n, trCw = envelopeMeasures(run(line(tv, [-nTv[0], -nTv[1], -nTv[2]], false), "cw", { baseline: 0.15 }), false);
  const ra = beat.report.pressure.RA.mean;
  const eAvg = (septalE + lateralE) / 2;
  return {
    mitral: { ...inflow, meanGradient: mvCw.meanGradient },
    annulus: { septalE, lateralE, eOverEprime: eAvg > 0 ? inflow.e / eAvg : 0 },
    lvot: { vti: lvot.vti, diameterCm: lvotD, strokeVolume: lvot.vti * lvotArea },
    aortic: { vmax: avCw.vmax, peakGradient: avCw.peakGradient, meanGradient: avCw.meanGradient, vti: avCw.vti, ava: avCw.vti > 0 ? (lvotArea * lvot.vti) / avCw.vti : 0 },
    tricuspid: { vmax: trCw.vmax, rvsp: trCw.vmax > 1.5 ? 4 * trCw.vmax ** 2 + ra : null },
  };
}
