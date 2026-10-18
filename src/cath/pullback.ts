import { WireModel } from "../sim/cath";
import { WIRE } from "../config/cath";

const AXIS = { lo: 0.2, hi: 1.05 }; // Pd/Pa range drawn

/**
 * The pressure-wire strip: Pd/Pa along the vessel at adenosine hyperemia (solid) and at rest (dashed), the 0.80 line,
 * a vessel-diameter band, and a marker for the wire at `position`. Pure drawing; the numbers come from `wireModel`.
 */
export function drawPullback(canvas: HTMLCanvasElement, w: WireModel, position: number, label: string) {
  const g = canvas.getContext("2d")!, W = canvas.width, H = canvas.height;
  const L = 44, R = W - 12, T = 26, B = H - 84, BAND = H - 54, BANDH = 26; // plot area and the diameter band under it
  const x = (mm: number) => L + (mm / w.length) * (R - L), y = (r: number) => B - ((Math.min(AXIS.hi, Math.max(AXIS.lo, r)) - AXIS.lo) / (AXIS.hi - AXIS.lo)) * (B - T);
  g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, W, H);
  g.font = "12px ui-monospace, Menlo, monospace"; g.textBaseline = "alphabetic";
  g.strokeStyle = "#2a2a2a"; g.lineWidth = 1; g.fillStyle = "#8a8a80";
  for (const f of [0.4, 0.6, 0.8, 1]) { g.beginPath(); g.moveTo(L, y(f)); g.lineTo(R, y(f)); g.stroke(); g.fillText(f.toFixed(1), 8, y(f) + 4); }
  g.strokeStyle = "#7a5"; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(L, y(WIRE.ffrCutoff)); g.lineTo(R, y(WIRE.ffrCutoff)); g.stroke(); g.setLineDash([]);
  g.fillStyle = "#7a5"; g.fillText("0.80", R - 34, y(WIRE.ffrCutoff) - 4);
  g.fillStyle = "#8a8a80"; g.fillText(`Pd / Pa · ${label}`, L, 16);
  g.fillText("ostium", L, H - 8); g.fillText("distal", R - 40, H - 8);

  const reach = w.blockedFrom ?? w.length; // the wire stops at an occlusion
  const trace = (r: number[], color: string, width: number, dash: number[]) => {
    g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash); g.beginPath();
    let started = false;
    for (let i = 0; i < w.s.length; i++) { if (w.s[i] > reach) break; const px = x(w.s[i]), py = y(r[i]); if (started) g.lineTo(px, py); else { g.moveTo(px, py); started = true; } }
    g.stroke(); g.setLineDash([]);
  };
  trace(w.restRatio, "#9aa3c0", 1.6, [4, 4]);
  trace(w.hyperRatio, "#ff6b5b", 2.6, []);

  // diameter band
  const dmax = Math.max(...w.diameterMm);
  g.fillStyle = "#17181d"; g.fillRect(L, BAND, R - L, BANDH);
  g.fillStyle = "#c9c6bb"; g.beginPath(); g.moveTo(x(0), BAND + BANDH / 2);
  for (let i = 0; i < w.s.length; i++) g.lineTo(x(w.s[i]), BAND + BANDH / 2 - (w.diameterMm[i] / dmax) * (BANDH / 2 - 1));
  for (let i = w.s.length - 1; i >= 0; i--) g.lineTo(x(w.s[i]), BAND + BANDH / 2 + (w.diameterMm[i] / dmax) * (BANDH / 2 - 1));
  g.closePath(); g.fill();
  g.fillStyle = "#8a8a80"; g.fillText("lumen", 6, BAND + 17);

  if (w.blockedFrom !== null) {
    g.fillStyle = "#17181d"; g.fillRect(x(w.blockedFrom), BAND, R - x(w.blockedFrom), BANDH);
    g.strokeStyle = "#ff6b5b"; g.lineWidth = 2; g.beginPath(); g.moveTo(x(w.blockedFrom), T); g.lineTo(x(w.blockedFrom), BAND + BANDH); g.stroke();
    g.fillStyle = "#ff6b5b"; g.fillText("occlusion: the wire stops here", Math.min(x(w.blockedFrom) + 8, R - 190), T + 14);
  }
  // the wire
  const p = w.at(position);
  g.strokeStyle = "#ffe27a"; g.lineWidth = 1; g.beginPath(); g.moveTo(x(p.s), T); g.lineTo(x(p.s), BAND + BANDH); g.stroke();
  g.fillStyle = "#ffe27a"; g.beginPath(); g.arc(x(p.s), y(p.hyperRatio), 4.5, 0, 6.283); g.fill();
}
