import type { Scenario } from "./scenario";
import { DEFAULT_IABP, DEFAULT_IMPELLA, effectiveDevices, normalizePatient } from "./patient";
import type { DeviceSpec, FluidSpec, HeartSpec, PatientSpec, PericardiumSpec, VentilationSpec } from "./patient";
import { LESION_BY_ID, defaults } from "./structural";
import type { LesionId } from "./structural";

/**
 * Playground mode's spec builder (task P12), DOM-free. The Simulator page edits one `PatientSpec`. The Scenario part (coronary
 * lesions, rhythm, drugs, support, blood loss) lives in the `Simulation` and its existing controls; the rest of the spec is
 * the `PlaygroundState` below, which the playground's own controls edit. `buildPlaygroundSpec(scenario, state)` joins the two,
 * normalises the result and reports what it changed. Every piece of the state is a PatientSpec field, so nothing a preset or a
 * shared link carries is lost when the controls are shown.
 */
export interface PlaygroundState {
  kind?: "adult" | "neonate";
  /**
   * The structural lesion picked from `LESIONS` with its slider values. When set, `heart` is built from it; when absent
   * (a preset or a link that carries its own `heart`) the `heart` below is used as it is.
   */
  structural?: { id: LesionId; values: Record<string, number> };
  heart?: HeartSpec;
  pericardium?: PericardiumSpec;
  fluids?: FluidSpec;
  ventilation?: VentilationSpec;
  devices?: DeviceSpec;
}

/** The PatientSpec fields the playground controls own; everything else in a spec is the Scenario. */
export const PLAYGROUND_FIELDS = ["kind", "heart", "pericardium", "fluids", "ventilation", "devices"] as const;

/** What the page's engines read today, per group of fields. The rest is stored in the spec and shared, nothing more. */
export type Modelled = "yes" | "legacy" | "no";
export interface FieldGroupInfo { id: string; label: string; modelled: Modelled; note: string }
export const GROUP_INFO: Record<string, FieldGroupInfo> = {
  kind: { id: "kind", label: "Patient kind", modelled: "yes", note: "The bridge builds the neonate or the adult circulation. The ACS monitor and ECG are adult models either way." },
  heart: { id: "heart", label: "Structural heart", modelled: "yes", note: "The bridge's structural engine reads every field (Gorlin valves, shunts, chamber sizes). The ACS monitor does not see it." },
  pericardium: { id: "pericardium", label: "Pericardium", modelled: "no", note: "Not modelled on this page yet: stored in the spec and shared." },
  fluids: { id: "fluids", label: "Fluids and hemorrhage", modelled: "no", note: "Modelled by the core engine only (C2: Starling exchange between plasma and interstitium, doses, bleeding rate, capillary leak, urine, Hb), which this page does not run yet, so here it is stored in the spec and shared. Passive leg raise is not modelled yet (C4). Blood loss (Volume and drugs) and IV fluid (Management) are modelled by the legacy engine." },
  ventilation: { id: "ventilation", label: "Ventilation", modelled: "no", note: "Not modelled on this page yet: stored in the spec and shared." },
  impella: { id: "impella", label: "Impella", modelled: "legacy", note: "On or off drives the legacy ACS Impella model; model, level and position are not modelled on this page yet." },
  iabp: { id: "iabp", label: "Balloon pump", modelled: "legacy", note: "On or off drives the legacy ACS balloon-pump model; ratio is not modelled on this page yet." },
  ecmo: { id: "ecmo", label: "ECMO", modelled: "no", note: "Not modelled on this page yet: stored in the spec and shared." },
};

const isEmpty = (o: object | undefined) => !o || Object.keys(o).length === 0;
const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

/** The heart a lesion pick builds: the structural engine's fields without `patient` and `hr` (those come from kind and rhythm). */
export function heartOfPick(pick: NonNullable<PlaygroundState["structural"]>): HeartSpec | undefined {
  const def = LESION_BY_ID[pick.id];
  if (!def) return undefined;
  const { patient: _p, hr: _h, ...heart } = def.build({ ...defaults(def), ...pick.values });
  return isEmpty(heart) ? undefined : (heart as HeartSpec);
}

/** The Scenario part of a spec: the playground fields removed. */
export function scenarioOf(spec: PatientSpec): Scenario {
  const s: PatientSpec = { ...spec };
  for (const k of PLAYGROUND_FIELDS) delete s[k];
  return s;
}

/** The playground state a spec stands for (legacy device booleans become `devices`). The lesion pick is not recovered: a spec's `heart` is kept as it is. */
export function stateOfSpec(spec: PatientSpec): PlaygroundState {
  const st: PlaygroundState = {};
  if (spec.kind) st.kind = spec.kind;
  if (spec.heart) st.heart = clone(spec.heart);
  if (spec.pericardium) st.pericardium = clone(spec.pericardium);
  if (spec.fluids) st.fluids = clone(spec.fluids);
  if (spec.ventilation) st.ventilation = clone(spec.ventilation);
  const d = effectiveDevices(spec);
  if (!isEmpty(d)) st.devices = clone(d);
  return st;
}

export interface BuiltPatient {
  /** The normalised spec: what the engines, the props view, the bridge and the share link all get. */
  spec: PatientSpec;
  /** Everything normalisation changed or dropped, plus the neonate's dropped coronary lesions. */
  warnings: string[];
}

/**
 * Join the Scenario (`scenario`: normally `sim.scenario()`) and the playground state into one normalised PatientSpec.
 *  - A neonate has no coronary tree: its lesions are dropped, with a warning.
 *  - The device switches are the legacy booleans' only source: `support.impella` / `support.iabp` follow `devices.impella` / `devices.iabp`.
 *  - Empty sections are left out, so a normal adult is `{}` plus its Scenario.
 * Pure: neither input is changed.
 */
export function buildPlaygroundSpec(scenario: Scenario, state: PlaygroundState): BuiltPatient {
  const extra: string[] = [];
  const raw: PatientSpec = scenarioOf(clone(scenario));
  const kind = state.kind ?? "adult";
  if (kind === "neonate") {
    raw.kind = "neonate";
    if (raw.lesions?.length) { extra.push(`a neonate has no coronary tree: ${raw.lesions.length === 1 ? "the coronary lesion was" : `${raw.lesions.length} coronary lesions were`} dropped`); delete raw.lesions; }
  }
  const heart = state.structural ? heartOfPick(state.structural) : clone(state.heart);
  if (!isEmpty(heart)) raw.heart = heart;
  for (const k of ["pericardium", "fluids", "ventilation"] as const) { const v = clone(state[k]); if (!isEmpty(v)) (raw as Record<string, unknown>)[k] = v; }
  const dev = clone(state.devices);
  if (!isEmpty(dev)) raw.devices = dev;
  raw.support = { ...(raw.support ?? {}), impella: !!dev?.impella, iabp: !!dev?.iabp };
  const n = normalizePatient(raw);
  return { spec: n.spec, warnings: [...extra, ...n.warnings] };
}

/** Switch on or off one device with its defaults (the legacy booleans' meaning); off removes its settings. */
export function withDevice(state: PlaygroundState, id: "impella" | "iabp" | "ecmo" | "impellaRp", on: boolean): PlaygroundState {
  const devices: DeviceSpec = { ...(state.devices ?? {}) };
  if (!on) delete devices[id];
  else if (!devices[id]) {
    if (id === "impella") devices.impella = { ...DEFAULT_IMPELLA };
    else if (id === "iabp") devices.iabp = { ...DEFAULT_IABP };
    else if (id === "ecmo") devices.ecmo = { flowLpm: 3, sweepLpm: 2, fio2: 0.6 };
    else devices.impellaRp = { level: 4 };
  }
  return { ...state, devices: isEmpty(devices) ? undefined : devices };
}

/** Set some fields of one section, keeping the rest; a section left empty is removed. Pure. */
export function patchSection<K extends "pericardium" | "fluids" | "ventilation">(state: PlaygroundState, key: K, patch: Partial<NonNullable<PlaygroundState[K]>>): PlaygroundState {
  const next = { ...(state[key] ?? {}), ...patch } as Record<string, unknown>;
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  return { ...state, [key]: isEmpty(next) ? undefined : next };
}

/** Set some settings of one device (it is switched on if it was off). Pure. */
export function patchDevice<K extends "impella" | "iabp" | "ecmo" | "impellaRp">(state: PlaygroundState, id: K, patch: Partial<NonNullable<DeviceSpec[K]>>): PlaygroundState {
  const on = withDevice(state, id, true);
  return { ...on, devices: { ...on.devices, [id]: { ...(on.devices![id] ?? {}), ...patch } } };
}

/** The first bolus (kind and ml) of the fluids section, other doses kept. A 0 ml bolus removes it. Pure. */
export function withBolus(state: PlaygroundState, kind: NonNullable<FluidSpec["given"]>[number]["kind"], ml: number): PlaygroundState {
  const rest = (state.fluids?.given ?? []).slice(1), first = state.fluids?.given?.[0];
  const given = ml > 0 ? [{ ...(first ?? {}), kind, ml }, ...rest] : rest;
  return patchSection(state, "fluids", { given: given.length ? given : undefined });
}

/** True when the spec carries anything the plain simulator would not show (decides whether a shared link opens in playground mode). */
export const hasPlaygroundFields = (spec: PatientSpec) => PLAYGROUND_FIELDS.some((k) => spec[k] !== undefined);
