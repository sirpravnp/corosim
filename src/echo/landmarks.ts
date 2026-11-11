import type { V3 } from "../anatomy/curve";

/** Landmarks of the heart in its own frame (x left, y base-ward along the long axis, z anterior), mm, placed on the schematic heart. */
export const LANDMARKS_HEART_FRAME = {
  apex: [0, -63, 0] as V3,          // just inside the tip of the tapered LV
  mitral: [15, 50, -14] as V3,      // LV side of the septal plane, at the valve plane (y = 54), well posterior to the aortic root
  tricuspid: [-18, 50, -4] as V3,   // RV side; the A4C plane through both valves passes behind the aortic root, as in life
  aortic: [0, 48, 2] as V3,         // aortic root, a little below the valve plane so the short-axis cut passes through the right ventricular outflow too
};
