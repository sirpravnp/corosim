/**
 * The "Pressures" panel: left-heart (aorta, LV, LA) and right-heart (PA, RV, RA) pressure traces scrolling live, drawn
 * with the structural page's colours and labels. Reads only `source.trace`. Maths in ./traceMath.
 */
import { LEFT, RIGHT, type Trace } from "../structural/traces";
import type { HemoSource, Series } from "../sim/hemoSource";
import type { Panel, PanelDef } from "./panel";
import { snapshots } from "./snapshots";
import { DEFAULT_WINDOW, REVIEW_SECONDS, WINDOWS, axisBottom, dataRange, gridStep, isWaiting, legendText, legendValues, maxScrub, nextTop, pickMaxPoints, windowSeries } from "./traceMath";

const ASPECT = 0.4;
const FONT = "12px ui-monospace, Menlo, monospace";

interface Band { canvas: HTMLCanvasElement; traces: Trace[]; title: string; top?: number }

/** A paused review: one long copy of each node's trace, and how far back the window ends from the moment of the pause. */
interface Review { at: number; kept: Map<string, Series>; back: number }

function drawBand(b: Band, source: HemoSource, nowLive: number, seconds: number, review: Review | null): void {
  const now = review ? review.at - review.back : nowLive;
  const c = b.canvas;
  const dpr = window.devicePixelRatio || 1, W = Math.max(200, c.clientWidth || c.width), H = Math.round(W * ASPECT);
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const series: Series[] = b.traces.map(t => review
    ? windowSeries(review.kept.get(t.node) ?? { t: new Float32Array(0), v: new Float32Array(0) }, now - seconds, now, pickMaxPoints(W))
    : source.trace(t.node, seconds, { maxPoints: pickMaxPoints(W) }));
  const L = 36, R = W - 10, T = 42, B = H - 20;
  g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, W, H);
  g.font = FONT; g.textBaseline = "alphabetic";
  const waiting = isWaiting(series);
  // The selected snapshot's last seconds, pinned to the right edge (its saved moment is "now"), drawn dashed behind live data.
  const snap = snapshots.selected();
  const ghosts: (Series | undefined)[] = snap ? b.traces.map(t => snap.traces[t.node]) : [];
  const { min, max } = dataRange([...series, ...ghosts.filter((s): s is Series => !!s)]);
  const top = (b.top = nextTop(b.top, max)), bottom = axisBottom(min);
  const x = (t: number) => L + ((t - (now - seconds)) / seconds) * (R - L);
  const y = (p: number) => B - ((p - bottom) / (top - bottom)) * (B - T);
  g.strokeStyle = "#232323"; g.lineWidth = 1; g.fillStyle = "#8a8a80";
  const step = gridStep(top);
  for (let p = Math.ceil(bottom / step) * step; p <= top; p += step) { g.beginPath(); g.moveTo(L, y(p)); g.lineTo(R, y(p)); g.stroke(); g.fillText(String(p), 8, y(p) + 4); }
  g.fillText(`${b.title} · mmHg`, L, 16);
  g.fillText(review ? `${seconds} s, ${review.back > 0.05 ? `${review.back.toFixed(1)} s back` : "paused"}` : `${seconds} s`, review ? R - 118 : R - 30, H - 5);
  // legend on its own row: colour key, label and current systolic/diastolic (mean)
  let lx = 8;
  g.font = "11px ui-monospace, Menlo, monospace";
  for (let i = 0; i < b.traces.length; i++) {
    const tr = b.traces[i], text = `${tr.label} ${waiting ? "–" : legendText(legendValues(series[i]))}`;
    g.fillStyle = tr.color; g.fillRect(lx, 29, 8, 3); g.fillText(text, lx + 11, 33);
    lx += g.measureText(text).width + 22;
  }
  if (snap) { g.fillStyle = "#8a8a80"; g.fillText(`- - ${snap.label}`, R - 120, 16); }
  g.font = FONT;
  if (waiting) {
    g.fillStyle = "#8a8a80"; g.textAlign = "center";
    g.fillText("waiting for first solve", (L + R) / 2, (T + B) / 2); g.textAlign = "start";
    return;
  }
  g.save(); g.beginPath(); g.rect(L, T - 4, R - L, B - T + 8); g.clip();
  if (snap) {
    g.setLineDash([5, 4]); g.lineWidth = 1.6; g.globalAlpha = 0.65;
    b.traces.forEach((tr, k) => {
      const s = ghosts[k];
      if (!s) return;
      g.strokeStyle = tr.color; g.beginPath();
      let pen = false;
      for (let i = 0; i < s.t.length; i++) {
        if (!Number.isFinite(s.v[i])) { pen = false; continue; }
        const px = x(s.t[i] + (now - snap.t));
        if (pen) g.lineTo(px, y(s.v[i])); else { g.moveTo(px, y(s.v[i])); pen = true; }
      }
      g.stroke();
    });
    g.setLineDash([]); g.globalAlpha = 1;
  }
  b.traces.forEach((tr, k) => {
    const s = series[k];
    g.strokeStyle = tr.color; g.lineWidth = tr.node === "LV" || tr.node === "RV" ? 1.6 : 2.2; g.beginPath();
    let pen = false;
    for (let i = 0; i < s.t.length; i++) {
      if (!Number.isFinite(s.v[i]) || (i > 0 && s.t[i] < s.t[i - 1])) pen = false; // gap, or the clock stepped back: harmless defence
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
    let review: Review | null = null;
    let lastNow = NaN, stalled = 0, auto = false, manualLive = false;
    let pauseBtn: HTMLButtonElement, scrub: HTMLInputElement, scrubLabel: HTMLElement;
    const syncScrub = () => {
      const max = review ? maxScrub(REVIEW_SECONDS, seconds) : 0;
      scrub.max = String(max);
      if (review) review.back = Math.min(review.back, max);
      scrub.value = String(review ? review.back : 0);
      scrub.hidden = scrubLabel.hidden = !review;
      scrubLabel.textContent = review ? (review.back > 0.05 ? `${review.back.toFixed(1)} s back` : "paused") : "";
      pauseBtn.textContent = review ? "Live" : "Review";
      pauseBtn.setAttribute("aria-pressed", String(!!review));
    };
    const pause = () => {
      if (!Number.isFinite(lastNow)) return;
      const kept = new Map<string, Series>();
      for (const b of bands) for (const t of b.traces) kept.set(t.node, src.trace(t.node, REVIEW_SECONDS, { maxPoints: 40000 }));
      review = { at: lastNow, kept, back: 0 };
    };
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
            syncScrub();
          });
          return b;
        });
        bar.append(...btns);
        pauseBtn = document.createElement("button");
        pauseBtn.type = "button"; pauseBtn.title = "Freeze the traces to review them (the simulation keeps running); drag the slider to go back up to a minute. Pausing the simulation does this too.";
        pauseBtn.style.cssText = "width:auto;padding:2px 10px;font:600 11px/1.4 var(--font-data)";
        pauseBtn.addEventListener("click", () => { if (review) { review = null; auto = false; manualLive = true; } else pause(); syncScrub(); });
        scrub = document.createElement("input");
        scrub.type = "range"; scrub.min = "0"; scrub.step = "0.1"; scrub.value = "0"; scrub.hidden = true;
        scrub.setAttribute("aria-label", "Scrub back in time");
        scrub.style.cssText = "flex:1 1 140px;min-width:100px;direction:rtl"; // right end = now, dragging left goes back
        scrub.addEventListener("input", () => { if (review) { review.back = Number(scrub.value); syncScrub(); } });
        scrubLabel = document.createElement("span");
        scrubLabel.className = "note"; scrubLabel.hidden = true;
        const row = document.createElement("div");
        row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center";
        row.append(bar, pauseBtn, scrub, scrubLabel);
        const mk = (traces: Trace[], title: string): Band => {
          const canvas = document.createElement("canvas");
          canvas.style.cssText = "display:block;width:100%;border-radius:4px;margin-top:6px";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `${title} pressure traces`);
          el.append(canvas);
          return { canvas, traces, title };
        };
        el.append(row);
        bands = [mk(LEFT, "Left heart"), mk(RIGHT, "Right heart")];
        syncScrub();
      },
      setSource(s) { src = s; review = null; auto = false; syncScrub(); for (const b of bands) b.top = undefined; },
      draw(now) {
        // The simulation's own Pause stops the clock: the traces then go into review by themselves, and back to live when it runs again.
        stalled = now === lastNow ? stalled + 1 : 0;
        if (now !== lastNow) manualLive = false;
        if (stalled >= 5 && !review && !manualLive) { pause(); auto = !!review; syncScrub(); }
        else if (review && auto && now > review.at + 1e-6) { review = null; auto = false; syncScrub(); }
        lastNow = now; for (const b of bands) drawBand(b, src, now, seconds, review); },
      dispose() { for (const b of bands) b.canvas.remove(); bands = []; },
    };
  },
};
