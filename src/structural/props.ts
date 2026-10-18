import { heartSdfMorph, HeartMorph, MorphPart, partsMorph, unrotateHeart } from "../anatomy/heartSurface";
import { V3 } from "../anatomy/curve";
import { StructuralReport, StructuralSpec, NodeName } from "../physics/structural";
import { ValveFinding } from "../sim/structural";

/**
 * What sits inside the heart for the cutaway: the septa (with a hole where a defect is), the four valves as annuli whose opening
 * follows each valve's area, and jets drawn where blood moves fast or the wrong way. Heart frame (x left, y toward the base,
 * z anterior), schematic and not to scale; DOM-free so the geometry can be tested. The heart's field is solid (no cavities), so
 * these are the only walls and leaflets there are.
 */
export interface Tri { positions: number[]; indices: number[] }
export interface Jet { from: V3; dir: V3; length: number; radius: number; node: NodeName | "DUCT"; label: string }
export interface Props { septum: Tri; atrialSeptum: Tri; valves: { name: "AV" | "MV" | "TV" | "PVL"; tri: Tri; center: V3; open: number }[]; jets: Jet[] }

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The heart frame's septal plane (src/anatomy/heartSurface.ts SEPT_N / SEPT_D), toward the left ventricle positive. */
const SEPT_N: V3 = [0.979, 0, -0.204], SEPT_D = 6.5, T_SEPT: V3 = [0.204, 0, 0.979];
const RA_C: V3 = [-27, 54, -6], LA_C: V3 = [5, 56, -21];
const kvOf = (m: HeartMorph) => (m.ventricleScale !== undefined && Number.isFinite(m.ventricleScale) && m.ventricleScale > 0.05 ? m.ventricleScale : 1);
/** Ventricle-anchored points scale about the base plane with the ventricles. */
const scaled = (p: V3, kv: number): V3 => [p[0] * kv, 54 + (p[1] - 54) * kv, p[2] * kv];

/** Radius at which a defect is drawn (mm): its true size would be a speck on the adult-sized heart, so it is enlarged. */
export const defectRadius = (diameterMm: number) => (diameterMm > 0 ? Math.min(18, 3 + 1.4 * diameterMm) : 0);

/** A flat grid of quads over a plane, kept where the field says the point is inside the heart and clear of an optional round hole. */
function planeGrid(origin: V3, u: V3, v: V3, u0: number, u1: number, v0: number, v1: number, step: number, keep: (p: V3) => boolean, hole?: { c: V3; r: number }): Tri {
  const positions: number[] = [], indices: number[] = [], ids = new Map<string, number>();
  const vert = (i: number, j: number) => {
    const k = `${i},${j}`;
    let id = ids.get(k);
    if (id === undefined) { const p = add(origin, add(mul(u, u0 + i * step), mul(v, v0 + j * step))); id = positions.length / 3; positions.push(p[0], p[1], p[2]); ids.set(k, id); }
    return id;
  };
  const nu = Math.ceil((u1 - u0) / step), nv = Math.ceil((v1 - v0) / step);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const c = add(origin, add(mul(u, u0 + (i + 0.5) * step), mul(v, v0 + (j + 0.5) * step)));
    if (!keep(c) || (hole && len(sub(c, hole.c)) < hole.r)) continue;
    const a = vert(i, j), b = vert(i + 1, j), d = vert(i, j + 1), e = vert(i + 1, j + 1);
    indices.push(a, b, e, a, e, d);
  }
  return { positions, indices };
}

/** An annulus (inner radius r0 to outer r1) in the plane through `c` with normal `n`. */
function annulus(c: V3, n: V3, r0: number, r1: number, segments = 40): Tri {
  const a = unit(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), b = cross(n, a), positions: number[] = [], indices: number[] = [];
  for (let k = 0; k < segments; k++) {
    const t = (k / segments) * Math.PI * 2, d = add(mul(a, Math.cos(t)), mul(b, Math.sin(t)));
    const inner = add(c, mul(d, r0)), outer = add(c, mul(d, r1));
    positions.push(inner[0], inner[1], inner[2], outer[0], outer[1], outer[2]);
  }
  for (let k = 0; k < segments; k++) { const i = 2 * k, j = 2 * ((k + 1) % segments); indices.push(i, i + 1, j + 1, i, j + 1, j); }
  return { positions, indices };
}

interface ValveSite { name: "AV" | "MV" | "TV" | "PVL"; center: V3; normal: V3; radius: number; forward: V3; back: V3 }
/** The pulmonary trunk's axis in the heart frame (start of the trunk to its bifurcation), from the same patient-frame path the mesh uses. */
const TRUNK_START: V3 = unrotateHeart([-23, 53, -6]), TRUNK_AXIS = unit(sub(unrotateHeart([-14, 56, -34]), TRUNK_START));
const LV_C: V3 = [20, -5, -5], RV_C: V3 = [-12, 8, 14];
const SITES: ValveSite[] = [
  // the aortic valve sits on the left-ventricular side of the septal plane (septal distance > 0), where the aorta really arises
  { name: "AV", center: [7, 47, 0], normal: [0, 1, 0], radius: 8, forward: [0, 1, 0], back: [0, -1, 0] },
  { name: "MV", center: [13, 52, -9], normal: unit([0.15, 1, -0.1]), radius: 13, forward: unit(sub(LV_C, [13, 52, -9])), back: unit(sub(LA_C, [13, 52, -9])) },
  { name: "TV", center: [-21, 52, 7], normal: unit([-0.1, 1, 0.1]), radius: 15, forward: unit(sub(RV_C, [-21, 52, 7])), back: unit(sub(RA_C, [-21, 52, 7])) },
  { name: "PVL", center: add(TRUNK_START, mul(TRUNK_AXIS, 8)), normal: TRUNK_AXIS, radius: 9, forward: TRUNK_AXIS, back: mul(TRUNK_AXIS, -1) },
];

/** Largest radius, up to `r`, at which a ring of this size around `c` stays inside the heart. */
function fitRadius(c: V3, n: V3, r: number, inside: (p: V3) => boolean): number {
  const a = unit(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), b = cross(n, a);
  for (let k = 0; k < 24 && r > 2; k++) {
    let ok = true;
    for (let i = 0; i < 24 && ok; i++) { const t = (i / 24) * Math.PI * 2; ok = inside(add(c, add(mul(a, Math.cos(t) * r), mul(b, Math.sin(t) * r)))); }
    if (ok) break;
    r *= 0.93;
  }
  return r;
}

/** Shorten a jet until its far end is inside the heart (with room for its own width). */
function trim(from: V3, dir: V3, length: number, radius: number, sdf: (p: V3) => number): number {
  let l = length;
  while (l > 6 && sdf(add(from, mul(dir, l))) > -radius) l -= 2;
  return l;
}

/** Fraction of its annulus each valve opens, from the graded valves: a normal valve is open (1), an atretic one shut (0). */
export function openFractions(valves: ValveFinding[]): Record<"AV" | "MV" | "TV" | "PVL", number> {
  const f = { AV: 1, MV: 1, TV: 1, PVL: 1 };
  for (const v of valves) f[v.valve as keyof typeof f] = v.stenosis === "atretic" ? 0 : v.areaFraction === null ? 1 : Math.min(1, Math.max(0.05, v.areaFraction / 0.72)); // a normal valve measures 0.8 to 0.95 of its nominal area, and counts as fully open
  return f;
}

export function buildProps(spec: StructuralSpec, report: StructuralReport, morph: HeartMorph, valves: ValveFinding[]): Props {
  const kv = kvOf(morph), sdf = (p: V3) => heartSdfMorph(p, morph), inside = (margin: number) => (p: V3) => sdf(p) < -margin;
  const vsdR = Math.max(defectRadius(spec.vsd?.diameterMm ?? 0), defectRadius(spec.tof?.vsdMm ?? 0)), asdD = spec.asd?.diameterMm ?? 0;

  // ventricular septum: the ventricles' own septal plane, mapped with the ventricles, kept where the ventricular field is inside and
  // the aorta, pulmonary artery and atria are not
  const mapV = (p: V3) => scaled(p, kv), p0 = mul(SEPT_N, SEPT_D), vsdAt = add(p0, add(mul([0, 1, 0], 38), mul(T_SEPT, 6)));
  const ventricular = (p: V3) => { const d = partsMorph(p, morph); return d[MorphPart.LV] < -1.2 && d[MorphPart.Aorta] > 2 && d[MorphPart.PA] > 2 && d[MorphPart.LA] > 2 && d[MorphPart.RA] > 2; };
  const septum = planeGrid(p0, [0, 1, 0], T_SEPT, -62, 54, -50, 50, 2.5, (p) => p[1] < 53 && ventricular(mapV(p)), vsdR > 0 ? { c: vsdAt, r: vsdR } : undefined);
  for (let i = 0; i < septum.positions.length; i += 3) { const q = mapV([septum.positions[i], septum.positions[i + 1], septum.positions[i + 2]]); septum.positions[i] = q[0]; septum.positions[i + 1] = q[1]; septum.positions[i + 2] = q[2]; }

  // atrial septum: the sheet between the two atria, where each one's own field meets the other's (so it follows their sizes), kept inside the atria only
  const ra = Number.isFinite(morph.raScale) ? morph.raScale! : 1, la = Number.isFinite(morph.laScale) ? morph.laScale! : 1;
  const axis = unit(sub(LA_C, RA_C)), t = (17 * ra) / (17 * ra + 20 * la), mid = add(RA_C, mul(sub(LA_C, RA_C), t)), ua = unit(cross(axis, [0, 1, 0])), va: V3 = [0, 1, 0];
  const atrialOnly = (p: V3) => { const d = partsMorph(p, morph); return Math.min(d[MorphPart.RA], d[MorphPart.LA]) < -1.2 && d[MorphPart.Aorta] > 2 && d[MorphPart.PA] > 2 && d[MorphPart.PV] > 2 && d[MorphPart.LV] > 1; };
  // the atria overlap only in a lens, so that is the septum; an ASD takes a share of it that grows with the defect (all of it at about 17 mm)
  const whole = planeGrid(mid, ua, va, -40, 40, -16, 18, 2.5, atrialOnly), lensR = Math.sqrt(((whole.indices.length / 6) * 2.5 * 2.5) / Math.PI);
  const atrial = asdD > 0 ? planeGrid(mid, ua, va, -40, 40, -16, 18, 2.5, atrialOnly, { c: mid, r: lensR * Math.min(1.3, 0.25 + asdD / 17) }) : whole;

  const open = openFractions(valves);
  const rings = SITES.map((s) => {
    const R = fitRadius(s.center, s.normal, s.radius, inside(0.6)), r0 = R * 0.78 * Math.sqrt(open[s.name]);
    // a frame, then the leaflets between it and the opening (the whole disc when the valve is atretic)
    const frame = annulus(s.center, s.normal, R * 0.78, R * 0.9), leaflets = open[s.name] >= 0.99 ? { positions: [], indices: [] } : annulus(s.center, s.normal, r0, R * 0.78);
    const positions = [...frame.positions, ...leaflets.positions], base = frame.positions.length / 3;
    const indices = [...frame.indices, ...leaflets.indices.map((i) => i + base)];
    return { name: s.name, tri: { positions, indices }, center: s.center, open: open[s.name] };
  });

  return { septum, atrialSeptum: atrial, valves: rings, jets: jetsFor(spec, report, valves, kv, vsdAt, mid, sdf) };
}

/** Jets: forward through a stenotic valve, backward through a leaking one, across each defect that shunts; each cut short where it would leave the heart. */
export function jetsFor(spec: StructuralSpec, r: StructuralReport, valves: ValveFinding[], kv: number, vsdAt: V3, asdAt: V3, sdf: (p: V3) => number): Jet[] {
  const jets: Jet[] = [], jetLen = (flow: number) => Math.min(50, 12 + 6 * Math.sqrt(Math.abs(flow))), jetR = (flow: number) => Math.min(6, 1.6 + 0.35 * Math.sqrt(Math.abs(flow)));
  const push = (from: V3, dir: V3, length: number, radius: number, node: Jet["node"], label: string) => {
    const l = trim(from, dir, length, radius, sdf);
    if (l > 6) jets.push({ from, dir, length: l, radius, node, label });
  };
  const UP: Record<string, NodeName> = { AV: "LV", MV: "LA", TV: "RA", PVL: "RV" }, DOWN: Record<string, NodeName> = { AV: "AO", MV: "LV", TV: "RV", PVL: "PA" };
  for (const s of SITES) {
    const v = valves.find((x) => x.valve === s.name); if (!v) continue;
    if ((v.stenosis === "moderate" || v.stenosis === "severe") && v.meanGradient > 4) push(s.center, s.forward, Math.min(45, 8 + v.meanGradient), Math.max(1.5, s.radius * 0.18), UP[s.name], `${v.label} stenosis jet`);
    if (v.regurgFraction !== null && v.regurgFraction >= 0.15) push(s.center, s.back, 10 + 40 * Math.min(1, v.regurgFraction), Math.max(1.5, s.radius * 0.14), DOWN[s.name], `${v.label} regurgitation jet`);
  }
  const sh = r.shunt;
  if (Math.abs(sh.vsd) > 0.2) push(scaled(vsdAt, kv), mul(SEPT_N, sh.vsd > 0 ? -1 : 1), jetLen(sh.vsd), jetR(sh.vsd), sh.vsd > 0 ? "LV" : "RV", "VSD jet");
  if (Math.abs(sh.asd) > 0.2) push(asdAt, mul(unit(sub(RA_C, LA_C)), sh.asd > 0 ? 1 : -1), jetLen(sh.asd), jetR(sh.asd), sh.asd > 0 ? "LA" : "RA", "ASD jet");
  if (sh.rvao > 0.2) push([-3, 47, 3], [0, 1, 0], jetLen(sh.rvao), jetR(sh.rvao), "RV", "Right ventricle to aorta");
  // the ductus and BT shunt run along their own paths, from the aortic end to the pulmonary end when the flow is aorta to PA
  const duct = [unrotateHeart([4, 58, -56]), unrotateHeart([-16, 56, -80])], bt = [unrotateHeart([-38, 70, -54]), unrotateHeart([-46, 52, -70])];
  if (Math.abs(sh.pda) > 0.2) { const [pa, ao] = duct, d = unit(sub(ao, pa)); push(sh.pda > 0 ? ao : pa, sh.pda > 0 ? mul(d, -1) : d, jetLen(sh.pda), jetR(sh.pda), "DUCT", "Ductal flow"); }
  if (Math.abs(sh.bt) > 0.2) push(bt[0], unit(sub(bt[1], bt[0])), jetLen(sh.bt), jetR(sh.bt), "AO", "BT shunt flow");
  return jets;
}
