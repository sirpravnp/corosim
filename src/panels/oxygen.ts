/**
 * The "Oxygen" panel (task P10): SpO2, pre- and post-ductal SaO2, SvO2, DO2, VO2, extraction, Qp:Qs, lactate (after E6),
 * ECMO return saturation, a pulse-oximeter pleth and teaching cues in plain words. Draws only; the derivations and
 * thresholds are src/sim/oxygenReadout.ts and src/config/oxygenPanel.ts. Colour dots reuse the 3D view's saturation scale.
 */
import { OXYGEN_PANEL } from "../config/oxygenPanel";
import type { HemoSource } from "../sim/hemoSource";
import { oxygenReadout, plethFromPressure, type OxygenReadout } from "../sim/oxygenReadout";
import { satColor } from "../structural/heartView";
import { DASH, fmt } from "./numbers";
import type { Panel, PanelDef } from "./panel";

const FONT = "11px ui-monospace, Menlo, monospace";
const WAITING = "waiting for first solve";
const FOOTNOTE = "The pleth is derived from the aortic pressure trace, normalised; it is not a modelled optical signal.";
const LACTATE_PENDING = "available with oxygen-in-time (E6)";

const pct = (x: number): string => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : DASH);

interface Row { label: string; value: string; sat?: number; note?: string }

/** Label/value rows for the readouts. Pure, so tests can check them. */
export function oxygenRows(r: OxygenReadout): Row[] {
  const rows: Row[] = [
    { label: "SpO₂ (right hand)", value: pct(r.spo2), sat: r.spo2 },
    { label: "SaO₂ pre-ductal", value: pct(r.pre), sat: r.pre },
    { label: "SaO₂ post-ductal", value: pct(r.post), sat: r.post },
  ];
  if (r.diff.significant) rows.push({ label: "Pre − post", value: `${r.diff.points.toFixed(1)} points`, note: r.diff.explanation });
  rows.push(
    { label: "SvO₂", value: pct(r.svo2), sat: r.svo2 },
    { label: "DO₂", value: Number.isFinite(r.do2) ? `${fmt(r.do2)} ml/min` : DASH },
    { label: "VO₂", value: Number.isFinite(r.vo2) ? `${fmt(r.vo2)} ml/min` : DASH },
    { label: "O₂ extraction (VO₂/DO₂)", value: Number.isFinite(r.extraction) ? r.extraction.toFixed(2) : DASH },
    { label: "Qp:Qs", value: Number.isFinite(r.qpQs) ? r.qpQs.toFixed(2) : DASH },
    Number.isFinite(r.lactate)
      ? { label: "Lactate", value: `${r.lactate.toFixed(1)} mmol/L` }
      : { label: "Lactate", value: DASH, note: LACTATE_PENDING },
  );
  if (r.hasEcmo) rows.push({ label: "ECMO return SaO₂", value: pct(r.ecmoReturn), sat: r.ecmoReturn });
  return rows;
}

export const oxygenPanel: PanelDef = {
  id: "oxygen",
  title: "Oxygen",
  defaultOn: true,
  create(): Panel {
    let src: HemoSource;
    let body: HTMLElement, cuesEl: HTMLElement, canvas: HTMLCanvasElement;
    let last = "";

    function drawPleth(ready: boolean) {
      const dpr = window.devicePixelRatio || 1, W = Math.max(200, canvas.clientWidth || canvas.width), H = Math.round(W * 0.28);
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      const g = canvas.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, W, H);
      g.font = FONT; g.fillStyle = "#8a8a80";
      g.fillText("pleth (from aortic pressure)", 8, 13);
      const tr = ready ? src.trace("AO", OXYGEN_PANEL.plethSeconds, { maxPoints: OXYGEN_PANEL.plethPoints }) : null;
      if (!tr || tr.v.length < 2) { g.textAlign = "center"; g.fillText(WAITING, W / 2, H / 2 + 4); g.textAlign = "start"; return; }
      const y = plethFromPressure(tr.v), t0 = tr.t[0], span = tr.t[tr.t.length - 1] - t0 || 1;
      const L = 8, R = W - 8, T = 22, B = H - 8;
      g.strokeStyle = "#5fd08a"; g.lineWidth = 2; g.beginPath();
      let pen = false;
      for (let i = 0; i < y.length; i++) {
        if (!Number.isFinite(y[i])) { pen = false; continue; }
        const px = L + ((tr.t[i] - t0) / span) * (R - L), py = B - y[i] * (B - T);
        if (pen) g.lineTo(px, py); else { g.moveTo(px, py); pen = true; }
      }
      g.stroke();
    }

    return {
      id: "oxygen",
      title: "Oxygen",
      mount(el, source) {
        src = source;
        const table = document.createElement("table");
        table.className = "readout";
        body = document.createElement("tbody");
        table.append(body);
        cuesEl = document.createElement("ul");
        cuesEl.style.cssText = "margin:8px 0 0;padding-left:18px;font-size:13px";
        canvas = document.createElement("canvas");
        canvas.style.cssText = "display:block;width:100%;border-radius:4px;margin-top:8px";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", "Pulse oximeter pleth derived from the aortic pressure");
        const foot = document.createElement("p");
        foot.className = "note";
        foot.textContent = FOOTNOTE;
        el.append(table, canvas, cuesEl, foot);
      },
      setSource(s) { src = s; last = ""; },
      draw() {
        const r = oxygenReadout(src.saturations(), src.numbers(), src.devices());
        const key = r.ready ? JSON.stringify(r) : WAITING;
        if (key !== last) {
          last = key;
          if (!r.ready) {
            const tr = document.createElement("tr"), td = document.createElement("td");
            td.colSpan = 2; td.style.color = "var(--muted)"; td.textContent = WAITING;
            tr.append(td);
            body.replaceChildren(tr);
            cuesEl.replaceChildren();
          } else {
            body.replaceChildren(...oxygenRows(r).map(row => {
              const tr = document.createElement("tr"), a = document.createElement("td"), b = document.createElement("td");
              a.textContent = row.label;
              if (row.sat !== undefined && Number.isFinite(row.sat)) {
                const dot = document.createElement("span");
                dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${satColor(row.sat).getStyle()}`;
                b.append(dot);
              }
              b.append(row.value);
              if (row.value === DASH) b.style.color = "var(--muted)";
              tr.append(a, b);
              if (!row.note) return tr;
              const n = document.createElement("tr"), nd = document.createElement("td");
              nd.colSpan = 2; nd.className = "note"; nd.style.cssText = "font-size:12px;padding-top:0";
              nd.textContent = row.note;
              n.append(nd);
              const frag = document.createDocumentFragment();
              frag.append(tr, n);
              return frag;
            }));
            cuesEl.replaceChildren(...r.cues.map(c => { const li = document.createElement("li"); li.textContent = c; return li; }));
          }
        }
        drawPleth(r.ready);
      },
      resize() { /* the canvas is sized from its CSS width on each draw */ },
      dispose() { canvas?.remove(); },
    };
  },
};
