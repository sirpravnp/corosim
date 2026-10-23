/**
 * The "Pressures" panel: left-heart (aorta, LV, LA) and right-heart (PA, RV, RA) pressure traces scrolling live, drawn
 * with the structural page's colours and labels. Reads only `source.trace`. Maths in ./traceMath.
 */
import { LEFT, RIGHT, type Trace } from "../structural/traces";
import type { HemoSource, Series } from "../sim/hemoSource";
import type { Panel, PanelDef } from "./panel";
import { DEFAULT_WINDOW, WINDOWS, axisBottom, dataRange, gridStep, isWaiting, legendText, legendValues, nextTop, pickMaxPoints } from "./traceMath";

const ASPECT = 0.4;
const FONT = "12px ui-monospace, Menlo, monospace";

interface Band { canvas: HTMLCanvasElement; traces: Trace[]; title: string; top?: number }

function drawBand(b: Band, source: HemoSource, now: number, seconds: number): void {
  const c = b.canvas;
  const dpr = window.devicePixelRatio || 1, W = Math.max(200, c.clientWidth || c.width), H = Math.round(W * ASPECT);
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const series: Series[] = b.traces.map(t => source.trace(t.node, seconds, { maxPoints: pickMaxPoints(W) }));
  const L = 36, R = W - 10, T = 42, B = H - 20;
  g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, W, H);
  g.font = FONT; g.textBaseline = "alphabetic";
  const waiting = isWaiting(series);
  const { min, max } = dataRange(series);
  const top = (b.top = nextTop(b.top, max)), bottom = axisBottom(min);
  const x = (t: number) => L + ((t - (now - seconds)) / seconds) * (R - L);
  const y = (p: number) => B - ((p - bottom) / (top - bottom)) * (B - T);
  g.strokeStyle = "#232323"; g.lineWidth = 1; g.fillStyle = "#8a8a80";
  const step = gridStep(top);
  for (let p = Math.ceil(bottom / step) * step; p <= top; p += step) { g.beginPath(); g.moveTo(L, y(p)); g.lineTo(R, y(p)); g.stroke(); g.fillText(String(p), 8, y(p) + 4); }
  g.fillText(`${b.title} · mmHg`, L, 16);
  g.fillText(`${seconds} s`, R - 30, H - 5);
  // legend on its own row: colour key, label and current systolic/diastolic (mean)
  let lx = 8;
  g.font = "11px ui-monospace, Menlo, monospace";
  for (let i = 0; i < b.traces.length; i++) {
    const tr = b.traces[i], text = `${tr.label} ${waiting ? "–" : legendText(legendValues(series[i]))}`;
    g.fillStyle = tr.color; g.fillRect(lx, 29, 8, 3); g.fillText(text, lx + 11, 33);
    lx += g.measureText(text).width + 22;
  }
  g.font = FONT;
  if (waiting) {
    g.fillStyle = "#8a8a80"; g.textAlign = "center";
    g.fillText("waiting for first solve", (L + R) / 2, (T + B) / 2); g.textAlign = "start";
    return;
  }
  g.save(); g.beginPath(); g.rect(L, T - 4, R - L, B - T + 8); g.clip();
  b.traces.forEach((tr, k) => {
    const s = series[k];
    g.strokeStyle = tr.color; g.lineWidth = tr.node === "LV" || tr.node === "RV" ? 1.6 : 2.2; g.beginPath();
    let pen = false;
    for (let i = 0; i < s.t.length; i++) {
      if (!Number.isFinite(s.v[i]) || (i > 0 && s.t[i] < s.t[i - 1])) pen = false; // gap, or the clock stepped back
      if (!Number.isFinite(s.v[i])) continue;
      if (pen) g.lineTo(x(s.t[i]), y(s.v[i])); else { g.moveTo(x(s.t[i]), y(s.v[i])); pen = true; }
    }
    g.stroke();
  });
  g.restore();
}

export const tracesPanel: PanelDef = {
  id: "traces",
  title: "Pressures",
  defaultOn: true,
  create(): Panel {
    let src: HemoSource;
    let bands: Band[] = [];
    let seconds = DEFAULT_WINDOW;
    return {
      id: "traces",
      title: "Pressures",
      mount(el, source) {
        src = source;
        const bar = document.createElement("div");
        bar.className = "hp-seg";
        bar.setAttribute("role", "group");
        bar.setAttribute("aria-label", "Time window");
        const btns = WINDOWS.map(w => {
          const b = document.createElement("button");
          b.type = "button"; b.textContent = `${w} s`; b.setAttribute("aria-pressed", String(w === seconds));
          b.addEventListener("click", () => {
            seconds = w;
            btns.forEach(o => o.setAttribute("aria-pressed", String(o === b)));
          });
          return b;
        });
        bar.append(...btns);
        const mk = (traces: Trace[], title: string): Band => {
          const canvas = document.createElement("canvas");
          canvas.style.cssText = "display:block;width:100%;border-radius:4px;margin-top:6px";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `${title} pressure traces`);
          el.append(canvas);
          return { canvas, traces, title };
        };
        el.append(bar);
        bands = [mk(LEFT, "Left heart"), mk(RIGHT, "Right heart")];
      },
      setSource(s) { src = s; for (const b of bands) b.top = undefined; },
      draw(now) { for (const b of bands) drawBand(b, src, now, seconds); },
      dispose() { for (const b of bands) b.canvas.remove(); bands = []; },
    };
  },
};
