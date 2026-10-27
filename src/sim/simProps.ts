import { analyze } from "../physics/structural";
import type { StructuralSpec } from "../physics/structural";
import { rotateHeart } from "../anatomy/tree";
import { unrotateHeart } from "../anatomy/heartSurface";
import type { V3 } from "../anatomy/curve";
import { buildProps } from "../structural/props";
import type { Jet, Props, Tri } from "../structural/props";
import { satMap } from "../structural/morph";
import type { PatientSpec } from "./patient";
import { gradeValves } from "./structural";

/**
 * The structural props (septa with defect holes, valve annuli, jets) for the Simulator's heart, task P11. DOM-free.
 *
 * Report: `analyze` of the patient's `heart` spec on its own (no waveform, no MAP calibration), then `gradeValves` and
 * `buildProps` against the default heart morph, because the Simulator draws the default (normal-shaped) heart and the props
 * must sit inside it, not inside the reshaped heart the structural page draws. This is not a calibrated report:
 * a lesion's anatomy and jets do not depend on the ACS state, and re-solving as ischemia moves would rebuild the props for nothing. It is computed once when the patient changes, in a worker (src/sim/propsWorker.ts).
 *
 * Frame: props are built in the heart frame (x left, y toward the base, z anterior, mm), the frame of `meshHeart`. The
 * Simulator draws the heart with `rotateHeart` on every vertex (apex tilted left and anterior), and so did the structural page
 * for its props, so a prop point maps to the scene with the same `rotateHeart`, and a direction, being a vector, with the same
 * rotation (it is linear: no translation).
 */
export const heartToScene = (p: V3): V3 => rotateHeart(p);
export const sceneToHeart = (p: V3): V3 => unrotateHeart(p);
export const dirToScene = (d: V3): V3 => rotateHeart(d);

const triToScene = (t: Tri): Tri => {
  const positions = new Array<number>(t.positions.length);
  for (let i = 0; i < t.positions.length; i += 3) { const q = heartToScene([t.positions[i], t.positions[i + 1], t.positions[i + 2]]); positions[i] = q[0]; positions[i + 1] = q[1]; positions[i + 2] = q[2]; }
  return { positions, indices: t.indices };
};
/** The same props with every point and direction in the Simulator's scene frame. */
export function propsToScene(p: Props): Props {
  return {
    septum: triToScene(p.septum), atrialSeptum: triToScene(p.atrialSeptum),
    valves: p.valves.map((v) => ({ ...v, tri: triToScene(v.tri), center: heartToScene(v.center) })),
    jets: p.jets.map((j): Jet => ({ ...j, from: heartToScene(j.from), dir: dirToScene(j.dir) })),
  };
}

export interface SimProps { props: Props; sat: ReturnType<typeof satMap> }
/** Spec to props, in the heart frame. A patient with no `heart` section is the normal heart. */
export function propsForPatient(patient: PatientSpec | undefined): SimProps {
  const spec: StructuralSpec = { ...(patient?.heart ?? {}), patient: "adult" };
  const report = analyze(spec, { waveform: false });
  return { props: buildProps(spec, report, {}, gradeValves(spec, report)), sat: satMap(report) };
}
