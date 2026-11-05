import { V3, add, mul } from "../anatomy/curve";
import { Part, PART_NAMES, heartSdf, partAt } from "../anatomy/heartSurface";
import { Pose, SECTOR, toHeart } from "./poses";

/**
 * Ideal cross-section of one probe pose. Samples lie in the scan sector (the pose plane, within the
 * sector angle and depth). Each sample is classified by the schematic heart: signed distance in the
 * heart frame, and the part when the point is inside. Labels sit at the centroid of each part's samples.
 * Valves, papillary muscles and wall thickness are not in the field, so a label names the solid part.
 */

export interface SliceSample {
  /** Patient frame, mm. */
  point: V3;
  /** Millimeters along the beam, from the probe. */
  depth: number;
  /** Millimeters along the lateral axis, from the beam. */
  lateral: number;
  /** Signed distance, mm, in the heart frame. Negative inside the heart. */
  sdf: number;
  /** Null outside the heart. */
  part: Part | null;
}

export interface SliceLabel {
  part: Part;
  /** Anatomical name, sentence case. */
  name: string;
  depth: number;
  lateral: number;
}

export interface EchoSlice {
  samples: SliceSample[];
  labels: SliceLabel[];
}

/** Rays across the sector, and steps along each ray. Fine enough to catch the aortic root. */
const RAYS = 61;
const STEPS = 80;

/** Sample the sector of `pose` and label each part that the plane cuts. */
export function sampleSlice(pose: Pose): EchoSlice {
  const samples: SliceSample[] = [];
  const half = SECTOR.halfAngle;
  for (let i = 0; i < RAYS; i++) {
    const angle = -half + (2 * half * i) / (RAYS - 1);
    const c = Math.cos(angle), s = Math.sin(angle);
    const dir: V3 = [
      pose.beam[0] * c + pose.lateral[0] * s,
      pose.beam[1] * c + pose.lateral[1] * s,
      pose.beam[2] * c + pose.lateral[2] * s,
    ];
    for (let j = 0; j < STEPS; j++) {
      const radius = (pose.depth * j) / (STEPS - 1);
      const point = add(pose.probe, mul(dir, radius));
      const heart = toHeart(point);
      const sdf = heartSdf(heart);
      samples.push({
        point,
        depth: radius * c,
        lateral: radius * s,
        sdf,
        part: sdf < 0 ? partAt(heart) : null,
      });
    }
  }

  const groups = new Map<Part, { n: number; depth: number; lateral: number }>();
  for (const sample of samples) {
    if (sample.part === null) continue;
    const group = groups.get(sample.part) ?? { n: 0, depth: 0, lateral: 0 };
    group.n += 1;
    group.depth += sample.depth;
    group.lateral += sample.lateral;
    groups.set(sample.part, group);
  }
  const labels: SliceLabel[] = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([part, group]) => ({
      part,
      name: PART_NAMES[part],
      depth: group.depth / group.n,
      lateral: group.lateral / group.n,
    }));
  return { samples, labels };
}
