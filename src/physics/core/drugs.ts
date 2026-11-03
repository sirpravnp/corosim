import { AV_NODE, BETA_BLOCK, DEMAND, DRUG_NAMES, KINETICS, LOOP, NO, PROFILES, RECEPTOR, type DrugName } from "../../config/drugs";

/**
 * Receptor-level drugs for the core engine (E4). Replaces the `SUPPORT` multipliers on the core path.
 *
 *  dose (0..1)  --first order, clinical minutes-->  level  --profile-->  receptor drive  --RECEPTOR / NO-->  effects on the heart
 *
 *  - level: the effect-site concentration as a fraction of a full dose; dL/dt = (dose − L)/τ with τ = `KINETICS[drug].on` when the
 *    dose is above the level and `.off` when below (minutes of the clinical clock: `Simulation` passes the clinical minutes of each step).
 *  - receptor drive: alpha-1, beta-1, beta-2, V1, PDE3 are the sums of the levels weighted by each drug's `PROFILES` entry. The beta-1
 *    drive of an agonist is cut by the beta-blocker's blockade (competitive); PDE3 is not (milrinone works through a blocked receptor).
 *    The NO/cGMP drive is a Hill curve per bed (`NO`): veins respond first.
 *  - effects, all multipliers on the design point (1 = none), the same names as `LiveModifiers`:
 *      resistance   = Π (1 + gain·drive) over alpha-1, V1, beta-2, PDE3, × (1 − NO arterial response)      systemic arteriolar resistance
 *      venousTone   = Π (1 + gain·drive) over alpha-1, V1, beta-2, PDE3, × (1 − NO venous response) × (1 − loop·level)   tone > 1: less unstressed volume
 *      contractility = 1 + Ees gain · beta-1 drive + PDE3 gain · PDE3 drive                                   LV and RV Ees
 *      relax        = (1 + lusitropy · beta-1 drive)(1 + PDE3 lusitropy · drive)(1 + blocker · blockade)      tau (< 1: relaxes faster)
 *      hrScale      = (1 + chronotropy · beta-1 drive)(1 + PDE3 chronotropy · drive), on the rate the autonomic model asks for
 *      betaBlock    = the blockade (0..1), handed to the autonomic model, which removes that fraction of the sympathetic effect on
 *                     rate and Ees (the same loop acts on the heart: the drug does not fight the reflex, it limits what the reflex can do)
 *      diuretic     = 1 + `LOOP.urine` · loop level, the multiplier of the fluid model's urine flow (`FluidCompartments.diuretic`)
 *  Nothing here sets pressure, flow or HR directly: the engine and the baroreflex turn these into MAP, CO and rate, so reflex
 *  bradycardia under a pure vasoconstrictor and the fall in Ees reserve under a beta-blocker come out of the loop.
 */
export type DrugDoses = Partial<Record<DrugName, number>>;

export interface Receptors { a1: number; b1: number; b2: number; v1: number; pde3: number; noVen: number; noArt: number; block: number; loop: number; ccb: number }

export interface DrugEffects {
  resistance: number; venousTone: number; contractility: number; relax: number; hrScale: number; betaBlock: number; diuretic: number;
  /** Multiplier on the ventricular response in atrial fibrillation from AV-nodal slowing (beta blockade, calcium channel blockade), 1 = none. */
  avSlow: number;
  /** Rise of ischemic ectopy with catecholamine drive: the beta-1 drive after any blockade, 0..~1.3. */
  ectopyDrive: number;
  /** Myocardial oxygen demand relative to the patient's own from these effects (`DEMAND`), 1 = none. */
  demand: number;
}

const hill = (d: number, h: { max: number; ec50: number; n: number }) => (d > 0 ? (h.max * d ** h.n) / (d ** h.n + h.ec50 ** h.n) : 0);

/** Receptor drives of a set of levels. */
export function receptorDrive(level: Readonly<Record<DrugName, number>>): Receptors {
  const r: Receptors = { a1: 0, b1: 0, b2: 0, v1: 0, pde3: 0, noVen: 0, noArt: 0, block: 0, loop: 0, ccb: 0 };
  for (const n of DRUG_NAMES) for (const [k, w] of Object.entries(PROFILES[n]) as [keyof Receptors, number][]) r[k] += w * level[n];
  r.block = Math.min(1, r.block);
  r.b1 *= 1 - r.block; // the blockade is competitive for the agonists
  return r;
}

/** The effects of a set of levels (see the table above). */
export function drugEffects(level: Readonly<Record<DrugName, number>>): DrugEffects {
  const r = receptorDrive(level), R = RECEPTOR;
  const resistance = (1 + R.a1.art * r.a1) * (1 + R.v1.art * r.v1) * (1 + R.b2.art * r.b2) * (1 + R.pde3.art * r.pde3) * (1 + R.ccb.art * r.ccb) * (1 - hill(r.noArt, NO.art));
  const venousTone = (1 + R.a1.ven * r.a1) * (1 + R.v1.ven * r.v1) * (1 + R.b2.ven * r.b2) * (1 + R.pde3.ven * r.pde3) * (1 - hill(r.noVen, NO.ven)) * (1 - LOOP.ven * r.loop);
  const contractility = 1 + R.b1.ees * r.b1 + R.pde3.ees * r.pde3 + R.ccb.ees * r.ccb;
  const relax = (1 + R.b1.relax * r.b1) * (1 + R.pde3.relax * r.pde3) * (1 + BETA_BLOCK.blockerRelax * r.block);
  const hrScale = (1 + R.b1.hr * r.b1) * (1 + R.pde3.hr * r.pde3);
  const demand = Math.max(0.3, (1 + DEMAND.inotropy * (contractility - 1)) * (1 + DEMAND.rate * (hrScale - 1)) * (1 + DEMAND.afterload * (resistance - 1)) * (1 - DEMAND.preload * (1 - venousTone)));
  const avSlow = Math.max(AV_NODE.floor, (1 - AV_NODE.betaBlock * r.block) * (1 - AV_NODE.ccb * Math.min(1, r.ccb)));
  return { resistance, venousTone, contractility, relax, hrScale, avSlow, betaBlock: r.block, diuretic: 1 + LOOP.urine * r.loop, ectopyDrive: r.b1, demand };
}

/** Effect-site levels of every drug, moved toward the doses with first-order kinetics in clinical minutes. */
export class Drugs {
  readonly level = Object.fromEntries(DRUG_NAMES.map((n) => [n, 0])) as Record<DrugName, number>;
  constructor(doses: DrugDoses = {}) { this.set(doses); }

  /** Put every level at its dose at once (a steady infusion already running). A drug left out is 0. */
  set(doses: DrugDoses) { for (const n of DRUG_NAMES) this.level[n] = Math.min(1, Math.max(0, doses[n] ?? 0)); }

  /** Advance `minutes` of clinical time toward `doses` (a drug left out is stopped). Exact for a constant dose, so the step size does not matter. */
  step(minutes: number, doses: DrugDoses) {
    if (!(minutes > 0)) return;
    for (const n of DRUG_NAMES) {
      const target = Math.min(1, Math.max(0, doses[n] ?? 0)), L = this.level[n], tau = target > L ? KINETICS[n].on : KINETICS[n].off;
      this.level[n] = L + (target - L) * (1 - Math.exp(-minutes / tau));
    }
  }

  effects(): DrugEffects { return drugEffects(this.level); }
}
