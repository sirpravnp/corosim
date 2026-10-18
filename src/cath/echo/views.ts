/**
 * The 23 standard transesophageal views, as probe poses built from the landmarks in heart.json.
 *
 * A pose is: the probe tip P, the beam direction b, the in-plane axis h that points image-right at omniplane 0°, and the axis s the imaging
 * plane turns toward as the omniplane angle grows. Angles are the model's own, not a probe readout.
 *
 * NOT YET CLINICALLY REVIEWED. Image-left/right and the omniplane direction follow the ASE/SCA guideline conventions as recalled; a
 * cardiologist should check each view (docs/CATH_LAB_INTEGRATION.md, phase 6). The probe positions inside the oesophagus are idealised.
 */
import { ID } from "./ids";
import { D2R, add, cross, dot, mid, nrm, reject, sub } from "./vec";
import type { Heart, Vec3 } from "./volume";

export type ViewGroup = "ME" | "TG" | "DTG" | "AO" | "UE";

export interface View {
  /** Stable key. */
  id: string;
  name: string;
  group: ViewGroup;
  P: Vec3; b: Vec3; h: Vec3; s: Vec3;
  /** Default omniplane angle, degrees. */
  ang: number;
  /** Depth shown, cm. */
  depth: number;
  /** What the view is for. */
  purpose: string;
  /** Region ids the view must show (tests, and the teaching list). */
  expects: number[];
}

/** The plane for an omniplane angle: unit beam b and in-plane image-right axis hh. */
export function planeBasis(v: Pick<View, "b" | "h" | "s" | "ang">, ang?: number): { b: Vec3; hh: Vec3 } {
  const a = (ang ?? v.ang) * D2R, b = nrm(v.b), h = nrm(reject(v.h, b)), s = nrm(reject(v.s, b));
  const c = Math.cos(a), sn = Math.sin(a);
  return { b, hh: [c * h[0] + sn * s[0], c * h[1] + sn * s[1], c * h[2] + sn * s[2]] };
}

const Z: Vec3 = [0, 0, 1], X: Vec3 = [1, 0, 0], Y: Vec3 = [0, 1, 0];

/** Build all 23 views for a heart. Order is the order of the ASE exam, upper oesophageal views last. */
export function buildViews(heart: Heart): View[] {
  const { meta, procedural: pr } = heart, V = meta.valves, O = meta.ostia, T = meta.tubes, C = meta.centroids, u = pr.aoAxis, Dd = pr.desc, UT = meta.u_table;
  const out: View[] = [];
  const planeCost = (P: Vec3, b: Vec3, v: Vec3, pts: Vec3[]) => { const n = cross(b, v); return pts.reduce((s, q) => s + Math.abs(dot(sub(q, P), n)), 0); };
  /** Omniplane angle whose plane passes closest to the given points. */
  const fit = (P: Vec3, b: Vec3, h0: Vec3, s0: Vec3, pts: Vec3[], lo = 0, hi = 180) => {
    let best = lo, bc = 1e9;
    const { b: bb } = planeBasis({ b, h: h0, s: s0, ang: 0 }, 0);
    for (let a = lo; a <= hi; a++) { const { hh } = planeBasis({ b, h: h0, s: s0, ang: a }); const c = planeCost(P, bb, hh, pts); if (c < bc) { bc = c; best = a; } }
    return best;
  };
  const push = (id: string, name: string, group: ViewGroup, pose: Omit<View, "id" | "name" | "group" | "purpose" | "expects">, purpose: string, expects: number[]) => out.push({ id, name, group, ...pose, purpose, expects });

  // Mid-oesophageal: probe on the LV long axis above the heart. The four-chamber plane holds the axis and the tricuspid centre; the tricuspid side is image-left.
  const tv = V.TV.c, h4 = nrm([-tv[0], -tv[1], 0]), s4raw = nrm(cross(Z, h4)), sgn = dot(s4raw, Y) >= 0 ? 1 : -1;
  const s4: Vec3 = [s4raw[0] * sgn, s4raw[1] * sgn, s4raw[2] * sgn];
  const me = (off: number, ang: number, depth = 16.8) => ({ P: add([0, 0, 6.9], s4, off), b: [0, 0, -1] as Vec3, h: h4, s: s4, ang, depth });
  const ca = V.AV.c, laxA = Math.round(((Math.atan2(dot(ca, s4), dot(ca, h4)) / D2R) + 360) % 180);
  push("me-4ch", "ME four-chamber (0°)", "ME", me(0, 0), "Chamber sizes, septa, both AV valves, basal and mid inferoseptal and anterolateral walls", [ID.LV, ID.RV, ID.LA, ID.RA, ID.MV, ID.TV, ID.IAS]);
  push("me-5ch", "ME five-chamber", "ME", me(1.6, 0), "LVOT and aortic valve with the four chambers; anteroseptal and inferolateral walls", [ID.LV, ID.RV, ID.LA, ID.RA, ID.MV, ID.TV, ID.AV]);
  push("me-mc", "ME mitral commissural (60°)", "ME", me(0, 60), "Mitral commissures (P3, A2, P1); anterior and inferior walls", [ID.LV, ID.LA, ID.MV]);
  push("me-2ch", "ME two-chamber (90°)", "ME", me(0, 90), "LV and LA only; anterior and inferior walls, the appendage", [ID.LV, ID.LA, ID.MV]);
  push("me-lax", `ME long-axis (${laxA}°)`, "ME", me(0, laxA), "LVOT, aortic valve and root; anteroseptal and inferolateral walls", [ID.LV, ID.LA, ID.MV, ID.AV, ID.AOROOT]);

  // Axial poses: a plane perpendicular to a vessel axis (angle 0) that turns into a long-axis plane at 90°.
  const axial = (pt: Vec3, ax: Vec3, bpref: Vec3, leftRef: Vec3 | null, depth: number, ang = 0, D = 7) => {
    const b = nrm(reject(bpref, ax));
    let h = nrm(cross(ax, b));
    if (leftRef && dot(sub(leftRef, pt), h) > 0) h = [-h[0], -h[1], -h[2]];
    return { P: add(pt, b, -D), b, h, s: ax, ang, depth };
  };
  const avN = nrm(V.AV.n);
  push("me-av-sax", "ME aortic valve short-axis", "ME", axial(V.AV.c, avN, Y, C.RA, 11), "Trileaflet valve, coronary ostia, interatrial septum", [ID.AV, ID.LA, ID.RA]);
  push("me-av-lax", "ME aortic valve long-axis", "ME", axial(V.AV.c, avN, Y, C.RA, 11, 100), "Aortic root, sinuses, LVOT, ascending aorta", [ID.AV, ID.AOROOT, ID.LA]);
  const asc = add(T.ao.end, u, 1.2);
  push("me-asc-sax", "ME ascending aortic short-axis", "ME", axial(asc, u, Y, C.RA, 12), "Ascending aorta in cross-section with the PA and SVC", [ID.ASCAO]);
  push("me-asc-lax", "ME ascending aortic long-axis", "ME", axial(asc, u, Y, C.RA, 12, 90), "Ascending aorta along its length", [ID.ASCAO]);
  { const a = axial(V.AV.c, avN, Y, C.RA, 12), ang = fit(a.P, a.b, a.h, a.s, [V.TV.c, V.PV.c]); push("me-rv-io", "ME RV inflow-outflow", "ME", { ...a, ang }, "Tricuspid and pulmonic valves, RVOT, RA", [ID.TV, ID.PV, ID.RA, ID.RV]); }
  { const m = mid(O.SVC.c, O.IVC.c), a = axial(m, avN, Y, null, 12), ang = fit(a.P, a.b, a.h, a.s, [O.SVC.c, O.IVC.c]); push("me-bicaval", "ME bicaval", "ME", { ...a, ang }, "SVC and IVC entering the RA, the interatrial septum", [ID.RA, ID.SVC, ID.IVC]); }
  { const m = mid(O.LAA.c, O.LUPV.c), a = axial(m, avN, Y, C.RA, 11), ang = fit(a.P, a.b, a.h, a.s, [O.LAA.c, O.LUPV.c]); push("me-laa", "ME LAA / left upper PV", "ME", { ...a, ang }, "Left atrial appendage (thrombus look-out) and the left upper pulmonary vein", [ID.LA, ID.LAA, ID.LUPV]); }

  // Transgastric: probe beyond the inferior wall, looking along the LV short axis.
  const nearest = (deg: number) => { let best = 0, bd = 1e9; for (let b = 0; b < 72; b++) { const d = Math.abs(((UT[b] + deg + 540) % 360) - 180); if (d < bd) { bd = d; best = b; } } return (best * 5 + 2.5) * D2R; };
  const psiI = nearest(90), psiS = nearest(0);
  const dI: Vec3 = [Math.cos(psiI), Math.sin(psiI), 0], bT: Vec3 = [-dI[0], -dI[1], 0], dS: Vec3 = [Math.cos(psiS), Math.sin(psiS), 0];
  let hT = nrm(cross(Z, bT)); if (dot(hT, dS) > 0) hT = [-hT[0], -hT[1], -hT[2]]; // septum on the image-left
  const L = heart.lvLength;
  const tg = (zl: number, ang: number, depth = 13) => ({ P: add([0, 0, zl], dI, 10), b: bT, h: hT, s: Z, ang, depth });
  push("tg-basal", "TG basal short-axis", "TG", tg(-0.9, 0), "Mitral valve from the LV side (fish-mouth); the six basal segments", [ID.LV, ID.MV]);
  push("tg-mid", "TG mid short-axis", "TG", tg(-L * 0.5, 0), "The standard LV short-axis ring: all three territories, papillary muscles, EF and wall motion", [ID.LV]);
  push("tg-apical", "TG apical short-axis", "TG", tg(-L * 0.78, 0), "Apical segments", [ID.LV]);
  push("tg-2ch", "TG two-chamber", "TG", tg(-L * 0.5, 90, 16), "Anterior and inferior walls and the mitral apparatus", [ID.LV, ID.LA, ID.MV]);
  { const a = tg(-L * 0.5, 0, 16), ang = fit(a.P, a.b, a.h, a.s, [V.AV.c], 90, 170); push("tg-lax", "TG long-axis", "TG", { ...a, ang }, "LVOT and aortic valve aligned with Doppler (not modelled)", [ID.LV, ID.AV]); }
  { // RV apex: the lowest part of the RV cavity
    let zmin = 9;
    for (let i = 0; i < heart.nx; i += 2) for (let j = 0; j < heart.ny; j += 2) for (let k = 0; k < heart.nz; k += 2) if (heart.label[(i * heart.ny + j) * heart.nz + k] === ID.RV) { const zz = (k + heart.lo[2]) / 10; if (zz < zmin) zmin = zz; }
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < heart.nx; i += 2) for (let j = 0; j < heart.ny; j += 2) for (let k = 0; k < heart.nz; k += 2) if (heart.label[(i * heart.ny + j) * heart.nz + k] === ID.RV && (k + heart.lo[2]) / 10 < zmin + 0.8) { sx += (i + heart.lo[0]) / 10; sy += (j + heart.lo[1]) / 10; n++; }
    const rva: Vec3 = [sx / n, sy / n, zmin + 0.4], a = tg(-2.5, 0, 14), P = add(rva, dI, 10), ang = fit(P, bT, hT, Z, [V.TV.c, rva], 0, 180);
    push("tg-rv-inflow", "TG RV inflow", "TG", { ...a, P, ang }, "RV inflow: tricuspid valve, chordae, RV free wall", [ID.RV, ID.TV]);
  }
  { const apex: Vec3 = [0, 0, -L + 0.3], bd = nrm(sub(ca, apex)), P = add(apex, bd, -3.0); push("dtg-lax", "Deep TG long-axis", "DTG", { P, b: bd, h: X, s: Y, ang: 0, depth: 17 }, "LVOT and aortic valve along the beam: the angle for continuous-wave Doppler (not modelled)", [ID.LV, ID.AV, ID.AOROOT]); }

  // Thoracic aorta
  { const a = axial(Dd.D0, Dd.u, Y, null, 8, 0, 4.5); push("dao-sax", "Descending aorta short-axis", "AO", a, "Descending aorta in cross-section (atheroma, dissection flap)", [ID.DAO]); push("dao-lax", "Descending aorta long-axis", "AO", { ...a, ang: 90 }, "Descending aorta along its length", [ID.DAO]); }
  { const H = nrm(Dd.Hv), nA = nrm(cross(Dd.u, H)), Pa = add(Dd.M, H, -(Math.hypot(...Dd.Hv) / 2 + 4)), Tgt = add(Dd.M, Dd.u, Dd.hh * 0.5), b = nrm(sub(Tgt, Pa));
    const pose = { P: Pa, b, h: nrm(cross(nA, b)), s: nA, ang: 0, depth: 13 };
    push("ue-arch-lax", "UE aortic arch long-axis", "UE", pose, "The aortic arch along its length", [ID.ARCH]);
    push("ue-arch-sax", "UE aortic arch short-axis", "UE", { ...pose, ang: 90 }, "The arch in cross-section with the pulmonary artery", [ID.ARCH]); }
  return out;
}

export const VIEW_COUNT = 23;
