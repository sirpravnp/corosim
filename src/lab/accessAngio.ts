import type { VGraph, VSeg } from "./types";

const MM3_PER_L = 1e6;
const ACCESS_ROOTS = ["FEM_R", "FEM_L", "RADIAL_R"] as const;
const lumenAreaMm2 = (diamMm: number) => Math.PI * (diamMm * 0.5) ** 2;

const propagate = (seg: VSeg, qMm3s: number, t0: number): number[] => {
  const arrival = new Array<number>(seg.samples.length);
  let t = t0;
  arrival[0] = t;
  for (let i = 1; i < seg.samples.length; i++) {
    const ds = seg.length / (seg.samples.length - 1);
    const v = qMm3s / Math.max(0.5, lumenAreaMm2(seg.diameterMm[i]));
    t += ds / Math.max(0.02, v);
    arrival[i] = t;
  }
  return arrival;
};

/** Seconds after aortic root injection for contrast to reach each sample along access vessels. */
export function accessArrival(g: VGraph, flowLmin: number): Record<string, number[]> {
  const qMm3s = (flowLmin / 60) * MM3_PER_L / 1000;
  const out: Record<string, number[]> = {};
  const fill = (id: string, t0: number) => {
    const seg = g.byId[id];
    if (!seg || out[id]) return;
    out[id] = propagate(seg, qMm3s, t0);
    const tEnd = out[id][out[id].length - 1];
    for (const c of g.segs.filter((s) => s.parent === id)) {
      const attachT = out[id][Math.min(out[id].length - 1, Math.round(c.attach * (seg.samples.length - 1)))];
      fill(c.id, attachT);
    }
    if (id === "ILIAC_R" || id === "ILIAC_L") fill("AORTA_ABD", tEnd);
    if (id === "AORTA_ABD") { fill("AORTA_THOR", tEnd); }
    if (id === "AORTA_THOR") { fill("ARCH", tEnd); fill("INNOM", out.INNOM ? out.INNOM[0] : tEnd); }
    if (id === "ARCH") fill("AORTA_ASC", tEnd);
    if (id === "INNOM") fill("AORTA_THOR", tEnd);
  };
  for (const root of ACCESS_ROOTS) fill(root, 0);
  return out;
}
