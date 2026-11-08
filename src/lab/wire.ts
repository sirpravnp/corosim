import { LAB } from "../config/lab";
import type { Guidewire, LabEvent, LabState, Plaque, VGraph } from "./types";
import { transmission } from "./route";

export interface AdvanceResult {
  tipSeg: string;
  tipMm: number;
  moved: number;
  route: string[];
  event?: LabEvent;
  prolapse?: { seg: string; atMm: number };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Resistance to advancing through a plaque (0..1), compared with push × transmission. */
export function crossingResistance(w: Guidewire, p: Plaque, tipLoadGf: number): number {
  let r = 0.12 + p.ds * 0.55 + p.calcium * 0.4;
  if (p.cto) r += p.cto.capHardness * (p.cto.microchannels ? 0.35 : 0.85);
  if (p.thrombus > 0.5 && p.ds > 0.9) r += 0.15;
  const stiff = w.stiffness === "stiff" ? 0.28 : w.stiffness === "intermediate" ? 0.12 : 0;
  r = Math.max(0.08, r - stiff - tipLoadGf * 0.012);
  if (w.coating === "hydrophilic" || w.coating === "polymer") r *= 1 - LAB.hydrophilicCrossingDiscount;
  return clamp01(r);
}

/** Pick a daughter branch. `""` means stay on the parent segment past the bifurcation. */
export function branchChoice(
  w: Guidewire,
  bendDeg: number,
  rotDeg: number,
  branchAngles: { id: string; angleDeg: number; diameterMm: number }[],
  rand: () => number,
): string {
  if (!branchAngles.length) return "";
  if (bendDeg < LAB.branchBendChoiceDeg) {
    const big = branchAngles.reduce((a, b) => (b.diameterMm > a.diameterMm ? b : a));
    const second = branchAngles.find((b) => b.id !== big.id);
    return second && big.diameterMm > second.diameterMm + 0.15 ? big.id : "";
  }
  const pick = branchAngles.find((b) => Math.abs(rotDeg - b.angleDeg) < LAB.branchMatchRotDeg);
  if (!pick) return "";
  return rand() < 0.9 ? pick.id : "";
}

const plaqueAt = (plaques: Plaque[], segId: string, mm: number): Plaque | undefined =>
  plaques.find((p) => p.segId === segId && Math.abs(p.centerMm - mm) < p.lengthMm / 2 + 2);

const v3 = (a: [number, number, number], b: [number, number, number]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  return [dx / l, dy / l, dz / l] as const;
};

const branchAngleAt = (g: VGraph, parent: string, childId: string): number => {
  const p = g.byId[parent], c = g.byId[childId];
  const u = c.attach;
  const i = Math.min(p.samples.length - 2, Math.max(0, Math.floor(u * (p.samples.length - 1))));
  const pt = v3(p.samples[i], p.samples[i + 1]);
  const ct = v3(c.samples[0], c.samples[Math.min(2, c.samples.length - 1)]);
  const dot = Math.min(1, Math.max(-1, pt[0] * ct[0] + pt[1] * ct[1] + pt[2] * ct[2]));
  return (Math.acos(dot) * 180) / Math.PI;
};

const childBranches = (g: VGraph, segId: string) =>
  g.segs
    .filter((s) => s.parent === segId)
    .map((s) => ({
      id: s.id,
      angleDeg: branchAngleAt(g, segId, s.id),
      diameterMm: Math.min(...s.diameterMm),
      attachMm: s.attach * g.byId[segId].length,
    }));

/** Push the wire along its route, with lesion crossing and branch choice. */
export function advanceWire(
  g: VGraph,
  st: LabState,
  w: Guidewire,
  plaques: Plaque[],
  guideSupport: number,
  mm: number,
  rand: () => number,
): AdvanceResult {
  const route = [...(st.wire?.route ?? [])];
  let tipSeg = st.wire?.tipSeg ?? route[0] ?? "";
  let tipMm = st.wire?.tipMm ?? 0;
  const tx = transmission(g, route, tipMm, 0.35 + guideSupport);
  const push = Math.abs(mm) * tx * (0.35 + w.support + guideSupport * 0.45);
  const want = Math.sign(mm) * Math.abs(mm);
  let moved = 0;
  let event: LabEvent | undefined;
  let prolapse: AdvanceResult["prolapse"];

  const plaque = plaqueAt(plaques, tipSeg, tipMm);
  if (plaque && want > 0) {
    const res = crossingResistance(w, plaque, w.tipLoadGf);
    let need = res * (9 + plaque.calcium * 2);
    if (w.stiffness === "stiff") need *= 0.45;
    else if (w.stiffness === "intermediate") need *= 0.85;
    if (push < need) {
      const idx = Math.max(0, route.indexOf(tipSeg));
      const prox = route[Math.max(0, idx - 1)] ?? tipSeg;
      prolapse = { seg: prox, atMm: Math.max(0, tipMm - 4) };
      event = { at: st.elapsedS, kind: "prolapse", text: "The wire buckled and prolapsed proximally.", severity: "caution" };
      return { tipSeg: prox, tipMm: prolapse.atMm, moved: 0, route, event, prolapse };
    }
    if (plaque.cto && !plaque.cto.microchannels && push >= need) {
      const risk = (w.stiffness === "stiff" ? 0.45 : 0.2) + (w.coating === "hydrophilic" ? 0.35 : 0);
      if (rand() < risk) {
        const sub = rand() < 0.55 ? "subintimal" : "perforation";
        event = {
          at: st.elapsedS, kind: sub,
          text: sub === "subintimal" ? "The wire tracked subintimally." : "Suspected perforation.",
          severity: "bad",
        };
      }
    }
  }

  let left = Math.abs(want);
  const dir = Math.sign(want) || 1;
  while (left > 1e-6 && tipSeg) {
    const seg = g.byId[tipSeg];
    if (!seg) break;
  const stepRoom = dir > 0 ? seg.length - tipMm : tipMm;
    const step = Math.min(left, stepRoom);
    const nextMm = tipMm + dir * step;
    moved += step;
    left -= step;
    tipMm = nextMm;

    if (dir > 0) {
      const branches = childBranches(g, tipSeg).filter((b) => b.attachMm <= tipMm + 0.5 && b.attachMm >= tipMm - step - 0.5);
      if (branches.length && st.wire) {
        const choice = branchChoice(w, st.wire.bendDeg, st.wire.rotDeg, branches, rand);
        if (choice && g.byId[choice]) {
          if (!route.includes(choice)) route.push(choice);
          tipSeg = choice;
          tipMm = Math.max(0, tipMm - branches.find((b) => b.id === choice)!.attachMm);
        }
      }
    }
    if ((dir > 0 && tipMm >= seg.length - 1e-6) || (dir < 0 && tipMm <= 1e-6)) {
      const idx = route.indexOf(tipSeg);
      if (dir > 0 && idx >= 0 && idx < route.length - 1) {
        tipSeg = route[idx + 1];
        tipMm = 0;
      } else if (dir < 0 && idx > 0) {
        tipSeg = route[idx - 1];
        tipMm = g.byId[tipSeg].length;
      } else break;
    }
  }
  return { tipSeg, tipMm: Math.max(0, tipMm), moved, route, event, prolapse };
}
