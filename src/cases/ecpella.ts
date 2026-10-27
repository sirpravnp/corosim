import type { CaseDef } from "./engine";

/**
 * Refractory VF/VT on arrival, an occluded proximal LAD, and a case that is won with mechanical support and PCI together:
 * ACLS alone does not hold, ECMO alone distends the left ventricle, and the arrhythmia only stops once the artery is open.
 * Based on a published case report of ECPELLA (VA-ECMO with an Impella CP) for refractory ischemic VF.
 */
// The circuit and the pump are built into the patient from the start, switched off: placing them is then a live change, not a rebuild.
const ECMO = { devices: { ecmo: { flowLpm: 4 } } };
const IMPELLA = { devices: { impella: { level: 6 } } };
const BOTH = { devices: { ecmo: { flowLpm: 4 }, impella: { level: 6 } } }; // one `devices` object: spreading ECMO and IMPELLA together would keep only the second

export const ECPELLA: CaseDef = {
  id: "ecpella",
  title: "Collapse at home",
  tier: "hard",
  blurb: "Refractory VF and polymorphic VT after a witnessed collapse.",
  card: {
    presents: "58-year-old man who collapsed at home. His daughter, a medical student, started CPR at once. EMS found VF and polymorphic VT, gave at least six shocks, and ACLS is still running. There is transient ROSC, then VF again.",
    pmh: "Hypertension, hyperlipidemia. Southeast Asian man. No known coronary disease.",
    info: ["Amiodarone and lidocaine already given in the field; the rhythm is refractory to both.", "An ECG during a brief ROSC is the only 12-lead you will get."],
  },
  start: { lesions: [{ artery: "LAD", occluded: true, position: 0.1 }], seed: 7, devices: { ecmo: { flowLpm: 0, sweepLpm: 3, fio2: 1 }, impella: { model: "CP", level: 0 } } },
  opening: { rhythm: "vf-coarse", cpr: true, drugs: [{ drug: "epinephrine", mg: 1 }, { drug: "amiodarone", mg: 300 }, { drug: "lidocaine", mg: 100 }] },
  stable: (p) => p.map >= 55 && !p.dead,
  points: { survive: 30, stable: 20, harm: 15 },
  limitS: 1800,
  musts: [
    { flag: "ecmoCalled", label: "call for mechanical circulatory support early" },
    { flag: "vented", label: "vent the left ventricle (Impella)" },
    { flag: "pciOrdered", label: "take the patient to the cath lab for PCI" },
  ],
  checkpoints: [
    // 1. Arrival: what now?
    {
      id: "arrival", atS: 0, forbids: ["ecmoCalled"], repeatAfterS: 150,
      prompt: {
        text: "VF and polymorphic VT keep coming back through every shock, amiodarone and lidocaine. CPR is in progress. What is your next step?",
        options: [
          { label: "Keep going with ACLS: another shock, another amiodarone dose", points: -5, correct: false, why: "Refractory VF will not respond to a seventh shock. Every minute of low-flow CPR costs brain and heart; mechanical support has to be started now.", outcome: { reveal: ["Another round of shocks and drugs. VF resumes within seconds of each brief ROSC."] } },
          { label: "Activate the mechanical-support team: ECPR, interventional cardiology, CT surgery, ICU", points: 15, correct: true, why: "Refractory VF with a likely coronary cause is the indication for ECPR. The team has to be called while CPR continues.", outcome: { flags: ["ecmoCalled"], reveal: ["Interventional cardiology and CT surgery are on the way. They want to place VA-ECMO and an Impella while compressions continue."] } },
          { label: "Give a bolus of sodium bicarbonate and calcium and keep compressing", points: -5, correct: false, why: "Neither treats refractory VF from an occluded artery. They delay the one thing that will.", outcome: { reveal: ["No change in the rhythm."] } },
        ],
      },
    },
    // 2. Which device strategy
    {
      id: "device", requires: ["ecmoCalled"], forbids: ["deviceChosen"], repeatAfterS: 60,
      prompt: {
        text: "The team is ready. What do you want placed?",
        options: [
          { label: "VA-ECMO alone", points: 5, correct: false, why: "VA-ECMO restores flow, but in VF the left ventricle cannot eject. It distends against the ECMO afterload, the aortic valve stays shut and pulmonary edema follows. It needs a vent.", outcome: { flags: ["deviceChosen", "ecmoOnly"], patch: ECMO, reveal: ["VA-ECMO is running at 4 L/min. Perfusion is back, but the LV is not ejecting."] } },
          { label: "VA-ECMO with an Impella CP (ECPELLA)", points: 20, correct: true, why: "The Impella vents the left ventricle while ECMO carries the circulation, which is what lets a fibrillating, ischemic heart rest until the artery is open.", outcome: { flags: ["deviceChosen", "vented"], patch: BOTH, reveal: ["VA-ECMO is running at 4 L/min and the Impella CP is unloading the LV."] } },
          { label: "Intra-aortic balloon pump", points: -10, correct: false, why: "A balloon pump needs a rhythm and a native output to augment. It does nothing in VF.", outcome: { flags: ["iabpOnly"], reveal: ["The balloon pump has nothing to augment. VF continues and flow is still CPR-only."] } },
        ],
      },
    },
    // 2b. Complication of ECMO alone: LV distension
    {
      id: "distension", branch: true, requires: ["ecmoOnly"], forbids: ["vented"], when: (p) => p.ecmo, forS: 45, repeatAfterS: 60,
      prompt: {
        text: "On ECMO alone the arterial line is non-pulsatile, the LV looks dilated on echo and the aortic valve is not opening. The lungs are filling. How do you vent the LV?",
        options: [
          { label: "Place an Impella CP across the aortic valve", points: 15, correct: true, why: "An Impella is the usual vent on ECMO: it empties the LV directly and brings the pulmonary pressures down.", outcome: { flags: ["vented"], patch: IMPELLA, reveal: ["The Impella CP is in. The LV decompresses and the pulmonary edema stops progressing."] } },
          { label: "Give more fluid to improve ECMO drainage", points: -10, correct: false, why: "More volume loads a ventricle that is already overdistended.", outcome: { reveal: ["The LV distends further."] } },
          { label: "Add an inotrope to open the aortic valve", points: -5, correct: false, why: "An inotrope cannot make a fibrillating ventricle eject, and it raises demand in ischemic muscle.", outcome: { reveal: ["No effect on the valve; the myocardium is more irritable."] } },
        ],
      },
    },
    // 3. Support is on, VF persists: the artery
    {
      id: "artery", requires: ["vented"], forbids: ["pciOrdered"],
      when: (p) => p.ecmo, forS: 20,
      prompt: {
        text: "Flow is established and the patient is perfusing on support, but VF keeps recurring. The ECG shows anterior ST elevation. What now?",
        options: [
          { label: "Emergency coronary angiography and PCI", points: 20, correct: true, why: "The VF is driven by an open ischemic territory. Support buys time; opening the artery is what ends the arrhythmia.", outcome: { flags: ["pciOrdered"], order: "pci", reveal: ["Proximal LAD occlusion on the angiogram. PCI is under way."] } },
          { label: "More shocks and a second amiodarone bolus", points: -5, correct: false, why: "Drugs and shocks do not fix an electrical storm that comes from ischemia.", outcome: { reveal: ["VF persists."] } },
          { label: "Systemic fibrinolysis", points: -10, correct: false, why: "Lysis is a poor choice after prolonged CPR and with cannulas in: bleeding risk is high and PCI is available.", outcome: { reveal: ["The team declines: bleeding risk after CPR and cannulation is too high."] } },
        ],
      },
    },
    // The storm: transient ROSC, then VF again until the artery is open
    {
      id: "storm", repeatAfterS: 25,
      when: (p) => p.arrest === "rosc" && !p.pci, forS: 12,
      outcome: { patch: { patient: { rhythm: "vf-coarse" } }, reveal: ["VF resumes."] },
    },
    // PCI done: the storm ends
    {
      id: "reperfused", when: (p) => p.pci,
      outcome: { patch: { patient: { rhythm: "sinus" } }, flags: ["reperfused"], reveal: ["Flow is restored in the LAD. VF and VT stop immediately. Pressor requirements remain high."] },
    },
    // 4. After reperfusion
    {
      id: "after", requires: ["reperfused"],
      prompt: {
        text: "VF has stopped with PCI, but pressor requirements remain high. What are your next steps?",
        options: [
          { label: "Decannulate now that the rhythm is back", points: -10, correct: false, why: "The myocardium is stunned and pressor needs are high. Taking support away now risks a return to shock.", outcome: { end: "fail", reveal: ["The patient decompensates after decannulation."] } },
          { label: "Keep ECMO and Impella, admit to the cardiac ICU, and wean by echo and pressor needs", points: 20, correct: true, why: "ECMO and Impella stay until the ventricle recovers. The ICU team watches for the complications of support: bleeding, limb ischemia, abdominal compartment syndrome.", outcome: { end: "success", reveal: ["Admitted to the CTICU on ECMO and Impella, with a plan to wean."] } },
          { label: "Send the patient to the ward on high-dose pressors", points: -15, correct: false, why: "A patient on mechanical support and high pressors belongs in a cardiac ICU.", outcome: { end: "fail", reveal: ["The patient is not safe for the ward."] } },
        ],
      },
    },
  ],
};
