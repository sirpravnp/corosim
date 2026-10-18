/**
 * What the mesh does not hold. The mesh stops at short stubs of the aorta and pulmonary artery and has no great veins, pulmonary veins,
 * appendage, arch or descending aorta, so those are tubes built from the landmarks in heart.json. SCHEMATIC: their course and calibre
 * are plausible, not anatomical, and need an anatomist's look before teaching use. The papillary muscles are placeholders too (no chordae).
 */
import { ID, isSegment } from "./ids";
import { D2R, add, dot, len, mid, nrm, sub } from "./vec";
import type { Heart, Vec3 } from "./volume";

export interface Cap { id: number; p: Vec3; d: Vec3; L: number; r: number; w: number; c: Vec3; br: number }
export interface Papillary { id: number; psi: number; r: number; z: number }
export interface Descending { D0: Vec3; Dtop: Vec3; u: Vec3; M: Vec3; Hv: Vec3; hh: number; E1: Vec3 }
export interface Procedural { caps: Cap[]; arch: Vec3[]; desc: Descending; papillary: Papillary[]; aoAxis: Vec3 }

export function buildProcedural(h: Heart): Procedural {
  const { meta } = h, T = meta.tubes, O = meta.ostia, u = nrm(T.ao.u);
  const caps: Cap[] = [];
  const cap = (id: number, p: Vec3, d: Vec3, L: number, r: number, w: number) => caps.push({ id, p, d, L, r, w, c: add(p, d, L / 2), br: L / 2 + r + w + 0.2 });
  const tubes: [keyof typeof O, number, number, number][] = [
    ["SVC", ID.SVC, 6.5, 0.95], ["IVC", ID.IVC, 4.5, 0.95], ["LUPV", ID.LUPV, 2.8, 0.95], ["LLPV", ID.LLPV, 2.8, 0.95],
    ["RUPV", ID.RUPV, 2.8, 0.95], ["RLPV", ID.RLPV, 2.8, 0.95], ["LAA", ID.LAA, 2.6, 0.85],
  ];
  for (const [nm, id, L, f] of tubes) { const o = O[nm]; cap(id, add(o.c, o.n, -0.5), nrm(o.n), L, o.r * f, 0.22); }
  const ep = T.ao.end;
  cap(ID.ASCAO, add(ep, u, -0.3), u, 3.3, T.ao.r, 0.25);
  cap(ID.PA, add(T.pa.end, nrm(T.pa.u), -0.3), nrm(T.pa.u), 3.6, T.pa.r, 0.22);
  // arch: a planar semi-ellipse from the end of the ascending aorta to the top of the descending aorta, which runs behind the left atrium
  const E1 = add(ep, u, 3.0), LAc = meta.centroids.LA;
  let laYmin = 9;
  for (let i = 0; i < h.nx; i += 2) for (let j = 0; j < h.ny; j += 2) for (let k = 0; k < h.nz; k += 3) {
    if (h.label[(i * h.ny + j) * h.nz + k] === ID.LA) { const y = (j + h.lo[1]) / 10; if (y < laYmin) laYmin = y; }
  }
  const D0: Vec3 = [3.7, laYmin - 2.6, LAc[2]];
  const Dtop = add(D0, u, dot(sub(E1, D0), u)), M = mid(E1, Dtop), Hv = sub(Dtop, E1);
  const H = len(Hv) / 2, hh = Math.min(3.4, Math.max(2.2, H * 0.9));
  const arch: Vec3[] = [];
  for (let i = 0; i <= 20; i++) { const f = (i / 20) * Math.PI; arch.push(add(add(M, Hv, -Math.cos(f) / 2), u, Math.sin(f) * hh)); }
  caps.push({ id: ID.DAO, p: add(Dtop, u, -24), d: u, L: 24, r: 1.25, w: 0.25, c: add(Dtop, u, -12), br: 12 + 1.8 });
  // papillary muscles: on the endocardium at mid-level in the anterolateral and posteromedial positions
  const papillary: Papillary[] = [];
  for (const [id, uu, zf] of [[ID.PMAL, 150, 0.5], [ID.PMPM, -65, 0.52]] as const) {
    const z = -h.lvLength * (1 - zf); // zf: how far from the apex (0) to the base (1)
    let best = 0, bd = 1e9;
    for (let b = 0; b < 72; b++) { const d = Math.abs(((meta.u_table[b] - uu + 540) % 360) - 180); if (d < bd) { bd = d; best = b; } }
    const psi = (best * 5 + 2.5) * D2R;
    let rEnd = 2;
    for (let r = 0.2; r < 5; r += 0.05) { const ix = h.index(Math.cos(psi) * r, Math.sin(psi) * r, z); if (ix >= 0 && isSegment(h.label[ix])) { rEnd = r; break; } }
    papillary.push({ id, psi, r: rEnd * 0.78, z });
  }
  return { caps, arch, desc: { D0, Dtop, u, M, Hv, hh, E1 }, papillary, aoAxis: u };
}

/** The procedural vessel (if any) at a point in cm: its id, and whether the point is in the lumen or the wall. */
export function capHit(p: Procedural, x: number, y: number, z: number): [id: number, lumen: boolean] | null {
  const caps = p.caps;
  for (let q = 0; q < caps.length; q++) {
    const c = caps[q], cx = x - c.c[0], cy = y - c.c[1], cz = z - c.c[2];
    if (cx * cx + cy * cy + cz * cz > c.br * c.br) continue;
    const vx = x - c.p[0], vy = y - c.p[1], vz = z - c.p[2];
    let t = vx * c.d[0] + vy * c.d[1] + vz * c.d[2];
    t = t < 0 ? 0 : t > c.L ? c.L : t;
    const d = Math.hypot(vx - t * c.d[0], vy - t * c.d[1], vz - t * c.d[2]);
    if (d < c.r) return [c.id, true];
    if (d < c.r + c.w) return [ID.VW, false];
  }
  const ap = p.arch;
  if (z > 2) {
    for (let i = 0; i < ap.length - 1; i++) {
      const a = ap[i], b = ap[i + 1], ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], L2 = ex * ex + ey * ey + ez * ez;
      let t = ((x - a[0]) * ex + (y - a[1]) * ey + (z - a[2]) * ez) / L2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - a[0] - t * ex, y - a[1] - t * ey, z - a[2] - t * ez);
      if (d < 1.35) return [ID.ARCH, true];
      if (d < 1.6) return [ID.VW, false];
    }
  }
  return null;
}
