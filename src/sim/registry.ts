import { SIM_RHYTHMS } from "../physics/rhythmSource";
import { PROSTHESIS_KINDS } from "../config/valves";

/**
 * The spec registry (SIMULATOR_PLAN D1): the one list of the patient's fields. Each entry names a field by its path in the
 * `PatientSpec` (plus the `display.*` options of the 3D view), the dock tab its control lives in, the JSON-Schema fragment that
 * describes it and the page controls that edit it. Three things are built from or checked against this list:
 *
 *  - the MCP tool schema (`src/mcp/tools.ts` calls `specSchema()`), so a field added here reaches `corosim_set_scenario`,
 *    `corosim_adjust`, `corosim_compare` and `corosim_show` and the OpenAI/Anthropic exports (`scripts/export-tools.ts`);
 *  - the page: `DOCK_TABS` is checked against the dock in `sim/index.html`, every control id in the dock and the view overlay must
 *    be listed here (or in `ACTIONS`), and every control `createPlaygroundUi` builds names its field path;
 *  - `tests/specRegistry.test.ts`, which fails when a control has no field, when a field has no entry in the MCP schema, or when
 *    a schema property has no field.
 *
 * To add a control: add its field here (with its `controls`), add the control to the page, and the schema follows.
 */
export type DockTab = "patient" | "rhythm" | "coronary" | "valves" | "pericardium" | "support";
/** The tabs of the settings dock, in order. `display` is the 3D view's overlay (not a dock tab). */
export const DOCK_TABS: readonly DockTab[] = ["patient", "rhythm", "coronary", "valves", "pericardium", "support"];
export type FieldTab = DockTab | "display";
/** Where a field enters the MCP: the patient (`scenario`/`patch`) or the viewer options of `corosim_show`. */
export type FieldTarget = "patient" | "display";

export interface FieldSpec {
  /** Dotted path in the PatientSpec (`heart.valves.av.reg`), or `display.mode`. */
  path: string;
  tab: FieldTab;
  target: FieldTarget;
  /** JSON-Schema fragment of this field (a leaf, or an array/object kept whole). */
  schema: Record<string, unknown>;
  /**
   * Page controls that edit it: element ids in `sim/index.html`, or `pg:<path>` for a control `createPlaygroundUi` builds (it names the path it edits;
   * a control on a parent path, like `pg:heart`, covers every field below it). Empty: no page control (set from chat or a link only).
   */
  controls: readonly string[];
}

const num = (min: number, max: number, description?: string) => ({ type: "number", minimum: min, maximum: max, ...(description ? { description } : {}) });
const bool = (description?: string) => ({ type: "boolean", ...(description ? { description } : {}) });
const en = (values: readonly (string | number)[], description?: string) => ({ enum: [...values], ...(description ? { description } : {}) });

const F: FieldSpec[] = [];
const add = (path: string, tab: FieldTab, schema: Record<string, unknown>, controls: readonly string[] = [], target: FieldTarget = "patient") => { F.push({ path, tab, target, schema, controls }); };

// ---- coronary anatomy and lesions --------------------------------------------------------------------------------
add("anatomy.dominance", "coronary", en(["right", "co", "left"]), ["dom", "p_typ", "p_left"]);
add("anatomy.lm", "coronary", en(["bifurcation", "trifurcation", "absent"], "Left-main pattern; trifurcation adds a ramus intermedius."), ["lm", "p_ramus", "p_abs"]);
add("anatomy.saNodeFrom", "coronary", en(["RCA", "LCx"]), ["san"]);
add("anatomy.conusOstium", "coronary", en(["shared", "separate"]), ["conus"]);
add("anatomy.ladCourse", "coronary", en(["normal", "short", "wrap"]), ["lad"]);
add("lesions", "coronary", {
  type: "array", description: "Coronary lesions, at most one per artery.",
  items: {
    type: "object", required: ["artery"],
    properties: {
      artery: { type: "string", description: "LM, LAD, D1, D2, RAMUS, LCX, OM1, OM2, RCA, AM, PDA, PLV, SAN (SA-node artery), AVN (AV-node artery), CONUS. Names like 'circumflex' also work." },
      stenosis: num(0, 0.99, "Fractional diameter reduction at the narrowest point (0.7 = 70 % diameter stenosis). Default 0.7."),
      occluded: bool("Complete occlusion; overrides stenosis."),
      position: num(0, 1, "0 = proximal end of the artery, 1 = distal. Default 0.15."),
    },
  },
}, ["lseg", "pos", "ds", "occ"]);
add("exertion", "coronary", bool("Moderate exertion: doubles myocardial oxygen demand."), ["exert"]);

// ---- patient: volume, drugs, autonomic, rhythm -----------------------------------------------------------------------
add("bloodLoss", "support", num(-0.3, 0.6, "Fraction of blood volume lost (0.15 = ATLS class II, 0.3 = class III). Negative = volume overload."), ["bl"]);
add("drugs.betaBlocker", "support", num(0, 1, "Fraction of beta-adrenergic effect blocked."), ["bb"]);
add("drugs.atropine", "support", num(0, 1, "Fraction of vagal effect on the sinus node blocked."), ["m_atropine"]);
add("drugs.vasopressor", "support", num(-1, 1, "-1 strong vasodilator, +1 strong alpha-agonist (phenylephrine-like)."));
add("autonomic.baroreflexGain", "patient", num(0, 4, "0 = denervated, 1 = normal, ≥2 = enough loop gain for a sustained ~0.1 Hz (Mayer-wave) oscillation."));
add("autonomic.respRate", "patient", num(4, 40, "Breaths per minute (drives respiratory sinus arrhythmia)."));
add("autonomic.respDepth", "patient", num(0, 2));
add("autonomic.setPointShift", "patient", num(-30, 60, "mmHg added to the baroreceptor set point (chronic hypertension resets it upward)."));
add("autonomic.noise", "patient", num(0, 3, "Scale of physiological noise. 0 = deterministic loop; 1 = normal."));
add("patient.rhythm", "rhythm", en([...new Set(["sinus", "af", ...SIM_RHYTHMS.map((p) => p.id)])], "Baseline rhythm. sinus and af (atrial fibrillation: no P waves, irregular, no atrial kick) are the coronary model's own; any other id is a rhythm of the EKG library (corosim_ekg_list lists them; \"nsr\" also means sinus): flutter, SVT, junctional, AV blocks, VT, torsades, VF, asystole, paced and so on. Library rhythms run on the core engine (VF and asystole give no flow)."), ["rhythmq", "rhythmsel"]);
add("patient.bbb", "rhythm", en(["none", "rbbb", "lbbb"], "Pre-existing bundle branch block."), ["c_none", "c_rbbb", "c_lbbb"]);
add("seed", "patient", { type: "integer", description: "Random seed. The same scenario and seed reproduce the same beats." });
add("ectopyTendency", "patient", num(0, 3, "Teaching override of the patient's tendency to ischemic PVCs (core engine): a multiplier on the susceptibility the seed gives. 0 = never any PVC, 1 = as the seed has it (default), 3 = very ectopy-prone."));
add("arrhythmiaTendency", "patient", num(0, 3, "Teaching override of the patient's tendency to ventricular tachycardia, ventricular fibrillation and reperfusion AIVR (core engine): a multiplier on the susceptibility the seed gives. 0 = never any (and ends one that is running), 1 = as the seed has it (default)."));
add("electrolytes.potassium", "patient", num(2, 7.5, "Serum potassium in mmol/l (core engine); hypo- and hyperkalaemia raise the VT/VF hazard and the PVCs. Default 4.2."));
add("electrolytes.magnesium", "patient", num(0.2, 3, "Serum magnesium in mmol/l (core engine); hypomagnesaemia raises the VT/VF hazard and the PVCs. Default 0.9."));

// ---- support (the management panel) --------------------------------------------------------------------------------------
add("support.fluids", "support", num(0, 3, "Litres of IV fluid given (the legacy dial; the page's IV bolus is fluids.given). Helps a right-ventricular infarct; congests the lungs of a failing left ventricle."));
add("support.norepinephrine", "support", num(0, 1), ["nor"]);
add("support.dobutamine", "support", num(0, 1), ["dob"]);
add("support.nitroglycerin", "support", num(0, 1), ["m_nitro"]);
add("support.epinephrine", "support", num(0, 1, "Core engine only."));
add("support.milrinone", "support", num(0, 1, "Core engine only."));
add("support.vasopressin", "support", num(0, 1, "Core engine only."));
add("support.nitroprusside", "support", num(0, 1, "Core engine only."));
add("support.furosemide", "support", num(0, 1, "Core engine only."));
add("support.pacing", "support", bool(), ["m_pace"]);
add("support.paceRate", "support", num(40, 120), ["pacerate"]);
add("support.iabp", "support", bool("Intra-aortic balloon pump (the legacy switch; devices.iabp is the same pump with settings, and the page's one switch edits both)."), ["m_iabp"]);
add("support.impella", "support", bool("Microaxial left-ventricular pump (the legacy switch; devices.impella is the same pump with settings, and the page's one switch edits both)."), ["m_impella"]);

// ---- structural heart (Valves tab; heart.volumeMl is on the Patient tab) -----------------------------------------------------------------------------------
const VALVES = [["av", "aortic", 19, 34], ["mv", "mitral", 25, 33], ["tv", "tricuspid", 27, 36], ["pv", "pulmonary", 19, 29]] as const;
for (const [k, name, lo, hi] of VALVES) {
  add(`heart.valves.${k}.open`, "valves", num(0, 1, `${name[0].toUpperCase()}${name.slice(1)} valve opening as a fraction of normal (1 = normal, 0 = atretic). Ignored when a prosthesis is set.`), ["pg:heart"]);
  add(`heart.valves.${k}.reg`, "valves", num(0, 10, `${name[0].toUpperCase()}${name.slice(1)} regurgitant orifice area, cm². Ignored when a prosthesis is set.`), ["pg:heart"]);
  add(`heart.valves.${k}.prosthesis`, "valves", {
    type: "object", description: `A prosthetic ${name} valve: replaces the native valve's open and reg with the prosthesis's own orifice and leak. For the action (replace, TAVR, balloon, clip, ring) use corosim_valve.`,
    required: ["kind"],
    properties: {
      kind: en(PROSTHESIS_KINDS),
      sizeMm: num(lo, hi, `Labelled size, mm (${lo} to ${hi}).`),
      leak: num(0, 2, "Paravalvular (or degenerative) regurgitant orifice, cm², on top of the closing leak of its kind."),
      obstruction: num(0, 1, "Share of the orifice lost to thrombus, pannus or degeneration (1 = fully obstructed)."),
      inRing: bool("A transcatheter valve inside a failed surgical bioprosthesis (valve-in-valve)."),
    },
  }, []);
}
for (const k of ["pda", "asd", "vsd", "bt"] as const) add(`heart.${k}`, "valves", { type: "object", description: { pda: "Patent ductus arteriosus.", asd: "Atrial septal defect.", vsd: "Ventricular septal defect.", bt: "Modified Blalock-Taussig shunt, aorta to pulmonary artery." }[k], properties: { diameterMm: num(0, 40) } }, ["pg:heart"]);
add("heart.tof", "valves", { type: "object", description: "Tetralogy of Fallot.", properties: { vsdMm: num(0, 40), rvotFrac: num(0, 1, "Right ventricular outflow tract opening as a fraction of normal."), spasm: num(0, 1), override: num(0, 1), rvHypertrophy: num(0.2, 5) } }, ["pg:heart"]);
add("heart.pvri", "valves", num(0.2, 60, "Pulmonary vascular resistance index, Wood units·m²."), ["pg:heart"]);
add("heart.svrScale", "valves", num(0.1, 5, "Multiplies systemic vascular resistance."), ["pg:heart"]);
add("heart.satLung", "valves", num(0.3, 1, "Saturation of blood leaving the lungs."), ["pg:heart"]);
// (the baseline blood volume is the patient's own, so it lives in the Patient tab, not with the valves)
add("heart.volumeMl", "patient", num(-1000, 5000, "Baseline blood volume: extra ml on the patient's normal (negative: less). Blood loss, hemorrhage and boluses act on top of it."), ["pg:heart.volumeMl"]);
for (const k of ["lvSize", "laSize", "rvSize", "raSize"]) add(`heart.${k}`, "valves", num(0.05, 4, "Chamber volume as a multiple of normal."), ["pg:heart"]);
for (const k of ["lvEes", "rvEes"]) add(`heart.${k}`, "valves", num(0.2, 5, "Multiplies the ventricle's end-systolic elastance (stunned or ischemic muscle)."), ["pg:heart"]);
for (const k of ["lvStiffness", "rvStiffness"]) add(`heart.${k}`, "valves", num(0.2, 5, "Multiplies the ventricle's passive stiffness."), ["pg:heart"]);
add("heart.rvContractility", "valves", num(0.2, 5, "Multiplies right ventricular contractility and stiffness."), ["pg:heart"]);

// ---- pericardium (its own tab) ----------------------------------------------------------------------------------------
add("pericardium.effusionMl", "pericardium", num(0, 2000), ["pg:pericardium.effusionMl"]);
add("pericardium.effusionRateMlMin", "pericardium", num(0, 100), ["pg:pericardium.effusionRateMlMin"]);
add("pericardium.stiffness", "pericardium", num(0.2, 10, "1 normal, > 1 constrictive"), ["pg:pericardium.stiffness"]);
add("pericardium.open", "pericardium", bool("Pericardium opened (post cardiac surgery)."), ["pg:pericardium.open"]);
add("pericardium.drainMl", "pericardium", num(0, 2000, "Pericardiocentesis, an action for corosim_adjust: ml of effusion to remove now (50-100 ml relieves a tamponade); it is subtracted from the effusion and not kept."), ["pg:pericardium.drainMl"]);
add("septum", "pericardium", bool("Ventricular interdependence through the septum (core engine): a failing right ventricle bows the septum into the left. Switch it on for RV infarct and tamponade."), ["pg:septum"]);

// ---- fluids, ventilation, devices (Support tab) -----------------------------------------------------------------------
add("fluids.given", "support", { type: "array", maxItems: 20, items: { type: "object", required: ["kind", "ml"], properties: { kind: en(["crystalloid", "colloid", "albumin", "blood"]), ml: num(0, 5000), atMin: num(0, 1440), overMin: num(0, 1440) } } }, ["pg:fluids.given"]);
add("fluids.hemorrhageMlMin", "support", num(0, 500), ["pg:fluids.hemorrhageMlMin"]);
add("fluids.capillaryLeak", "support", num(0, 1));
add("fluids.legRaise", "support", bool());
add("ventilation.mode", "support", en(["spontaneous", "positive"]), ["pg:ventilation.mode"]);
add("ventilation.peep", "support", num(0, 25, "cmH2O"), ["pg:ventilation.peep"]);
add("ventilation.tidalMlKg", "support", num(2, 15), ["pg:ventilation.tidalMlKg"]);
add("devices.impella.model", "support", en(["2.5", "CP", "5.5"]), ["pg:devices.impella.model"]);
add("devices.impella.level", "support", num(0, 9, "P-level"), ["pg:devices.impella.level"]);
add("devices.impella.position", "support", en(["correct", "aortic", "deep"]), ["pg:devices.impella.position"]);
add("devices.impellaRp.level", "support", num(0, 9));
add("devices.iabp.ratio", "support", en([1, 2, 3]), ["pg:devices.iabp.ratio"]);
add("devices.iabp.inflateMs", "support", num(-100, 100), ["pg:devices.iabp.inflateMs"]);
add("devices.iabp.deflateMs", "support", num(-100, 100), ["pg:devices.iabp.deflateMs"]);
add("devices.iabp.volumeMl", "support", num(0, 50));
add("devices.ecmo.flowLpm", "support", num(0, 7), ["m_ecmo", "pg:devices.ecmo.flowLpm"]);
add("devices.ecmo.sweepLpm", "support", num(0, 10), ["pg:devices.ecmo.sweepLpm"]);
add("devices.ecmo.fio2", "support", num(0.21, 1), ["pg:devices.ecmo.fio2"]);

// ---- display: the 3D view's options (corosim_show.display) ---------------------------------------------------------------------
const D = (path: string, schema: Record<string, unknown>, controls: readonly string[]) => add(`display.${path}`, "display", schema, controls, "display");
D("mode", en(["real", "isch", "anat", "pressure", "velocity", "wss", "o2"], "What colours the coronary arteries: real = anatomic, isch = ischemia, anat = territory, pressure, velocity, wss = wall shear, o2 = O2 saturation."), ["m_real", "m_isch", "m_anat", "m_pressure", "m_velocity", "m_wss", "m_o2"]);
D("heart", en(["solid", "ghost", "none"], "How the heart muscle is drawn."), ["h_solid", "h_ghost", "h_none"]);
D("view", en(["anterior", "left", "posterior", "inferior", "right"], "Camera view."), ["vAnt", "vLeft", "vPost", "vInf", "vRight"]);
D("labels", bool("Name the arteries and chambers."), ["labelbtn"]);
D("flow", bool("Animate blood flow in the arteries."), ["flowbtn"]);
D("valves", bool("Show the valves, septal defects and jets inside the heart (makes a solid heart translucent)."), ["propsbtn"]);
D("posteriorLeads", bool("Show posterior leads V7-V9 on the ECG."), ["postbtn"]);
D("coronaryScale", num(1, 5, "Coronary vessel size exaggeration."), ["ex"]);
D("autoRotate", bool(), ["spin"]);
D("timeScale", en([1, 3, 6], "Speed of simulated time, x real time."), ["s1", "s3", "s6"]);

export const FIELDS: readonly FieldSpec[] = F;
export const FIELD_PATHS: ReadonlySet<string> = new Set(F.map((f) => f.path));
export const fieldsOf = (tab: FieldTab) => F.filter((f) => f.tab === tab);

/** Controls in the dock and the view overlay that act (treat, reset, navigate) instead of setting a field: the MCP tool that does the same, or null when it is page-only. */
export const ACTIONS: Record<string, { tool: string | null; why: string }> = {
  m_pci: { tool: "corosim_treat", why: "primary PCI" }, m_lysis: { tool: "corosim_treat", why: "fibrinolytic" }, m_cabg: { tool: "corosim_treat", why: "CABG" },
  m_cancel: { tool: null, why: "cancels an order not yet carried out (the chat orders and waits)" },
  m_hint: { tool: "corosim_get_state", why: "guideline next steps are in the assessment" }, m_reset: { tool: "corosim_set_scenario", why: "reset treatment: a new patient" },
  a_cpr: { tool: null, why: "chest compressions on or off (page-only until the arrest MCP tool)" }, a_rate: { tool: null, why: "CPR rate, 80-140 per min (page-only)" },
  a_depth: { tool: null, why: "CPR depth, 3-8 cm (page-only)" }, a_quality: { tool: null, why: "CPR quality 0-100 % (page-only)" },
  a_joules: { tool: null, why: "shock energy 120/150/200 J (page-only)" }, a_sync: { tool: null, why: "synchronized (cardioversion) or unsynchronized shock (page-only)" }, a_shock: { tool: null, why: "deliver the shock (page-only)" },
  a_epi: { tool: null, why: "epinephrine 1 mg (page-only)" }, a_amio: { tool: null, why: "amiodarone 300 then 150 mg (page-only)" }, a_lido: { tool: null, why: "lidocaine 100 mg (page-only)" },
  openCath: { tool: "corosim_heart_cath", why: "the cath lab readings" },
};

// ---- the schema ---------------------------------------------------------------------------------------------------------------
/** Descriptions of the objects the paths pass through. */
const GROUPS: Record<string, string> = {
  anatomy: "Coronary anatomy variant.",
  patient: "What the patient brought with them.",
  support: "Hemodynamic support (as in the app's Support tab). Atropine is drugs.atropine.",
  devices: "Mechanical support with settings. support.iabp / support.impella (true) mean the defaults: IABP 1:1 at correct timing, 40 ml; Impella CP at P6, correct position.",
  heart: "Structural heart as on the Valves tab: valves {av|mv|tv|pv: {open 0..1, reg cm2, prosthesis}}, pda|asd|vsd|bt {diameterMm}, tof, pvri, svrScale, satLung, volumeMl (baseline blood volume, on the Patient tab), chamber sizes, elastance and stiffness. Use corosim_valve to replace, dilate, clip or repair a valve.",
  "heart.valves": "Per valve: native opening and regurgitant orifice, or a prosthesis. Several valves can be abnormal at once.",
};
type Node = Record<string, unknown>;

/** Nest the fields of one target into a JSON Schema `properties` map. */
export function specProperties(target: FieldTarget): Record<string, Node> {
  const root: Record<string, Node> = {};
  for (const f of F.filter((x) => x.target === target)) {
    const parts = target === "display" ? f.path.split(".").slice(1) : f.path.split(".");
    let props = root;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) { props[p] = f.schema; return; }
      const prefix = parts.slice(0, i + 1).join(".");
      const node = (props[p] ??= { type: "object", ...(GROUPS[prefix] ? { description: GROUPS[prefix] } : {}), properties: {} });
      props = node.properties as Record<string, Node>;
    });
  }
  return root;
}
/** The JSON Schema of the patient fields (the Scenario plus the PatientSpec fields). */
export const patientProperties = () => specProperties("patient");
/** The JSON Schema of `corosim_show.display`. */
export const displaySchema = (): Node => ({ type: "object", description: "How the 3D view is drawn, as the page's view overlay: coloring, heart style, camera, labels, flow, valves, posterior leads, vessel scale, rotation, time scale. Every field optional.", properties: specProperties("display") });
