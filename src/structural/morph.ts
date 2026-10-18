import { analyze, StructuralReport, StructuralSpec } from "../physics/structural";
import { HeartMorph } from "../anatomy/heartSurface";
import { NodeName } from "../physics/structural";

/**
 * From a lesion and what the engine solved for it to the shape of the heart: chamber sizes from the solved volumes (linear scale
 * = volume^(1/3)), vessel sizes from the flow they carry, defects as tubes. Schematic: the heart is the same procedural one the
 * simulator draws, reshaped to illustrate the lesion, not to measure it. DOM-free so it can be tested.
 */
const cube = (r: number) => Math.cbrt(Math.max(r, 1e-6));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const normals = new Map<string, StructuralReport>();
const normalOf = (patient: "adult" | "neonate") => { let r = normals.get(patient); if (!r) { r = analyze({ patient }, { waveform: false }); normals.set(patient, r); } return r; };

/** Drawing size of a duct or shunt: its true radius is a millimetre or two, which would vanish at the heart's drawn scale, so it is exaggerated. */
export const tubeRadius = (diameterMm: number) => (diameterMm > 0 ? 1.8 + 0.9 * diameterMm : 0);

/** A finite number, or `fallback`: a NaN from a degenerate report must not empty the heart. */
const fin = (x: number, fallback = 1) => (Number.isFinite(x) ? x : fallback);

/** What the 3D view colours each structure by: a node's saturation, and for the ductus the blood that actually flows through it. */
export function satMap(r: StructuralReport): Partial<Record<NodeName | "DUCT", number>> {
  return { ...r.saturation, DUCT: r.shunt.pda >= 0 ? r.saturation.AO : r.saturation.PA };
}

export function morphFor(spec: StructuralSpec, r: StructuralReport): HeartMorph {
  const n = normalOf(spec.patient ?? "adult"), v = r.maxVolume, nv = n.maxVolume;
  const rvRel = fin(v.RV / nv.RV);
  const atretic = spec.valves?.pv?.open === 0 || spec.tof?.rvotFrac === 0;
  const qpRel = fin(r.qp / Math.max(n.qp, 1e-6)), pressureRel = fin(r.pressure.PA.mean / Math.max(n.pressure.PA.mean, 1e-6));
  // wider with more flow and with pulmonary hypertension; a thin cord when the valve is atretic
  const pa = atretic ? 0.45 : spec.tof && spec.tof.rvotFrac < 0.3 ? 0.7 : clamp(cube(qpRel) * Math.pow(pressureRel, 0.15), 0.75, 1.5);
  const av = r.valves.AV, regFraction = av && av.forwardMl > 1e-6 ? av.regurgMl / av.forwardMl : 0;
  const aorta = 1 + 0.15 * (spec.tof ? 1 : 0) + 0.3 * Math.min(1, regFraction); // an overriding aorta is large; a leaking valve dilates the root
  return {
    ventricleScale: clamp(cube(fin(v.LV + v.RV, 1) / (nv.LV + nv.RV)), 0.7, 1.6),
    rvBulge: clamp(Math.sqrt(rvRel), 0.3, 1.6),
    raScale: clamp(cube(fin(v.RA / nv.RA)), 0.8, 1.6),
    laScale: clamp(cube(fin(v.LA / nv.LA)), 0.8, 2),
    aortaScale: clamp(aorta, 1, 1.4),
    greatVessels: true, paScale: pa, pvScale: 1, cavaScale: 1,
    ductRadius: tubeRadius(spec.pda?.diameterMm ?? 0), btRadius: tubeRadius(spec.bt?.diameterMm ?? 0),
  };
}

/** Round a morph to steps small enough to be invisible, so sliding back and forth finds meshes already built. */
export function quantize(m: HeartMorph): HeartMorph {
  const q = (x: number | undefined, step: number) => (x === undefined ? undefined : Math.round(x / step) * step);
  return { ...m, ventricleScale: q(m.ventricleScale, 0.02), rvBulge: q(m.rvBulge, 0.05), raScale: q(m.raScale, 0.04), laScale: q(m.laScale, 0.04), aortaScale: q(m.aortaScale, 0.04), paScale: q(m.paScale, 0.05), ductRadius: q(m.ductRadius, 0.25), btRadius: q(m.btRadius, 0.25) };
}
