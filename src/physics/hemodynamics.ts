import { BLOOD, CORONARY, STENOSIS } from "../config/anatomy";
import { LumenProfile, area, integrate } from "./geometry";

export interface Patient {
  meanAorticPressure: number;
  zeroFlowPressure: number;
  restingFlow: number;
  maxCoronaryFlowReserve: number;
  collateralConductanceFrac: number;
  collateralPressure: number;
}
export const defaultPatient = (): Patient => ({ ...CORONARY });

/**
 * Pressure drop (Pa) across a lesion for flow Q (m3/s).
 *  viscous:   8·pi·mu·Q · ∫ dx/A(x)^2           (Poiseuille integrated along the real lumen)
 *  turbulent: (Kt·rho/2)·(1/As − 1/A0)^2 · Q|Q|  (Young & Tsai expansion-loss form)
 */
export function pressureDrop(Q: number, p: LumenProfile, refDiameter: number): number {
  const A0 = area(refDiameter);
  const As = area(Math.min(...p.d));
  const viscous = 8 * Math.PI * BLOOD.viscosity * Q * integrate(p, (d) => 1 / area(d) ** 2);
  const turbulent =
    0.5 * STENOSIS.Kt * STENOSIS.waveformFactor * BLOOD.density * (1 / As - 1 / A0) ** 2 * Q * Math.abs(Q);
  return viscous + turbulent;
}

/** Microvascular resistance at maximal vasodilation. */
export const minResistance = (pt: Patient) =>
  (pt.meanAorticPressure - pt.zeroFlowPressure) / (pt.restingFlow * pt.maxCoronaryFlowReserve);

export interface FlowState {
  Q: number; // antegrade flow THROUGH the lesion, m3/s (drives pressure drop and contrast arrival)
  Qbed: number; // total flow into the distal bed = Q + collateral inflow
  Pd: number; // distal pressure, Pa
}

const collateralInflow = (Pd: number, pt: Patient) =>
  Math.max(0, (pt.collateralConductanceFrac / minResistance(pt)) * (pt.collateralPressure - Pd));

/** Bisection for the unique root of a function that is increasing in Q. */
function bisect(f: (Q: number) => number, hi: number): number {
  let lo = 0;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Steady state at a fixed microvascular resistance R:
 *   Pd = Pa − ΔP(Q);  bed flow = (Pd − Pzf)/R = Q + collateralInflow(Pd)
 * Collaterals bypass the lesion, so only the antegrade flow Q enters ΔP.
 */
export function solveFlow(resistance: number, prof: LumenProfile, ref: number, pt: Patient): FlowState {
  const Pd = (Q: number) => pt.meanAorticPressure - pressureDrop(Q, prof, ref);
  const bedFlow = (Q: number) => Math.max(0, (Pd(Q) - pt.zeroFlowPressure) / resistance);
  const hi = ((pt.meanAorticPressure - pt.zeroFlowPressure) / resistance) * 1.5 + 1e-9;
  const Q = bisect((q) => q - (bedFlow(q) - collateralInflow(Pd(q), pt)), hi);
  return { Q, Qbed: Q + collateralInflow(Pd(Q), pt), Pd: Pd(Q) };
}

/** Maximal hyperemia (adenosine): resistance at its floor. */
export const hyperemicFlow = (prof: LumenProfile, ref: number, pt = defaultPatient()) =>
  solveFlow(minResistance(pt), prof, ref, pt);

/** Resting state with autoregulation: bed flow held at the resting value until the bed is maximally dilated. */
export function restingFlow(prof: LumenProfile, ref: number, pt = defaultPatient()): FlowState {
  const atFloor = solveFlow(minResistance(pt), prof, ref, pt);
  if (atFloor.Qbed <= pt.restingFlow) return atFloor; // autoregulation exhausted
  const Pd = (Q: number) => pt.meanAorticPressure - pressureDrop(Q, prof, ref);
  const Q = bisect((q) => q - Math.max(0, pt.restingFlow - collateralInflow(Pd(q), pt)), pt.restingFlow * 1.5 + 1e-9);
  return { Q, Qbed: Q + collateralInflow(Pd(Q), pt), Pd: Pd(Q) };
}

/** FFR = distal / aortic mean pressure at maximal hyperemia. */
export const ffr = (prof: LumenProfile, ref: number, pt = defaultPatient()) =>
  hyperemicFlow(prof, ref, pt).Pd / pt.meanAorticPressure;

/** Coronary flow reserve: hyperemic flow / resting flow through the lesion. */
export const coronaryFlowReserve = (prof: LumenProfile, ref: number, pt = defaultPatient()) =>
  hyperemicFlow(prof, ref, pt).Qbed / restingFlow(prof, ref, pt).Qbed;

/** Resting ANTEGRADE flow relative to normal (1 = normal) – the basis for contrast transit speed and TIMI. */
export const relativeRestingFlow = (prof: LumenProfile, ref: number, pt = defaultPatient()) =>
  restingFlow(prof, ref, pt).Q / pt.restingFlow;

/** Same thresholds as the original prompt, now fed by physics instead of an invented curve. */
export function timiGrade(relFlow: number): 0 | 1 | 2 | 3 {
  if (relFlow >= 0.8) return 3;
  if (relFlow >= 0.25) return 2;
  if (relFlow > 0.02) return 1;
  return 0;
}

/**
 * Balloon (or thrombus) occlusion: no antegrade flow; the bed is maximally dilated and
 * fed only by collaterals. Returns the same shape as the other solvers.
 */
export function occludedFlow(pt = defaultPatient()): FlowState {
  const R = minResistance(pt);
  const Gc = pt.collateralConductanceFrac / R;
  const Pd = Math.max(pt.zeroFlowPressure, (pt.zeroFlowPressure / R + Gc * pt.collateralPressure) / (1 / R + Gc));
  return { Q: 0, Qbed: Math.max(0, (Pd - pt.zeroFlowPressure) / R), Pd };
}

/**
 * Pressure (Pa) at each sample of the lesion profile for antegrade flow Q.
 *   P(x) = Pa − viscous(x) − ½ρ(v(x)² − v0²) − entranceLoss·f_in(x) − exitLoss·f_out(x)
 * viscous: running Poiseuille integral; Bernoulli: reversible pressure exchange with velocity;
 * the Young–Tsai turbulent total is split into the Borda–Carnot sudden-expansion loss at the exit
 * (½ρ(v_s − v0)²) and the remainder as a contraction loss at the entrance, so pressure recovers
 * downstream of the throat as it does in real stenoses.
 * The last sample equals Pa − pressureDrop(Q), so it agrees with the solver exactly.
 */
export function pressureAlong(prof: LumenProfile, ref: number, Q: number, Pa: number): number[] {
  const A0 = area(ref);
  const As = area(Math.min(...prof.d));
  const v0 = Q / A0;
  const turb = 0.5 * STENOSIS.Kt * STENOSIS.waveformFactor * BLOOD.density * (1 / As - 1 / A0) ** 2 * Q * Math.abs(Q);
  const exitLoss = Math.min(turb, 0.5 * BLOOD.density * (1 / As - 1 / A0) ** 2 * Q * Math.abs(Q));
  const entranceLoss = turb - exitLoss;
  const minD = Math.min(...prof.d);
  let first = prof.d.length - 1, last = 0;
  prof.d.forEach((d, i) => { if (d <= minD * (1 + 1e-9)) { first = Math.min(first, i); last = Math.max(last, i); } });
  const frac = (Ai: number) => Math.min(1, Math.max(0, (1 / Ai - 1 / A0) / (1 / As - 1 / A0)));
  const out: number[] = [];
  let visc = 0;
  for (let i = 0; i < prof.x.length; i++) {
    if (i > 0) {
      const g = (j: number) => 1 / area(prof.d[j]) ** 2;
      visc += 8 * Math.PI * BLOOD.viscosity * Q * 0.5 * (g(i - 1) + g(i)) * (prof.x[i] - prof.x[i - 1]);
    }
    const Ai = area(prof.d[i]);
    const bern = 0.5 * BLOOD.density * ((Q / Ai) ** 2 - v0 ** 2);
    const fin = i <= first ? frac(Ai) : 1; // 0 → 1 as the lumen narrows to the throat
    const fout = i <= last ? 0 : 1 - frac(Ai); // 0 → 1 as it re-expands
    out.push(Pa - visc - bern - entranceLoss * fin - exitLoss * fout);
  }
  return out;
}
