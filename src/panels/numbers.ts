/** The "Hemodynamics" panel: the catheter-lab numbers as a compact table. Draws only; computes nothing. */
import type { HemoNumbers, HemoSource, Saturations } from "../sim/hemoSource";
import type { Panel, PanelDef } from "./panel";
import { snapshots } from "./snapshots";

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
    ["CPP", fmt(n.diastolic - n.lvedp)], // coronary perfusion pressure: aortic diastolic minus LVEDP
    ["LVEF", pct(n.lvEf)],
    ["RVEF", pct(n.rvEf)],
    ["Qp:Qs", Number.isFinite(n.qpQs) ? n.qpQs.toFixed(2) : DASH],
    ["SpO₂", pct(s.spo2)],
    ["SvO₂", pct(s.svo2)],
  ];
}

/**
 * The "Ectopic beats" row (live source only): the share of premature beats, and, when the readouts above could not come from steady
 * beats, a muted note saying what they were taken from. Kept out of `numberRows` so the snapshot delta (one basis per row) is unchanged.
 */
export const ECTOPY_TIP = "CO and MAP average every beat, premature ones included (they eject little and a pause follows), over the last 30 s; the other numbers use steady beats (not premature, not cut short by one, not within 3 beats after one). So with ectopy CO is not heart rate x the typical stroke volume: a pulse deficit.";
export function ectopyRow(n: HemoNumbers): { label: string; value: string; note: string; tip: string } | null {
  const e = n.ectopy;
  if (!e) return null;
  const note = e.used === "steady" ? "" : e.used === "non-premature" ? "no steady beats: premature beats left out" : "no steady beats: all beats shown";
  return { label: "Ectopic beats", value: `${Math.round(e.fraction * 100)} % of beats`, note, tip: ECTOPY_TIP };
}

/**
 * The one value per row of `numberRows` that a delta compares (BP: the mean; PA: the mean; CO / CI: CO), in the same
 * order, with the decimals the row shows. Fractions (EF, saturation) are in percentage points.
 */
export function deltaBasis(n: HemoNumbers, s: Saturations): { value: number; digits: number; unit: string }[] {
  const pt = (x: number) => ({ value: x * 100, digits: 0, unit: " pts" });
  return [
    { value: n.hr, digits: 0, unit: "" }, { value: n.map, digits: 0, unit: "" }, { value: n.cvp, digits: 0, unit: "" },
    { value: n.pa.mean, digits: 0, unit: "" }, { value: n.pcwp, digits: 0, unit: "" }, { value: n.lvedp, digits: 0, unit: "" },
    { value: n.rvedp, digits: 0, unit: "" }, { value: n.co, digits: 1, unit: "" }, { value: n.svr, digits: 1, unit: "" },
    { value: n.pvr, digits: 1, unit: "" }, { value: n.diastolic - n.lvedp, digits: 0, unit: "" }, pt(n.lvEf), pt(n.rvEf), { value: n.qpQs, digits: 2, unit: "" }, pt(s.spo2), pt(s.svo2),
  ];
}

/** Signed difference live − snapshot as text, or DASH when either is missing. Rounds to the row's decimals; no "-0". */
export function deltaText(live: number, snap: number, digits: number, unit = ""): string {
  if (!Number.isFinite(live) || !Number.isFinite(snap)) return DASH;
  const d = Number((live - snap).toFixed(digits));
  if (d === 0) return `0${unit}`;
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(digits)}${unit}`;
}

export function badgeText(_kind: HemoSource["kind"]): string { return "live"; }

function ectopyRows(e: NonNullable<ReturnType<typeof ectopyRow>>, snap: boolean): HTMLElement[] {
  const cell = (t: string) => { const td = document.createElement("td"); td.textContent = t; return td; };
  const tr = document.createElement("tr");
  tr.append(cell(e.label), cell(e.value));
  tr.title = e.tip;
  if (snap) tr.append(cell(""), cell(""));
  const out = [tr];
  if (e.note) {
    const nr = document.createElement("tr"), td = cell(e.note);
    td.colSpan = snap ? 4 : 2; td.style.color = "var(--muted)"; td.style.fontSize = "12px";
    nr.append(td); out.push(nr);
  }
  return out;
}

export const numbersPanel: PanelDef = {
  id: "numbers",
  title: "Hemodynamics",
  defaultOn: true,
  create(): Panel {
    let src: HemoSource;
    let badge: HTMLElement, body: HTMLElement;
    let last = "";
    let head: HTMLElement, unsub: (() => void) | undefined;
    return {
      id: "numbers",
      title: "Hemodynamics",
      mount(el, source) {
        src = source;
        badge = document.createElement("span");
        badge.className = "hp-badge";
        const table = document.createElement("table");
        table.className = "readout";
        head = document.createElement("thead");
        body = document.createElement("tbody");
        table.append(head, body);
        unsub = snapshots.subscribe(() => { last = ""; });
        const unit = document.createElement("p");
        unit.className = "note";
        unit.textContent = "mmHg, L/min, L/min/m², Wood units. – means not available.";
        el.append(badge, table, unit);
      },
      setSource(s) { src = s; last = ""; },
      draw() {
        const n = src.numbers(), sat = src.saturations(), snap = snapshots.selected();
        const rows = numberRows(n, sat);
        const snapRows = snap ? numberRows(snap.numbers, snap.saturations) : null;
        const ect = ectopyRow(n);
        const key = badgeText(src.kind) + (snap ? `#${snap.id}` : "") + rows.map(r => r[1]).join("|") + (ect ? `|${ect.value}|${ect.note}` : "");
        if (key === last) return; // numbers change at beat rate; skip identical frames
        last = key;
        badge.textContent = badgeText(src.kind);
        badge.title = "Beat-by-beat engine";
        const lb = deltaBasis(n, sat), sb = snap ? deltaBasis(snap.numbers, snap.saturations) : null;
        const hr = document.createElement("tr");
        if (snap) {
          for (const t of ["", "Live", snap.label, "Δ"]) { const th = document.createElement("th"); th.textContent = t; hr.append(th); }
          head.replaceChildren(hr);
        } else head.replaceChildren();
        body.replaceChildren(...rows.map(([k, v], i) => {
          const tr = document.createElement("tr");
          const cells = snapRows && sb
            ? [k, v, snapRows[i][1], deltaText(lb[i].value, sb[i].value, lb[i].digits, lb[i].unit)]
            : [k, v];
          cells.forEach((t, j) => {
            const td = document.createElement("td");
            td.textContent = t;
            if (t === DASH || (j === 2 && snap)) td.style.color = "var(--muted)";
            tr.append(td);
          });
          return tr;
        }), ...(ect ? ectopyRows(ect, !!snap) : []));
      },
      dispose() { unsub?.(); unsub = undefined; body?.replaceChildren(); },
    };
  },
};
