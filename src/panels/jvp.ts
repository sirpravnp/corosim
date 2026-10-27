/**
 * The "JVP" panel: the last beat's right-atrial waveform with a, c, x, v and y labelled, the height in cm above the sternal
 * angle, the classification in words, and a neck whose venous column rises and falls with the RA pressure in time. Draws only;
 * the analysis is src/physics/jvp.ts. The column replays the last completed beat at the source's clock.
 */
import { analyzeJvp, jvpHeightCm, jvpWords, type JvpResult } from "../physics/jvp";
import type { BeatSummary, HemoSource } from "../sim/hemoSource";
import { recentHemodynamicBeats, SETTLE_BEATS } from "../sim/hemoBeats";
import { DASH, fmt } from "./numbers";
import type { Panel, PanelDef } from "./panel";

const FONT = "11px ui-monospace, Menlo, monospace";
const SVG_NS = "http://www.w3.org/2000/svg";
/** Neck drawing: cm above the sternal angle that fit, and pixels per cm in the 120x220 viewBox. */
const CM_TOP = 16, PX_PER_CM = 8, Y_ANGLE = 150;
/** RA pressure at a time within the beat (linear), wrapping at the beat's end. */
export function pressureAt(beat: Pick<BeatSummary, "time" | "rr"> & { ra: ArrayLike<number> }, phase: number): number {
  const { time, ra, rr } = beat, n = Math.min(time.length, ra.length);
  if (n < 2) return NaN;
  const ph = ((phase % rr) + rr) % rr;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (time[m] <= ph) lo = m; else hi = m; }
  const span = time[hi] - time[lo];
  return span > 0 ? ra[lo] + ((ra[hi] - ra[lo]) * Math.min(1, Math.max(0, (ph - time[lo]) / span))) : ra[lo];
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export const jvpPanel: PanelDef = {
  id: "jvp",
  title: "JVP",
  defaultOn: true,
  create(): Panel {
    let src: HemoSource;
    let height: HTMLElement, words: HTMLElement, note: HTMLElement, canvas: HTMLCanvasElement;
    let column: SVGRectElement, tip: SVGCircleElement, level: SVGTextElement;
    let key = "";
    let cached: { beat: BeatSummary; res: JvpResult } | null = null;

    const analyze = (): { beat: BeatSummary; res: JvpResult } | null => {
      const bs = recentHemodynamicBeats(src.beats(4 + SETTLE_BEATS)).beats, beat = bs[bs.length - 1]; // the latest steady beat: a premature or cut-short one has a distorted a/v pattern
      if (!beat) return null;
      if (cached?.beat === beat) return cached;
      const res = analyzeJvp({ p: beat.pressure.RA, t: beat.time, atrial: beat.atrial, rr: beat.rr });
      cached = res.v ? { beat, res } : null;
      return cached;
    };

    const yOf = (cm: number) => Y_ANGLE - cm * PX_PER_CM;

    function drawWave(beat: BeatSummary | null, res: JvpResult | null, phase: number) {
      const dpr = window.devicePixelRatio || 1, W = Math.max(200, canvas.clientWidth || canvas.width), H = Math.round(W * 0.45);
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      const g = canvas.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, W, H);
      g.font = FONT; g.fillStyle = "#8a8a80";
      if (!beat || !res) { g.textAlign = "center"; g.fillText("waiting for first solve", W / 2, H / 2); g.textAlign = "start"; return; }
      const ra = beat.pressure.RA, tm = beat.time;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < ra.length; i++) { lo = Math.min(lo, ra[i]); hi = Math.max(hi, ra[i]); }
      lo = Math.min(0, Math.floor(lo)); hi = Math.max(lo + 6, Math.ceil(hi + 1));
      const L = 30, R = W - 10, T = 22, B = H - 20;
      const x = (t: number) => L + (t / beat.rr) * (R - L), y = (p: number) => B - ((p - lo) / (hi - lo)) * (B - T);
      g.strokeStyle = "#232323"; g.lineWidth = 1;
      const step = hi - lo > 20 ? 10 : hi - lo > 10 ? 5 : 2;
      for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) { g.beginPath(); g.moveTo(L, y(p)); g.lineTo(R, y(p)); g.stroke(); g.fillText(String(p), 6, y(p) + 4); }
      g.fillText("RA · mmHg", L, 12);
      // ventricular event (t = 0) and atrial activations
      g.strokeStyle = "#444"; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x(0), T); g.lineTo(x(0), B); g.stroke();
      g.strokeStyle = "#3b5b73";
      for (const ta of beat.atrial) { g.beginPath(); g.moveTo(x(ta), T); g.lineTo(x(ta), B); g.stroke(); }
      g.setLineDash([]);
      g.strokeStyle = "#4fc3f7"; g.lineWidth = 2; g.beginPath();
      for (let i = 0; i < ra.length; i++) { const px = x(tm[i]), py = y(ra[i]); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
      g.stroke();
      // meanRA line
      g.strokeStyle = "#8a8a80"; g.lineWidth = 1; g.setLineDash([2, 4]);
      g.beginPath(); g.moveTo(L, y(res.meanRA)); g.lineTo(R, y(res.meanRA)); g.stroke(); g.setLineDash([]);
      // labelled waves
      g.fillStyle = "#e8e8e0"; g.textAlign = "center";
      const mark = (label: string, pt: { t: number; p: number } | null, above: boolean) => {
        if (!pt) return;
        g.beginPath(); g.arc(x(pt.t), y(pt.p), 3, 0, Math.PI * 2); g.fill();
        g.fillText(label, x(pt.t), y(pt.p) + (above ? -7 : 14));
      };
      for (const w of res.aWaves) mark(w.cannon ? "a (cannon)" : "a", w, true);
      mark("c", res.c, true); mark("x", res.x, false); mark("v", res.v, true); mark("y", res.y, false);
      g.textAlign = "start";
      // moving cursor: where the neck is now
      g.strokeStyle = "#f2c14e"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x(phase), T); g.lineTo(x(phase), B); g.stroke();
    }

    return {
      id: "jvp",
      title: "JVP",
      mount(el, source) {
        src = source;
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:14px;align-items:stretch;flex-wrap:wrap";
        // neck illustration
        const svg = svgEl("svg", { viewBox: "0 0 120 220", width: 110, height: 200, role: "img", "aria-label": "Neck with the jugular venous column pulsing" });
        svg.style.cssText = "flex:none;color:var(--muted)";
        svg.append(
          svgEl("path", { d: "M34 6 C36 70 30 120 14 166 L14 214 L106 214 L106 166 C90 120 84 70 86 6", fill: "none", stroke: "currentColor", "stroke-width": 1.5, opacity: 0.7 }),
          svgEl("path", { d: "M14 166 C40 176 80 176 106 166", fill: "none", stroke: "currentColor", "stroke-width": 1, opacity: 0.5 }), // clavicles
          svgEl("rect", { x: 60, y: yOf(CM_TOP), width: 12, height: 214 - yOf(CM_TOP), rx: 5, fill: "none", stroke: "currentColor", "stroke-width": 1, opacity: 0.5 }), // jugular vein
        );
        column = svgEl("rect", { x: 61.5, y: Y_ANGLE, width: 9, height: 60, fill: "#c0392b" });
        tip = svgEl("circle", { cx: 66, cy: Y_ANGLE, r: 4.5, fill: "#e4584a" });
        svg.append(column, tip);
        const angle = svgEl("line", { x1: 40, x2: 100, y1: Y_ANGLE, y2: Y_ANGLE, stroke: "#f2c14e", "stroke-width": 1, "stroke-dasharray": "3 3" });
        const angleLabel = svgEl("text", { x: 100, y: Y_ANGLE - 4, "text-anchor": "end", fill: "#f2c14e", "font-size": 9 });
        angleLabel.textContent = "sternal angle";
        level = svgEl("text", { x: 82, y: Y_ANGLE, fill: "currentColor", "font-size": 10 });
        for (const cm of [5, 10, 15]) {
          const tk = svgEl("text", { x: 46, y: yOf(cm) + 3, "text-anchor": "end", fill: "currentColor", "font-size": 8 });
          tk.textContent = `${cm}`;
          svg.append(svgEl("line", { x1: 48, x2: 54, y1: yOf(cm), y2: yOf(cm), stroke: "currentColor" }), tk);
        }
        svg.append(angle, angleLabel, level);
        const info = document.createElement("div");
        info.style.cssText = "flex:1;min-width:150px";
        height = document.createElement("div");
        height.style.cssText = "font:600 26px/1.1 var(--font-data, ui-monospace, monospace)";
        words = document.createElement("p");
        words.style.cssText = "margin:6px 0 0;font-size:14px";
        const sub = document.createElement("p");
        sub.className = "note";
        sub.textContent = "cm above the sternal angle, patient at 45°: mean RA × 1.36 − 5";
        info.append(height, sub, words);
        row.append(svg, info);
        canvas = document.createElement("canvas");
        canvas.style.cssText = "display:block;width:100%;border-radius:4px;margin-top:8px";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", "Right atrial pressure with a, c, x, v and y labelled");
        note = document.createElement("p");
        note.className = "note";
        note.hidden = true;
        el.append(row, canvas, note);
      },
      setSource(s) { src = s; cached = null; key = ""; },
      draw(now) {
        const got = analyze();
        const label = got ? `${fmt(got.res.heightCm, 1)} cm` : DASH;
        const text = got ? jvpWords(got.res.classes) : "waiting for first solve";
        if (label + text !== key) {
          key = label + text;
          height.textContent = label; words.textContent = text;
          note.textContent = ""; note.hidden = true;
        }
        let phase = 0;
        if (got) {
          const { beat } = got;
          phase = (((now - beat.t) % beat.rr) + beat.rr) % beat.rr;
          const p = pressureAt({ time: beat.time, ra: beat.pressure.RA, rr: beat.rr }, phase);
          const cm = Math.max(-6, Math.min(CM_TOP, jvpHeightCm(p)));
          const top = yOf(cm);
          column.setAttribute("y", String(top)); column.setAttribute("height", String(Math.max(0, 214 - top)));
          tip.setAttribute("cy", String(top));
          level.setAttribute("y", String(Math.min(top - 8, Y_ANGLE - 8)));
          level.textContent = `${jvpHeightCm(p).toFixed(1)}`;
        }
        drawWave(got?.beat ?? null, got?.res ?? null, phase);
      },
      resize() { /* the canvas is sized from its CSS width on each draw */ },
      dispose() { canvas?.remove(); },
    };
  },
};
