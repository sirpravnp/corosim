import type { Guidewire, Plaque } from "./types";
import type { Lesion } from "../physics/network";

export type Complication =
  | "dissection" | "perforation" | "tamponade" | "no-reflow" | "spasm" | "access-bleed"
  | "retroperitoneal-bleed" | "ostial-dissection" | "air-embolism" | "arrhythmia-vf";

export interface Effect {
  lesions?: Lesion[];
  bedResistance?: Record<string, number>;
  bloodLoss?: number;
  tamponade?: number;
  rhythm?: "vf" | "vt" | "brady";
  coronaryBlock?: { segId: string; posMm: number };
}

export interface RiskContext {
  tipLoad: number;
  calcium: number;
  oversize: number;
  thrombus: number;
  pressureAtm: number;
  ratedAtm: number;
  hydrophilic?: boolean;
  act?: number;
  radial?: boolean;
}

export interface ForcedEvent { complication: Complication; trigger: string; once: boolean }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const accessBleedRisk = (ultrasound: boolean): number => (ultrasound ? 0.05 : 0.2);
export const spasmRisk = (radial: boolean, nitro: boolean): number => (radial && !nitro ? 0.35 : 0.05);
export const thrombusRisk = (act: number): number => (act < 250 ? 0.4 : 0);

export const perforationRisk = (w: Guidewire, p: Plaque, oversize = 0): number =>
  risk("perforation", {
    tipLoad: w.tipLoadGf, calcium: p.calcium, oversize, thrombus: p.thrombus,
    pressureAtm: 10, ratedAtm: 16, hydrophilic: w.coating === "hydrophilic",
  });

export const subintimalRisk = (w: Guidewire, p: Plaque): number => {
  if (!p.cto) return 0.05;
  const hydro = w.coating === "hydrophilic" ? 0.2 : 0;
  return clamp01(0.08 + p.cto.capHardness * 0.25 + hydro + (w.stiffness === "stiff" ? 0.15 : 0));
};

export const dissectionRisk = (pressureAtm: number, ratedAtm: number): number =>
  risk("dissection", { tipLoad: 0, calcium: 0, oversize: 0, thrombus: 0, pressureAtm, ratedAtm });

export function risk(c: Complication, ctx: RiskContext): number {
  switch (c) {
    case "perforation":
      return clamp01(0.02 + ctx.tipLoad * 0.02 + ctx.calcium * 0.35 + ctx.oversize * 0.4 + (ctx.hydrophilic ? 0.1 : 0));
    case "no-reflow":
      return clamp01(0.1 + ctx.thrombus * 0.7);
    case "dissection":
      return clamp01(Math.max(0, (ctx.pressureAtm / ctx.ratedAtm - 0.8) * 0.9));
    case "access-bleed":
      return ctx.radial ? 0.05 : 0.25;
  case "arrhythmia-vf":
      return clamp01(ctx.thrombus * 0.2);
    default:
      return 0.1;
  }
}

export function draw(c: Complication, ctx: RiskContext, rand: () => number): Effect | null {
  if (rand() > risk(c, ctx) && c !== "no-reflow") return null;
  switch (c) {
    case "no-reflow":
      return { bedResistance: { "LAD#dist": 3 + ctx.thrombus * 3 } };
    case "perforation":
      return { tamponade: 0.1 + ctx.calcium * 0.15, bloodLoss: 0.02 };
    case "access-bleed":
      return { bloodLoss: ctx.radial ? 0.005 : 0.02 };
    case "spasm":
      return { bedResistance: { "RADIAL_R": 1.35 } };
    case "arrhythmia-vf":
      return { rhythm: "vf" };
    default:
      return {};
  }
}

export function scriptedComplication(c: Complication, trigger: string): ForcedEvent {
  return { complication: c, trigger, once: true };
}
