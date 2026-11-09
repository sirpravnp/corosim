import type { CaseDef } from "./engine";
import type { CaseSpec } from "./spec";
import { AF_HF } from "./afHeartFailure";
import { AF_RVR } from "./afRvr";
import { ANTERIOR_STEMI } from "./anteriorStemi";
import { ECPELLA } from "./ecpella";
import { INFERIOR_RV } from "./inferiorRv";
import { LM_SHOCK } from "./lmShock";
import { PROTECTED_PCI, PROTECTED_PCI_SPEC } from "./protectedPci";
import { STEMI_SHOCK_UNLOAD, STEMI_SHOCK_UNLOAD_SPEC } from "./stemiShockUnload";
import { SUCTION_ALARM, SUCTION_ALARM_SPEC } from "./suctionAlarm";
import { MALPOSITION_OUT, MALPOSITION_OUT_SPEC } from "./malpositionOut";
import { MALPOSITION_DEEP, MALPOSITION_DEEP_SPEC } from "./malpositionDeep";
import { PURGE_RISING, PURGE_RISING_SPEC } from "./purgeRising";
import { HEMOLYSIS, HEMOLYSIS_SPEC } from "./hemolysis";
import { WEANING, WEANING_SPEC } from "./weaning";
import { MYOCARDITIS_BRIDGE, MYOCARDITIS_BRIDGE_SPEC } from "./myocarditisBridge";
import { VT_ABLATION, VT_ABLATION_SPEC } from "./vtAblation";

/** The six original built-in cases, easy to hard. */
export const CASES: CaseDef[] = [ANTERIOR_STEMI, AF_RVR, INFERIOR_RV, AF_HF, LM_SHOCK, ECPELLA];

/** The ten CoroPump cases, easy to hard, each with the plain-data spec it was compiled from (the markdown builder reads the spec). Each lists the monitor it needs, so they sit apart from the six built-ins that show the standard monitor. */
export const COROPUMP_SPECS: CaseSpec[] = [
  WEANING_SPEC, SUCTION_ALARM_SPEC, PROTECTED_PCI_SPEC, STEMI_SHOCK_UNLOAD_SPEC, MALPOSITION_OUT_SPEC, MALPOSITION_DEEP_SPEC, PURGE_RISING_SPEC, HEMOLYSIS_SPEC, MYOCARDITIS_BRIDGE_SPEC, VT_ABLATION_SPEC,
];
export const COROPUMP_CASES: CaseDef[] = [
  WEANING, SUCTION_ALARM, PROTECTED_PCI, STEMI_SHOCK_UNLOAD, MALPOSITION_OUT, MALPOSITION_DEEP, PURGE_RISING, HEMOLYSIS, MYOCARDITIS_BRIDGE, VT_ABLATION,
];

/** Every case the front door lists. */
export const ALL_CASES: CaseDef[] = [...CASES, ...COROPUMP_CASES];
export const caseById = (id: string) => ALL_CASES.find((c) => c.id === id);
