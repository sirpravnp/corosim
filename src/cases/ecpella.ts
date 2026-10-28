import type { CaseDef } from "./engine";

/**
 * A witnessed collapse in VF, a quick ROSC, and an anterolateral STEMI (proximal LAD occlusion) on the first 12-lead. The case is five decisions
 * with time to watch the consequences between them: stabilize in the ED or go to the cath lab (an ED that keeps running ACLS re-arrests him);
 * on the table he goes back into VF, and the question is what to do about it: mechanical support first (ECPELLA: VA-ECMO with an Impella CP),
 * because opening the artery with no circulation is a death on the table; then PCI with support kept running; then keep the support after reperfusion.
 * ECMO alone distends the left ventricle and needs a vent. Based on a published case report of ECPELLA for refractory ischemic VF.
 */
// ---- pacing: case seconds, all in one place so the case is easy to tune. Dwells count from the state change that starts them (a flag, a rhythm).
const QUICK_ROSC_S = 8;           // from the start to the first shock (it repeats until it converts)
const POST_ROSC_DWELL_S = 30;     // perfusing after ROSC (ROSC itself is called ~10 s after conversion) before Decision 1
const ED_REARREST_S = 30;         // an ED that keeps running ACLS: perfusing this long before he re-arrests into VF
const ED_REARREST_EVERY_S = 60;   // ... and again this long after if he is still in the ED
const DECISION1_REPEAT_S = 120;   // the cath lab prompt comes back this often
const LAB_STABLE_S = 25;          // on the table, stable, before he goes back into VF
const LAB_ARREST_DWELL_S = 18;    // in VF in the lab before Decision 2: the consequences show first
const DECISION2_REPEAT_S = 60;    // the support prompt comes back this often after a wrong answer
const UNSUPPORTED_MID_S = 12;     // straight to PCI with no support: when he visibly worsens
const UNSUPPORTED_DEATH_S = 28;   // ... and when he dies, counted from the choice
const ECMO_ALONE_S = 42;          // on ECMO alone before the LV distension prompt
const ECPELLA_DWELL_S = 45;       // on full support in VF before Decision 3 (PCI)
const DECISION3_REPEAT_S = 60;
const RECOVERY_DWELL_S = 38;      // after reperfusion before Decision 4
const STORM_S = 12;               // transient ROSC before VF recurs (until the artery is open)
const STORM_EVERY_S = 25;

// The circuit and the pump are built into the patient from the start, switched off: placing them is then a live change, not a rebuild.
const ECMO = { devices: { ecmo: { flowLpm: 4 } } };
const IMPELLA = { devices: { impella: { level: 6 } } };
const BOTH = { devices: { ecmo: { flowLpm: 4 }, impella: { level: 6 } } }; // one `devices` object: spreading ECMO and IMPELLA together would keep only the second
const VF = { patient: { rhythm: "vf-coarse" } };
const SINUS = { patient: { rhythm: "sinus" } };

export const ECPELLA: CaseDef = {
  id: "ecpella",
  title: "Collapse at home",
  tier: "hard",
  blurb: "A witnessed collapse in VF, a quick ROSC and a STEMI. Where does he go, and what keeps him alive?",
  card: {
    presents: "62-year-old man who collapsed at home. His wife, a nurse, started CPR at once. EMS found VF and polymorphic VT, shocked him and gave amiodarone and lidocaine. He is back in the ED with CPR in progress. ROSC comes quickly, and the post-ROSC 12-lead shows an anterolateral STEMI.",
    pmh: "Hypertension, hyperlipidemia. Southeast Asian man. No known coronary disease.",
    info: ["The post-ROSC ECG shows anterolateral ST elevation: a proximal LAD occlusion.", "After ROSC his pressure holds, but his ventricle is stunned (ejection fraction about 0.3, high filling pressure) and ventricular ectopy is frequent."],
  },
  start: { lesions: [{ artery: "LAD", occluded: true, position: 0.1 }], seed: 7, devices: { ecmo: { flowLpm: 0, sweepLpm: 3, fio2: 1 }, impella: { model: "CP", level: 0 } } },
  opening: { rhythm: "vf-coarse", cpr: true, drugs: [{ drug: "epinephrine", mg: 1 }, { drug: "amiodarone", mg: 300 }, { drug: "lidocaine", mg: 100 }] },
  stable: (p) => p.map >= 55 && !p.dead,
  points: { survive: 30, stable: 20, harm: 15 },
  limitS: 2400,
  musts: [
    { flag: "cathLab", label: "take him to the cath lab promptly after ROSC" },
    { flag: "mcs", label: "start mechanical circulatory support (ECPELLA) before PCI" },
    { flag: "vented", label: "vent the left ventricle (Impella)" },
    { flag: "pciOrdered", label: "do the PCI with support running" },
  ],
  checkpoints: [
    // ---- the team's hands: compressions go on at an arrest and off at ROSC
    { id: "cprOff", when: (p) => p.arrest === "rosc" && p.cpr && p.rhythmClass === "perfusing", repeatAfterS: 5, outcome: { cpr: false } },
    { id: "cprOn", when: (p) => p.arrest === "arrest" && !p.cpr, repeatAfterS: 5, outcome: { cpr: true } },

    // ---- 1. The quick ROSC: shock until he converts
    {
      id: "quickRosc", atS: QUICK_ROSC_S, forbids: ["rosc1"], repeatAfterS: 6,
      outcome: { shock: { joules: 200, onSuccess: { patch: SINUS, flags: ["rosc1"], reveal: ["The shock converts him. A pulse returns. The 12-lead shows anterolateral ST elevation: a proximal LAD occlusion."] }, onFail: { reveal: ["The shock does not convert him. Compressions resume."] } } },
    },

    // ---- Decision 1: the ED or the cath lab (after the post-ROSC hemodynamics have played)
    {
      id: "disposition", requires: ["rosc1"], forbids: ["cathLab"], when: (p) => p.rhythmClass === "perfusing" && p.arrest !== "arrest", forS: POST_ROSC_DWELL_S, repeatAfterS: DECISION1_REPEAT_S,
      prompt: {
        text: "He has a pulse and his pressure is holding, but the ventricle is stunned (ejection fraction about 0.3, high filling pressure), ventricular ectopy is frequent and the 12-lead shows an anterolateral STEMI. What do you do?",
        options: [
          { label: "Activate the cath lab and take him for emergent angiography", points: 15, correct: true, why: "A STEMI after ROSC needs immediate angiography. The artery is the cause of the arrest and it will cause the next one; every minute in the ED is a minute of ischemia.", outcome: { flags: ["cathLab"], reveal: ["The cath lab is activated. He is on the table within minutes, with the team and the devices on standby."] } },
          { label: "Keep running ACLS in the ED: more amiodarone, a pressor, observe", points: -10, correct: false, why: "Drugs do not treat an occluded LAD. Stabilizing him in the ED only gives the ischemia time to re-arrest him.", outcome: { flags: ["edWorse"], reveal: ["Another amiodarone bolus and a pressor. The ectopy does not settle and the ST elevation does not change."] } },
          { label: "Wait for the troponin and a CT of the head before deciding", points: -10, correct: false, why: "An ECG with ST elevation is enough. A troponin only confirms what the 12-lead shows, and the CT delays reperfusion.", outcome: { flags: ["edWorse"], reveal: ["He goes for a CT. The ectopy is increasing."] } },
        ],
      },
    },
    // An ED that keeps running ACLS: he goes back into VF, is shocked again, and the question comes back
    { id: "edRearrest", requires: ["edWorse"], forbids: ["cathLab"], when: (p) => p.rhythmClass === "perfusing" && p.arrest === "rosc", forS: ED_REARREST_S, repeatAfterS: ED_REARREST_EVERY_S, outcome: { patch: VF, cpr: true, reveal: ["He re-arrests in the ED: VF again."] } },
    { id: "edShock", requires: ["edWorse"], forbids: ["cathLab"], when: (p) => p.rhythmClass === "vf", repeatAfterS: 6, outcome: { shock: { joules: 200, onSuccess: { patch: SINUS, reveal: ["Shocked back to a perfusing rhythm. The STEMI is unchanged."] }, onFail: { reveal: ["No conversion. Compressions continue."] } } } },

    // ---- In the lab: stable on the table, then back into VF
    { id: "labArrest", requires: ["cathLab"], forbids: ["labArrested"], when: () => true, forS: LAB_STABLE_S, outcome: { patch: VF, cpr: true, flags: ["labArrested"], reveal: ["On the table, as the wire is about to cross, he goes into VF again. Compressions restart."] } },

    // ---- Decision 2: what now?
    {
      id: "device", requires: ["labArrested"], forbids: ["deviceChosen", "unsupportedPci"], when: (p) => p.rhythmClass !== "perfusing", forS: LAB_ARREST_DWELL_S, repeatAfterS: DECISION2_REPEAT_S,
      prompt: {
        text: "He is in VF in the lab, the LAD is occluded and compressions are the only flow. What now?",
        options: [
          { label: "Mechanical support first: VA-ECMO with an Impella CP (ECPELLA), then revascularize", points: 25, correct: true, why: "The Impella vents the left ventricle while ECMO carries the circulation, which is what lets a fibrillating, ischemic heart rest and lets the operator open the artery on a perfused patient.", outcome: { flags: ["deviceChosen", "mcs", "vented"], patch: BOTH, reveal: ["VA-ECMO is running at 4 L/min and the Impella CP is unloading the LV."] } },
          { label: "VA-ECMO alone", points: 5, correct: false, why: "VA-ECMO restores flow, but in VF the left ventricle cannot eject. It distends against the ECMO afterload, the aortic valve stays shut and pulmonary edema follows. It needs a vent.", outcome: { flags: ["deviceChosen", "mcs", "ecmoOnly"], patch: ECMO, reveal: ["VA-ECMO is running at 4 L/min. Perfusion is back, but the LV is not ejecting."] } },
          { label: "Proceed straight to PCI of the LAD", points: -25, correct: false, why: "Opening the artery is the cure, but he has no circulation to carry him through the procedure. Revascularization on compressions alone ends in refractory shock before the stent is in. Support first, then the artery.", outcome: { flags: ["unsupportedPci"], reveal: ["The operator crosses the lesion on compressions alone."] } },
          { label: "Intra-aortic balloon pump", points: -10, correct: false, why: "A balloon pump needs a rhythm and a native output to augment. It does nothing in VF.", outcome: { flags: ["iabpOnly"], reveal: ["The balloon pump has nothing to augment. VF continues and flow is still CPR-only."] } },
          { label: "More shocks and another amiodarone bolus", points: -5, correct: false, why: "Drugs and shocks do not fix an electrical storm that comes from an occluded artery.", outcome: { reveal: ["VF persists."] } },
        ],
      },
    },
    // Straight to PCI with no support: the consequence is visible, then final
    { id: "unsupportedWorse", requires: ["unsupportedPci"], forbids: ["deviceChosen", "unsupportedWorse"], when: () => true, forS: UNSUPPORTED_MID_S, outcome: { flags: ["unsupportedWorse"], reveal: ["Compressions cannot hold a perfusion pressure through the procedure; the pressure stays around fifty."] } },
    { id: "unsupportedDeath", requires: ["unsupportedPci"], forbids: ["deviceChosen"], when: () => true, forS: UNSUPPORTED_DEATH_S, outcome: { end: "fail", reveal: ["He cannot be resuscitated without support and dies in refractory shock before the LAD is opened."] } },

    // ---- A complication of ECMO alone: LV distension
    {
      id: "distension", branch: true, requires: ["ecmoOnly"], forbids: ["vented"], when: (p) => p.ecmo, forS: ECMO_ALONE_S, repeatAfterS: 60,
      prompt: {
        text: "On ECMO alone the arterial line is non-pulsatile, the LV looks dilated on echo and the aortic valve is not opening. The lungs are filling. How do you vent the LV?",
        options: [
          { label: "Place an Impella CP across the aortic valve", points: 15, correct: true, why: "An Impella is the usual vent on ECMO: it empties the LV directly and brings the pulmonary pressures down.", outcome: { flags: ["vented"], patch: IMPELLA, reveal: ["The Impella CP is in. The LV decompresses and the pulmonary edema stops progressing."] } },
          { label: "Give more fluid to improve ECMO drainage", points: -10, correct: false, why: "More volume loads a ventricle that is already overdistended.", outcome: { reveal: ["The LV distends further."] } },
          { label: "Add an inotrope to open the aortic valve", points: -5, correct: false, why: "An inotrope cannot make a fibrillating ventricle eject, and it raises demand in ischemic muscle.", outcome: { reveal: ["No effect on the valve; the myocardium is more irritable."] } },
        ],
      },
    },

    // ---- Decision 3: on support, still in VF: the artery
    {
      id: "artery", requires: ["vented"], forbids: ["pciOrdered"], when: (p) => p.ecmo, forS: ECPELLA_DWELL_S, repeatAfterS: DECISION3_REPEAT_S,
      prompt: {
        text: "Flow is established and he is perfusing on ECMO and Impella, but he remains in VF. The LAD is still occluded. What now?",
        options: [
          { label: "PCI of the proximal LAD with ECMO and Impella kept running", points: 20, correct: true, why: "The VF is driven by an open ischemic territory. Support buys time on the table; opening the artery is what ends the arrhythmia.", outcome: { flags: ["pciOrdered"], order: "pci", reveal: ["Proximal LAD occlusion on the angiogram. PCI is under way with ECMO and Impella running."] } },
          { label: "Wean ECMO to test his rhythm before the PCI", points: -10, correct: false, why: "Support is what keeps him alive through the procedure. Taking it away before the artery is open returns him to compressions.", outcome: { reveal: ["The team holds off: flow is his only perfusion until the artery is open."] } },
          { label: "Systemic fibrinolysis", points: -10, correct: false, why: "Lysis is a poor choice after prolonged CPR and with cannulas in: bleeding risk is high and PCI is available.", outcome: { reveal: ["The team declines: bleeding risk after CPR and cannulation is too high."] } },
          { label: "More shocks and a second amiodarone bolus", points: -5, correct: false, why: "Drugs and shocks do not fix an electrical storm that comes from ischemia.", outcome: { reveal: ["VF persists."] } },
        ],
      },
    },
    // The storm: transient ROSC, then VF again until the artery is open
    {
      id: "storm", requires: ["labArrested"], repeatAfterS: STORM_EVERY_S,
      when: (p) => p.rhythmClass === "perfusing" && p.arrest === "rosc" && !p.pci, forS: STORM_S,
      outcome: { patch: VF, reveal: ["VF resumes."] },
    },
    // PCI done: the storm ends
    {
      id: "reperfused", when: (p) => p.pci,
      outcome: { patch: SINUS, flags: ["reperfused"], reveal: ["Flow is restored in the LAD. VF and VT stop immediately. The ventricle is stunned and he stays support-dependent."] },
    },

    // ---- Decision 4: after reperfusion, once the recovery has played
    {
      id: "after", requires: ["reperfused"], when: () => true, forS: RECOVERY_DWELL_S,
      prompt: {
        text: "VF has stopped with PCI, but the ventricle is stunned (ejection fraction very low) and he is support-dependent. What are your next steps?",
        options: [
          { label: "Decannulate now that the rhythm is back", points: -10, correct: false, why: "The myocardium is stunned and he is support-dependent. Taking support away now risks a return to shock.", outcome: { end: "fail", reveal: ["The patient decompensates after decannulation."] } },
          { label: "Keep ECMO and Impella, admit to the cardiac ICU, and wean by echo and pressor needs", points: 20, correct: true, why: "ECMO and Impella stay until the ventricle recovers. The ICU team watches for the complications of support: bleeding, limb ischemia, abdominal compartment syndrome.", outcome: { end: "success", reveal: ["Admitted to the CTICU on ECMO and Impella, with a plan to wean."] } },
          { label: "Send the patient to the ward on support", points: -15, correct: false, why: "A patient on mechanical support belongs in a cardiac ICU.", outcome: { end: "fail", reveal: ["The patient is not safe for the ward."] } },
        ],
      },
    },
  ],
};
