/**
 * The "PV loops" panel: the latest beat's loop with a fading trail of the beats before it, estimated ES/ED reference
 * lines (only when the beats shown spread enough), and a saved ghost loop for comparison. Reads source.beats() and
 * source.onBeat() only. Look follows the structural page's loop (src/structural/traces.ts drawLoop).
 */
import type { BeatSummary, Chamber, HemoSource } from "../sim/hemoSource";
import type { Panel, PanelDef } from "./panel";
import { snapshots } from "./snapshots";
import { DASH, fmt } from "./numbers";
import { cleanLoop, fitEDPVR, fitESPVR, loopStats, rescaleAxis, type Axis, type LoopStats, type Pt } from "../physics/loopMath";

/** Beats drawn faintly behind the latest. */
export const TRAIL_BEATS = 4;
type Choice = Chamber | "BV";
const OPTIONS: [Choice, string][] = [["LV", "LV"], ["RV", "RV"], ["LA", "LA"], ["RA", "RA"], ["BV", "Both ventricles"]];
const COLOR: Record<Chamber, string> = { LV: "#f4f1ea", RV: "#ffb36a", LA: "#6aa7ff", RA: "#9ad0ff" };
const ES_COLOR = "#e9a23b", ED_COLOR = "#5fd0a0";
const chambersOf = (c: Choice): Chamber[] => (c === "BV" ? ["LV", "RV"] : [c]);
const isVentricle = (c: Chamber) => c === "LV" || c === "RV";
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

export const loopsPanel: PanelDef = {
  id: "loops",
  title: "PV loops",
  defaultOn: true,
  create(): Panel {
    let src: HemoSource;
    let unsub: (() => void) | undefined;
    let dirty = true;
    let seen: BeatSummary | undefined;
    let choice: Choice = "LV";
    let ghost: BeatSummary | null = null; // the selected snapshot's beat (shared store, saved from the workspace bar)
    let unsubStore: (() => void) | undefined;
    let vAxis: Axis | null = null, pAxis: Axis | null = null;
    let canvas: HTMLCanvasElement, wait: HTMLElement, table: HTMLTableElement, note: HTMLElement;
    let lastW = 0;

    const subscribe = () => { unsub?.(); unsub = src.onBeat(() => { dirty = true; }); };
    const stats = (b: BeatSummary, c: Chamber): LoopStats => loopStats(b.loops[c].p, b.loops[c].v, b.edv[c], b.esv[c]);

    function renderTable(live: BeatSummary): void {
      const chs = chambersOf(choice);
      const rows: HTMLElement[] = [];
      const head = document.createElement("tr");
      for (const h of ["", "SV ml", "EF", "EDP mmHg"]) { const th = document.createElement("th"); th.textContent = h; head.append(th); }
      rows.push(head);
      const add = (label: string, b: BeatSummary, c: Chamber, dim: boolean) => {
        const s = stats(b, c), tr = document.createElement("tr");
        const cells = [label, fmt(s.sv), Number.isFinite(s.ef) ? `${Math.round(s.ef * 100)}%` : DASH, fmt(s.edp)];
        cells.forEach((t, i) => {
          const td = document.createElement("td");
          td.textContent = t;
          if (i === 0 && dim) td.style.color = "var(--muted)";
          tr.append(td);
        });
        if (!isVentricle(c)) tr.title = "Atrium: SV is the volume it empties; pressure is at its largest volume";
        rows.push(tr);
      };
      for (const c of chs) add(chs.length > 1 ? `${c} live` : "Live", live, c, false);
      if (ghost) for (const c of chs) add(chs.length > 1 ? `${c} ghost` : "Ghost", ghost, c, true);
      table.replaceChildren(...rows);
    }

    function render(): void {
      const beats = src.beats(TRAIL_BEATS + 1);
      ghost = snapshots.selected()?.beat ?? null;
      const live = beats[beats.length - 1];
      seen = live;
      wait.hidden = !!live;
      canvas.hidden = !live;
      if (!live) { table.replaceChildren(); note.textContent = ""; return; }
      const chs = chambersOf(choice);
      let vlo = Infinity, vhi = -Infinity, phi = 0;
      for (const b of [...beats, ...(ghost ? [ghost] : [])]) for (const c of chs) {
        for (const q of cleanLoop(b.loops[c].p, b.loops[c].v)) { vlo = Math.min(vlo, q.v); vhi = Math.max(vhi, q.v); phi = Math.max(phi, q.p); }
      }
      vAxis = rescaleAxis(vAxis, Math.max(0, vlo), vhi, 10);
      pAxis = rescaleAxis(pAxis, 0, Math.max(phi, 10), phi > 100 ? 20 : 10);
      pAxis.lo = 0;
      drawCanvas(live, beats.slice(0, -1), chs);
      renderTable(live);
    }

    function drawCanvas(live: BeatSummary, trail: BeatSummary[], chs: Chamber[]): void {
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(200, canvas.clientWidth || canvas.width), H = Math.round(W * 260 / 320);
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      lastW = canvas.clientWidth;
      const g = canvas.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const L = 42, R = W - 12, T = 26, B = H - 28;
      const va = vAxis!, pa = pAxis!;
      const x = (a: number) => L + ((a - va.lo) / (va.hi - va.lo)) * (R - L), y = (q: number) => B - ((q - pa.lo) / (pa.hi - pa.lo)) * (B - T);
      g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, W, H);
      g.font = "12px ui-monospace, Menlo, monospace"; g.textBaseline = "alphabetic";
      g.lineWidth = 1; g.strokeStyle = "#232323"; g.fillStyle = "#8a8a80";
      const pstep = pa.hi > 100 ? 40 : pa.hi > 40 ? 20 : 10;
      for (let q = 0; q <= pa.hi; q += pstep) { g.beginPath(); g.moveTo(L, y(q)); g.lineTo(R, y(q)); g.stroke(); g.fillText(String(q), 6, y(q) + 4); }
      const vspan = va.hi - va.lo, vstep = vspan > 160 ? 40 : vspan > 80 ? 20 : 10;
      for (let a = Math.ceil(va.lo / vstep) * vstep; a <= va.hi; a += vstep) {
        g.beginPath(); g.moveTo(x(a), T); g.lineTo(x(a), B); g.stroke();
        g.fillText(String(a), x(a) - 8, H - 8);
      }
      g.fillText("mmHg / ml", L, 16);

      const path = (b: BeatSummary, c: Chamber) => {
        g.beginPath();
        cleanLoop(b.loops[c].p, b.loops[c].v).forEach((q, i) => (i ? g.lineTo(x(q.v), y(q.p)) : g.moveTo(x(q.v), y(q.p))));
        g.closePath();
      };
      g.save();
      g.beginPath(); g.rect(L, T - 4, R - L + 2, B - T + 6); g.clip();
      if (ghost) for (const c of chs) { g.setLineDash([5, 4]); g.lineWidth = 1.6; g.strokeStyle = rgba(COLOR[c], 0.6); path(ghost, c); g.stroke(); }
      g.setLineDash([]);
      trail.forEach((b, i) => {
        for (const c of chs) { g.lineWidth = 1.3; g.strokeStyle = rgba(COLOR[c], 0.1 + 0.4 * ((i + 1) / (trail.length + 1))); path(b, c); g.stroke(); }
      });
      const shown = [...trail, live];
      if (chs.length === 1 && isVentricle(chs[0])) {
        const sts = shown.map(b => stats(b, chs[0]));
        const es = sts.map(s => s.es).filter((q): q is Pt => !!q), ed = sts.map(s => s.ed).filter((q): q is Pt => !!q);
        const espvr = fitESPVR(es), edpvr = fitEDPVR(ed);
        g.lineWidth = 1.2; g.setLineDash([2, 3]);
        if (espvr) {
          const v1 = Math.max(va.lo, espvr.v0), v2 = Math.min(va.hi, espvr.v0 + pa.hi / espvr.slope);
          g.strokeStyle = ES_COLOR; g.beginPath();
          g.moveTo(x(v1), y(espvr.slope * (v1 - espvr.v0))); g.lineTo(x(v2), y(espvr.slope * (v2 - espvr.v0))); g.stroke();
        }
        if (edpvr) {
          const lo = Math.min(...ed.map(q => q.v)) - 5, hi = Math.max(...ed.map(q => q.v)) + 5;
          g.strokeStyle = ED_COLOR; g.beginPath();
          for (let k = 0; k <= 24; k++) {
            const a = lo + ((hi - lo) * k) / 24, px = x(a), py = y(edpvr.a * Math.exp(edpvr.b * a));
            if (k) g.lineTo(px, py); else g.moveTo(px, py);
          }
          g.stroke();
        }
        g.setLineDash([]);
        const ls = sts[sts.length - 1];
        for (const [pt, col] of [[ls.es, ES_COLOR], [ls.ed, ED_COLOR]] as const) {
          if (!pt) continue;
          g.fillStyle = col; g.beginPath(); g.arc(x(pt.v), y(pt.p), 3.5, 0, 6.2832); g.fill();
        }
        const fitted = espvr || edpvr;
        note.textContent =
          (fitted ? `Dotted lines are estimates fitted to the ${shown.length} beats shown, not measurements` +
            (espvr ? `: ESPVR slope ${espvr.slope.toFixed(2)} mmHg/ml, V0 ${espvr.v0.toFixed(0)} ml` : "") + ". "
            : "Points mark the live beat's end-systole (amber) and end-diastole (green). Lines are drawn only when the beats shown differ enough to fit. ") +
          (src.kind === "bridge" ? "Bridge: volumes do not vary with RR." : "");
      } else {
        note.textContent = chs.length > 1 ? "Reference lines are shown for one ventricle at a time." : "Reference lines are drawn for the ventricles only.";
      }
      for (const c of chs) { g.lineWidth = 2.2; g.strokeStyle = COLOR[c]; path(live, c); g.stroke(); }
      g.restore();
      let lx = R - 4;
      for (const c of [...chs].reverse()) {
        const wd = g.measureText(c).width; lx -= wd + 18;
        g.fillStyle = COLOR[c]; g.fillRect(lx, 8, 10, 3); g.fillText(c, lx + 14, 16);
      }
      if (ghost) { const t = `- - ${snapshots.selected()?.label ?? "snapshot"}`; g.fillStyle = "#8a8a80"; g.fillText(t, lx - g.measureText(t).width - 12, 16); }
      if (live.pvc) { g.fillStyle = "#ff6b5b"; g.fillText("PVC", L + 90, 16); }
    }

    return {
      id: "loops",
      title: "PV loops",
      mount(el, source) {
        src = source;
        const ctl = document.createElement("div");
        ctl.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px";
        const sel = document.createElement("select");
        sel.setAttribute("aria-label", "Chamber");
        sel.style.cssText = "width:auto;min-width:0";
        for (const [v, t] of OPTIONS) { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.append(o); }
        sel.addEventListener("change", () => { choice = sel.value as Choice; vAxis = pAxis = null; dirty = true; });
        ctl.append(sel);
        wait = document.createElement("p");
        wait.className = "note";
        wait.textContent = "waiting for first solve";
        canvas = document.createElement("canvas");
        canvas.style.cssText = "display:block;width:100%;height:auto;border-radius:6px";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", "Pressure-volume loop");
        table = document.createElement("table");
        table.className = "readout";
        note = document.createElement("p");
        note.className = "note";
        el.append(ctl, wait, canvas, table, note);
        subscribe();
        unsubStore = snapshots.subscribe(() => { vAxis = pAxis = null; dirty = true; });
      },
      setSource(s) { src = s; vAxis = pAxis = null; seen = undefined; dirty = true; subscribe(); },
      resize() { dirty = true; },
      draw() {
        if (canvas.clientWidth && Math.abs(canvas.clientWidth - lastW) > 1) dirty = true;
        if (!dirty && src.beats(1)[0] === seen) return; // onBeat marks new beats; the identity check covers a source that fills silently
        dirty = false;
        render();
      },
      dispose() { unsub?.(); unsub = undefined; unsubStore?.(); unsubStore = undefined; },
    };
  },
};
