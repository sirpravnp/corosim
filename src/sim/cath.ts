/**
 * What the cath lab reads off a Simulation. DOM-free.
 *
 * This file is shared between sessions: phase 1 adds the angiogram and wire models (angioModel, wireModel); phase 2 (the TEE) adds
 * echoModel below. Keep them separate functions so the two merge cleanly.
 */
import { NSEG, SEG17 } from "../cath/echo/ids";
import { SCORE_NAME, SEGMENT_TERRITORY, WALL_MOTION } from "../config/echo";
import type { Simulation } from "./simulation";

// ---------- echo ----------

export type WallMotionScore = 1 | 2 | 3 | 4;

export interface EchoSegment {
  /** 0..16, volume order (see SEG17). */
  index: number;
  name: string;
  /** Mean ischemia of the beds that feed it, 0..1. */
  ischemia: number;
  /** Irreversible injury, 0..1. */
  scar: number;
  /** How little it thickens, 0 (normal) .. 1 (not at all). */
  dysfunction: number;
  /** Bulges outward in systole, 0..1. */
  bulge: number;
  /** 1 normal, 2 hypokinetic, 3 akinetic, 4 dyskinetic. */
  score: WallMotionScore;
  motion: (typeof SCORE_NAME)[number];
}

export interface EchoModel {
  segments: EchoSegment[];
  /** Mean ischemia by coronary group, mass-weighted. */
  groups: { LAD: number; LCx: number; RCA: number };
  /** Mean wall-motion score over the 17 segments (1 normal .. 4). */
  scoreIndex: number;
  ef: number;
  hr: number;
}

const GROUP_INDEX: Record<string, number> = { LAD: 0, LCx: 1, RCA: 2 };

/**
 * Severity per AHA segment, wall-motion score, EF and heart rate. A segment's ischemia is the territory-weighted mean of the
 * mass-weighted ischemia of the three coronary groups; scar is likewise weighted. Replaces the prototype's `segSeverity` and `prepSev`.
 * Limit: a lesion in the middle of an artery lowers the group mean as much as one at its origin; no beds are mapped to a particular
 * level of the wall yet, so distal and proximal segments of one territory move together.
 */
export function echoModel(sim: Pick<Simulation, "sev" | "scar" | "analysis" | "tree" | "circ" | "rolling">): EchoModel {
  const group = new Map<string, string>(sim.tree.segments.map((s) => [s.id, s.group]));
  const sev = [0, 0, 0], scar = [0, 0, 0], mass = [0, 0, 0];
  for (const t of sim.analysis.cond.terminals) {
    const g = GROUP_INDEX[group.get(t.segId) ?? "RCA"] ?? 2;
    mass[g] += t.mass; sev[g] += t.mass * (sim.sev[t.key] ?? 0); scar[g] += t.mass * (sim.scar[t.key] ?? 0);
  }
  for (let g = 0; g < 3; g++) if (mass[g] > 0) { sev[g] /= mass[g]; scar[g] /= mass[g]; }
  const segments: EchoSegment[] = [];
  for (let i = 0; i < NSEG; i++) {
    const w = SEGMENT_TERRITORY[i];
    const ischemia = w[0] * sev[0] + w[1] * sev[1] + w[2] * sev[2], injury = w[0] * scar[0] + w[1] * scar[1] + w[2] * scar[2];
    const dysfunction = Math.min(1, Math.max(ischemia, injury));
    const bulge = injury > WALL_MOTION.dyskinetic ? Math.min(1, (injury - WALL_MOTION.dyskinetic) / (1 - WALL_MOTION.dyskinetic)) : 0;
    const score: WallMotionScore = bulge > 0.3 ? 4 : dysfunction >= WALL_MOTION.akinetic ? 3 : dysfunction >= WALL_MOTION.hypokinetic ? 2 : 1;
    segments.push({ index: i, name: SEG17[i], ischemia, scar: injury, dysfunction, bulge, score, motion: SCORE_NAME[score] });
  }
  const hr = sim.rolling(10).hr;
  return {
    segments,
    groups: { LAD: sev[0], LCx: sev[1], RCA: sev[2] },
    scoreIndex: segments.reduce((s, x) => s + x.score, 0) / NSEG,
    ef: sim.circ.ejectionFraction,
    hr: Number.isFinite(hr) ? hr : 72,
  };
}
