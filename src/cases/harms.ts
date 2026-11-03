import type { Harm, Probe } from "./engine";

/**
 * Harms every case is scored against: what an intervention does to a patient in the state they are in. Each rule is a drug (or fluid) given
 * into a physiology it is known to make worse, so the same list serves a STEMI, an arrhythmia or a shock; a case adds its own only for
 * something particular to it, and may switch a rule off by tag (`CaseDef.skipHarms`). Time spent doing harm is deducted in proportion to the
 * length of the case, and each harm is named in the debrief. [assumed thresholds]
 */
const on = (p: Probe, drug: string, level = 0.1) => (p.drugs[drug] ?? 0) > level;
/** Pressure low, or no effective circulation of the patient's own. */
export const lowPressure = (p: Probe) => p.map < 65 || p.arrest === "arrest" || p.arrest === "rosc";
/** A ventricle that is failing: poor ejection fraction, or a large ischemic territory. */
export const failingLv = (p: Probe) => p.ef < 0.35 || p.lvIschemia > 0.3;
/** A right ventricle that is infarcted depends on its filling pressure. */
export const preloadDependent = (p: Probe) => p.rvIschemia > 0.3 || p.map < 55;

export const GENERIC_HARMS: Harm[] = [
  { tag: "vasodilator", label: "a vasodilator (nitroglycerin, nitroprusside) with low pressure or a preload-dependent right ventricle", when: (p) => (on(p, "nitroglycerin") || on(p, "nitroprusside")) && (lowPressure(p) || preloadDependent(p)) },
  { tag: "beta blocker", label: "a beta blocker with low pressure or a failing ventricle", when: (p) => on(p, "betaBlocker") && (lowPressure(p) || failingLv(p) || p.congestion > 0.3) },
  { tag: "catecholamine", label: "a catecholamine driving a fast rate into ischemic muscle", when: (p) => (on(p, "dobutamine", 0.3) || on(p, "epinephrine", 0.3) || on(p, "norepinephrine", 0.5)) && p.hr > 130 && p.lvIschemia > 0.2 && p.arrest === "none" },
  { tag: "pure vasoconstrictor", label: "a pure vasoconstrictor (phenylephrine, vasopressin) into a failing ventricle", when: (p) => (on(p, "phenylephrine", 0.3) || on(p, "vasopressin", 0.3)) && failingLv(p) && p.arrest === "none" },
  { tag: "diuretic", label: "a diuretic with low pressure and no congestion", when: (p) => on(p, "furosemide") && p.map < 65 && p.congestion < 0.2 && p.arrest === "none" },
  { tag: "calcium channel blocker", label: "diltiazem with a failing ventricle or low pressure", when: (p) => on(p, "diltiazem") && (failingLv(p) || p.map < 65 || p.congestion > 0.3) },
  { tag: "dual AV-nodal blockade", label: "a beta blocker and diltiazem together", when: (p) => on(p, "betaBlocker") && on(p, "diltiazem") },
  { tag: "fluid into congestion", label: "volume into a failing ventricle with congested lungs", when: (p) => p.fluidsL > 0.5 && failingLv(p) && p.congestion > 0.4 },
];
