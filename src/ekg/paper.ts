import { LeadName } from "../config/ecg";

const FS = 500, SECONDS = 10, N = FS * SECONDS;
const GRID: LeadName[][] = [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]];
const POSTERIOR: LeadName[] = ["V7", "V8", "V9"];
const ALL: LeadName[] = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9"];
const SANS = "-apple-system, 'Helvetica Neue', Arial, sans-serif";

interface Panel { lead: LeadName; x: number; y: number; w: number; h: number; from: number; to: number }

/**
 * A 12-lead printout that writes itself: standard 3 × 4 layout (each column a consecutive 2.5 s), a 10 s rhythm strip,
 * and optionally the posterior leads, on 25 mm/s paper at a chosen gain. A sweep erases just ahead of the pen, as on a
 * monitor. Click a lead to select it.
 */
export class Paper {
  readonly fs = FS;
  gain = 10; // mm/mV
  posterior = false;
  rhythmLead: LeadName = "II";
  selected: LeadName | null = null;
  onSelect?: (lead: LeadName) => void;
  private ring = Object.fromEntries(ALL.map((l) => [l, new Float32Array(N).fill(NaN)])) as Record<LeadName, Float32Array>;
  private idx = 0;
  private panels: Panel[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener("click", (e) => {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const p = this.panels.find((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
      if (p) { this.selected = p.lead; this.onSelect?.(p.lead); }
    });
  }

  clear() { for (const l of ALL) this.ring[l].fill(NaN); this.idx = 0; }

  /** Append one sample of every lead (mV). */
  push(s: Record<LeadName, number>) {
    const i = this.idx % N;
    for (const l of ALL) this.ring[l][i] = s[l];
    this.idx++;
  }

  draw() {
    const c = this.canvas, dpr = Math.min(2, devicePixelRatio || 1), w = c.clientWidth;
    if (!w) return;
    const mm = w / (SECONDS * 25), row = Math.round(mm * Math.max(24, this.gain * 2.6));
    const rows = 3 + (this.posterior ? 1 : 0) + 1, h = rows * row;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.height = h + "px"; }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#fffaf8"; g.fillRect(0, 0, w, h);
    for (let x = 0, i = 0; x <= w + 0.5; x += mm, i++) { g.strokeStyle = i % 5 === 0 ? "rgba(214,90,80,.5)" : "rgba(214,90,80,.16)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0, i = 0; y <= h + 0.5; y += mm, i++) { g.strokeStyle = i % 5 === 0 ? "rgba(214,90,80,.5)" : "rgba(214,90,80,.16)"; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }

    // Panels: three rows of four 2.5 s columns, the posterior row, and the 10 s rhythm strip.
    const cw = w / 4, seg = N / 4;
    this.panels = [];
    GRID.forEach((r, ri) => r.forEach((lead, ci) => this.panels.push({ lead, x: ci * cw, y: ri * row, w: cw, h: row, from: ci * seg, to: (ci + 1) * seg })));
    if (this.posterior) POSTERIOR.forEach((lead, ci) => this.panels.push({ lead, x: ci * cw, y: 3 * row, w: cw, h: row, from: ci * seg, to: (ci + 1) * seg }));
    this.panels.push({ lead: this.rhythmLead, x: 0, y: (rows - 1) * row, w, h: row, from: 0, to: N });

    const pxMv = mm * this.gain, cur = this.idx % N, gap = FS * 0.12, cal = 7 * mm;
    for (const p of this.panels) {
      const mid = p.y + p.h / 2, sel = this.selected === p.lead;
      if (sel) { g.fillStyle = "rgba(184,55,46,.07)"; g.fillRect(p.x, p.y, p.w, p.h); }
      const startX = p.x === 0 ? cal : 0;
      g.strokeStyle = sel ? "#8a1d16" : "#141414"; g.lineWidth = sel ? 1.6 : 1.25; g.lineJoin = "round"; g.beginPath();
      let pen = false;
      const n = p.to - p.from, step = Math.max(1, Math.floor(n / (p.w * 2)));
      for (let k = 0; k < n; k += step) {
        const i = p.from + k, v = this.ring[p.lead][i], x = p.x + (k / n) * p.w;
        if (Number.isNaN(v) || x < p.x + startX || (i - cur + N) % N < gap) { pen = false; continue; }
        const y = mid - v * pxMv;
        if (!pen) { g.moveTo(x, y); pen = true; } else g.lineTo(x, y);
      }
      g.stroke();
      g.font = `600 12px ${SANS}`; g.fillStyle = sel ? "#8a1d16" : "#1a1a1a";
      g.fillText(p.lead + (p.to - p.from === N ? "  rhythm" : ""), p.x + startX + 5, p.y + 14);
      if (p.x > 0) { g.strokeStyle = "rgba(20,20,20,.55)"; g.lineWidth = 1; g.beginPath(); g.moveTo(p.x, mid - 4 * mm); g.lineTo(p.x, mid + 4 * mm); g.stroke(); }
    }
    // Calibration pulse (1 mV, 0.2 s) on every row.
    g.strokeStyle = "#141414"; g.lineWidth = 1.25;
    for (let r = 0; r < rows; r++) {
      const mid = r * row + row / 2;
      g.beginPath(); g.moveTo(1, mid); g.lineTo(1 + mm, mid); g.lineTo(1 + mm, mid - pxMv); g.lineTo(1 + 6 * mm, mid - pxMv); g.lineTo(1 + 6 * mm, mid); g.lineTo(cal, mid); g.stroke();
    }
    g.fillStyle = "rgba(20,20,20,.6)"; g.font = `11px ${SANS}`;
    g.fillText(`25 mm/s · ${this.gain} mm/mV`, w - 128, h - 6);
  }
}
