// Constants for the cardiac-arrest state machine (task B4a, src/sim/arrest.ts).
// Each constant is tagged [lit] (a published figure, direction and rough size) or [assumed] (a teaching choice, not a measured value).
//
// Sources:
//  - Larsen MP et al. Ann Emerg Med 1993;22:1652 (PMID 8214853): survival after witnessed VF falls 5.5 % per minute with no CPR, shock or ACLS (1.1 %/min to defibrillation, 2.3 %/min to CPR, 2.1 %/min to ACLS). That is survival, not shock success. [lit]
//  - Weisfeldt ML, Becker LB. JAMA 2002;288:3035 (CPR gives about 25-30 % of normal cardiac output; three-phase model of arrest). [lit]
//  - Edelson DP et al. Resuscitation 2006;71:137 and Stiell IG et al. Circulation 2012;125:3004 (compression depth 5-6 cm, rate 100-120/min). [lit]
//  - Christenson J et al. Circulation 2009;120:1241 (chest-compression fraction and interruptions lower survival). [lit]
//  - Paradis NA et al. JAMA 1990;263:1106 (coronary perfusion pressure predicts ROSC; pauses reset it). [lit]
//  - Kudenchuk PJ et al. N Engl J Med 1999;341:871 (ARREST: amiodarone 300 mg improves survival to admission in shock-refractory VF). [lit]
//  - Dorian P et al. N Engl J Med 2002;346:884 (ALIVE: amiodarone vs lidocaine in shock-resistant VF). [lit]
//  - Perkins GD et al. N Engl J Med 2018;379:711 (PARAMEDIC2: epinephrine raises ROSC, 1 mg every 3-5 min). [lit]
//  - AHA 2020 ACLS guidelines, Panchal AR et al. Circulation 2020;142:S366 (biphasic 120-200 J, epinephrine q3-5 min, amiodarone 300 then 150 mg). [lit]
//  - Brain injury timing: irreversible injury begins after about 4 min of no flow (resuscitation literature, e.g. Safar P, Crit Care Med 1988). [lit]

export const ARREST = {
  /** Seconds of (CPR-extended) no flow after which the patient is declared dead. Near-certain irreversible injury by about 10 min. [lit] */
  deathAfterNoFlowS: 600,
  /** Irreversible injury begins after about 4 min of no flow. [lit] */
  injuryOnsetNoFlowS: 240,

  /** Output (fraction of normal) the engine must hold, as a perfusing rhythm, for ROSC. [assumed] */
  roscOutput: 0.5,
  /** Seconds that perfusing rhythm with output >= roscOutput must be sustained before status becomes rosc. [assumed] */
  roscSustainS: 10,
  /** Seconds of loss of perfusing rhythm or output below roscOutput after which ROSC reverts to arrest. [assumed] */
  rearrestAfterS: 15,
  /** Output at which no-flow stops accumulating and starts to recover. [assumed] */
  noFlowRecoverOutput: 0.5,
  /** Output scale for no-flow credit: accumulation rate = 1 - output / this, so CPR at 0.3 halves it. [assumed] */
  noFlowCreditRef: 0.6,
  /** Smallest accumulation rate while output is below roscOutput. [assumed] */
  noFlowMinRate: 0.15,
  /** Seconds of no-flow recovered per second once output is at or above roscOutput. [assumed] */
  noFlowRecoverRate: 0.5,

  cpr: {
    /** Best-case CPR-delivered output, fraction of normal (25-30 % in the literature). [lit] */
    maxOutput: 0.3,
    rateMin: 80, rateMax: 140, depthMin: 3, depthMax: 8,
    /** Ideal rate band (per min) and depth band (cm). [lit] */
    rateBest: [100, 120] as [number, number],
    depthBest: [5, 6] as [number, number],
    /** Factor at the edges of the allowed range (linear to 1 at the ideal band). [assumed] */
    rateEdgeFactor: 0.7,
    depthLowFactor: 0.3,
    depthHighFactor: 0.75,
    /** Time constant of the compression-duty memory (s): pauses cost output and it rebuilds after. [assumed] */
    dutyTauS: 6,
    /** Time constant of the recent CPR quality memory used for shock odds and VF clock (s). [assumed] */
    recentTauS: 30,
    /** Fraction by which perfect recent CPR slows the "untreated VF" clock. [assumed] */
    vfClockProtection: 0.6,
  },

  shock: {
    /** First-shock success of a biphasic 200 J shock on fresh VF. [lit, AHA 2020] */
    baseSuccess: 0.9,
    /** Absolute fall in shock success per minute of untreated VF. The 7-10 %/min figure often quoted for survival is NOT in Larsen 1993 (5.5 %/min); this value is a teaching choice, see docs/ARREST.md. [assumed] */
    declinePerMin: 0.085,
    /** Added success for perfect recent CPR. [assumed] */
    cprBonus: 0.08,
    /** Biphasic energy range (J); factor energyFactorAtLow at 120 J, 1.0 at 200 J, proportional below 120 J. [lit/assumed] */
    energyLow: 120, energyHigh: 200, energyFactorAtLow: 0.92,
    minSuccess: 0.02, maxSuccess: 0.95,
    /** Synchronized cardioversion success on a perfusing tachyarrhythmia at full energy (50-200 J). [assumed] */
    cardioversionSuccess: 0.85,
    cardioversionMinJoules: 50,
    /** Chance an unsynchronized shock on a perfusing rhythm induces VF (R-on-T). [assumed] */
    unsyncedInduceVfTachy: 0.1,
    unsyncedInduceVfNormal: 0.03,
  },

  drugs: {
    epinephrine: {
      /** 1 mg every 3-5 min. [lit] Benefit window after a dose; doses closer than minIntervalS add nothing. */
      doseMg: 1, minIntervalS: 180, windowS: 300,
      /** Extra CPR output (fraction of normal) while in window. [assumed] */
      cprOutputBoost: 0.03,
      /** Multiplier on spontaneous ROSC rate while in window. [assumed] */
      roscMultiplier: 2.0,
      /** Added shock success in window. [assumed] */
      shockBonus: 0.02,
    },
    amiodarone: {
      /** First dose 300 mg, second 150 mg [lit]. Added shock success after cumulative dose [assumed size]. */
      firstMg: 300, secondMg: 150, firstBonus: 0.08, secondBonus: 0.04,
    },
    lidocaine: {
      /** Alternative to amiodarone, about 1-1.5 mg/kg (about 100 mg) [lit]; smaller effect [assumed]. */
      doseMg: 100, bonus: 0.05,
    },
  },

  /** Spontaneous ROSC per minute of PEA/asystole with perfect CPR (never by shock). [assumed] */
  spontaneousRoscPerMin: 0.03,
};
