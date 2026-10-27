import type { CaseDef } from "./engine";
import { AF_HF } from "./afHeartFailure";
import { AF_RVR } from "./afRvr";
import { ANTERIOR_STEMI } from "./anteriorStemi";
import { ECPELLA } from "./ecpella";
import { INFERIOR_RV } from "./inferiorRv";
import { LM_SHOCK } from "./lmShock";

/** Every case, easy to hard: the order the front door lists them. */
export const CASES: CaseDef[] = [ANTERIOR_STEMI, AF_RVR, INFERIOR_RV, AF_HF, LM_SHOCK, ECPELLA];
export const caseById = (id: string) => CASES.find((c) => c.id === id);
