import { Simulation } from "./simulation";
import { explain } from "./explain";
import { Scenario } from "./scenario";

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
  "seed": integer
}`;

/**
 * A self-contained block of text that any chat assistant can work from: the scenario, what the model
 * computed, grounded mechanisms, and how to ask for changes. Paste it into Claude or ChatGPT.
 */
export function describeForLlm(sim: Simulation, opts: { link?: string } = {}): string {
  const ex = explain(sim);
  const m = sim.metrics(Math.min(sim.t, 60));
  const st = sim.state();
  const lines = [
    "# CoroSim state (educational simulation, not for clinical decisions)",
    "",
    "You are helping someone learn physiology. Explain using ONLY the model output below; if something is not in it, say the model does not compute that. Quote numbers. Distinguish what the model computes from general physiology you add.",
    "",
    `## Headline\n${ex.headline}\n${ex.vitals}`,
    `Simulated time: ${st.timeS} s.${opts.link ? ` Open in the app: ${opts.link}` : ""}`,
    "",
    "## Scenario (editable JSON)",
    "```json",
    JSON.stringify(sim.scenario(), null, 2),
    "```",
    "",
    "## Last 60 s of beats",
    "```json",
    JSON.stringify({ hr: m.hr, sbp: m.sbp, dbp: m.dbp, map: m.map, strokeVolume: m.strokeVolume, pvcs: m.pvcs, hrv: m.hrv, baroreflexSensitivity: m.baroreflexSensitivity, respiratorySinusArrhythmia: m.respiratorySinusArrhythmia }, null, 2),
    "```",
    "",
    "## Mechanisms the model identified",
    ...(ex.mechanisms.length ? ex.mechanisms.map((x) => `- ${x}`) : ["- None: this is the typical resting patient."]),
    "",
    "## Teaching points",
    ...ex.teachingPoints.map((x) => `- ${x}`),
    "",
    "## How to change the patient",
    "Reply with a modified Scenario JSON and I will paste it back in (Scenario → paste), or, if you have the CoroSim MCP tools, call corosim_set_scenario / corosim_adjust.",
    SCENARIO_REFERENCE,
    "",
    "## Limits",
    ...ex.caveats.map((x) => `- ${x}`),
  ];
  return lines.join("\n");
}

/** URL-safe base64 of a scenario, for share links and the app's #s= hash. */
export function encodeScenario(s: Scenario): string {
  const json = JSON.stringify(s);
  const b64 = typeof Buffer !== "undefined" ? Buffer.from(json, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeScenario(s: string): Scenario {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const json = typeof Buffer !== "undefined" ? Buffer.from(b64, "base64").toString("utf8") : decodeURIComponent(escape(atob(b64)));
  return JSON.parse(json) as Scenario;
}
