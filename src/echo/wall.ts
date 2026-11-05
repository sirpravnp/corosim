import { Part } from "../anatomy/heartSurface";

/**
 * Which solid points of the schematic heart are myocardium. The heart field is solid, with one ventricular ellipsoid cut by a
 * septal plane into left and right, so walls are rebuilt here: a band just inside the outer surface, plus the interventricular
 * septum as a band around the septal plane (thicker on the left side, as in life).
 */

/** Approximate free-wall thickness by part, mm. */
export const WALL_MM: Record<Part, number> = {
  [Part.LV]: 9,
  [Part.RV]: 3.5,
  [Part.RA]: 2.5,
  [Part.LA]: 2.5,
  [Part.Aorta]: 2.8,
};

/** Septum extent in `septalDistance` mm: RV side to LV side (10 mm thick). */
export const SEPTUM = { rv: -3, lv: 7 };
/** Heart-frame y above which the ventricles give way to the valve plane and atria: no septum there. */
const SEPTUM_TOP_Y = 46;

/**
 * `sdf` is the whole-heart signed distance (negative inside), `septal` the signed distance to the septal plane
 * (positive on the LV side), `y` the heart-frame height along the long axis.
 */
export function isWall(part: Part, sdf: number, septal: number, y: number): boolean {
  if (sdf > -WALL_MM[part]) return true;
  return (part === Part.LV || part === Part.RV) && y < SEPTUM_TOP_Y && septal >= SEPTUM.rv && septal <= SEPTUM.lv;
}
