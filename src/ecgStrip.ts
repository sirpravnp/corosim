import { AF, ALL_LEADS, LeadName, POTASSIUM_ECG, Rhythm, ST, Vec3 } from "./config/ecg";
import { Beat, heartVector, projectLeads, stLevelVec } from "./physics/ecg";
import { BeatStream } from "./physics/beatStream";

const FS = 250, WIN = 2.5, N = Math.round(FS * WIN);
/** Pixels per millimeter of paper in the rhythm strip (a CSS millimeter is about 3.78 px; narrow screens use a smaller square so more beats fit). */
const STRIP_MM_WIDE = 3.78, STRIP_MM_NARROW = 3;
const LAYOUT: LeadName[][] = [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]];
const POSTERIOR: LeadName[] = ["V7", "V8", "V9"]; // a fifth column when the posterior leads are on
const SANS = '"Hanken Grotesk", -apple-system, Helvetica, Arial, sans-serif';

/** A ring of samples at write position `idx`, copied into one of `n` slots keeping the newest samples in order (older ones drop when it shrinks; the rest stays blank). */
export function resizeRing(old: Float32Array, idx: number, n: number): { ring: Float32Array; idx: number } {
  const len = old.length, ring = new Float32Array(n).fill(NaN);
  const keep = Math.min(len, n);
  for (let k = 0; k < keep; k++) ring[keep - 1 - k] = old[(((idx - 1 - k) % len) + len) % len]; // newest last
  return { ring, idx: keep };
}

/**
 * Sweeping 12-lead ECG on standard paper (25 mm/s, 10 mm/mV).
 * Each frame the caller supplies the current injury vector, T-wave boost and rhythm; the P waves and QRS
 * complexes come from the simulation's shared beat stream, generated a little ahead of the sweep, so the
 * ECG and the beat-by-beat pressure are the same beats. A rhythm from the EKG library (B2) is drawn with the library's own
 * complexes (each beat carries its painter) and baseline (flutter waves, fibrillation), with the coronary model's ST injury on top.
 */
export class EcgStrip {
  posterior = false;
  /** "twelve" is the Simulator's 2.5 s twelve-lead page; "strip" is lead II alone on a long rhythm strip that fills the canvas width at 25 mm/s;
   *  "full" is the twelve-lead with a lead II rhythm strip under it across the whole width (the case monitor). */
  private ring = Object.fromEntries(ALL_LEADS.map((l) => [l, new Float32Array(N).fill(NaN)])) as Record<LeadName, Float32Array>;
  private n = N;
  private rhy: Float32Array = new Float32Array(FS * 10).fill(NaN); // "full" mode: the rhythm strip's own ring of lead II
  private rIdx = 0;
  private acc = 0;
  private idx = 0;
  t = 0;
  private injury: Vec3 = [0, 0, 0];
  private tBoost = 0;
  private fWave = 0;
  private potassium: number = POTASSIUM_ECG.normal;

  constructor(private canvas: HTMLCanvasElement, public stream: BeatStream = new BeatStream(1), private mode: "twelve" | "strip" | "full" = "twelve") {}

  private get beats(): Beat[] { return this.stream.beats; }

  /** Blank the paper and restart the clock (the simulation was reset). */
  reset(t = 0) { for (const l of ALL_LEADS) this.ring[l].fill(NaN); this.rhy.fill(NaN); this.acc = 0; this.idx = 0; this.rIdx = 0; this.t = t; }

  /** Strip mode: lead II only; the ring holds as many samples as the canvas shows seconds. A change of width restarts the sweep. */
  private fit(secs: number) {
    const n = Math.max(FS, Math.round(secs * FS));
    if (n === this.n) return;
    const r = resizeRing(this.ring.II, this.idx, n); // the trace survives a resize: the newest samples are kept
    this.n = n; this.idx = r.idx;
    for (const l of ALL_LEADS) this.ring[l] = l === "II" ? r.ring : new Float32Array(0);
  }

  /** The simulation generates and prunes the beats; this only samples them. */
  step(dt: number, injury: Vec3, tBoost: number, rhythm: Rhythm, potassium: number = POTASSIUM_ECG.normal) {
    this.injury = injury; this.tBoost = tBoost; this.fWave = rhythm === "af" ? AF.fWaveMv : 0; this.potassium = potassium;
    this.acc += dt * FS;
    const n = Math.floor(this.acc);
    this.acc -= n;
    for (let k = 0; k < n; k++) {
      if (this.mode === "strip") this.ring.II[this.idx % this.n] = projectLeads(this.vector(this.t)).II;
      else {
        const s = this.sample(this.t); for (const l of ALL_LEADS) this.ring[l][this.idx % this.n] = s[l];
        if (this.mode === "full") this.rhy[this.rIdx++ % this.rhy.length] = s.II;
      }
      this.idx++; this.t += 1 / FS;
    }
  }

  /** Heart vector (mV) at time t: the coronary model's beats, the library rhythm's beats (their own painter, with this frame's injury) and baseline. */
  vector(t: number): Vec3 {
    const base = this.stream.baseline(t);
    const v = heartVector(t, this.beats, this.injury, this.tBoost, base || this.stream.libraryRhythm ? 0 : this.fWave, this.potassium);
    if (base) { v[0] += base[0]; v[1] += base[1]; v[2] += base[2]; }
    for (const b of this.beats) {
      if (!b.ekg) continue;
      const dt = t - b.t;
      if (dt < -0.6 || dt > 1.0) continue;
      const p = b.ekg.painter, m = p.morph, inj0 = m.injury, tb0 = m.tBoost;
      m.injury = this.injury; m.tBoost = tb0 + this.tBoost;
      p.vector(dt, b.alt !== undefined ? { ...b.ekg.beat, alt: b.alt } : b.ekg.beat, v);
      m.injury = inj0; m.tBoost = tb0;
    }
    return v;
  }
  private sample(t: number): Record<LeadName, number> { return projectLeads(this.vector(t)); }

  /** Measured ventricular and atrial rates (bpm), last PR (s, null if not conducting) and recent ectopy. */
  rhythm(): { hr: number; atrial: number; pr: number | null; pvc: boolean } {
    const past = this.beats.filter((b) => b.t <= this.t && b.t > this.t - 10); // recent beats only, so a change of rhythm reads within seconds
    const rate = (xs: Beat[]) => (xs.length > 1 ? (60 * (xs.length - 1)) / (xs[xs.length - 1].t - xs[0].t) : 0);
    const qrs = past.filter((b) => !b.pOnly && !b.silent).slice(-5); // every ventricular complex, PVCs included (not the silent ticks of VF or asystole)
    const atria = past.filter((b) => !b.noP && !b.pvc && (b.pOnly || !b.silent)).slice(-4); // flutter waves count
    const conducted = past.filter((b) => !b.pOnly && !b.noP && !b.pvc && !b.silent);
    const last = conducted[conducted.length - 1];
    return { hr: rate(qrs), atrial: rate(atria), pr: last && last.t > this.t - 4 ? last.pr ?? 0.16 : null, pvc: past.some((b) => b.pvc && b.t > this.t - 10) };
  }

  /** ST level (mm) in every lead, measured on the latest completed sinus beat. */
  st(): Record<LeadName, number> {
    // In AV dissociation a P wave can land on the baseline or the J+60 point; measure a beat clear of them.
    const pPeaks = this.beats.filter((x) => !x.noP && !x.silent).map((x) => x.t - (x.pr ?? 0.16));
    const clear = (b: Beat) => pPeaks.every((p) => Math.abs(p - (b.t - 0.07)) > 0.07 && Math.abs(p - (b.t + 0.11)) > 0.07);
    const done = this.beats.filter((b) => !b.pvc && !b.pOnly && !b.silent && b.t < this.t - 0.3 && (!b.ekg || b.ekg.beat.kind === "sv"));
    const b = [...done].reverse().find(clear) ?? done[done.length - 1];
    const out = {} as Record<LeadName, number>;
    if (b?.ekg) { // a library rhythm's beat: measured on what the strip draws (baseline before the QRS, J + 60 ms)
      const back = (b.ekg.painter.morph.bbb === "lbbb" ? 0.11 : 0.07) * b.ekg.painter.morph.qrsWide, base = this.sample(b.t - back), at = this.sample(b.t + ST.measureAt);
      for (const l of ALL_LEADS) out[l] = (at[l] - base[l]) * 10;
      return out;
    }
    for (const l of ALL_LEADS) out[l] = b ? stLevelVec(l, b, this.beats, this.injury, this.tBoost) * 10 : 0;
    return out;
  }

  draw() {
    if (this.mode === "strip") return this.drawStrip();
    const c = this.canvas, dpr = devicePixelRatio || 1;
    const layout = this.posterior ? LAYOUT.map((row, r) => [...row, POSTERIOR[r]]) : LAYOUT;
    const cols = layout[0].length, rows = 3, w = c.clientWidth, full = this.mode === "full";
    if (!w) return; // not laid out (its panel is closed or on a hidden tab): nothing to draw, and the paper loop below would not end
    const mm = w / cols / (WIN * 25);
    const ph = Math.max(96, Math.round(mm * 22));
    const h = (rows + (full ? 1 : 0)) * ph; // "full" adds the rhythm strip as a fourth row
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.height = h + "px";
    }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#fffaf8"; g.fillRect(0, 0, w, h);
    // ECG paper: 1 mm minor and 5 mm major squares
    for (let x = 0, i = 0; x <= w + 0.5; x += mm, i++) {
      g.strokeStyle = i % 5 === 0 ? "rgba(214,90,80,.55)" : "rgba(214,90,80,.18)";
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
    for (let y = 0, i = 0; y <= h + 0.5; y += mm, i++) {
      g.strokeStyle = i % 5 === 0 ? "rgba(214,90,80,.55)" : "rgba(214,90,80,.18)";
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
    const pw = w / cols, pxMv = mm * 10, cur = this.idx % this.n;
    const cal = 8 * mm; // the first 8 mm of each row belong to the calibration pulse, not the trace
    layout.forEach((row, r) => row.forEach((lead, col) => {
      const x0 = col * pw, mid = r * ph + ph / 2, from = col === 0 ? cal : 0;
      g.strokeStyle = "#141414"; g.lineWidth = 1.25; g.lineJoin = "round"; g.beginPath();
      let pen = false;
      for (let i = 0; i < this.n; i++) {
        const v = this.ring[lead][i], x = x0 + (i / this.n) * pw;
        if (Number.isNaN(v) || x < x0 + from || (i - cur + this.n) % this.n < FS * 0.1) { pen = false; continue; }
        const y = mid - v * pxMv;
        if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = "#1a1a1a"; g.font = `600 12px ${SANS}`; g.fillText(lead, x0 + from + 6, r * ph + 15);
    }));
    if (full) { // lead II across the whole width: w / (mm x 25) seconds, the newest samples at the sweep
      const rn = Math.max(FS, Math.round((w / (mm * 25)) * FS));
      if (rn !== this.rhy.length) { const r = resizeRing(this.rhy, this.rIdx, rn); this.rhy = r.ring; this.rIdx = r.idx; }
      const mid = rows * ph + ph / 2, rc = this.rIdx % rn;
      g.strokeStyle = "#141414"; g.lineWidth = 1.25; g.lineJoin = "round"; g.beginPath();
      let pen2 = false;
      for (let i = 0; i < rn; i++) {
        const v = this.rhy[i], x = (i / rn) * w;
        if (Number.isNaN(v) || x < cal || (i - rc + rn) % rn < FS * 0.1) { pen2 = false; continue; }
        const y = mid - Math.max(-ph / 2 + 2, Math.min(ph / 2 - 2, v * pxMv));
        if (!pen2) { g.moveTo(x, y); pen2 = true; } else g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = "#1a1a1a"; g.font = `600 12px ${SANS}`; g.fillText("II rhythm", cal + 6, rows * ph + 15);
    }
    // calibration pulse, 1 mV × 0.2 s, standing on the baseline at the start of each row
    g.strokeStyle = "#141414"; g.lineWidth = 1.25;
    for (let r = 0; r < rows + (full ? 1 : 0); r++) {
      const mid = r * ph + ph / 2, x = 1;
      g.beginPath(); g.moveTo(x, mid); g.lineTo(x + mm, mid); g.lineTo(x + mm, mid - pxMv); g.lineTo(x + 6 * mm, mid - pxMv); g.lineTo(x + 6 * mm, mid); g.lineTo(x + 7 * mm, mid); g.stroke();
    }
  }

  /** Lead II on pink paper, 25 mm/s and 10 mm/mV, sweeping left to right across the whole canvas. */
  private drawStrip() {
    const c = this.canvas, dpr = devicePixelRatio || 1, w = c.clientWidth;
    if (!w) return;
    const mm = w < 560 ? STRIP_MM_NARROW : STRIP_MM_WIDE;
    const h = Math.round(mm * (w < 560 ? 36 : 48)); // 48 mm of paper (36 on a phone): a 2 mV complex fits with room
    this.fit(w / (mm * 25));
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.height = h + "px";
    }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#fffaf8"; g.fillRect(0, 0, w, h);
    for (let x = 0, i = 0; x <= w + 0.5; x += mm, i++) {
      g.strokeStyle = i % 5 === 0 ? "rgba(214,90,80,.55)" : "rgba(214,90,80,.18)";
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
    for (let y = 0, i = 0; y <= h + 0.5; y += mm, i++) {
      g.strokeStyle = i % 5 === 0 ? "rgba(214,90,80,.55)" : "rgba(214,90,80,.18)";
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
    const mid = Math.round(h / 2), pxMv = mm * 10, cur = this.idx % this.n, cal = 8 * mm;
    g.strokeStyle = "#141414"; g.lineWidth = 1.5; g.lineJoin = "round"; g.beginPath();
    let pen = false;
    for (let i = 0; i < this.n; i++) {
      const v = this.ring.II[i], x = (i / this.n) * w;
      if (Number.isNaN(v) || x < cal || (i - cur + this.n) % this.n < FS * 0.12) { pen = false; continue; }
      const y = mid - Math.max(-h / 2 + 2, Math.min(h / 2 - 2, v * pxMv));
      if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
    }
    g.stroke();
    g.beginPath(); g.moveTo(1, mid); g.lineTo(1 + mm, mid); g.lineTo(1 + mm, mid - pxMv); g.lineTo(1 + 6 * mm, mid - pxMv); g.lineTo(1 + 6 * mm, mid); g.lineTo(1 + 7 * mm, mid); g.stroke(); // 1 mV x 0.2 s calibration pulse
  }
}
