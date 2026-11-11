import type { Simulation } from "../../sim/simulation";
import type { LabEngineLike } from "../../lab/types";
import { LabEngine } from "../../lab/engine";
import { CATALOG } from "../../config/labDevices";
import { LAB_CASES } from "./cases";

/** The one place the page chooses its procedure engine: the real `LabEngine` on the first case. */
export const PHYSICS_LIVE = true;
export const catalog = CATALOG;
export const CASE = LAB_CASES[0]!;
export const SCENARIO = { seed: 4, ...CASE.scenario };
export function createEngine(sim: Simulation): LabEngineLike {
  return new LabEngine(sim, { seed: 7, access: CASE.access, plaques: CASE.plaques, forced: CASE.forced });
}
