// Management constants: hemodynamic support, infarct evolution, revascularization.
// Every value is a teaching assumption chosen so the direction and rough size of each effect match the clinical
// teaching points, not a measured dose-response. [assumed]

export const SUPPORT = {
  // Fluids (litres given). Effect saturates: 1 − exp(−L/fluidScale).
  fluidScale: 1.0,
  fluidRvRelief: 0.85, // fraction of the RV preload loss a full bolus restores
  congestionGain: 0.8, // pulmonary congestion = litres × LV ischemic fraction × this
  congestionSvLoss: 0.3, // SV × (1 − loss × congestion)
  maxFluids: 3,
  // Norepinephrine, 0..1 of a full dose
  norepiSvr: 0.35, // SVR × (1 + k·dose)
  norepiAfterloadLoss: 0.22, // SV × (1 − k·dose·LV ischemic fraction): afterload mismatch in a failing ventricle
  norepiHr: 0.04,
  norepiDemand: 0.15, // myocardial oxygen demand × (1 + k·dose)
  // Dobutamine
  dobContractility: 0.45, // LV contractile loss × (1 − k·dose)
  dobSvr: 0.12, // SVR × (1 − k·dose)
  dobHr: 0.22,
  dobDemand: 0.3,
  dobEctopy: 0.6, // ischemic ectopy × (1 + k·dose)
  // Nitroglycerin
  nitroSvr: 0.22,
  nitroPreload: 0.12, // SV × (1 − (k + rvK·RV ischemic fraction)·dose)
  nitroPreloadRv: 0.6, // the infarcted right ventricle is preload-dependent
  nitroDemand: 0.1,
  // Atropine: removes vagal tone (rate, vasodilation), and relieves tone-mediated 2nd-degree block
  atropineBlockVagal: 0.3, // vagal drive above which 2nd-degree block is considered tone-mediated
  atropineBlockMaxIschemia: 0.7, // but not once the AV-node artery is largely infarcted
  // Intra-aortic balloon pump
  iabpStrokeVolume: 0.1, // SV × (1 + k·min(1, LV ischemic fraction / 0.25)): afterload reduction
  iabpCoronaryAug: 10, // mmHg of diastolic augmentation added to coronary perfusion pressure
  iabpDemand: 0.07,
  // Impella-type microaxial pump
  impellaFlow: 3.0, // L/min at no RV failure
  impellaRvSuction: 0.85, // device flow × (1 − k·RV ischemic fraction): it cannot pump blood the RV does not deliver
  impellaNativeSv: 0.35, // native SV × (1 − k): unloading
  impellaDemand: 0.25,
  // Pacing
  paceMin: 40, paceMax: 120, paceDefault: 70,
};

export const INFARCT = {
  minutesPerSecond: 2, // clinical minutes per second of simulated time at 1×
  tauMinutes: 150, // e-folding time of necrosis for a fully ischemic bed (≈ 3 h to 70%: collateral-free worst case) [assumed]
  severityPower: 2, // necrosis rate ∝ severity^k, so mild or partial ischemia injures far more slowly
  lvefNormal: 0.62,
};

export const PROCEDURE = {
  // Clinical minutes from the decision to flow in the artery.
  pci: { label: "Primary PCI", delayMin: 60 }, // call to balloon (guideline goal ≤ 90 min door to device)
  lysis: { label: "Fibrinolytic", delayMin: 40 }, // bolus plus time for the clot to lyse
  cabg: { label: "CABG", delayMin: 240 }, // urgent operation
  lysisSuccess: 0.55, // TIMI 3 flow at 90 minutes in trials is about 50–60%
  lysisResidual: 0.5, // diameter stenosis left under a lysed clot
  graftDiameter: 2.5e-3, // m
  graftLength: 0.15, // m
  graftTail: 3, // mm distal to the lesion window where the graft is sewn on
};
export type Procedure = "pci" | "lysis" | "cabg";
