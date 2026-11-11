import { V3 } from "../anatomy/curve";
import { MorphPart, Part } from "../anatomy/heartSurface";
import { ctHeart, _iasCenter } from "./ctEcho";
import { FlowWave, waveIndex } from "./beat";

/**
 * Blood velocity in the CT heart, for color and spectral Doppler. The engine supplies, at every moment of the beat, the flow through
 * each valve and shunt and the pressures on either side; this file turns them into jets, the way the physics does:
 *
 * - Across a narrowed orifice (a stenotic valve, a regurgitant leak, a septal defect) the speed comes from the pressure drop across it
 *   (simplified Bernoulli: v = sqrt(dP / 4), v in m/s, dP in mmHg), as an echo reads it back. Across a normal open valve the drop is
 *   mostly the pressure that accelerates the blood, which Bernoulli would wrongly turn into speed, so there the speed is the flow over
 *   the valve's open area.
 * - The jet's width at the orifice follows from continuity (area = flow / speed). Downstream it spreads (a turbulent jet widens by about
 *   0.11 mm per mm) and its core slows (in proportion to its width once past about five orifice radii).
 * - Upstream, blood converges on the orifice, its speed rising as Q / (2 pi r^2) toward it: the proximal isovelocity surface (PISA) of a
 *   regurgitant valve, and flow acceleration in the LV outflow tract.
 * Each contribution lives only in its own chamber: a mitral inflow jet only in the LV, a mitral regurgitant jet only in the LA.
 * All in the CT frame, mm; velocities in m/s.
 */

interface Valve { key: "MV" | "AV" | "TV" | "PV"; c: V3; n: V3; from: number; to: number; pFrom: keyof FlowWave["p"]; pTo: keyof FlowWave["p"]; areaCm2: number }
let VALVES: Valve[] | null = null;
let ASD: { c: V3; n: V3 } | null = null;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Normal open areas, cm^2 (adult; the engine's own: aortic 3.8, mitral 5, tricuspid 7), pulmonary taken as 3.5. */
const OPEN_AREA = { MV: 5.0, AV: 3.8, TV: 7.0, PV: 3.5 };

function valves(): Valve[] {
  const h = ctHeart();
  if (!h) throw new Error("flow: the CT heart is not installed");
  if (VALVES) return VALVES;
  const V = h.meta.valves, cm = (v: V3): V3 => [v[0] * 10, v[1] * 10, v[2] * 10];
  VALVES = [
    { key: "MV", c: cm(V.MV.c), n: unit(V.MV.n), from: Part.LA, to: Part.LV, pFrom: "LA", pTo: "LV", areaCm2: OPEN_AREA.MV },
    { key: "AV", c: cm(V.AV.c), n: unit(V.AV.n), from: Part.LV, to: Part.Aorta, pFrom: "LV", pTo: "AO", areaCm2: OPEN_AREA.AV },
    { key: "TV", c: cm(V.TV.c), n: unit(V.TV.n), from: Part.RA, to: Part.RV, pFrom: "RA", pTo: "RV", areaCm2: OPEN_AREA.TV },
    { key: "PV", c: cm(V.PV.c), n: unit(V.PV.n), from: Part.RV, to: MorphPart.PA, pFrom: "RV", pTo: "PA", areaCm2: OPEN_AREA.PV },
  ];
  const c = h.meta.centroids;
  ASD = { c: _iasCenter, n: unit([(c.RA[0] - c.LA[0]) * 10, (c.RA[1] - c.LA[1]) * 10, (c.RA[2] - c.LA[2]) * 10]) };
  return VALVES;
}

/** One jet at one moment: orifice, direction downstream, speed at the orifice (m/s), orifice radius (mm), flow (ml/s), chambers. */
export interface Jet {
  c: V3; n: V3; v0: number; r0: number; q: number; into: number; outOf: number; key: string;
  /** For forward flow out of a ventricle through a semilunar valve: the outflow tract's radius (mm), where flow arrives as a plug. */
  tractR?: number;
}
/** LV and RV outflow tract radii, mm (a 2.2 cm LVOT; a 2.4 cm RVOT). */
const TRACT_R = { AV: 11, PV: 12 };

const bern = (dp: number) => Math.sqrt(Math.max(0, dp) / 4);

/**
 * The jets at time `t` (seconds into the beat). A valve with forward flow makes a jet into its downstream chamber; with backward flow,
 * a regurgitant jet the other way. `asdOpen` adds the atrial shunt when the case has a defect.
 */
export interface JetOptions {
  /** The case's atrial septal defect is open. */
  asdOpen?: boolean;
  /** Valves that are stenotic (their forward speed is the Bernoulli one). */
  stenotic?: Partial<Record<"MV" | "AV" | "TV" | "PV", boolean>>;
}
export function jetsAt(w: FlowWave, t: number, opt: JetOptions = {}): Jet[] {
  const asdOpen = opt.asdOpen ?? false;
  const vs = valves(), { i, j, k } = waveIndex(w, t), at = (a: Float32Array) => a[i] + (a[j] - a[i]) * k;
  const out: Jet[] = [];
  for (const v of vs) {
    const q = at(w.q[v.key]);
    if (Math.abs(q) < 2) continue;
    const fwd = q > 0, dp = fwd ? at(w.p[v.pFrom]) - at(w.p[v.pTo]) : at(w.p[v.pTo]) - at(w.p[v.pFrom]);
    const open = Math.abs(q) / v.areaCm2 / 100;
    const v0 = fwd ? (opt.stenotic?.[v.key] ? Math.max(bern(dp), open) : open) : Math.max(bern(dp), 0.5);
    const areaCm2 = Math.abs(q) / (v0 * 100), r0 = Math.sqrt(areaCm2 / Math.PI) * 10;
    const tractR = fwd && (v.key === "AV" || v.key === "PV") ? TRACT_R[v.key] : undefined;
    out.push({ c: v.c, n: fwd ? v.n : [-v.n[0], -v.n[1], -v.n[2]], v0, r0, q: Math.abs(q), into: fwd ? v.to : v.from, outOf: fwd ? v.from : v.to, key: v.key + (fwd ? "" : "-regurgitant"), tractR });
  }
  if (asdOpen && ASD) {
    const q = at(w.q.ASD);
    if (Math.abs(q) > 2) {
      const dp = Math.abs(at(w.p.LA) - at(w.p.RA)), v0 = Math.max(bern(dp), Math.abs(q) / 1.5 / 100), r0 = Math.sqrt(Math.abs(q) / (v0 * 100) / Math.PI) * 10;
      const n: V3 = q > 0 ? ASD.n : [-ASD.n[0], -ASD.n[1], -ASD.n[2]];
      out.push({ c: ASD.c, n, v0, r0, q: Math.abs(q), into: q > 0 ? Part.RA : Part.LA, outOf: q > 0 ? Part.LA : Part.RA, key: "ASD" });
    }
  }
  return out;
}

/**
 * Turbulent spread of a jet, mm of radius per mm downstream. A fast jet (a regurgitant leak, a stenosis: over about 1.5 m/s) follows the
 * free round-jet law, its centreline speed v0 * 6 d0 / x (six orifice diameters, 12 radii), so it reaches deep into the chamber it enters;
 * a slow one (normal inflow, an atrial shunt) spreads along the walls and loses its momentum within a few centimetres.
 */
const SPREAD = 0.11, FAST = 1.5, CORE_FAST = 12, CORE_SLOW = 3, FADE_MM = 45;
/** How far upstream the converging flow is followed, mm. */
const CONVERGE_MM = 40;

/** Velocity (m/s, CT frame) of blood at point `p` in chamber `part`, from `jets`; `turbulence` gets 0..1 (disturbed flow). */
export function velocityAt(p: V3, part: number, jets: Jet[], out: V3, turb: { value: number }): V3 {
  out[0] = out[1] = out[2] = 0; turb.value = 0;
  for (const J of jets) {
    const dx = p[0] - J.c[0], dy = p[1] - J.c[1], dz = p[2] - J.c[2];
    const x = dx * J.n[0] + dy * J.n[1] + dz * J.n[2];
    if (part === J.into && x > -1) {
      // downstream: a jet along n, widening, its core slowing past the potential core
      const px = dx - x * J.n[0], py = dy - x * J.n[1], pz = dz - x * J.n[2], rho = Math.hypot(px, py, pz);
      const fast = J.v0 > FAST, L0 = (fast ? CORE_FAST : CORE_SLOW) * J.r0;
      const R = J.r0 + SPREAD * Math.max(0, x), core = J.v0 * Math.min(1, L0 / Math.max(L0, x)) * (fast ? 1 : Math.exp(-Math.max(0, x) / FADE_MM));
      const prof = Math.exp(-2 * (rho / R) ** 2);
      if (prof < 0.01) continue;
      const v = core * prof;
      out[0] += v * J.n[0]; out[1] += v * J.n[1]; out[2] += v * J.n[2];
      // a jet faster than about 1.5 m/s is turbulent, most of all where it mixes at its edge
      if (fast) turb.value = Math.max(turb.value, Math.min(1, (J.v0 - FAST) / 2) * prof * (0.6 + 0.4 * Math.min(1, x / L0)));
    } else if (part === J.outOf && x < 1 && J.tractR !== undefined && x > -30) {
      // ventricular outflow: a plug through the outflow tract, at flow over the tract's area, narrowing into the valve's own speed
      const px = dx - x * J.n[0], py = dy - x * J.n[1], pz = dz - x * J.n[2], rho = Math.hypot(px, py, pz);
      if (rho > J.tractR * 1.4) continue;
      // close to the valve the flow converges on its orifice at Q / (2 pi r^2), faster than the plug only within about tractR / sqrt(2)
      // of it (about 8 mm), whatever the orifice's size: a pulsed-wave gate 5 to 10 mm below the valve reads the plug, as on a real scan
      const plug = J.q / (Math.PI * (J.tractR / 10) ** 2) / 100, rcm = Math.max(J.r0, -x) / 10;
      const v = Math.max(plug, Math.min(J.v0, J.q / (2 * Math.PI * rcm * rcm) / 100)) * Math.exp(-((rho / J.tractR) ** 6)) * Math.min(1, (30 + x) / 6);
      out[0] += v * J.n[0]; out[1] += v * J.n[1]; out[2] += v * J.n[2];
    } else if (part === J.outOf && x < 1) {
      // upstream: flow converging on the orifice, speed Q / (2 pi r^2) on a hemisphere, capped at the orifice speed
      const d = Math.hypot(dx, dy, dz);
      if (d > CONVERGE_MM || d < 1e-3) continue;
      const dcm = Math.max(J.r0, d) / 10, v = Math.min(J.v0, J.q / (2 * Math.PI * dcm * dcm) / 100);
      out[0] -= (v * dx) / d; out[1] -= (v * dy) / d; out[2] -= (v * dz) / d;
    }
  }
  return out;
}

/** Mitral annulus velocity along the LV long axis (m/s; positive toward the apex, as in systole), from the LV's shortening rate. */
export function annulusVelocity(w: FlowWave, t: number, lvLengthMm: number): number {
  const { i, j, k } = waveIndex(w, t), prev = (i - 1 + w.n) % w.n, next = j;
  const dLong = (w.long[next] - w.long[prev]) / (2 * w.dt);
  void k;
  return (dLong * lvLengthMm) / 1000;
}
