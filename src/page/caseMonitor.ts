// The bedside monitor's numbers, DOM-free. A tile shows a measurement, never a verdict: no rhythm name, no "Stable" or "Shock" (the learner reads the tracing).

export interface Tile {
  id: "hr" | "bp" | "spo2" | "rr" | "temp";
  label: string;
  value: string;
  unit: string;
  abnormal: boolean;
  /** Respiratory rate and temperature are estimates in this model (src/sim/bedside.ts). */
  estimate: boolean;
}

/** The fields of the page's patient snapshot (PatientNow) that the monitor reads. Any of them may be NaN or missing. */
export interface MonitorInput {
  hr: number; sbp: number; dbp: number; map: number;
  spo2: number; respRate: number; tempC: number;
  arrest: "none" | "arrest" | "rosc" | "dead";
}

// Where a value turns abnormal. [assumed] teaching thresholds, not a clinical standard.
const HR_RANGE = [50, 110], MAP_MIN = 65, SPO2_MIN = 0.9, RR_RANGE = [8, 22], TEMP_RANGE = [36, 38];

const DASH = "—";
const ok = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const out = (x: number, lo: number, hi: number) => x < lo || x > hi;

/** Tiles for the monitor items shown, in the fixed order HR, BP, SpO2, RR, Temp. `ecg` is the strip above the tiles, not a tile. */
export function monitorTiles(n: MonitorInput, shown: readonly string[]): Tile[] {
  const pulseless = n.arrest === "arrest" || n.arrest === "dead";
  const tiles: Tile[] = [];
  const add = (t: Tile) => { if (shown.includes(t.id)) tiles.push(t); };

  add(pulseless
    ? { id: "hr", label: "Heart rate", value: "no pulse", unit: "", abnormal: true, estimate: false }
    : ok(n.hr) && n.hr > 0
      ? { id: "hr", label: "Heart rate", value: String(Math.round(n.hr)), unit: "bpm", abnormal: out(n.hr, HR_RANGE[0], HR_RANGE[1]), estimate: false }
      : { id: "hr", label: "Heart rate", value: DASH, unit: "bpm", abnormal: false, estimate: false });

  add(pulseless
    ? { id: "bp", label: "Blood pressure", value: "no pulse", unit: "", abnormal: true, estimate: false }
    : ok(n.sbp) && ok(n.dbp) && ok(n.map)
      ? { id: "bp", label: "Blood pressure", value: `${Math.round(n.sbp)}/${Math.round(n.dbp)} (${Math.round(n.map)})`, unit: "mmHg", abnormal: n.map < MAP_MIN, estimate: false }
      : { id: "bp", label: "Blood pressure", value: DASH, unit: "mmHg", abnormal: false, estimate: false });

  add(!pulseless && ok(n.spo2)
    ? { id: "spo2", label: "SpO2", value: String(Math.round(n.spo2 * 100)), unit: "%", abnormal: n.spo2 < SPO2_MIN, estimate: false }
    : { id: "spo2", label: "SpO2", value: DASH, unit: "%", abnormal: false, estimate: false });

  add(ok(n.respRate)
    ? { id: "rr", label: "Respiratory rate", value: String(Math.round(n.respRate)), unit: "/min", abnormal: out(n.respRate, RR_RANGE[0], RR_RANGE[1]), estimate: true }
    : { id: "rr", label: "Respiratory rate", value: DASH, unit: "/min", abnormal: false, estimate: true });

  add(ok(n.tempC)
    ? { id: "temp", label: "Temperature", value: n.tempC.toFixed(1), unit: "°C", abnormal: out(n.tempC, TEMP_RANGE[0], TEMP_RANGE[1]), estimate: true }
    : { id: "temp", label: "Temperature", value: DASH, unit: "°C", abnormal: false, estimate: true });

  return tiles;
}

/** The workspace panels a case session opens: only those the learner ordered. `ecg` and the vitals are the bedside monitor, not panels; `monitor` is never opened. */
export function casePanels(ids: readonly string[], panelOf: (id: string) => string | undefined): string[] {
  const out: string[] = [];
  for (const id of ids) { const p = panelOf(id); if (p && p !== "monitor" && !out.includes(p)) out.push(p); }
  return out;
}

/** The screen-reader label of a tile: the value and, because color alone must not carry it, the state. */
export function tileLabel(t: Tile): string {
  const v = t.value === "—" ? "no reading" : `${t.value}${t.unit ? " " + t.unit : ""}`;
  return `${t.label} ${v}${t.abnormal ? ", abnormal" : ""}${t.estimate ? ", estimate" : ""}`;
}

/** True when a refresh is owed: no refresh yet, the clock went backwards, or at least `periodMs` passed. */
export function due(lastMs: number, nowMs: number, periodMs: number): boolean {
  return !Number.isFinite(lastMs) || nowMs < lastMs || nowMs - lastMs >= periodMs;
}
