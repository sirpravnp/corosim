import { V3, add, mul } from "../anatomy/curve";
import { Part, PART_NAMES, heartSdf, partAt } from "../anatomy/heartSurface";
import { Pose, SECTOR, toHeart } from "./poses";
import { FrameSample, Tissue, classifyFrame, idealPatient } from "./tissue";

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

const scratch: FrameSample = { tissue: Tissue.Outside, part: null, sdf: 0, ref: [0, 0, 0] };

/** Rays across the sector, and steps along each ray. Fine enough to catch the aortic root. */
const RAYS = 61;
const STEPS = 80;

export interface SampleOpts {
  rays?: number;
  steps?: number;
}

/** Sample the sector of `pose` and label each part that the plane cuts. */
export function sampleSlice(pose: Pose, opts: SampleOpts = {}): EchoSlice {
  const rays = opts.rays ?? RAYS, steps = opts.steps ?? STEPS;
  const samples: SliceSample[] = [];
  const half = SECTOR.halfAngle;
  for (let i = 0; i < rays; i++) {
    const angle = -half + (2 * half * i) / Math.max(1, rays - 1);
    const c = Math.cos(angle), s = Math.sin(angle);
    const dir: V3 = [
      pose.beam[0] * c + pose.lateral[0] * s,
      pose.beam[1] * c + pose.lateral[1] * s,
      pose.beam[2] * c + pose.lateral[2] * s,
    ];
    for (let j = 0; j < steps; j++) {
      const radius = (pose.depth * j) / Math.max(1, steps - 1);
      const point = add(pose.probe, mul(dir, radius));
      const heart = toHeart(point);
      // the CT heart when it is installed (its own classification: chamber and outer distance), else the schematic display heart
      const ideal = idealPatient();
      const hit = ideal ? classifyFrame(heart, ideal.heart, ideal.frame, scratch) : null;
      const sdf = hit ? hit.sdf : heartSdf(heart);
      samples.push({
        point,
        depth: radius * c,
        lateral: radius * s,
        sdf,
        part: hit ? (hit.part !== null && hit.tissue !== Tissue.Outside && hit.part <= Part.Aorta ? hit.part : sdf < 0 ? Part.LV : null) : sdf < 0 ? partAt(heart) : null,
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
