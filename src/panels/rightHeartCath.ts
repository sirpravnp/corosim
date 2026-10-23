/** The "Right-heart cath" panel: pullback strip (RA, RV, PA, wedge), oximetry run with step-ups, and the derived numbers. Draws only. */
import type { HemoSource } from "../sim/hemoSource";
import { rightHeartCath, type RightHeartCath } from "../sim/rightHeartCath";
import { DASH, fmt } from "./numbers";
import type { Panel, PanelDef } from "./panel";

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : DASH);
const ratio = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : DASH);
const range = (a: number, b: number) => `${fmt(a)}/${fmt(b)}`;

/** Label/value rows of the report, in cath-lab order. Pure, so tests can check them. */
export function rhcRows(r: RightHeartCath): [string, string][] {
  const p = r.pullback, d = r.derived, o = r.output;
  const abc = p ? `${fmt(p.ra.mean)}${Number.isFinite(p.ra.a) ? ` (a ${fmt(p.ra.a)}, v ${fmt(p.ra.v)})` : Number.isFinite(p.ra.v) ? ` (v ${fmt(p.ra.v)})` : ""}` : DASH;
  return [
    ["RA mean", abc],
    ["RV sys/EDP", p ? range(p.rv.systolic, p.rv.endDiastolic) : DASH],
    ["PA s/d (mean)", `${range(r.numbers.pa.systolic, r.numbers.pa.diastolic)} (${fmt(r.numbers.pa.mean)})`],
    ["PCWP mean", fmt(r.numbers.pcwp)],
    ["CO Fick / TD", `${ratio(o.fick, 1)} / ${ratio(o.thermodilution, 1)} L/min`],
    ["CI", ratio(d.ci, 1)],
    ["Qp:Qs (Fick)", ratio(d.qpQs)],
    ["PVR / SVR (WU)", `${ratio(d.pvr, 1)} / ${ratio(d.svr, 1)}`],
    ["TPG / DPG", `${fmt(d.tpg)} / ${fmt(d.dpg)}`],
    ["PAPi", ratio(d.papi)],
    ["CPO (W)", ratio(d.cpo)],
    ["Hb used", `${ratio(o.hb, 1)} g/dl`],
  ];
}

export const rhcPanel: PanelDef = {
  id: "rhc",
  title: "Right-heart cath",
  defaultOn: true,
  create(): Panel {
    let src: HemoSource;
    let root: HTMLElement, wait: HTMLElement, strip: HTMLCanvasElement, oxy: HTMLElement, body: HTMLElement, note: HTMLElement;
    let last = "";
    const css = (v: string, fallback: string) => getComputedStyle(root).getPropertyValue(v).trim() || fallback;

    function drawStrip(r: RightHeartCath) {
      const p = r.pullback;
      const dpr = window.devicePixelRatio || 1, W = Math.max(240, strip.clientWidth || 320), H = 150;
      if (strip.width !== Math.round(W * dpr) || strip.height !== Math.round(H * dpr)) { strip.width = Math.round(W * dpr); strip.height = Math.round(H * dpr); }
      const g = strip.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ink = css("--ink", "#f4f1ea"), muted = css("--muted", "#8a8a80"), rule = css("--rule-light", "#2a2a2a"), accent = css("--warn", "#e0a447");
      g.clearRect(0, 0, W, H);
      if (!p) return;
      const L = 28, R = W - 4, T = 18, B = H - 6;
      let top = 10;
      for (const s of p.segments) for (const v of s.p) if (v > top) top = v;
      top = [10, 20, 30, 40, 60, 80, 100, 120, 150].find((x) => x >= top) ?? Math.ceil(top / 50) * 50;
      const y = (v: number) => B - (Math.max(0, v) / top) * (B - T);
      g.font = "11px ui-monospace, Menlo, monospace"; g.lineWidth = 1;
      const step = top > 60 ? 40 : top > 30 ? 20 : 10;
      for (let v = 0; v <= top; v += step) {
        g.strokeStyle = rule; g.beginPath(); g.moveTo(L, y(v)); g.lineTo(R, y(v)); g.stroke();
        g.fillStyle = muted; g.textBaseline = "middle"; g.fillText(String(v), 2, y(v));
      }
      const n = p.segments.length, w = (R - L) / n;
      p.segments.forEach((s, k) => {
        const x0 = L + k * w, x1 = x0 + w - 2, tEnd = s.t[s.t.length - 1] || 1;
        if (k) { g.strokeStyle = muted; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x0 - 1, T - 4); g.lineTo(x0 - 1, B); g.stroke(); g.setLineDash([]); }
        g.fillStyle = ink; g.textBaseline = "alphabetic"; g.fillText(s.label, x0 + 4, 12);
        g.strokeStyle = s.site === "Wedge" ? accent : ink; g.lineWidth = 1.6; g.beginPath();
        s.p.forEach((v, i) => { const x = x0 + (s.t[i] / tEnd) * (x1 - x0 - 4) + 2; if (i) g.lineTo(x, y(v)); else g.moveTo(x, y(v)); });
        g.stroke(); g.lineWidth = 1;
      });
    }

    function drawOximetry(r: RightHeartCath) {
      const o = r.oximetry;
      oxy.replaceChildren();
      const row = document.createElement("div");
      row.style.cssText = "display:flex;flex-wrap:wrap;gap:6px 14px;font:12px/1.4 var(--font-data);";
      for (const s of o.sites) {
        const c = document.createElement("span");
        c.textContent = `${s.site} ${pct(s.sat)}`;
        row.append(c);
      }
      const mv = document.createElement("span");
      mv.style.color = "var(--muted)"; mv.textContent = `mixed venous ${pct(o.mixedVenous)}`;
      row.append(mv);
      oxy.append(row);
      const msg = document.createElement("div");
      msg.style.cssText = "margin-top:6px;font:600 12px/1.4 var(--font-data);";
      if (o.stepUp) {
        msg.style.color = "var(--warn)";
        msg.textContent = o.stepUps.map((s) => `${s.level} step-up +${(s.delta * 100).toFixed(0)}% (${s.from} to ${s.to})`).join("; ");
      } else {
        msg.style.color = "var(--muted)"; msg.textContent = "No step-up (atrial 7%, ventricular and great vessel 5%).";
      }
      oxy.append(msg);
    }

    return {
      id: "rhc",
      title: "Right-heart cath",
      mount(el, source) {
        src = source; root = el;
        wait = document.createElement("p"); wait.className = "note"; wait.textContent = "Waiting for the first solve.";
        strip = document.createElement("canvas"); strip.style.cssText = "width:100%;height:150px;display:block;"; strip.setAttribute("aria-label", "Pullback: RA, RV, PA, wedge");
        oxy = document.createElement("div"); oxy.style.margin = "8px 0 10px";
        const table = document.createElement("table"); table.className = "readout";
        body = document.createElement("tbody"); table.append(body);
        note = document.createElement("p"); note.className = "note";
        note.textContent = "mmHg. One beat per site; the wedge is the left atrial trace, delayed and damped. Thermodilution is unreliable with TR or shunts.";
        el.append(wait, strip, oxy, table, note);
        strip.hidden = oxy.hidden = table.hidden = note.hidden = true;
      },
      setSource(s) { src = s; last = ""; },
      resize() { last = ""; },
      draw() {
        const r = rightHeartCath(src);
        const key = r ? `${r.pullback?.rr}|${r.numbers.map}|${r.numbers.pcwp}|${r.numbers.cvp}|${r.oximetry.mixedVenous}|${strip.clientWidth}` : "wait";
        if (key === last) return;
        last = key;
        const has = !!r;
        wait.hidden = has;
        strip.hidden = oxy.hidden = note.hidden = !has;
        (body.parentElement as HTMLElement).hidden = !has;
        if (!r) return;
        drawStrip(r); drawOximetry(r);
        body.replaceChildren(...rhcRows(r).map(([k, v]) => {
          const tr = document.createElement("tr"), a = document.createElement("td"), b = document.createElement("td");
          a.textContent = k; b.textContent = v;
          if (v === DASH) b.style.color = "var(--muted)";
          tr.append(a, b);
          return tr;
        }));
      },
      dispose() { root?.replaceChildren(); },
    };
  },
};
