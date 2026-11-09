import type { Balloon, Device, GuideCatheter, Guidewire, Stent } from "../lab/types";

/** PCI device catalog (angioplasty tools). CoroPump and ECMO constants stay in `devices.ts`. */

const guides: GuideCatheter[] = ([
  ["guide-jl35", "JL 3.5", "JL3.5", 0.55],
  ["guide-jl4", "JL 4", "JL4", 0.65],
  ["guide-jl5", "JL 5", "JL5", 0.6],
  ["guide-jr4", "JR 4", "JR4", 0.55],
  ["guide-ebu35", "EBU 3.5", "EBU3.5", 0.7],
  ["guide-xb35", "XB 3.5", "XB3.5", 0.75],
  ["guide-al1", "AL 1", "AL1", 0.5],
  ["guide-al2", "AL 2", "AL2", 0.45],
] as const).map(([id, name, curve, support]) => ({
  id, name, kind: "guide" as const, french: 6, curve, support, tipStiffness: support,
}));

const wires: Guidewire[] = [
  { id: "wire-floppy", name: "Floppy", kind: "wire", diameterIn: 0.014, tipLoadGf: 1, stiffness: "floppy", coating: "hydrophilic", torque: 0.8, tipTaperMm: 3, support: 0.2 },
  { id: "wire-workhorse", name: "Workhorse", kind: "wire", diameterIn: 0.014, tipLoadGf: 4, stiffness: "intermediate", coating: "polymer", torque: 0.85, tipTaperMm: 2, support: 0.55 },
  { id: "wire-stiff-cto", name: "Stiff CTO", kind: "wire", diameterIn: 0.014, tipLoadGf: 12, stiffness: "stiff", coating: "hydrophilic", torque: 0.7, tipTaperMm: 1.5, support: 0.85 },
  { id: "wire-pressure", name: "Pressure wire", kind: "wire", diameterIn: 0.014, tipLoadGf: 3, stiffness: "intermediate", coating: "none", torque: 0.9, tipTaperMm: 2, support: 0.35 },
];

const mkBalloon = (id: string, name: string, type: Balloon["type"], nominalMm: number, lengthMm: number, slope: number, burst: number): Balloon => ({
  id, name, kind: "balloon", type, nominalMm, lengthMm, nominalAtm: 8, ratedBurstAtm: burst, slopeMmPerAtm: slope,
});

const balloons: Balloon[] = [];
for (let mm = 2; mm <= 4.0001; mm += 0.25) {
  const d = +mm.toFixed(2);
  for (const len of [12, 20]) {
    balloons.push(mkBalloon(`bal-semi-${d.toFixed(2)}-${len}`, `Semi ${d} × ${len}`, "semi", d, len, 0.04, 16));
    balloons.push(mkBalloon(`bal-nc-${d.toFixed(2)}-${len}`, `NC ${d} × ${len}`, "noncompliant", d, len, 0.015, 20));
  }
}
balloons.push(mkBalloon("bal-cutting-3.00-15", "Cutting 3.0 × 15", "cutting", 3, 15, 0.02, 16));
balloons.push(mkBalloon("bal-scoring-2.75-15", "Scoring 2.75 × 15", "scoring", 2.75, 15, 0.02, 16));

const stents: Stent[] = [];
for (let mm = 2.25; mm <= 4.0001; mm += 0.25) {
  const d = +mm.toFixed(2);
  for (const len of [8, 12, 18, 24, 28, 38]) {
    stents.push({
      id: `stent-des-${d.toFixed(2)}-${len}`,
      name: `DES ${d} × ${len}`,
      kind: "stent",
      nominalMm: d,
      lengthMm: len,
      strutUm: 81,
      material: "DES",
      nominalAtm: 8,
    });
  }
}

export const CATALOG: Device[] = [...guides, ...wires, ...balloons, ...stents];

export const byId: Record<string, Device> = Object.fromEntries(CATALOG.map((d) => [d.id, d]));

/** Inflated diameter at pressure (mm). */
export function balloonDiameter(b: Balloon, atm: number): number {
  return Math.max(0.5, b.nominalMm + b.slopeMmPerAtm * (atm - b.nominalAtm));
}
