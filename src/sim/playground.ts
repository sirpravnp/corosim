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
  /** Ventricular interdependence through the septum (`PatientSpec.septum`). */
  septum?: boolean;
  fluids?: FluidSpec;
  ventilation?: VentilationSpec;
  devices?: DeviceSpec;
}

/** The PatientSpec fields the playground controls own; everything else in a spec is the Scenario. */
export const PLAYGROUND_FIELDS = ["kind", "heart", "pericardium", "septum", "fluids", "ventilation", "devices"] as const;

/**
 * What the page's engines read, per group of fields (task P16). An adult runs on the core engine, live beat by beat; a neonate on the
 * bridge (a steady-state solve of the structural engine on its own baseline, replayed), because the core is the adult ACS patient.
 * `modelled` is the adult's badge; `neonate`, when it differs, the neonate's (with `neonateNote`). What is not read is stored in the
 * spec and the share link, nothing more.
 */
export type Modelled = "yes" | "legacy" | "no";
export interface FieldGroupInfo { id: string; label: string; modelled: Modelled; note: string; neonate?: Modelled; neonateNote?: string }
const NEONATE_BRIDGE = "A neonate runs on the bridge, which has no pericardium, thorax or devices: stored in the spec and shared.";
export const GROUP_INFO: Record<string, FieldGroupInfo> = {
  kind: { id: "kind", label: "Patient kind", modelled: "yes", note: "An adult runs on the live core engine (beat by beat). A neonate runs on the bridge: the structural engine solved on the newborn's own baseline and replayed. The ACS monitor and ECG are adult models either way." },
  heart: { id: "heart", label: "Structural heart", modelled: "yes", note: "Adult: the core engine builds every field (Gorlin valves, shunts, chamber sizes, per-ventricle elastance and stiffness) and the monitor, traces, loops and JVP all see it. Neonate: the bridge's structural engine reads it." },
  pericardium: { id: "pericardium", label: "Pericardium", modelled: "yes", note: "Core engine: effusion, accumulation rate (per clinical minute), stiffness (constriction) and an opened pericardium, a pericardiocentesis button, and the septum switch (ventricular interdependence: the septum bows toward the lower-pressure ventricle). The sac does not stretch over days, so a slow effusion is no better tolerated than a fast one.", neonate: "no", neonateNote: NEONATE_BRIDGE },
  fluids: { id: "fluids", label: "Fluids and hemorrhage", modelled: "yes", note: "Core engine (C2): boluses of crystalloid, colloid, albumin or blood (amount, start and duration) and the bleeding rate move water between plasma and interstitium by the Starling forces (capillary and oncotic pressure, lymph), set the blood volume the heart holds, dilute or concentrate Hb, and drive urine; the capillary leak raises filtration and protein escape. Passive leg raise is not modelled yet (C4).", neonate: "no", neonateNote: NEONATE_BRIDGE },
  ventilation: { id: "ventilation", label: "Ventilation", modelled: "yes", note: "Core engine: spontaneous breathing or positive-pressure ventilation with PEEP and tidal volume put the pleural pressure on the chest vessels and the heart, and a smaller swing on the abdomen (pulsus paradoxus, pulse-pressure variation, PEEP reducing venous return). The lungs' own resistance does not change with inflation.", neonate: "no", neonateNote: NEONATE_BRIDGE },
  impella: { id: "impella", label: "Impella", modelled: "yes", note: "Core engine: model (2.5, CP, 5.5), P-level and position (correct, in the aorta, too deep) set the flow, the unloading of the left ventricle, suction and the console readings. Changing the model or the position rebuilds the heart.", neonate: "no", neonateNote: NEONATE_BRIDGE },
  iabp: { id: "iabp", label: "Balloon pump", modelled: "yes", note: "Core engine: a real balloon in the descending aorta: ratio 1:1 to 1:3, inflation and deflation timing offsets and balloon volume shape the aortic trace, the diastolic augmentation and the unloading.", neonate: "no", neonateNote: NEONATE_BRIDGE },
  ecmo: { id: "ecmo", label: "ECMO", modelled: "yes", note: "Core engine: VA-ECMO drains the right atrium and returns oxygenated blood to the descending aorta at the set flow (pump speed is solved for it); sweep gas and FiO₂ set the return saturation, and differential hypoxemia follows from the lungs and the circuit perfusing different parts of the body. The left ventricle is not vented unless something else vents it.", neonate: "no", neonateNote: NEONATE_BRIDGE },
  impellaRp: { id: "impellaRp", label: "Impella RP", modelled: "yes", note: "Core engine: inflow from the inferior vena cava, outflow into the pulmonary artery, by P-level.", neonate: "no", neonateNote: NEONATE_BRIDGE },
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
  if (spec.septum) st.septum = true;
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
  if (state.septum) raw.septum = true;
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
