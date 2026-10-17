import { BeatRecord } from "./sim/metrics";

const SANS = "-apple-system, Helvetica, Arial, sans-serif";
const N = 90; // beats shown

/**
 * Beat-by-beat trace: systolic and diastolic pressure of each beat (top) and the R–R interval that led to it
 * (bottom). Premature beats are marked. Plotted against beat number, so respiratory sinus arrhythmia and
 * the slower baroreflex oscillation show up as the pattern in these two lines.
 */
export function drawBeatTrace(c: HTMLCanvasElement, history: BeatRecord[]) {
  const dpr = devicePixelRatio || 1, w = c.clientWidth, h = 210;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.height = h + "px"; }
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#fffaf8"; g.fillRect(0, 0, w, h);
  const beats = history.slice(-N), L = 44, R = 8, T = 8, gap = 18;
  const ph = (h - T - gap - 22) / 2;
  const xAt = (i: number) => L + (i / (N - 1)) * (w - L - R);
  const panel = (y0: number, series: number[][], lo: number, hi: number, unit: string, colors: string[], pvc?: boolean[]) => {
    g.strokeStyle = "rgba(214,90,80,.22)"; g.fillStyle = "#555"; g.font = `11px ${SANS}`; g.lineWidth = 1;
    const step = niceStep((hi - lo) / 4);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = y0 + ph - ((v - lo) / (hi - lo)) * ph;
      g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke(); g.fillText(String(Math.round(v)), 4, y + 4);
    }
    g.fillText(unit, L + 4, y0 + 11);
    series.forEach((vals, k) => {
      g.strokeStyle = colors[k]; g.lineWidth = 1.5; g.beginPath();
      vals.forEach((v, i) => { const y = y0 + ph - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * ph; i ? g.lineTo(xAt(i), y) : g.moveTo(xAt(i), y); });
      g.stroke();
    });
    pvc?.forEach((p, i) => { if (!p) return; g.fillStyle = "#c0392b"; g.beginPath(); g.arc(xAt(i), y0 + ph - 3, 3, 0, 7); g.fill(); });
  };
  if (beats.length < 3) { g.fillStyle = "#777"; g.font = `12px ${SANS}`; g.fillText("Waiting for beats…", L, h / 2); return; }
  const sbp = beats.map((b) => b.sbp), dbp = beats.map((b) => b.dbp), rr = beats.map((b) => b.interval * 1000);
  const pLo = Math.floor((Math.min(...dbp) - 8) / 10) * 10, pHi = Math.ceil((Math.max(...sbp) + 8) / 10) * 10;
  const rLo = Math.floor((Math.min(...rr) - 40) / 100) * 100, rHi = Math.ceil((Math.max(...rr) + 40) / 100) * 100;
  panel(T, [sbp, dbp], pLo, pHi, "mmHg (systolic, diastolic)", ["#141414", "#8a8a8a"]);
  panel(T + ph + gap, [rr], rLo, rHi, "R–R interval, ms (dots = premature beats)", ["#c0392b"], beats.map((b) => b.pvc));
  g.fillStyle = "#555"; g.font = `11px ${SANS}`; g.fillText(`last ${beats.length} beats`, w - 90, h - 6);
}
const niceStep = (x: number) => { const p = 10 ** Math.floor(Math.log10(x)); const f = x / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; };
