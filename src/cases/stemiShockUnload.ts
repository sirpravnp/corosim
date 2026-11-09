import { compileCase, type CaseSpec } from "./spec";

/** Anterior STEMI in shock with a very wet ventricle. The lesson: unload with a CoroPump before and during PCI; a diuretic or a nitrate is the wrong tool in shock. */
const PUMP = { devices: { coroPump: { level: 6 } } };

export const STEMI_SHOCK_UNLOAD_SPEC: CaseSpec = {
  id: "stemi-shock-unload",
  title: "Wet and cold",
  tier: "medium",
  complaint: "Chest pain",
  devices: ["CoroPump"],
  blurb: "An anterior infarct, a falling pressure and a lung full of fluid.",
  card: {
    presents: "59-year-old woman with two hours of crushing chest pain, now breathless and gray. ST elevation in V1 to V5. Heart rate 108, BP 82/58, crackles to the mid-lung fields.",
    pmh: "Hypertension, smoker. No known coronary disease. No allergies.",
    info: ["The cath lab is ready. The right heart catheter reads a wedge pressure in the high 20s."],
  },
  start: { lesions: [{ artery: "LAD", occluded: true, position: 0.15 }], heart: { lvEes: 0.35, lvStiffness: 1.6 }, devices: { coroPump: { model: "CP", level: 0 } }, seed: 11 },
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 600,
  monitor: ["hr", "bp", "rhc"],
  musts: [
    { flag: "unloaded", label: "unload the left ventricle with the CoroPump" },
    { flag: "pciOrdered", label: "reperfuse the LAD with the pump running" },
  ],
  checkpoints: [
    {
      id: "first", atS: 5, forbids: ["unloaded"], repeatAfterS: 40,
      prompt: {
        text: "She is wet, cool and her pressure is falling. The wedge pressure is high. What is the first thing you do?",
        options: [
          { label: "Place a CoroPump to unload the ventricle, then go to PCI", points: 25, correct: true, why: "The ventricle is flooded and stunned. A pump takes blood out of it and pushes it forward, so the wedge pressure drops and the lungs clear while the artery is opened.", outcome: { flags: ["unloaded"], patch: PUMP, reveal: ["The CoroPump is placed and running at P6. The wedge pressure falls."] } },
          { label: "Go to PCI at once and see how she does", points: 5, correct: false, why: "Opening the artery is right, but a stunned ventricle in shock often does not tolerate the procedure unsupported.", outcome: { flags: ["pciOrdered"], order: "pci", reveal: ["Left anterior descending occlusion on the angiogram. PCI is under way."] } },
          { label: "Give IV furosemide for the lungs", points: -10, correct: false, why: "A diuretic does not fix a failing ventricle, and in shock it costs volume that the pressure still depends on.", outcome: { patch: { support: { furosemide: 0.5 } }, reveal: ["She passes urine, and her pressure drifts lower."] } },
          { label: "Start IV nitroglycerin to lower the wedge", points: -15, correct: false, why: "Nitrates lower the filling pressure by dilating veins and arteries, and in shock they drop an already low pressure.", outcome: { patch: { support: { nitroglycerin: 0.5 } }, reveal: ["Her pressure falls further."] } },
        ],
      },
    },
    {
      id: "reperfuse", requires: ["unloaded"], forbids: ["pciOrdered"], atS: 40, repeatAfterS: 40,
      prompt: {
        text: "With the pump running, her wedge pressure is lower and her pressure is steadier. The LAD is still occluded. What now?",
        options: [
          { label: "Primary PCI of the LAD with the pump running", points: 25, correct: true, why: "Reperfusion is the definitive treatment and the pump protects her during it. Lowering the wedge first also gives the myocardium a chance to recover.", outcome: { flags: ["pciOrdered"], order: "pci", reveal: ["Proximal LAD occlusion on the angiogram. PCI is under way."] } },
          { label: "Wait until she is fully stable before the cath lab", points: -20, correct: false, why: "The occluded artery is the cause. Every minute of delay costs myocardium, and support is a bridge to reperfusion, not a replacement.", outcome: { reveal: ["The infarct keeps extending."] } },
        ],
      },
    },
    { id: "open", requires: ["pciOrdered"], when: [{ is: "pci" }], outcome: { end: "success", reveal: ["The LAD is open. She goes to the cardiac ICU on the CoroPump."] } },
  ],
};
export const STEMI_SHOCK_UNLOAD = compileCase(STEMI_SHOCK_UNLOAD_SPEC);
