// ---------------------------------------------------------------- versions: the simulator alone, or with the cases
import { Scenario } from "../sim/scenario";
import { encodeScenario, encodePatient } from "../sim/llm";
import { TOOLS } from "../mcp/tools";
import { mountShell } from "../shell/shell";
import { joinPatient } from "../sim/crossLinks";
import { mountCrossLinks } from "../shell/crossLinkRow";
import { $, sim, K, inCases, setInCases, patientOpts } from "./state";
import { casesUi } from "./cases";
import { adoptSimState, loadScenario } from "./model";

/** The page at /cases/ runs the cases; anywhere else (/sim/) it is the plain simulator. The links between them
 *  and to the homepage are relative, so the site still works under any URL. */
/** The cath lab link opens the patient on screen (/cath/#s=…) when it is followed. In the cases it stays plain: the angiogram would show the diagnosis. */
let cathBase = "./cath/";
/** The shared header and footer; its AI control runs the tools on the patient on screen (see runForAi). */
export let shell: ReturnType<typeof mountShell>;
/** The patient on screen: the simulator's scenario plus the structural sections of a shared link (heart, kind), which the Simulation does not keep. */
const currentPatient = () => joinPatient(sim.scenario(), patientOpts.patient);
export function cathLinkUi() {
  const a = shell.menuLink("cath")!, b = $("openCath") as HTMLAnchorElement; // the page menu's link and the Reperfuse tab's
  const point = () => { a.href = b.href = inCases ? cathBase : `${cathBase}#s=${encodePatient(currentPatient())}`; };
  const row = mountCrossLinks($("xlinks"), "sim", "../", currentPatient, { skip: ["cath"], hidden: () => inCases }); // the other pages; the cases show none (they would reveal the diagnosis)
  addEventListener("hashchange", () => row.refresh());
  for (const el of [a, b]) for (const ev of ["pointerdown", "focus", "mouseenter", "contextmenu", "touchstart"]) el.addEventListener(ev, point);
  a.title = "Open this patient in the cath lab"; a.setAttribute("aria-label", "Open in cath lab");
}
export function applyMode() {
  const cases = /\/cases(\/(index\.html)?)?$/.test(location.pathname); // /cases, /cases/ or /cases/index.html
  const root = /\/(sim|cases)\/(index\.html)?$/.test(location.pathname) ? "../" : "./"; // the site's root: the homepage
  cathBase = root + "cath/";
  shell.menuLink("cath")!.href = cathBase; ($("openCath") as HTMLAnchorElement).href = cathBase;
  $("openCath").hidden = cases; // the cases keep the diagnosis hidden
  (document.querySelector(".c-plain") as HTMLAnchorElement).href = root + "sim/";
  setInCases(cases);
  shell.setPage(cases ? "cases" : "sim");
  shell.ai.setHidden(cases); // the cases page has no AI line: an AI on the line could read the diagnosis
  document.title = cases ? "CoroSim · Cases" : "CoroSim";
  casesUi();
}

/** A link that opens this patient in the simulator: /sim/#s=…, from either page. */
const appLink = () => `${location.origin}${location.pathname.replace(/(sim|cases)\/?(index\.html)?$/, "")}sim/#s=${encodeScenario(sim.scenario())}`;
// ---------------------------------------------------------------- connect your AI: a live MCP line to this page
/** Each tool call from the AI runs here, on the patient on screen; the controls then follow what it changed. */
function runForAi(name: string, args: Record<string, unknown>) {
  if (K.phase === "run") throw new Error("The user is in the middle of a case; the AI connection is paused until it ends.");
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  sim.settleNow(); // the tools read the live heart
  const stream = sim.stream, t0 = sim.t, sig = JSON.stringify(sim.scenario());
  const result = tool.run({ sim, appUrl: appLink().split("#")[0] }, args);
  if (sim.stream !== stream || sim.t !== t0 || JSON.stringify(sim.scenario()) !== sig) adoptSimState(sim.stream !== stream);
  shell.ai.live!.snapshot(sim.scenario());
  return result;
}
/** An AI changed the saved patient while this page was closed: pick up where it left off. */
function restoreFromServer(sc: Scenario) {
  if (K.phase === "run") return; // a case owns the patient; the saved one waits for next time
  const w = loadScenario(sc);
  shell.ai.note("Picked up the patient your AI left while this page was closed" + (w.length ? ` (adjusted: ${w.join("; ")})` : "."));
}
/** Mount the shell (header, footer, AI line) and keep the server's copy of the patient current. */
export function initShell() {
  shell = mountShell({ page: "sim", root: "../", ai: { run: (name, args) => runForAi(name, args), restore: (sc) => restoreFromServer(sc), version: "0.4.0" } });
  // Keep the server's copy of this patient current as it is edited here, so the AI works on it with the page closed.
  setInterval(() => { if (K.phase !== "run") shell.ai.live!.snapshot(sim.scenario()); }, 3000);
}
