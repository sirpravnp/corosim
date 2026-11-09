// One state per patient field at its low, middle and high value (scripts/eval/states.ts pulls these in).
// Display fields and `seed` are not swept: display does not change the engine, and the harness owns the seed.
// A lesion is paired with an artery. Devices that are built into the heart are applied with setPatient (see engine.ts).
import { FIELDS } from "../../src/sim/registry";
import type { PatientSpec } from "../../src/sim/patient";
import type { State } from "./states";

interface Level { level: "low" | "mid" | "high"; value: unknown }

const setPath = (path: string, value: unknown): PatientSpec => {
  const parts = path.split(".");
  const root: Record<string, unknown> = {};
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) { const n: Record<string, unknown> = {}; cur[parts[i]] = n; cur = n; }
  cur[parts[parts.length - 1]] = value;
  return root as PatientSpec;
};

const three = (xs: unknown[]): Level[] => {
  if (xs.length <= 2) return xs.map((value, i) => ({ level: i === 0 ? "low" : "high", value }));
  return [
    { level: "low", value: xs[0] },
    { level: "mid", value: xs[Math.floor((xs.length - 1) / 2)] },
    { level: "high", value: xs[xs.length - 1] },
  ];
};

/** Object and array fields have no single minimum. Each is three concrete patients, low to high. */
const OBJECTS: Record<string, Level[]> = {
  lesions: [
    { level: "low", value: [{ artery: "LAD", stenosis: 0.2, position: 0.2 }] },
    { level: "mid", value: [{ artery: "LAD", stenosis: 0.7, position: 0.2 }] },
    { level: "high", value: [{ artery: "LAD", occluded: true, position: 0.2 }] },
  ],
  "fluids.given": [
    { level: "low", value: [{ kind: "crystalloid", ml: 250, atMin: 0, overMin: 10 }] },
    { level: "mid", value: [{ kind: "colloid", ml: 1000, atMin: 0, overMin: 20 }] },
    { level: "high", value: [{ kind: "blood", ml: 2000, atMin: 0, overMin: 30 }] },
  ],
  "heart.tof": [
    { level: "low", value: { vsdMm: 5, rvotFrac: 0.8, override: 0.2, spasm: 0, rvHypertrophy: 1 } },
    { level: "mid", value: { vsdMm: 15, rvotFrac: 0.4, override: 0.5, spasm: 0.2, rvHypertrophy: 2 } },
    { level: "high", value: { vsdMm: 30, rvotFrac: 0.15, override: 0.8, spasm: 0.6, rvHypertrophy: 4 } },
  ],
};
for (const k of ["pda", "asd", "vsd", "bt"]) OBJECTS[`heart.${k}`] = [
  { level: "low", value: { diameterMm: 0 } },
  { level: "mid", value: { diameterMm: 20 } },
  { level: "high", value: { diameterMm: 40 } },
];
const PROSTHESIS_SIZE: Record<string, [number, number]> = { av: [19, 34], mv: [25, 33], tv: [27, 36], pv: [19, 29] };
for (const [k, [lo, hi]] of Object.entries(PROSTHESIS_SIZE)) OBJECTS[`heart.valves.${k}.prosthesis`] = [
  { level: "low", value: { kind: "bioprosthetic", sizeMm: lo } },
  { level: "mid", value: { kind: "mechanical", sizeMm: Math.round((lo + hi) / 2) } },
  { level: "high", value: { kind: "transcatheter", sizeMm: hi, inRing: k === "av" } },
];

function levelsOf(schema: Record<string, unknown>): Level[] | null {
  if (Array.isArray(schema.enum) && schema.enum.length) return three(schema.enum);
  if (schema.type === "boolean") return [{ level: "low", value: false }, { level: "high", value: true }];
  if (schema.type === "number" || schema.type === "integer") {
    const lo = schema.minimum, hi = schema.maximum;
    if (typeof lo !== "number" || typeof hi !== "number") return null;
    return [{ level: "low", value: lo }, { level: "mid", value: (lo + hi) / 2 }, { level: "high", value: hi }];
  }
  return null;
}

export function sweepStates(): State[] {
  const out: State[] = [];
  const patient = FIELDS.filter((f) => f.target === "patient");
  if (patient.length !== 93) throw new Error(`expected 93 patient fields, found ${patient.length}`);
  for (const f of patient) {
    if (f.path === "seed") continue;
    const levels = OBJECTS[f.path] ?? levelsOf(f.schema);
    if (!levels) throw new Error(`no sweep values for ${f.path}`);
    for (const L of levels) {
      const id = `sweep-${f.path.replace(/\./g, "_")}-${L.level}`;
      out.push({
        id, suite: "sweep", seeds: 1, invariantsOnly: true,
        title: `${f.path} = ${JSON.stringify(L.value)} (${L.level})`,
        // A pace rate does nothing unless pacing is on, and pacing only captures when the sinus is at or under that rate (simulation.ts paced()).
        insult: f.path === "support.paceRate" ? { support: { pacing: true, paceRate: L.value as number } } : setPath(f.path, L.value),
        sweep: { field: f.path, level: L.level, value: JSON.stringify(L.value), noPageControl: f.controls.length === 0 },
      });
    }
  }
  return out;
}

/** The patient fields the sweep does not run, so the report can still list all 93. */
export const SWEEP_SKIPPED: { field: string; why: string }[] = [
  { field: "seed", why: "the harness sets the seed; sweeping it would re-roll the baseline instead of testing a control" },
];
