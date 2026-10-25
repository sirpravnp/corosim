/** The "Left-heart cath" panel: numbers table plus two overlay plots (LV with aorta, wedge with LV in diastole). Draws only; the maths is in sim/leftHeartCath.ts. */
import { leftHeartCath, type LeftHeartCath } from "../sim/leftHeartCath";
import type { HemoSource } from "../sim/hemoSource";
import type { Panel, PanelDef } from "./panel";
import { DASH, fmt } from "./numbers";

const COLORS = { lv: "#f4f1ea", ao: "#ff6b5b", la: "#6aa7ff", gap: "rgba(255,179,106,0.35)" };

export function cathRows(c: LeftHeartCath): [string, string][] {
  const a = (x: number) => (Number.isFinite(x) ? `${x.toFixed(2)} cm²` : DASH);
  const mmHg = (x: number) => `${fmt(x)} mmHg`;
  const label = (s: string) => (s === "none" ? "no stenosis" : `${s} stenosis`);
  return [
    ["LV systolic / LVEDP", `${fmt(c.lv.systolic)} / ${fmt(c.lv.lvedp)}`],
    ["Aorta s/d (mean)", `${fmt(c.ao.systolic)}/${fmt(c.ao.diastolic)} (${fmt(c.ao.mean)})`],
    ["Peak-to-peak gradient", mmHg(c.gradient.peakToPeak)],
    ["Mean gradient (ejection)", mmHg(c.gradient.mean)],
    ["Peak instantaneous", mmHg(c.gradient.peakInstant)],
    ["Wedge − LV mean (diastole)", mmHg(c.mitral.meanGradient)],
    ["Aortic area, Gorlin", `${a(c.area.aorticGorlin)} · ${label(c.severity.aortic)}`],
    ["Aortic area, Hakki", a(c.area.aorticHakki)],
    ["Mitral area, Gorlin (37.7)", a(c.area.mitralGorlin)],
    ["Mitral area, engine (44.3)", `${a(c.area.mitralEngine)} · ${label(c.severity.mitral)}`],
    ["Mitral area, Hakki", a(c.area.mitralHakki)],
  ];
}

interface PlotSpec { a: Float32Array; b: Float32Array; ca: string; cb: string; la: string; lb: string; shade: (i: number) => boolean; cap?: number }

function plot(canvas: HTMLCanvasElement, c: LeftHeartCath, p: PlotSpec, title: string) {
  const dpr = window.devicePixelRatio || 1, W = Math.max(160, canvas.clientWidth || 300), H = Math.round(W * 0.5);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = `${H}px`; }
  const g = canvas.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, W, H);
  g.font = "11px ui-monospace, Menlo, monospace";
  const t = c.traces.t, n = t.length, T1 = t[n - 1] || 1;
  const hi = p.cap ?? Math.max(...p.a, ...p.b), lo = Math.min(0, ...p.a, ...p.b);
  const top = Math.ceil(hi / 20) * 20 || 20;
  const L = 34, R = W - 8, T = 22, B = H - 8;
  const x = (s: number) => L + (s / T1) * (R - L), y = (v: number) => B - ((v - lo) / (top - lo)) * (B - T);
  g.strokeStyle = "#232323"; g.fillStyle = "#8a8a80"; g.lineWidth = 1;
  const step = top > 100 ? 40 : top > 40 ? 20 : 10;
  for (let v = 0; v <= top; v += step) { g.beginPath(); g.moveTo(L, y(v)); g.lineTo(R, y(v)); g.stroke(); g.fillText(String(v), 4, y(v) + 4); }
  g.fillText(`${title} · mmHg`, L, 13);
  let lx = R;
  for (const [lab, col] of [[p.lb, p.cb], [p.la, p.ca]] as const) { lx -= g.measureText(lab).width + 16; g.fillStyle = col; g.fillRect(lx, 6, 10, 3); g.fillStyle = "#8a8a80"; g.fillText(lab, lx + 13, 13); }
  g.save(); g.beginPath(); g.rect(L, T - 2, R - L, B - T + 4); g.clip();
  g.fillStyle = COLORS.gap;
  for (let i = 0; i < n - 1; i++) {
    if (!p.shade(i) || Math.abs(p.a[i] - p.b[i]) < 0.01) continue;
    const x0 = x(t[i]), x1 = x(t[i + 1]);
    g.beginPath(); g.moveTo(x0, y(p.a[i])); g.lineTo(x1, y(p.a[i + 1])); g.lineTo(x1, y(p.b[i + 1])); g.lineTo(x0, y(p.b[i])); g.closePath(); g.fill();
  }
  for (const [arr, col] of [[p.b, p.cb], [p.a, p.ca]] as const) {
    g.strokeStyle = col; g.lineWidth = 1.8; g.beginPath();
    for (let i = 0; i < n; i++) (i ? g.lineTo(x(t[i]), y(arr[i])) : g.moveTo(x(t[i]), y(arr[i])));
    g.stroke();
  }
  g.restore();
}

export const leftHeartCathPanel: PanelDef = {
  id: "left-heart-cath",
  title: "Left-heart cath",
  defaultOn: true,
  create(): Panel {
    let src: HemoSource;
    let wait: HTMLElement, body: HTMLElement, tbody: HTMLElement, c1: HTMLCanvasElement, c2: HTMLCanvasElement;
    let lastBeat: unknown = null, lastKey = "", cur: LeftHeartCath | null = null;
    const drawPlots = () => {
      if (!cur) return;
      const c = cur, [e0, e1] = c.ejection, [f0, f1] = c.filling;
      plot(c1, c, { a: c.traces.lv, b: c.traces.ao, ca: COLORS.lv, cb: COLORS.ao, la: "LV", lb: "Aorta", shade: (i) => i >= e0 && i < e1 }, "LV and aorta");
      plot(c2, c, { a: c.traces.la, b: c.traces.lv, ca: COLORS.la, cb: COLORS.lv, la: "Wedge (LA)", lb: "LV", cap: Math.max(20, Math.ceil((Math.max(...c.traces.la) * 2.5) / 10) * 10), shade: (i) => i >= f0 && i < f1 && !(i >= e0 && i < e1) && c.traces.la[i] > c.traces.lv[i] && c.traces.la[i + 1] > c.traces.lv[i + 1] }, "Wedge and LV, diastole");
    };
    return {
      id: "left-heart-cath",
      title: "Left-heart cath",
      mount(el, source) {
        src = source;
        wait = document.createElement("p"); wait.className = "note"; wait.textContent = "Waiting for the first solve…";
        body = document.createElement("div"); body.hidden = true;
        const table = document.createElement("table"); table.className = "readout";
        tbody = document.createElement("tbody"); table.append(tbody);
        c1 = document.createElement("canvas"); c2 = document.createElement("canvas");
        for (const c of [c1, c2]) { c.style.width = "100%"; c.style.display = "block"; c.style.marginTop = "8px"; }
        const note = document.createElement("p"); note.className = "note";
        note.textContent = "Shaded: LV above aorta in ejection; wedge above LV in filling. Gorlin uses total forward flow; the clinical mitral constant 37.7 reads 18% above the engine's 44.3 area. Valve inertance is on: mean gradients and mitral peaks sit near clinical values, but a normal aortic peak instantaneous gradient still reads high (about 18 mmHg, clinically 4 to 8) because ejection flow peaks sharply.";
        body.append(table, c1, c2, note);
        el.append(wait, body);
      },
      setSource(s) { src = s; lastBeat = null; lastKey = ""; },
      resize() { lastKey = ""; },
      draw() {
        const n = src.numbers(), beat = src.beats(1)[0];
        if (beat !== lastBeat) { lastBeat = beat; cur = leftHeartCath(n, beat, src.patientKind ?? "adult"); lastKey = ""; }
        const key = `${cur ? 1 : 0}|${n.co}|${c1.clientWidth}`;
        if (key === lastKey) return;
        lastKey = key;
        wait.hidden = !!cur; body.hidden = !cur;
        if (!cur) return;
        tbody.replaceChildren(...cathRows(cur).map(([k, v]) => {
          const tr = document.createElement("tr"), a = document.createElement("td"), b = document.createElement("td");
          a.textContent = k; b.textContent = v; if (v === DASH) b.style.color = "var(--muted)";
          tr.append(a, b); return tr;
        }));
        drawPlots();
      },
      dispose() { tbody?.replaceChildren(); },
    };
  },
};
