/**
 * The Valves tab's per-valve controls (C4, docs/VALVES.md): stenosis and regurgitation severity for each native valve (several at once),
 * a prosthesis section per valve, the interventions (`intervene`), and a readout line per valve. DOM only; the logic is in src/sim/valves.ts.
 * Everything edits the playground state's `heart` (the Preset menu only fills it; `valvePreset` names where it started), which the page applies to the core engine.
 */
import { DEFAULT_PROSTHESIS_SIZE, PROSTHESIS_SIZE, REGURG_AREA_FRAC, STENOSIS_SPAN, VALVE_KEYS } from "../config/valves";
import type { ProsthesisKind, ValveKey } from "../config/valves";
import { PATIENTS } from "../config/structural";
import { heartOfPick } from "../sim/playground";
import type { PlaygroundState } from "../sim/playground";
import type { HeartSpec } from "../sim/patient";
import { assessHeart, intervene, nativeLesion } from "../sim/valves";
import type { Intervention } from "../sim/valves";
import type { ValveFinding } from "../sim/structural";

type H = <K extends keyof HTMLElementTagNameMap>(tag: K, props?: Partial<HTMLElementTagNameMap[K]> & { className?: string }, ...kids: (Node | string)[]) => HTMLElementTagNameMap[K];
export interface ValvesCtx {
  body: HTMLElement; h: H; ctlId: () => string; fields: string[];
  syncs: ((s: PlaygroundState) => void)[];
  edit: (f: (s: PlaygroundState) => PlaygroundState) => void;
  /** True when the page runs the legacy engine (the game): the controls are disabled. */
  legacy?: () => boolean;
}

const NAME: Record<ValveKey, string> = { av: "Aortic", mv: "Mitral", tv: "Tricuspid", pv: "Pulmonary" };
const CODE: Record<ValveKey, string> = { av: "AV", mv: "MV", tv: "TV", pv: "PVL" };
const KIND_LABEL: Record<ProsthesisKind, string> = { bioprosthetic: "Bioprosthetic (tissue)", mechanical: "Mechanical", transcatheter: "Transcatheter" };
const ACTIONS: Record<ValveKey, { label: string; title: string; iv: Intervention }[]> = {
  av: [
    { label: "TAVR", title: "Transcatheter aortic valve replacement (valve-in-valve if the valve is a bioprosthesis)", iv: { type: "tavr" } },
    { label: "Balloon valvuloplasty", title: "Dilate the stenotic native valve (area gains about 0.3 cm², a small new leak)", iv: { type: "balloon", valve: "av" } },
    { label: "Surgical replacement", title: "Replace with a bioprosthetic valve", iv: { type: "replace", valve: "av", kind: "bioprosthetic" } },
    { label: "Mechanical replacement", title: "Replace with a mechanical valve", iv: { type: "replace", valve: "av", kind: "mechanical" } },
  ],
  mv: [
    { label: "MitraClip (edge-to-edge)", title: "Two clips: the leak shrinks, the opening loses some area", iv: { type: "teer", valve: "mv" } },
    { label: "Annuloplasty repair", title: "Surgical ring annuloplasty: leak to 10 %, opening to 90 %", iv: { type: "repair", valve: "mv" } },
    { label: "Balloon valvuloplasty", title: "Dilate the stenotic native valve", iv: { type: "balloon", valve: "mv" } },
    { label: "Surgical replacement", title: "Replace with a bioprosthetic valve", iv: { type: "replace", valve: "mv", kind: "bioprosthetic" } },
    { label: "Mechanical replacement", title: "Replace with a mechanical valve", iv: { type: "replace", valve: "mv", kind: "mechanical" } },
  ],
  tv: [
    { label: "TriClip (edge-to-edge)", title: "Two clips on the tricuspid valve", iv: { type: "teer", valve: "tv" } },
    { label: "Annuloplasty repair", title: "Surgical ring annuloplasty", iv: { type: "repair", valve: "tv" } },
    { label: "Surgical replacement", title: "Replace with a bioprosthetic valve", iv: { type: "replace", valve: "tv", kind: "bioprosthetic" } },
  ],
  pv: [
    { label: "Balloon valvuloplasty", title: "Dilate the stenotic native pulmonary valve", iv: { type: "balloon", valve: "pv" } },
    { label: "Transcatheter valve", title: "Transcatheter pulmonary valve replacement", iv: { type: "replace", valve: "pv", kind: "transcatheter" } },
    { label: "Surgical replacement", title: "Replace with a bioprosthetic valve", iv: { type: "replace", valve: "pv", kind: "bioprosthetic" } },
  ],
};
const unit = (x: number) => Math.min(1, Math.max(0, x));
export const heartOf = (s: PlaygroundState): HeartSpec => (s.structural ? heartOfPick(s.structural) : s.heart) ?? {};
/** The state with `heart` as the structural heart (a lesion pick is dropped: its values are in the heart now). */
export function withHeart(s: PlaygroundState, heart: HeartSpec): PlaygroundState {
  const valves = Object.fromEntries(Object.entries(heart.valves ?? {}).filter(([, v]) => v));
  const next: HeartSpec = { ...heart };
  if (Object.keys(valves).length) next.valves = valves; else delete next.valves;
  return { ...s, structural: undefined, heart: Object.keys(next).length ? next : undefined };
}
function setValve(s: PlaygroundState, k: ValveKey, v: NonNullable<HeartSpec["valves"]>[ValveKey] | null): PlaygroundState {
  const heart = heartOf(s), valves = { ...(heart.valves ?? {}) };
  if (v) valves[k] = v; else delete valves[k];
  return withHeart(s, { ...heart, valves });
}
/** The 0..1 severity sliders a native valve stands for (the inverse of `nativeLesion`). */
export const severityOf = (k: ValveKey, v: { open?: number; reg?: number } | undefined) =>
  ({ stenosis: unit((1 - (v?.open ?? 1)) / STENOSIS_SPAN[k]), regurgitation: unit((v?.reg ?? 0) / (REGURG_AREA_FRAC[k] * PATIENTS.adult.valveAreas[k])) });

function readoutLine(k: ValveKey, f: ValveFinding | undefined): string {
  if (!f) return "";
  const p = f.prosthesis, bits: string[] = [];
  if (p) bits.push(`${p.sizeMm} mm ${p.inRing ? "valve-in-valve " : ""}${p.kind}, EOA ${p.eoa.toFixed(1)} cm²${p.mismatch !== "none" ? `, ${p.mismatch} mismatch` : ""}`);
  bits.push(f.stenosis === "none" && !p ? "no stenosis" : `stenosis ${f.stenosis}`);
  bits.push(`mean gradient ${f.meanGradient.toFixed(0)} mmHg`);
  bits.push(f.regurgitation === "none" ? (p && f.regurgMl > 0.5 ? `physiological closing leak ${f.regurgMl.toFixed(0)} ml/beat` : "no regurgitation") : `regurgitation ${f.regurgitation}: ${f.regurgMl.toFixed(0)} ml/beat${f.regurgFraction !== null ? ` (${(f.regurgFraction * 100).toFixed(0)}%)` : ""}`);
  return `${NAME[k]} grade ${f.grade}: ${bits.join(" · ")}`;
}

export function buildValves(c: ValvesCtx) {
  const { body, h, edit, fields, syncs } = c;
  const disable: HTMLElement[] = [];
  const legacyNote = h("p", { className: "note pg-note", textContent: "These controls need the core engine. The game runs the legacy engine, which has no per-valve model." });
  legacyNote.hidden = true;
  const result = h("div", { className: "note pg-ivresult", id: "pg-ivresult" });
  result.setAttribute("aria-live", "polite");
  body.append(
    h("p", { className: "note", textContent: "Build any combination of valve disease (for example aortic stenosis with mitral regurgitation), then treat it. Each readout is the steady resting state of this heart: the circulation itself makes the valves interact." }),
    legacyNote,
  );
  const readouts = new Map<ValveKey, HTMLElement>();
  let lastKey = "", timer: ReturnType<typeof setTimeout> | undefined;
  const refreshReadouts = (heart: HeartSpec) => {
    const key = JSON.stringify(heart);
    if (key === lastKey) return;
    lastKey = key;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      let found: ValveFinding[] = [];
      try { found = assessHeart(heart).valves; } catch { for (const r of readouts.values()) r.textContent = "Could not measure this heart."; return; }
      for (const k of VALVE_KEYS) readouts.get(k)!.textContent = readoutLine(k, found.find((x) => x.valve === CODE[k]));
    }, 200);
  };

  for (const k of VALVE_KEYS) {
    const sec = h("div", { className: "pg-valve" });
    const title = h("p", { className: "glabel pg-sub", textContent: `${NAME[k]} valve` });
    const readout = h("p", { className: "note pg-readout", id: `pg-readout-${k}` });
    readouts.set(k, readout);
    sec.append(title, readout);
    // native severities
    const mk = (path: string, label: string, key: "stenosis" | "regurgitation") => {
      fields.push(path);
      const id = c.ctlId(), val = h("span", { className: "val" }), input = h("input", { id, type: "range", min: "0", max: "1", step: "0.05" });
      sec.append(h("label", { htmlFor: id }, label + " ", val), input);
      input.addEventListener("input", () => edit((s) => {
        const cur = heartOf(s).valves?.[k], sev = severityOf(k, cur);
        sev[key] = Number(input.value);
        return setValve(s, k, sev.stenosis === 0 && sev.regurgitation === 0 ? null : nativeLesion(k, sev));
      }));
      syncs.push((s) => {
        const cur = heartOf(s).valves?.[k], v = severityOf(k, cur)[key], pro = !!cur?.prosthesis;
        if (document.activeElement !== input) input.value = String(+v.toFixed(2));
        val.textContent = pro ? "replaced by a prosthesis" : v === 0 ? "none" : `${Math.round(v * 100)}%`;
        input.disabled = pro || !!c.legacy?.();
      });
    };
    mk(`heart.valves.${k}.open`, "Stenosis", "stenosis");
    mk(`heart.valves.${k}.reg`, "Regurgitation", "regurgitation");
    // prosthesis
    const kid = c.ctlId(), kind = h("select", { id: kid, "aria-label": `${NAME[k]} prosthesis` } as Partial<HTMLSelectElement>);
    kind.append(h("option", { value: "", textContent: "Native valve" }), ...(Object.keys(KIND_LABEL) as ProsthesisKind[]).map((p) => h("option", { value: p, textContent: KIND_LABEL[p] })));
    fields.push(`heart.valves.${k}.prosthesis`);
    sec.append(h("label", { htmlFor: kid, textContent: "Prosthesis" }), kind);
    kind.addEventListener("change", () => edit((s) => {
      if (!kind.value) return setValve(s, k, null);
      const p = kind.value as ProsthesisKind, cur = heartOf(s).valves?.[k]?.prosthesis;
      return setValve(s, k, { open: 1, reg: 0, prosthesis: { kind: p, sizeMm: cur ? Math.min(PROSTHESIS_SIZE[k][1], Math.max(PROSTHESIS_SIZE[k][0], cur.sizeMm ?? DEFAULT_PROSTHESIS_SIZE[p][k])) : DEFAULT_PROSTHESIS_SIZE[p][k], leak: cur?.leak ?? 0, obstruction: cur?.obstruction ?? 0, inRing: p === "transcatheter" && cur?.inRing === true } });
    }));
    const pro = h("div", { className: "pg-prosthesis" });
    const pslider = (field: "sizeMm" | "leak" | "obstruction", label: string, min: number, max: number, step: number, fmt: (v: number) => string) => {
      fields.push(`heart.valves.${k}.prosthesis`);
      const id = c.ctlId(), val = h("span", { className: "val" }), input = h("input", { id, type: "range", min: String(min), max: String(max), step: String(step) });
      pro.append(h("label", { htmlFor: id }, label + " ", val), input);
      input.addEventListener("input", () => edit((s) => {
        const cur = heartOf(s).valves?.[k]; if (!cur?.prosthesis) return s;
        return setValve(s, k, { ...cur, prosthesis: { ...cur.prosthesis, [field]: Number(input.value) } });
      }));
      syncs.push((s) => {
        const p = heartOf(s).valves?.[k]?.prosthesis, v = p ? (p[field] ?? (field === "sizeMm" ? DEFAULT_PROSTHESIS_SIZE[p.kind][k] : 0)) : min;
        if (document.activeElement !== input) input.value = String(v);
        val.textContent = fmt(v); input.disabled = !!c.legacy?.();
      });
    };
    pslider("sizeMm", "Size", PROSTHESIS_SIZE[k][0], PROSTHESIS_SIZE[k][1], 1, (v) => `${v} mm`);
    pslider("leak", "Paravalvular leak", 0, 1, 0.01, (v) => (v ? `${v.toFixed(2)} cm²` : "none"));
    pslider("obstruction", "Obstruction (thrombus, pannus)", 0, 1, 0.05, (v) => (v ? `${Math.round(v * 100)}%` : "none"));
    sec.append(pro);
    // interventions
    const row = h("div", { className: "row pg-iv" });
    for (const a of ACTIONS[k]) {
      const b = h("button", { type: "button", textContent: a.label, title: a.title });
      fields.push(`action:valve-${k}-${a.iv.type}${"kind" in a.iv ? `-${a.iv.kind}` : ""}`);
      b.addEventListener("click", () => edit((s) => {
        const r = intervene(heartOf(s), a.iv);
        const lines = [...r.changes.map((t) => `Done: ${t}.`), ...r.warnings.map((t) => `Warning: ${t}.`)];
        result.replaceChildren(...lines.map((t) => h("div", { textContent: t })));
        result.hidden = !lines.length;
        return Object.keys(r.patch).length ? withHeart(s, r.heart) : s;
      }));
      disable.push(b); row.append(b);
    }
    sec.append(row);
    body.append(sec);
    syncs.push((s) => {
      const p = heartOf(s).valves?.[k]?.prosthesis;
      kind.value = p?.kind ?? ""; kind.disabled = !!c.legacy?.(); pro.hidden = !p;
    });
  }
  body.append(result);
  result.hidden = true;
  syncs.push((s) => {
    const lg = !!c.legacy?.();
    legacyNote.hidden = !lg;
    for (const b of disable) (b as HTMLButtonElement).disabled = lg;
    if (lg) for (const r of readouts.values()) r.textContent = "";
    else refreshReadouts(heartOf(s));
  });
}
