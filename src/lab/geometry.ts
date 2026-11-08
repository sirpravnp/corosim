import type { V3 } from "../anatomy/curve";
import type { VGraph } from "./types";

const lerp = (a: V3, b: V3, w: number): V3 => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];

export function samplePoint(g: VGraph, segId: string, mm: number): V3 {
  const s = g.byId[segId];
  if (!s) return [0, 0, 0];
  const u = Math.min(1, Math.max(0, mm / s.length));
  const i = Math.min(s.samples.length - 2, Math.floor(u * (s.samples.length - 1)));
  const w = u * (s.samples.length - 1) - i;
  return lerp(s.samples[i], s.samples[i + 1], w);
}

export function pointOnRoute(g: VGraph, route: string[], arcMm: number): V3 {
  let left = arcMm;
  for (const id of route) {
    const len = g.byId[id].length;
    if (left <= len) return samplePoint(g, id, left);
    left -= len;
  }
  const last = route[route.length - 1];
  return samplePoint(g, last, g.byId[last].length);
}

export function routeArcTo(g: VGraph, route: string[], segId: string, mm: number): number {
  let arc = 0;
  for (const id of route) {
    if (id === segId) return arc + mm;
    arc += g.byId[id].length;
  }
  return arc + mm;
}
