import { V3 } from "../anatomy/curve";
import { Part, classifyHeart, septalDistance } from "../anatomy/heartSurface";
import { isWall } from "./wall";
import { LV, E1, E2, LvPoint, MITRAL, TRICUSPID, lvEpiDistance, lvFrame, onAorticCusp, onAtrioventricularLeaflet, papillaryDistance } from "./anatomy";

/**
 * The echo anatomy: what a point of the heart is, as an ultrasound beam would meet it. Separate from the 3D display heart
 * (`heartSdf`), which the sim, the coronary tree and the 3D pane keep using unchanged. Only slicing reads this.
 * Heart frame, mm (x left, y along the long axis toward the base, z anterior): the frame `toHeart` in poses.ts returns.
 */
export enum Tissue {
  Outside = 0,
  /** Blood pool of the chamber named by `part`. */
  Blood = 1,
  /** Free wall of a ventricle or atrium, and the vessel walls. */
  Myocardium = 2,
  /** Interventricular septum. */
  Septum = 3,
  /** Valve leaflet or cusp. */
  Leaflet = 4,
  /** Papillary muscle. */
  Papillary = 5,
  /** Pericardium: the bright line behind the heart. */
  Pericardium = 6,
}

export interface EchoSample {
  tissue: Tissue;
  /** Chamber or vessel the point belongs to, null outside the heart. */
  part: Part | null;
  /** Signed distance to the display heart's outer surface, mm (negative inside). */
  sdf: number;
}

/** Everything that is not blood or empty is something the beam reflects from. */
export const isSolidTissue = (t: Tissue) => t !== Tissue.Outside && t !== Tissue.Blood;

/**
 * Pericardium: a thin bright line this far outside the display heart's outer surface. `center` is the sdf at the middle of the line, `thick` its
 * thickness in mm. The display field's gradient is not 1 everywhere (the fillets flatten it), so the band in sdf is scaled by the local gradient
 * to keep the line the same thickness in space.
 */
export const PERICARDIUM = { center: 4.2, thick: 1.2, from: 3.5, to: 5 };
const GRAD_STEP = 1.0;
function onPericardium(p: V3, sdf: number): boolean {
  if (sdf < PERICARDIUM.from - 0.5 || sdf > PERICARDIUM.to + 0.5) return false;
  const gx = (classifyHeart([p[0] + GRAD_STEP, p[1], p[2]]).sdf - sdf) / GRAD_STEP;
  const gy = (classifyHeart([p[0], p[1] + GRAD_STEP, p[2]]).sdf - sdf) / GRAD_STEP;
  const gz = (classifyHeart([p[0], p[1], p[2] + GRAD_STEP]).sdf - sdf) / GRAD_STEP;
  const g = Math.max(0.2, Math.hypot(gx, gy, gz)), half = Math.min(0.5 * PERICARDIUM.thick * g, 0.75);
  return Math.abs(sdf - PERICARDIUM.center) <= half;
}
/** The heart's bounding box (mesh bounds of `meshHeart`). Points outside it, beyond the pericardium, are empty. */
const BOX_LO: V3 = [-64, -74, -72], BOX_HI: V3 = [64, 114, 48];
const scratch: LvPoint = { t: 0, x: 0, y: 0 };

/**
 * Classify one heart-frame point. `phase` is the valve opening, 0 closed to 1 fully open (default: half open, a resting look).
 *
 * Ventricles are re-divided from the display heart: an LV epicardial shape that is round in the short axis, an LV cavity inset by `LV.wall`,
 * the septum as the part of that shell that faces the RV, and the RV as everything else inside the display heart's inset surface, so it
 * wraps the LV as a crescent. Every point gets exactly one tissue: the branches below are exclusive.
 */
export function classifyEcho(p: V3, phase = 0.35): EchoSample {
  if (p[0] < BOX_LO[0] || p[0] > BOX_HI[0] || p[1] < BOX_LO[1] || p[1] > BOX_HI[1] || p[2] < BOX_LO[2] || p[2] > BOX_HI[2]) {
    const dx = Math.max(BOX_LO[0] - p[0], 0, p[0] - BOX_HI[0]), dy = Math.max(BOX_LO[1] - p[1], 0, p[1] - BOX_HI[1]), dz = Math.max(BOX_LO[2] - p[2], 0, p[2] - BOX_HI[2]);
    return { tissue: Tissue.Outside, part: null, sdf: Math.hypot(dx, dy, dz) };
  }
  const hit = classifyHeart(p);
  if (hit.part === null) {
    return { tissue: onPericardium(p, hit.sdf) ? Tissue.Pericardium : Tissue.Outside, part: null, sdf: hit.sdf };
  }
  const sdf = hit.sdf, part = hit.part;
  const s = septalDistance(p);

  if (part !== Part.LV && part !== Part.RV) { // atria and aorta: thin wall, blood inside
    if (isWall(part, sdf, s, p[1])) return { tissue: Tissue.Myocardium, part, sdf };
    const lp = leafletPart(p, phase);
    return lp === null ? { tissue: Tissue.Blood, part, sdf } : { tissue: Tissue.Leaflet, part: lp, sdf };
  }

  const f = lvFrame(p, scratch), dEpi = lvEpiDistance(f);
  if (dEpi < 0) { // inside the LV epicardial shape
    if (dEpi > -LV.wall) { // wall: septum where the shell faces the right ventricle
      const rho = Math.hypot(f.x, f.y) || 1;
      // the epicardial point straight out from here, in the short-axis plane; its septal distance tells which side it faces
      const k = (-dEpi) / rho;
      const q: V3 = [p[0] + (f.x * E1[0] + f.y * E2[0]) * k, p[1] + (f.x * E1[1] + f.y * E2[1]) * k, p[2] + (f.x * E1[2] + f.y * E2[2]) * k];
      const facesRv = septalDistance(q) < LV.rvSideLimit && sdf < -LV.rvWall;
      return { tissue: facesRv ? Tissue.Septum : Tissue.Myocardium, part: Part.LV, sdf };
    }
    if (papillaryDistance(f) < 0) return { tissue: Tissue.Papillary, part: Part.LV, sdf };
    const lp = leafletPart(p, phase);
    return { tissue: lp === null ? Tissue.Blood : Tissue.Leaflet, part: lp ?? Part.LV, sdf };
  }
  // outside the LV shape, inside the display heart: right ventricle if on the right side, else more LV wall
  if (s < LV.rvSideLimit) {
    if (sdf < -LV.rvWall) {
      const lp = leafletPart(p, phase);
      return { tissue: lp === null ? Tissue.Blood : Tissue.Leaflet, part: lp ?? Part.RV, sdf };
    }
    return { tissue: Tissue.Myocardium, part: Part.RV, sdf };
  }
  return { tissue: Tissue.Myocardium, part: Part.LV, sdf };
}

/** The ventricle a leaflet or cusp at this point bounds on its ventricular side (LV for mitral and aortic, RV for tricuspid), or null if there is none. */
function leafletPart(p: V3, phase: number): Part | null {
  if (onAtrioventricularLeaflet(p, MITRAL, phase) || onAorticCusp(p, phase)) return Part.LV;
  if (onAtrioventricularLeaflet(p, TRICUSPID, phase)) return Part.RV;
  return null;
}
