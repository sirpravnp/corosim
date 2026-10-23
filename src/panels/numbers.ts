/** The "Hemodynamics" panel: the catheter-lab numbers as a compact table. Draws only; computes nothing. */
import type { HemoNumbers, HemoSource, Saturations } from "../sim/hemoSource";
import type { Panel, PanelDef } from "./panel";

export const DASH = "–";

export function fmt(x: number, digits = 0): string {
  return Number.isFinite(x) ? x.toFixed(digits) : DASH;
}
function pct(x: number): string { return Number.isFinite(x) ? `${Math.round(x * 100)}%` : DASH; }
function triple(s: number, d: number, m: number): string {
  if (![s, d, m].some(Number.isFinite)) return DASH;
  return `${fmt(s)}/${fmt(d)} (${fmt(m)})`;
}

/** Label/value rows, in catheter-report order. Pure, so tests can check them. */
export function numberRows(n: HemoNumbers, s: Saturations): [string, string][] {
  return [
    ["HR", fmt(n.hr)],
    ["BP s/d (mean)", triple(n.systolic, n.diastolic, n.map)],
    ["CVP", fmt(n.cvp)],
    ["PA s/d (mean)", triple(n.pa.systolic, n.pa.diastolic, n.pa.mean)],
    ["PCWP", fmt(n.pcwp)],
    ["LVEDP", fmt(n.lvedp)],
    ["RVEDP", fmt(n.rvedp)],
    ["CO / CI", Number.isFinite(n.co) || Number.isFinite(n.ci) ? `${fmt(n.co, 1)} / ${fmt(n.ci, 1)}` : DASH],
    ["SVR (WU)", fmt(n.svr, 1)],
    ["PVR (WU)", fmt(n.pvr, 1)],
    ["LVEF", pct(n.lvEf)],
    ["RVEF", pct(n.rvEf)],
    ["Qp:Qs", Number.isFinite(n.qpQs) ? n.qpQs.toFixed(2) : DASH],
    ["SpO₂", pct(s.spo2)],
    ["SvO₂", pct(s.svo2)],
  ];
}

export function badgeText(kind: HemoSource["kind"]): string { return kind === "live" ? "live" : "bridge"; }

export const numbersPanel: PanelDef = {
  id: "numbers",
  title: "Hemodynamics",
  defaultOn: true,
  create(): Panel {
    let src: HemoSource;
    let badge: HTMLElement, body: HTMLElement;
    let last = "";
    return {
      id: "numbers",
      title: "Hemodynamics",
      mount(el, source) {
        src = source;
        badge = document.createElement("span");
        badge.className = "hp-badge";
        const table = document.createElement("table");
        table.className = "readout";
        body = document.createElement("tbody");
        table.append(body);
        const unit = document.createElement("p");
        unit.className = "note";
        unit.textContent = "mmHg, L/min, L/min/m², Wood units. – means not available.";
        el.append(badge, table, unit);
      },
      setSource(s) { src = s; last = ""; },
      draw() {
        const rows = numberRows(src.numbers(), src.saturations());
        const key = badgeText(src.kind) + rows.map(r => r[1]).join("|");
        if (key === last) return; // numbers change at beat rate; skip identical frames
        last = key;
        badge.textContent = badgeText(src.kind);
        badge.title = src.kind === "live" ? "Beat-by-beat engine" : "Steady-state solve replayed";
        body.replaceChildren(...rows.map(([k, v]) => {
          const tr = document.createElement("tr");
          const a = document.createElement("td"), b = document.createElement("td");
          a.textContent = k; b.textContent = v;
          if (v === DASH) b.style.color = "var(--muted)";
          tr.append(a, b);
          return tr;
        }));
      },
      dispose() { body?.replaceChildren(); },
    };
  },
};
