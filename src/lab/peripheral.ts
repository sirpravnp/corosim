import peripheral from "../cath/data/peripheral.json";
import type { VSeg } from "./types";
import type { V3 } from "../anatomy/curve";

type Raw = {
  id: string;
  parent: string | null;
  points: V3[];
  radiusMm: number[];
};

const arcLen = (pts: V3[]) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return L;
};

/** Load baked peripheral centerlines as VSeg rows (patient frame, mm). */
export function loadPeripheral(): VSeg[] {
  const raw = (peripheral as { segments: Raw[] }).segments;
  return raw.map((s) => {
    const samples = s.points.map((p) => [...p] as V3);
    const diameterMm = s.radiusMm.map((r) => r * 2);
    return {
      id: s.id,
      name: s.id.replace(/_/g, " "),
      parent: s.parent,
      attach: s.parent ? 1 : 0,
      length: arcLen(samples) || 1,
      samples,
      diameterMm: diameterMm.length === samples.length
        ? diameterMm
        : samples.map((_, i) => diameterMm[Math.min(i, diameterMm.length - 1)] ?? 4),
      tortuosity: 0.1,
      calcification: 0,
    };
  });
}

/** Look up one baked segment by id. */
export function peripheralById(id: string): VSeg | undefined {
  return loadPeripheral().find((s) => s.id === id);
}
