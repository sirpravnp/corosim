import { Scenario } from "./scenario";
import type { PatientSpec } from "./patient";

/** Compact reference an LLM needs to build or edit a scenario without any tools. */
export const SCENARIO_REFERENCE = `Scenario JSON (all fields optional; omitted = typical resting adult):
{
  "anatomy": { "dominance": "right|co|left", "lm": "bifurcation|trifurcation|absent", "saNodeFrom": "RCA|LCx", "conusOstium": "shared|separate", "ladCourse": "normal|short|wrap" },
  "lesions": [ { "artery": "LAD|LM|D1|D2|RAMUS|LCX|OM1|OM2|RCA|AM|PDA|PLV|SAN|AVN|CONUS", "stenosis": 0.0-0.99 (diameter fraction), "occluded": false, "position": 0 proximal .. 1 distal } ],
  "exertion": false,
  "bloodLoss": -0.3 .. 0.6   (fraction of blood volume; 0.15 = class II hemorrhage),
  "drugs": { "betaBlocker": 0..1, "atropine": 0..1, "vasopressor": -1 (vasodilator) .. 1 (phenylephrine-like) },
  "patient": { "rhythm": "sinus|af", "bbb": "none|rbbb|lbbb" },
  "support": { "fluids": 0..3 (litres), "norepinephrine": 0..1, "dobutamine": 0..1, "nitroglycerin": 0..1, "pacing": false, "paceRate": 40..120, "iabp": false, "impella": false },
  "autonomic": { "baroreflexGain": 0 (denervated) .. 1 (normal) .. 4, "respRate": 4..40, "respDepth": 0..2, "setPointShift": -30..60 mmHg, "noise": 0..3 },
  "seed": integer,
  (PatientSpec additions, all optional:)
  "kind": "adult|neonate",
  "heart": { "valves": { "av|mv|tv|pv": { "open": 0..1 (1 = normal orifice), "reg": 0..10 (regurgitant orifice, cm2) } }, "pda|asd|vsd|bt": { "diameterMm": 0..40 }, "tof": { "vsdMm", "rvotFrac": 0..1, "spasm": 0..1 }, "pvri": 0.2..60 (WU.m2), "svrScale": 0.1..5, "satLung": 0.3..1, "volumeMl": -1000..5000, "lvSize|laSize|rvSize|raSize": 0.05..4, "rvContractility": 0.2..5 },
  "pericardium": { "effusionMl": 0..2000, "effusionRateMlMin": 0..100, "stiffness": 0.2..10 (1 normal), "open": false, "drainMl": 0..2000 (pericardiocentesis: ml removed now, an action in a patch, never stored) },
  "septum": false   (true = ventricular interdependence: a failing right ventricle bows the septum into the left),
  "fluids": { "given": [ { "kind": "crystalloid|colloid|albumin|blood", "ml": 0..5000, "atMin": 0..1440, "overMin": 0..1440 } ], "hemorrhageMlMin": 0..500, "capillaryLeak": 0..1, "legRaise": false },
  "ventilation": { "mode": "spontaneous|positive", "peep": 0..25 (cmH2O), "tidalMlKg": 2..15 },
  "devices": { "impella": { "model": "2.5|CP|5.5", "level": 0..9 (P-level), "position": "correct|aortic|deep" }, "impellaRp": { "level": 0..9 }, "iabp": { "ratio": 1|2|3, "inflateMs": -100..100, "deflateMs": -100..100, "volumeMl": 0..50 }, "ecmo": { "flowLpm": 0..7, "sweepLpm": 0..10, "fio2": 0.21..1 } }
  (support.iabp / support.impella = true mean devices.iabp 1:1, correct timing, 40 ml / devices.impella CP, P6, correct position.)
}`;

/** URL-safe base64 of a patient, for share links and the app's #s= hash. A Scenario is a valid PatientSpec, so old links are unchanged. */
export function encodePatient(s: PatientSpec): string {
  const json = JSON.stringify(s);
  const b64 = typeof Buffer !== "undefined" ? Buffer.from(json, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodePatient(s: string): PatientSpec {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const json = typeof Buffer !== "undefined" ? Buffer.from(b64, "base64").toString("utf8") : decodeURIComponent(escape(atob(b64)));
  return JSON.parse(json) as PatientSpec;
}
/** The same encoding, typed for a Scenario. */
export function encodeScenario(s: Scenario): string { return encodePatient(s); }
export function decodeScenario(s: string): Scenario { return decodePatient(s); }
