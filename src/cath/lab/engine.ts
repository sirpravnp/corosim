import type { Simulation } from "../../sim/simulation";
import type { LabEngineLike } from "../../lab/types";
import { StubLabEngine } from "../../lab/stub";
import { STUB_CATALOG } from "../../lab/stubCatalog";

/**
 * The one place the page chooses its procedure engine. Until `LabEngine` lands on main this is the scripted stub (no physics:
 * the monitor stays at baseline). To switch, import `LabEngine` and `CATALOG` and return `new LabEngine(sim, { seed, access, plaques })`.
 */
export const PHYSICS_LIVE = false;
export const catalog = STUB_CATALOG;
export function createEngine(_sim: Simulation): LabEngineLike { return new StubLabEngine(); }
