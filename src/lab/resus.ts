import type { Simulation } from "../sim/simulation";
import type { LabEvent } from "./types";

/** Turn CPR on or off through the main simulator's arrest machine. */
export function applyCpr(sim: Simulation, on: boolean): LabEvent[] {
  const r = sim.setCpr({ on });
  if (!r.ok) {
    return [{ at: 0, kind: "cpr", text: r.note ?? "CPR is not available right now.", severity: "caution" }];
  }
  return [{ at: 0, kind: "cpr", text: on ? "Chest compressions started." : "Chest compressions stopped.", severity: "info" }];
}

/** Defibrillate or cardiovert through the main simulator. */
export function applyShock(sim: Simulation, joules: number, sync?: boolean): LabEvent[] {
  const r = sim.shock({ joules, sync });
  const text = r.discharged
    ? (r.success ? `Shock ${joules} J restored a perfusing rhythm.` : `Shock ${joules} J delivered; rhythm is now ${r.rhythm}.`)
    : (r.note ?? `Shock ${joules} J did not discharge.`);
  return [{ at: 0, kind: "shock", text, severity: r.success ? "info" : "caution", data: { joules, sync: !!sync, success: r.success } }];
}

/** Pressor dial on the main support model (0..1 scale). */
export function applyPressor(
  sim: Simulation,
  id: "norepi" | "epi" | "phenylephrine",
  dose: number,
): LabEvent[] {
  const d = Math.max(0, Math.min(1, dose));
  if (id === "norepi") sim.apply({ support: { norepinephrine: d } });
  else if (id === "epi") sim.apply({ support: { epinephrine: d } });
  else sim.apply({ drugs: { vasopressor: d } });
  return [{ at: 0, kind: "pressor", text: `Gave ${id} (dose ${d}).`, severity: "info", data: { id, dose: d } }];
}

/** Crystalloid bolus in mL → litres on the support dial. */
export function applyFluid(sim: Simulation, ml: number): LabEvent[] {
  const liters = Math.max(0, ml / 1000);
  const cur = (sim.state() as { support?: { fluids?: number } }).support?.fluids ?? 0;
  sim.apply({ support: { fluids: cur + liters } });
  return [{ at: 0, kind: "fluid", text: `Gave ${Math.round(ml)} mL of fluid.`, severity: "info", data: { ml } }];
}

/** Drain pericardial effusion through Simulation.drainPericardium. */
export function applyPericardiocentesis(
  sim: Simulation,
  ml: number,
  engineEffusion: number,
  seal: () => void,
): { drained: number; events: LabEvent[] } {
  if (engineEffusion <= 0) {
    return {
      drained: 0,
      events: [{ at: 0, kind: "pericardiocentesis", text: "No pericardial effusion to drain.", severity: "caution" }],
    };
  }
  const want = Math.max(0, ml);
  const fromSim = sim.drainPericardium(want);
  const drained = Math.min(want, Math.max(engineEffusion, fromSim));
  seal();
  if (drained <= 0) {
    return {
      drained: 0,
      events: [{ at: 0, kind: "pericardiocentesis", text: "No pericardial effusion to drain.", severity: "caution" }],
    };
  }
  return {
    drained,
    events: [{
      at: 0, kind: "pericardiocentesis",
      text: `Drained ${Math.round(drained)} mL from the pericardium.`,
      severity: "info",
      data: { drained, requested: want },
    }],
  };
}

/** Restart after death via Simulation.restartPatient. */
export function applyRestart(sim: Simulation): LabEvent[] {
  sim.restartPatient();
  return [{ at: 0, kind: "restart", text: "Patient restarted from the baseline scenario.", severity: "info" }];
}
