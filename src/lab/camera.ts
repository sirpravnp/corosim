import { add, mul, type V3 } from "../anatomy/curve";
import type { LabState, VGraph } from "./types";
import { pointOnRoute, samplePoint } from "./geometry";

export type CameraZone = "access" | "iliac" | "abdomen" | "chest" | "arch" | "root" | "coronary";

const coronaryIds = new Set(["LM", "LAD", "LCX", "OM1", "OM2", "RCA", "PDA", "PLB"]);

export function zoneOf(segId: string, _mm: number): CameraZone {
  if (segId.startsWith("FEM") || segId.startsWith("RADIAL")) return "access";
  if (segId.startsWith("ILIAC")) return "iliac";
  if (segId === "AORTA_ABD") return "abdomen";
  if (segId === "AORTA_THOR" || segId === "BRACH_R" || segId === "SUBCLAV_R" || segId === "INNOM") return "chest";
  if (segId === "ARCH") return "arch";
  if (segId === "AORTA_ASC") return "root";
  if (coronaryIds.has(segId)) return "coronary";
  return "chest";
}

const fovMm: Record<CameraZone, number> = {
  access: 220, iliac: 180, abdomen: 200, chest: 240, arch: 260, root: 200, coronary: 120,
};

export interface DeviceFocus {
  point: V3;
  zone: CameraZone;
  fovMm: number;
}

const leadingTip = (st: LabState): { segId: string; mm: number } | null => {
  if (st.wire) return { segId: st.wire.tipSeg, mm: st.wire.tipMm };
  if (st.guide?.tipSeg) return { segId: st.guide.tipSeg, mm: st.guide.tipMm };
  if (st.sheath && st.access) return { segId: st.sheath.site.startsWith("radial") ? "RADIAL_R" : st.sheath.site.startsWith("femoral-L") ? "FEM_L" : "FEM_R", mm: Math.min(st.sheath.lengthMm, 40) };
  if (st.access) return { segId: st.access.startsWith("femoral-L") ? "FEM_L" : st.access.startsWith("radial") ? "RADIAL_R" : "FEM_R", mm: 0 };
  return null;
};

export function deviceFocus(st: LabState, g: VGraph): DeviceFocus {
  const tip = leadingTip(st);
  const segId = tip?.segId ?? "AORTA_ASC";
  const mm = tip?.mm ?? 0;
  const zone = zoneOf(segId, mm);
  return { point: samplePoint(g, segId, mm), zone, fovMm: fovMm[zone] };
}

export interface OverviewBox { min: V3; max: V3; center: V3; spanMm: number }

export function overviewBox(g: VGraph): OverviewBox {
  let min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of g.segs) for (const p of s.samples) {
    min = [Math.min(min[0], p[0]), Math.min(min[1], p[1]), Math.min(min[2], p[2])];
    max = [Math.max(max[0], p[0]), Math.max(max[1], p[1]), Math.max(max[2], p[2])];
  }
  const center = mul(add(min, max), 0.5);
  const spanMm = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  return { min, max, center, spanMm };
}

export function zonesAlongRoute(g: VGraph, route: string[]): CameraZone[] {
  const out: CameraZone[] = [];
  for (const id of route) {
    const z = zoneOf(id, 0);
    if (out[out.length - 1] !== z) out.push(z);
  }
  return out;
}

export { pointOnRoute };
