/**
 * Display-only lesion, flow and perfusion cues of the 3D coronary depiction (C6 parts b and c). Pure functions of numbers the physics
 * already produced (the lumen the network solved, the occlusion station, flow, bed severity and scar); nothing here feeds back into the
 * physics. The three.js assembly lives in page/vessels3d.ts (plaque, clot, flow particles) and page/heart3d.ts (myocardial blush).
 */
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (t: number) => { t = clamp01(t); return t * t * (3 - 2 * t); };

/** Fractional narrowing (0..1) of a lumen of diameter `d` against the healthy diameter `dh` there; below 2 % it is rounding noise and reads 0. */
export const narrowing = (d: number, dh: number) => (dh > 0 ? smooth((1 - d / dh - 0.02) / 0.06) * clamp01(1 - d / dh) : 0);

/** Angular weight (0..1) of an eccentric plaque centred on ring angle `theta0`: full at the centre, zero on the far side. */
export const plaqueSector = (theta: number, theta0: number) => Math.pow((1 + Math.cos(theta - theta0)) / 2, 1.6);

/**
 * Extra ring radius factor (>= 0, times the ring's lumen radius) that lets the vessel wall show the plaque: on the plaque side the wall
 * stands back out toward the healthy radius (and a little past it, the outward remodelling of a plaque), while the lumen stays pinched
 * on the opposite side. `ratio` is healthy/actual diameter, capped so a pin-hole lumen does not make a spike.
 */
export function plaqueBulge(narrow: number, sector: number, ratio: number): number {
  if (narrow <= 0 || sector <= 0) return 0;
  const r = Math.min(ratio, 6);
  return (r - 1 + 0.08 * r) * 0.9 * sector;
}
/** How strongly the plaque tint shows (0..1): even a moderate stenosis is clearly cream on its plaque side. */
export const plaqueTint = (narrow: number, sector: number) => clamp01(narrow * 4) * sector;

/** Deterministic speckle (0..1) for the calcification hint: sparse bright flecks, only on a tight (>= 60 %) plaque. */
export function calcification(s: number, theta: number, narrowFrac: number): number {
  if (narrowFrac < 0.6) return 0;
  const v = Math.sin(s * 5.3 + theta * 2.1) * Math.sin(s * 2.9 - theta * 3.7 + 1.3);
  return smooth((v - 0.55) / 0.2) * clamp01((narrowFrac - 0.6) / 0.2);
}

/**
 * Thrombus along a vessel at station `s` (mm): a clot cap on the proximal side of an occlusion that is built up over about `reach` mm and
 * a few mm of tail past the occlusion station. 0 where nothing is occluded (`blockedFrom` is null).
 */
export function thrombusAt(s: number, blockedFrom: number | null, reach = 5, tail = 1.5): number {
  if (blockedFrom === null) return 0;
  return smooth((s - (blockedFrom - reach)) / reach) * (1 - smooth((s - blockedFrom) / tail));
}
/** A near-occlusive plaque (>= 85 % stenosis) carries a mural thrombus on its crown, as in an acute coronary syndrome: 0..0.5. */
export const muralThrombus = (stenosis: number) => 0.5 * smooth((stenosis - 0.85) / 0.1);

/**
 * Fraction (0..1) of resting flow the lumen carries at a point: the density of the flow particles. Past a stenosis it thins (never to
 * nothing: a trickle is still flow); beyond an occlusion there is none.
 */
export const flowDensity = (q: number, qRest: number, blocked: boolean) => (blocked ? 0 : Math.max(0.12, clamp01(qRest > 0 ? q / qRest : 1)));
/** Speed multiplier for the particles at that density: slow (a fifth) at a trickle, full at normal flow. */
export const flowSpeedScale = (density: number) => 0.2 + 0.8 * density;

/**
 * Myocardial blush at a point of the muscle (0..1), from what the beds nearby get: `ratio` is delivered flow over demand (capped at 1),
 * `sev` the ischemia state and `nec` the scar. Bright where perfused, none over an infarct and fading over an ischemic bed.
 */
export const blushLevel = (ratio: number, sev: number, nec: number) => clamp01(ratio) * clamp01(1 - sev) * clamp01(1 - nec);
