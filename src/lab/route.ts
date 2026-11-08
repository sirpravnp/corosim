import type { AccessSite, VGraph } from "./types";

const siteRoot: Record<AccessSite, string> = {
  "femoral-R": "FEM_R",
  "femoral-L": "FEM_L",
  "radial-R": "RADIAL_R",
  "radial-L": "RADIAL_R", // mirror uses same topology; femoral-L uses left femoral
};

const childrenOf = (g: VGraph, id: string) => g.segs.filter((s) => s.parent === id).map((s) => s.id);

const neighbors = (g: VGraph, id: string): string[] => {
  const s = g.byId[id];
  const out = childrenOf(g, id);
  if (s.parent && g.byId[s.parent]) out.push(s.parent);
  if (id === "ILIAC_L" || id === "ILIAC_R") out.push("AORTA_ABD");
  if (id === "AORTA_ABD") { out.push("ILIAC_L", "ILIAC_R"); }
  if (id === "INNOM") out.push("AORTA_THOR");
  if (id === "AORTA_THOR") out.push("INNOM");
  return out;
};

/** Segment ids from the puncture site to a coronary target (e.g. LM, RCA, LAD). */
export function routeTo(g: VGraph, site: AccessSite, target: string): string[] {
  const start = site === "femoral-L" ? "FEM_L" : site === "radial-L" ? "RADIAL_R" : siteRoot[site];
  const q: string[][] = [[start]];
  const seen = new Set<string>([start]);
  while (q.length) {
    const path = q.shift()!;
    const cur = path[path.length - 1];
    if (cur === target) return path;
    for (const n of neighbors(g, cur)) {
      if (seen.has(n)) continue;
      seen.add(n);
      q.push([...path, n]);
    }
  }
  throw new Error(`no route from ${site} to ${target}`);
}

const tangentAt = (g: VGraph, segId: string, mm: number): [number, number, number] => {
  const s = g.byId[segId];
  const u = Math.min(1, Math.max(0, mm / s.length));
  const i = Math.min(s.samples.length - 2, Math.floor(u * (s.samples.length - 1)));
  const a = s.samples[i], b = s.samples[i + 1];
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  return [dx / l, dy / l, dz / l];
};

const angleBetween = (u: [number, number, number], v: [number, number, number]) => {
  const d = Math.min(1, Math.max(-1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  return Math.acos(d);
};

/** Radians turned along a route between arc-length positions (mm from the start of the route). */
export function curvatureAlong(g: VGraph, route: string[], fromMm: number, toMm: number): number {
  let pos = 0, rad = 0, prev: [number, number, number] | null = null;
  for (const id of route) {
    const s = g.byId[id];
    const segStart = pos;
    const segEnd = pos + s.length;
    if (segEnd < fromMm) { pos = segEnd; continue; }
    const a = Math.max(fromMm, segStart) - segStart;
    const b = Math.min(toMm, segEnd) - segStart;
    for (let mm = a; mm <= b; mm += 2) {
      const t = tangentAt(g, id, mm);
      if (prev) rad += angleBetween(prev, t);
      prev = t;
    }
    pos = segEnd;
    if (pos >= toMm) break;
  }
  return rad;
}

const routeLength = (g: VGraph, route: string[]) => route.reduce((sum, id) => sum + g.byId[id].length, 0);

/** Share of a push that reaches the wire tip (0..1). */
export function transmission(g: VGraph, route: string[], tipMm: number, supportScore: number): number {
  const total = routeLength(g, route);
  const curv = curvatureAlong(g, route, 0, Math.min(tipMm, total));
  let mult = 1;
  for (const id of route) {
    const s = g.byId[id];
    if (s.id.startsWith("ILIAC") && s.calcification > 0.5) mult *= 0.85;
    if (s.id === "RADIAL_R" && s.tortuosity > 0.5) mult *= 0.72;
    mult *= 1 - 0.08 * s.tortuosity;
  }
  return Math.exp(-0.35 * curv / (0.5 + supportScore)) * mult;
}
