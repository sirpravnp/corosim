import type { Guidewire, Plaque } from "./types";

/** Complication risk helpers (Task 9 fills draws; Tasks 6–8 call these). */

export const accessBleedRisk = (_ultrasound: boolean): number => 0;
export const spasmRisk = (_radial: boolean, _nitro: boolean): number => 0;
export const thrombusRisk = (act: number): number => (act < 250 ? 0.4 : 0);

export const perforationRisk = (w: Guidewire, p: Plaque, oversize = 0): number => {
  const base = 0.02 + p.calcium * 0.35 + oversize * 0.5 + w.tipLoadGf * 0.008;
  const hydro = w.coating === "hydrophilic" ? 0.12 : 0;
  return Math.min(0.95, base + hydro);
};

export const subintimalRisk = (w: Guidewire, p: Plaque): number => {
  if (!p.cto) return 0.05;
  const hydro = w.coating === "hydrophilic" ? 0.2 : 0;
  return Math.min(0.9, 0.08 + p.cto.capHardness * 0.25 + hydro + (w.stiffness === "stiff" ? 0.15 : 0));
};

export const dissectionRisk = (pressureAtm: number, ratedAtm: number): number =>
  Math.min(0.95, Math.max(0, (pressureAtm / ratedAtm - 0.85) * 0.8));
