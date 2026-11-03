// Lists every variable the headless engine can report, flattened to a path, with its value for one scenario.
//   npx tsx scripts/eval/inventory.ts
// Sources are the same objects the panels read: Simulation.state/ecg/hemo/fluids/drugState/coronarySupply/metrics/assessment,
// LiveSource (numbers, saturations, devices: Monitor, Hemodynamics, Oxygen panels) and the cath-lab readers (sim/cath.ts).
import { Simulation } from "../../src/sim/simulation";
import { LiveSource } from "../../src/sim/liveSource";
import { cathReport } from "../../src/sim/cath";

const s = new Simulation({}, { engine: "core" });
s.reset({ seed: 1, lesions: [{ artery: "LAD", stenosis: 0.8, position: 0.3 }], support: { impella: true } }, { settled: true, warmup: 30 });
s.warmup(10); s.step(30);
const src = new LiveSource(s);

const flat = (x: unknown, p: string, out: Record<string, unknown>) => {
  if (x && typeof x === "object" && !(x instanceof Float32Array) && !(x instanceof Float64Array)) {
    if (Array.isArray(x)) { if (x.length && typeof x[0] === "object") x.slice(0, 1).forEach((v) => flat(v, `${p}[]`, out)); else out[p] = `[${x.length}]`; }
    else for (const [k, v] of Object.entries(x)) flat(v, p ? `${p}.${k}` : k, out);
  } else if (ArrayBuffer.isView(x)) out[p] = `[series ${(x as any).length}]`;
  else out[p] = x;
};
const out: Record<string, unknown> = {};
const safe = (name: string, f: () => unknown) => { try { flat(f(), name, out); } catch (e) { out[name] = `ERR ${(e as Error).message}`; } };
safe("state", () => { const { lastBeat, ...r } = s.state() as any; return r; });
safe("ecg", () => s.ecg());
safe("hemo", () => s.hemo(20));
safe("rolling", () => s.rolling(20));
safe("metrics", () => s.metrics(30));
safe("fluids", () => s.fluids());
safe("drugs", () => s.drugState());
safe("coronary", () => s.coronarySupply());
safe("devices", () => s.devices());
safe("pericardium", () => s.pericardium());
safe("assessment", () => s.assessment());
safe("vitals", () => src.vitals());
safe("numbers", () => src.numbers());
safe("saturations", () => src.saturations());
safe("consoles", () => src.devices().map((d) => ({ id: d.id, readings: d.readings, alarms: d.alarms })));
safe("cath", () => { const r: any = cathReport(s); return r; });
for (const [k, v] of Object.entries(out)) console.log(`${k}\t${typeof v === "number" ? +v.toFixed(3) : JSON.stringify(v)}`);
