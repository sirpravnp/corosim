import type { V3 } from "../../anatomy/curve";
import type { LabState, VGraph } from "../../lab/types";
import { deviceFocus, overviewBox } from "../../lab/camera";

/** Where the picture is aimed: the heart (the default angiographic frame), the leading device tip, or a schematic of the whole route (see `isSchematic`). */
export type CameraMode = "heart" | "follow" | "overview";
export interface Cam { centre: V3; spanMm: number }

export const HEART_SPAN_MM = 135;
/** The widest field of view a real C-arm gives (about a 30 cm detector with magnification off). Follow never frames more than this. */
export const MAX_FLUORO_SPAN_MM = 260;
/** Overview is a schematic, not a fluoroscopic picture: no single x-ray frame can hold the whole 600 mm route. */
export const isSchematic = (mode: CameraMode) => mode === "overview";

export function camTarget(mode: CameraMode, st: Readonly<LabState>, g: VGraph, heartCentre: V3): Cam {
  if (mode === "heart") return { centre: heartCentre, spanMm: HEART_SPAN_MM };
  if (mode === "follow") { const f = deviceFocus(st as LabState, g); return { centre: f.point, spanMm: Math.min(f.fovMm, MAX_FLUORO_SPAN_MM) }; }
  const b = overviewBox(g);
  return { centre: b.center, spanMm: b.spanMm * 1.12 };
}

/** One step of easing toward the target so a camera change glides instead of jumping. `k` is the fraction of the gap closed per call. */
export function easeCam(cur: Cam, to: Cam, k = 0.14): Cam {
  const m = (a: number, b: number) => a + (b - a) * k;
  return { centre: [m(cur.centre[0], to.centre[0]), m(cur.centre[1], to.centre[1]), m(cur.centre[2], to.centre[2])], spanMm: m(cur.spanMm, to.spanMm) };
}
