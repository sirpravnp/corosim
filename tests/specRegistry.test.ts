import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ACTIONS, DOCK_TABS, FIELDS, FIELD_PATHS, displaySchema, patientProperties } from "../src/sim/registry";
import { HEART_KEYS, normalizePatient } from "../src/sim/patient";
import { TOOLS, anthropicTools, openAiTools } from "../src/mcp/tools";
import { createPlaygroundUi } from "../src/panels/playgroundControls";

/** Parity (SIMULATOR_PLAN D1): every control has a field, every field reaches the MCP schema, every schema property has a field. */
const html = readFileSync(new URL("../sim/index.html", import.meta.url), "utf8");

type Schema = { properties?: Record<string, Schema>; items?: Schema; [k: string]: unknown };
const tool = (name: string) => TOOLS.find((t) => t.name === name)!.inputSchema as Schema;
/** The schemas a patient goes through: set_scenario, adjust, compare. */
const patientSchemas: [string, Schema][] = [
  ["corosim_set_scenario.scenario", tool("corosim_set_scenario").properties!.scenario],
  ["corosim_adjust.patch", tool("corosim_adjust").properties!.patch],
  ["corosim_compare.scenarios[].scenario", tool("corosim_compare").properties!.scenarios.items!.properties!.scenario],
];
const displayIn = tool("corosim_show").properties!.display;

/** Resolve a dotted path in a schema; undefined if any step is missing. */
function resolve(root: Schema, path: string): Schema | undefined {
  let n: Schema | undefined = root;
  for (const p of path.split(".")) { n = n?.properties?.[p]; if (!n) return undefined; }
  return n;
}
/** The paths of every schema property below `n`, not descending into a path the registry names whole (arrays, kept objects). */
function leaves(n: Schema, prefix: string, out: string[] = []): string[] {
  for (const [k, v] of Object.entries(n.properties ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (FIELD_PATHS.has(p) || !v.properties) out.push(p); else leaves(v, p, out);
  }
  return out;
}

describe("the registry", () => {
  it("lists each path once, in a tab that exists", () => {
    expect(new Set(FIELDS.map((f) => f.path)).size).toBe(FIELDS.length);
    for (const f of FIELDS) expect([...DOCK_TABS, "display"], f.path).toContain(f.tab);
    for (const f of FIELDS) expect(f.target === "display", f.path).toBe(f.path.startsWith("display."));
  });
  it("covers every heart key the spec takes", () => {
    for (const k of HEART_KEYS) expect(FIELDS.some((f) => f.path === `heart.${k}` || f.path.startsWith(`heart.${k}.`)), k).toBe(true);
  });
  it("has the fields the chat was missing: all library rhythms, valve prostheses, pericardium, display", () => {
    const rhythm = resolve(patientSchemas[0][1], "patient.rhythm")!.enum as string[];
    expect(rhythm).toEqual(expect.arrayContaining(["sinus", "af", "flutter-21", "svt", "vt-mono", "vf-coarse", "chb", "paced"]));
    for (const v of ["av", "mv", "tv", "pv"]) expect(resolve(patientSchemas[0][1], `heart.valves.${v}.prosthesis.kind`)?.enum).toEqual(["bioprosthetic", "mechanical", "transcatheter"]);
    for (const k of ["effusionMl", "effusionRateMlMin", "stiffness", "open", "drainMl"]) expect(resolve(patientSchemas[0][1], `pericardium.${k}`), k).toBeDefined();
    expect(Object.keys(displayIn.properties!)).toEqual(expect.arrayContaining(["mode", "heart", "view", "labels", "flow", "valves", "posteriorLeads"]));
  });
});

describe("MCP schema parity", () => {
  for (const [name, root] of patientSchemas) {
    it(`${name}: every patient field has a schema entry, and every schema property has a field`, () => {
      for (const f of FIELDS.filter((x) => x.target === "patient")) expect(resolve(root, f.path), `${f.path} missing from ${name}`).toEqual(f.schema);
      for (const p of leaves(root, "")) expect(FIELD_PATHS.has(p), `${p} is in ${name} but has no field in src/sim/registry.ts`).toBe(true);
    });
  }
  it("corosim_show.display: same both ways", () => {
    for (const f of FIELDS.filter((x) => x.target === "display")) expect(resolve(displayIn, f.path.slice("display.".length)), f.path).toEqual(f.schema);
    for (const p of leaves(displayIn, "display")) expect(FIELD_PATHS.has(p), `${p} has no field`).toBe(true);
  });
  it("the exports for other assistants carry the same schema", () => {
    const want = JSON.stringify(patientProperties());
    const o = openAiTools().find((t) => t.function.name === "corosim_set_scenario")!.function.parameters as Schema;
    const a = anthropicTools().find((t) => t.name === "corosim_set_scenario")!.input_schema as Schema;
    expect(JSON.stringify(o.properties!.scenario.properties)).toBe(want);
    expect(JSON.stringify(a.properties!.scenario.properties)).toBe(want);
    expect(JSON.stringify(displaySchema())).toBe(JSON.stringify(tool("corosim_show").properties!.display));
  });
  it("valve interventions are a tool, and the actions the page has map to tools that exist", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("corosim_valve");
    for (const [id, a] of Object.entries(ACTIONS)) if (a.tool) expect(names, id).toContain(a.tool);
  });
  it("every field of the spec sections the engine reads is accepted by normalizePatient without a warning", () => {
    for (const f of FIELDS.filter((x) => x.target === "patient" && /^(heart|pericardium|ventilation|devices|fluids\.(hemorrhage|capillary|legRaise))/.test(x.path))) {
      const s = f.schema as { type?: string; enum?: unknown[]; minimum?: number; maximum?: number };
      const v = s.enum ? s.enum[0] : s.type === "number" ? (s.minimum! + s.maximum!) / 2 : s.type === "boolean" ? true : undefined;
      if (v === undefined) continue;
      const spec: Record<string, unknown> = {};
      let o = spec; const parts = f.path.split(".");
      parts.forEach((p, i) => { if (i === parts.length - 1) o[p] = v; else o = (o[p] = {}) as Record<string, unknown>; });
      const r = normalizePatient(spec);
      expect(r.warnings, f.path).toEqual([]);
      let got: unknown = r.spec; for (const p of parts) got = (got as Record<string, unknown> | undefined)?.[p];
      expect(got, f.path).toBeDefined();
    }
  });
});

describe("page parity", () => {
  const section = (from: string, to: string) => { const a = html.indexOf(from), b = html.indexOf(to, a); expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a); return html.slice(a, b); };
  const ids = (h: string) => [...h.matchAll(/<(?:button|input|select|a)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);

  it("the dock's tabs are the registry's tabs, each with a pane", () => {
    const dock = section('<section id="dock"', '<section class="ws-sec"');
    const tabs = [...dock.matchAll(/class="tab dtab[^"]*" data-tab="([^"]+)"/g)].map((m) => m[1]);
    expect(tabs).toEqual([...DOCK_TABS]);
    for (const t of DOCK_TABS) expect(dock, t).toContain(`data-pane="${t}"`);
    for (const t of DOCK_TABS) expect(FIELDS.some((f) => f.tab === t), `tab ${t} has no field`).toBe(true);
  });
  it("every control in the dock and the view overlay belongs to a field (or is a listed action)", () => {
    const controls = [...ids(section('id="vc"', 'id="pick"')), ...ids(section('<section id="dock"', '<section class="ws-sec"'))];
    const owned = new Set(FIELDS.flatMap((f) => f.controls));
    const missing = controls.filter((id) => !owned.has(id) && !(id in ACTIONS));
    expect(missing, `controls with no field in src/sim/registry.ts (add the field, or list the action in ACTIONS): ${missing.join(", ")}`).toEqual([]);
    // and the other way: a field names only controls that exist
    const present = new Set(controls);
    const gone = [...owned].filter((c) => !c.startsWith("pg:") && !present.has(c));
    expect(gone, `registry controls not in sim/index.html: ${gone.join(", ")}`).toEqual([]);
    for (const id of Object.keys(ACTIONS)) expect(present.has(id), id).toBe(true);
  });
  it("every control the playground builds names a field, and every pg: control of the registry is built", () => {
    // a minimal DOM: the builders only create elements, append and listen
    const el = (): Record<string, unknown> => {
      const e: Record<string, unknown> = { children: [], style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, hidden: false, value: "", options: [] };
      e.append = (...k: unknown[]) => { (e.children as unknown[]).push(...k); };
      e.addEventListener = () => {}; e.setAttribute = () => {}; e.querySelectorAll = () => []; e.replaceChildren = () => {};
      return e;
    };
    const g = globalThis as unknown as { document?: unknown };
    const had = g.document;
    g.document = { createElement: () => el(), activeElement: null };
    try {
      const ui = createPlaygroundUi({ getState: () => ({}), setState() {}, loadPreset() {}, exit() {} });
      const built = new Set(ui.fields);
      for (const f of ui.fields) {
        if (f.startsWith("action:")) continue;
        expect(FIELDS.some((x) => x.path === f || x.path.startsWith(`${f}.`)), `control "${f}" has no field`).toBe(true);
      }
      const wanted = new Set(FIELDS.flatMap((x) => x.controls).filter((c) => c.startsWith("pg:")).map((c) => c.slice(3)));
      for (const w of wanted) expect(built.has(w), `registry names control ${w} but the playground builds none`).toBe(true);
    } finally { g.document = had; }
  });
});
