import type { CaseDef } from "./engine";
import { ECPELLA } from "./ecpella";

/** Every case, in the order the front door lists them. */
export const CASES: CaseDef[] = [ECPELLA];
export const caseById = (id: string) => CASES.find((c) => c.id === id);
