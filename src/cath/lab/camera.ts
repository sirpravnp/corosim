import type { V3 } from "../../anatomy/curve";
import type { AccessSite, LabState, VGraph, VSeg } from "../../lab/types";
import { samplePoint } from "../../lab/geometry";
import { deviceFocus, overviewBox } from "../../lab/camera";

/** Where the picture is aimed: the heart (the default angiographic frame), the leading device tip, or a schematic of the whole route (see `isSchematic`). */
export type CameraMode = "heart" | "follow" | "overview";
export interface Cam { centre: V3; spanMm: number }

export const HEART_SPAN_MM = 170;
/** The widest field of view a real C-arm gives (about a 30 cm detector with magnification off). Follow never frames more than this. */
export const MAX_FLUORO_SPAN_MM = 260;
/** Overview is a schematic, not a fluoroscopic picture: no single x-ray frame can hold the whole 600 mm route. */
export const isSchematic = (mode: CameraMode) => mode === "overview";

/** Where Follow looks before there is any device: the puncture site, because a procedure starts at the groin (or the wrist) and works up. */
export function startCam(g: VGraph, site: AccessSite = "femoral-R"): Cam {
  const id = site.startsWith("radial") ? "RADIAL_R" : site === "femoral-L" ? "FEM_L" : "FEM_R";
  const seg = g.byId[id];
  return { centre: samplePoint(g, id, seg ? seg.length * 0.55 : 0), spanMm: site.startsWith("radial") ? 200 : 230 };
}

export function camTarget(mode: CameraMode, st: Readonly<LabState>, g: VGraph, heartCentre: V3, site?: AccessSite): Cam {
  if (mode === "heart") return { centre: heartCentre, spanMm: HEART_SPAN_MM };
  if (mode === "follow" && !st.access) return startCam(g, site);
  if (mode === "follow") { const f = deviceFocus(st as LabState, g); return { centre: f.point, spanMm: Math.min(f.fovMm, MAX_FLUORO_SPAN_MM) }; }
  const b = overviewBox(g);
  return { centre: b.center, spanMm: b.spanMm * 1.12 };
}

/** One step of easing toward the target so a camera change glides instead of jumping. `k` is the fraction of the gap closed per call. */
export function easeCam(cur: Cam, to: Cam, k = 0.14): Cam {
  const m = (a: number, b: number) => a + (b - a) * k;
  return { centre: [m(cur.centre[0], to.centre[0]), m(cur.centre[1], to.centre[1]), m(cur.centre[2], to.centre[2])], spanMm: m(cur.spanMm, to.spanMm) };
}

// ---------------------------------------------------------------- peripheral views (run-off, aortogram, iliac, arm)
/**
 * Named peripheral views, each matched to a class of reference angiogram (docs/CATH_PERIPHERAL_SOURCES.md): an abdominal aortogram
 * with the bifurcation (Leriche-style DSA), the iliac and common femoral arteries, a bilateral run-off from the groin to the foot, and the
 * supra-aortic arch with the right arm. Each names the vessels it must hold, where the contrast goes in, and the C-arm angle.
 */
export type PeripheralView = "aortogram" | "iliac" | "runoff" | "arm";
export interface PeripheralSpec { label: string; vessels: RegExp; inject: { segId: string; at: number }; rot: number; tilt: number; reachMm: number; caption: string }
export const PERIPHERAL_VIEWS: Record<PeripheralView, PeripheralSpec> = {
  aortogram: { label: "Aortogram", vessels: /^(AORTA_ABD|RENAL_[RL]|ILIAC_[RL]|IIA_[RL])$/, inject: { segId: "AORTA_ABD", at: 0.75 }, rot: 0, tilt: 0, reachMm: 260,
    caption: "Abdominal aortogram: a pigtail injection above the renal arteries fills the aorta, the renals and the bifurcation." },
  iliac: { label: "Iliacs", vessels: /^(ILIAC_[RL]|IIA_[RL]|FEM_[RL]|PROFUNDA_[RL]|PFA_[RL])$/, inject: { segId: "AORTA_ABD", at: 0.1 }, rot: 0, tilt: 0, reachMm: 280,
    caption: "Iliac and femoral view: an injection at the bifurcation fills both iliac systems down to the common femoral arteries." },
  runoff: { label: "Run-off", vessels: /^(ILIAC_[RL]|FEM_[RL]|SFA_[RL]|POP_[RL]|ATA_[RL]|PTA_[RL]|PERONEAL_[RL]|DP_[RL]|PROFUNDA_[RL]|PFA_[RL])$/, inject: { segId: "AORTA_ABD", at: 0.1 }, rot: 0, tilt: 0, reachMm: 900,
    caption: "Bilateral run-off: a stepped bolus-chase composite from the groin to the feet, because no single field holds both legs." },
  arm: { label: "Arch and arm", vessels: /^(ARCH|INNOM|SUBCLAV_R|BRACH_R|RADIAL_R|ULNAR_R|CCA_[RL]|VERT_R)$/, inject: { segId: "ARCH", at: 0.6 }, rot: 0, tilt: 0, reachMm: 700,
    caption: "Arch and right arm: an arch injection fills the supra-aortic trunks and runs down the subclavian, brachial and radial arteries." },
};

/** Every drawable segment of the graph (route, side branches, run-off), with duplicate ids dropped (the first one wins). */
export function peripheralSegments(g: VGraph): VSeg[] {
  const seen = new Set<string>(), out: VSeg[] = [];
  for (const s of [...g.segs, ...(g.branches ?? []), ...(g.runoff ?? [])]) { if (seen.has(s.id)) continue; seen.add(s.id); out.push(s); }
  return out;
}

/** The camera for a peripheral view: centered on the vessels it names, wide enough (with a margin) to hold all of them in the AP projection. */
export function peripheralCam(view: PeripheralView, g: VGraph): Cam {
  const spec = PERIPHERAL_VIEWS[view];
  const segs = peripheralSegments(g).filter((s) => spec.vessels.test(s.id));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z = 0, n = 0;
  for (const s of segs) for (const p of s.samples) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); z += p[2]; n++; }
  if (!n) return { centre: [0, 0, 0], spanMm: HEART_SPAN_MM };
  return { centre: [(x0 + x1) / 2, (y0 + y1) / 2, z / n], spanMm: Math.max(x1 - x0, y1 - y0) * 1.12 + 20 };
}

/** Contrast for a peripheral view: the vessels to fill, where the dye goes in, and how far it travels. */
export function peripheralDye(view: PeripheralView, g: VGraph) {
  const spec = PERIPHERAL_VIEWS[view];
  const segs = peripheralSegments(g).filter((s) => spec.vessels.test(s.id) || /^(AORTA_ABD|ILIAC_[RL]|FEM_[RL]|ARCH|AORTA_THOR)$/.test(s.id));
  const src = g.byId[spec.inject.segId];
  const origin = samplePoint(g, spec.inject.segId, src ? src.length * spec.inject.at : 0);
  return {
    segs: segs.map((s) => ({ id: s.id, samples: s.samples, diameterMm: s.diameterMm, calcification: s.calcification, length: s.length })),
    origin, reachMm: spec.reachMm,
  };
}
