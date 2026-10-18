import { NodeName, Waveform } from "../physics/structural";

/**
 * Drawing for the structural page: pressure traces for one side of the heart, and a pressure-volume loop. Pure drawing;
 * every number comes from the engine's waveform of the last beat.
 */
export interface Trace { node: NodeName; label: string; color: string }
export const LEFT: Trace[] = [{ node: "AO", label: "Aorta", color: "#ff6b5b" }, { node: "LV", label: "LV", color: "#f4f1ea" }, { node: "LA", label: "LA", color: "#6aa7ff" }];
export const RIGHT: Trace[] = [{ node: "PA", label: "PA", color: "#ffb36a" }, { node: "RV", label: "RV", color: "#f4f1ea" }, { node: "RA", label: "RA", color: "#6aa7ff" }];

/** Size the canvas' backing store to its on-screen width and the device's pixel ratio, and return a context in CSS pixels. */
function prepare(canvas: HTMLCanvasElement, aspect: number) {
  const dpr = window.devicePixelRatio || 1, W = Math.max(200, canvas.clientWidth || canvas.width), H = Math.round(W * aspect);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = canvas.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, W, H };
}
export function clearCanvas(canvas: HTMLCanvasElement) { const g = canvas.getContext("2d")!; g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, canvas.width, canvas.height); }
const finite = (a: number[]) => a.filter(Number.isFinite);
const niceMax = (v: number) => { const steps = [10, 20, 30, 40, 60, 80, 100, 120, 150, 200, 250]; return steps.find((s) => s >= v) ?? Math.ceil(v / 50) * 50; };

export function drawTraces(canvas: HTMLCanvasElement, w: Waveform, traces: Trace[], title: string) {
  const { g, W, H } = prepare(canvas, 250 / 720);
  const L = 44, R = W - 14, T = 26, B = H - 22;
  g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, W, H);
  g.font = "12px ui-monospace, Menlo, monospace"; g.textBaseline = "alphabetic";
  const all = finite(traces.flatMap((t) => w.p[t.node])), top = niceMax(Math.max(1, ...all)), bottom = Math.min(0, ...all);
  const T1 = w.t[w.t.length - 1] || 1;
  const x = (t: number) => L + (t / T1) * (R - L), y = (p: number) => B - ((p - bottom) / (top - bottom)) * (B - T);
  g.strokeStyle = "#232323"; g.lineWidth = 1; g.fillStyle = "#8a8a80";
  const step = top > 100 ? 40 : top > 40 ? 20 : 10;
  for (let p = Math.ceil(bottom / step) * step; p <= top; p += step) { g.beginPath(); g.moveTo(L, y(p)); g.lineTo(R, y(p)); g.stroke(); g.fillText(String(p), 8, y(p) + 4); }
  g.fillText(`${title} · mmHg`, L, 16);
  g.fillText(`${(T1 * 1000).toFixed(0)} ms`, R - 54, H - 6);
  let lx = R - 4;
  for (const tr of [...traces].reverse()) {
    const wd = g.measureText(tr.label).width; lx -= wd + 18;
    g.fillStyle = tr.color; g.fillRect(lx, 8, 10, 3); g.fillText(tr.label, lx + 14, 16);
  }
  for (const tr of traces) {
    g.strokeStyle = tr.color; g.lineWidth = tr.node === "LV" || tr.node === "RV" ? 1.6 : 2.2; g.beginPath();
    const p = w.p[tr.node];
    p.forEach((v, i) => (i ? g.lineTo(x(w.t[i]), y(v)) : g.moveTo(x(w.t[i]), y(v))));
    g.stroke();
  }
}

export function drawLoop(canvas: HTMLCanvasElement, v: number[], p: number[], title: string, color: string) {
  const { g, W, H } = prepare(canvas, 260 / 320);
  const L = 42, R = W - 12, T = 26, B = H - 28;
  g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, W, H);
  g.font = "12px ui-monospace, Menlo, monospace";
  const vmax = Math.max(...finite(v)), vmin = Math.min(...finite(v)), span = Math.max(1e-6, vmax - vmin);
  const lo = Math.max(0, vmin - 0.25 * span), hi = vmax + 0.15 * span, top = niceMax(Math.max(1, ...finite(p)));
  const x = (a: number) => L + ((a - lo) / (hi - lo)) * (R - L), y = (q: number) => B - (q / top) * (B - T);
  g.strokeStyle = "#232323"; g.fillStyle = "#8a8a80";
  const step = top > 100 ? 40 : top > 40 ? 20 : 10;
  for (let q = 0; q <= top; q += step) { g.beginPath(); g.moveTo(L, y(q)); g.lineTo(R, y(q)); g.stroke(); g.fillText(String(q), 6, y(q) + 4); }
  g.fillText(`${title} · mmHg / ml`, L, 16);
  g.fillText(`${vmin.toFixed(1)}–${vmax.toFixed(1)} ml`, L, H - 8);
  g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
  v.forEach((a, i) => (i ? g.lineTo(x(a), y(p[i])) : g.moveTo(x(a), y(p[i]))));
  g.closePath(); g.stroke();
}
