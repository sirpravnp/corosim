import { LEADS, LeadName, Vec3 } from "./config/ecg";
import { Beat, sampleLeadsVec, stLevelVec } from "./physics/ecg";
import { Conduction, RhythmState } from "./physics/rhythm";

const FS = 250, WIN = 2.5, N = Math.round(FS * WIN);
const LAYOUT: LeadName[][] = [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]];
const SANS = "-apple-system, Helvetica, Arial, sans-serif";

/**
 * Sweeping 12-lead ECG on standard paper (25 mm/s, 10 mm/mV).
 * Each frame the caller supplies the current injury vector, T-wave boost and rhythm state; a stateful
 * pacemaker/AV-node model emits P waves and QRS complexes a little ahead of the sweep.
 */
export class EcgStrip {
  private ring = Object.fromEntries(LEADS.map((l) => [l, new Float32Array(N).fill(NaN)])) as Record<LeadName, Float32Array>;
  private beats: Beat[] = [];
  private beatEnd = 0;
  private conduction = new Conduction(1);
  private acc = 0;
  private idx = 0;
  t = 0;
  private injury: Vec3 = [0, 0, 0];
  private tBoost = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  step(dt: number, injury: Vec3, tBoost: number, state: RhythmState) {
    this.injury = injury; this.tBoost = tBoost;
    // Short look-ahead so rate and conduction respond within about a beat of a state change.
    if (this.beatEnd < this.t + 0.6) {
      this.beatEnd = this.t + 1.0;
      this.beats.push(...this.conduction.advance(this.beatEnd, state));
    }
    this.beats = this.beats.filter((b) => b.t > this.t - 12);
    this.acc += dt * FS;
    const n = Math.floor(this.acc);
    this.acc -= n;
    for (let k = 0; k < n; k++) {
      const s = sampleLeadsVec(this.t, this.beats, injury, tBoost);
      for (const l of LEADS) this.ring[l][this.idx % N] = s[l];
      this.idx++; this.t += 1 / FS;
    }
  }

  /** Measured ventricular and atrial rates (bpm), last PR (s, null if not conducting) and recent ectopy. */
  rhythm(): { hr: number; atrial: number; pr: number | null; pvc: boolean } {
    const past = this.beats.filter((b) => b.t <= this.t);
    const rate = (xs: Beat[]) => (xs.length > 1 ? (60 * (xs.length - 1)) / (xs[xs.length - 1].t - xs[0].t) : 0);
    const qrs = past.filter((b) => !b.pOnly).slice(-5); // every ventricular complex, PVCs included
    const atria = past.filter((b) => !b.noP && !b.pvc).slice(-4);
    const conducted = past.filter((b) => !b.pOnly && !b.noP && !b.pvc);
    const last = conducted[conducted.length - 1];
    return { hr: rate(qrs), atrial: rate(atria), pr: last && last.t > this.t - 4 ? last.pr ?? 0.16 : null, pvc: past.some((b) => b.pvc && b.t > this.t - 10) };
  }

  /** ST level (mm) in every lead, measured on the latest completed sinus beat. */
  st(): Record<LeadName, number> {
    // In AV dissociation a P wave can land on the baseline or the J+60 point; measure a beat clear of them.
    const pPeaks = this.beats.filter((x) => !x.noP).map((x) => x.t - (x.pr ?? 0.16));
    const clear = (b: Beat) => pPeaks.every((p) => Math.abs(p - (b.t - 0.07)) > 0.07 && Math.abs(p - (b.t + 0.11)) > 0.07);
    const done = this.beats.filter((b) => !b.pvc && !b.pOnly && b.t < this.t - 0.3);
    const b = [...done].reverse().find(clear) ?? done[done.length - 1];
    const out = {} as Record<LeadName, number>;
    for (const l of LEADS) out[l] = b ? stLevelVec(l, b, this.beats, this.injury, this.tBoost) * 10 : 0;
    return out;
  }

  draw() {
    const c = this.canvas, dpr = devicePixelRatio || 1;
    const cols = 4, rows = 3, w = c.clientWidth;
    const mm = w / cols / (WIN * 25);
    const ph = Math.max(96, Math.round(mm * 22));
    const h = rows * ph;
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
    const pw = w / cols, pxMv = mm * 10, cur = this.idx % N;
    const cal = 8 * mm; // the first 8 mm of each row belong to the calibration pulse, not the trace
    LAYOUT.forEach((row, r) => row.forEach((lead, col) => {
      const x0 = col * pw, mid = r * ph + ph / 2, from = col === 0 ? cal : 0;
      g.strokeStyle = "#141414"; g.lineWidth = 1.25; g.lineJoin = "round"; g.beginPath();
      let pen = false;
      for (let i = 0; i < N; i++) {
        const v = this.ring[lead][i], x = x0 + (i / N) * pw;
        if (Number.isNaN(v) || x < x0 + from || (i - cur + N) % N < FS * 0.1) { pen = false; continue; }
        const y = mid - v * pxMv;
        if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = "#1a1a1a"; g.font = `600 12px ${SANS}`; g.fillText(lead, x0 + from + 6, r * ph + 15);
    }));
    // calibration pulse, 1 mV × 0.2 s, standing on the baseline at the start of each row
    g.strokeStyle = "#141414"; g.lineWidth = 1.25;
    for (let r = 0; r < rows; r++) {
      const mid = r * ph + ph / 2, x = 1;
      g.beginPath(); g.moveTo(x, mid); g.lineTo(x + mm, mid); g.lineTo(x + mm, mid - pxMv); g.lineTo(x + 6 * mm, mid - pxMv); g.lineTo(x + 6 * mm, mid); g.lineTo(x + 7 * mm, mid); g.stroke();
    }
  }
}
