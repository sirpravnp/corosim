import type { Balloon, Device, GuideCatheter, Guidewire, Stent } from "./types";

/**
 * A small device list with the same ids as the engine's catalog (`src/config/labDevices.ts`), for the UI and the stub.
 * When `LabEngine` lands the page imports `CATALOG` from there and this file goes away.
 */
const guide = (id: string, name: string, curve: GuideCatheter["curve"], support: number): GuideCatheter =>
  ({ id, name, kind: "guide", french: 6, curve, support, tipStiffness: support });
const wire = (id: string, name: string, stiffness: Guidewire["stiffness"], tipLoadGf: number, coating: Guidewire["coating"]): Guidewire =>
  ({ id, name, kind: "wire", diameterIn: 0.014, tipLoadGf, stiffness, coating, torque: 0.8, tipTaperMm: 2, support: 0.5 });
const balloon = (d: number, len: number, type: Balloon["type"]): Balloon => ({
  id: `bal-${type === "semi" ? "semi" : "nc"}-${d.toFixed(2)}-${len}`, name: `${type === "semi" ? "Semi" : "NC"} ${d} × ${len}`, kind: "balloon", type,
  nominalMm: d, lengthMm: len, nominalAtm: 8, ratedBurstAtm: type === "semi" ? 16 : 20, slopeMmPerAtm: type === "semi" ? 0.04 : 0.015,
});
const stent = (d: number, len: number): Stent => ({ id: `stent-des-${d.toFixed(2)}-${len}`, name: `DES ${d} × ${len}`, kind: "stent", nominalMm: d, lengthMm: len, strutUm: 81, material: "DES", nominalAtm: 8 });

export const STUB_CATALOG: Device[] = [
  guide("guide-jl35", "JL 3.5", "JL3.5", 0.55), guide("guide-jl4", "JL 4", "JL4", 0.65), guide("guide-jl5", "JL 5", "JL5", 0.6),
  guide("guide-jr4", "JR 4", "JR4", 0.55), guide("guide-ebu35", "EBU 3.5", "EBU3.5", 0.7),
  wire("wire-floppy", "Floppy", "floppy", 1, "hydrophilic"), wire("wire-workhorse", "Workhorse", "intermediate", 4, "polymer"),
  wire("wire-stiff-cto", "Stiff CTO", "stiff", 12, "hydrophilic"), wire("wire-pressure", "Pressure wire", "intermediate", 3, "none"),
  balloon(2.5, 12, "semi"), balloon(3, 12, "semi"), balloon(3.25, 12, "noncompliant"),
  stent(2.75, 18), stent(3, 18), stent(3, 24), stent(3.5, 24),
];
export const stubById: Record<string, Device> = Object.fromEntries(STUB_CATALOG.map((d) => [d.id, d]));
