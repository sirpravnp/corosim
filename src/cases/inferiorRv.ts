import type { CaseDef } from "./engine";

/**
 * Inferior STEMI from a proximal RCA occlusion: the right ventricle is infarcted and the AV node is dead. The pressure is held up by the
 * filling of a right ventricle that cannot pump on its own, so a nitrate takes it away and fluid gives it back; the rate is complete heart
 * block, which atropine does not touch and a pacer does.
 */
export const INFERIOR_RV: CaseDef = {
  id: "inferior-rv",
  title: "Slow and low",
  tier: "medium",
  blurb: "Chest pressure, a heart rate in the 40s and a falling blood pressure.",
  card: {
    presents: "64-year-old man with two hours of crushing chest pressure, nausea and sweating. He nearly fainted getting out of the car. Heart rate 42, BP 88/48, clear lungs, distended neck veins.",
    pmh: "Hypertension, type 2 diabetes, 30 pack-year smoker. Takes lisinopril and metformin. No allergies.",
    info: ["Pain 8/10; he is asking for something for it.", "The ECG shows ST elevation in II, III and aVF."],
  },
  start: { lesions: [{ artery: "RCA", occluded: true, position: 0.1 }], seed: 3 },
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 900,
  musts: [
    { flag: "fluids", label: "support the right ventricle's preload with fluid" },
    { flag: "paced", label: "pace the complete heart block" },
    { flag: "pciOrdered", label: "take him for primary PCI" },
  ],
  checkpoints: [
    {
      id: "first", atS: 5, forbids: ["fluids"], repeatAfterS: 45,
      prompt: {
        text: "Inferior ST elevation, a heart rate of 42, BP 88/48 and distended neck veins with clear lungs. He wants something for the pain. What do you do first?",
        options: [
          { label: "Sublingual nitroglycerin for the chest pain", points: -10, correct: false, why: "An infarcted right ventricle depends on its filling pressure. A nitrate lowers the preload it needs and the pressure drops, sometimes to shock.", outcome: { flags: ["nitroGiven"], patch: { support: { nitroglycerin: 0.6 } }, reveal: ["The nitroglycerin is in. His pressure starts to fall."] } },
          { label: "A fluid bolus; hold nitrates", points: 15, correct: true, why: "Low pressure, clear lungs and distended neck veins are a right-ventricular infarct: it needs volume, not vasodilators.", outcome: { flags: ["fluids"], patch: { support: { fluids: 1 } }, reveal: ["A right-sided ECG shows ST elevation in V4R: the right ventricle is infarcted.", "A litre of saline is running in."] } },
          { label: "Atropine for the slow heart rate", points: 2, correct: false, why: "Atropine works on vagal tone. With the AV-node artery occluded the block is in the node itself, and it does little.", outcome: { patch: { drugs: { atropine: 1 } }, reveal: ["Atropine is in. The rate does not change."] } },
        ],
      },
    },
    // Nitrate given: the crash
    {
      id: "crash", branch: true, requires: ["nitroGiven"], forbids: ["crashHandled"], when: (p) => p.map < 62, forS: 4, repeatAfterS: 45,
      prompt: {
        text: "After the nitroglycerin his pressure has dropped sharply and he is grey. How do you recover him?",
        options: [
          { label: "Stop the nitrate and give a fluid bolus", points: 10, correct: true, why: "Take away what caused it and refill the right ventricle.", outcome: { flags: ["fluids", "crashHandled"], patch: { support: { nitroglycerin: 0, fluids: 1 } }, reveal: ["The pressure comes back up as the fluid goes in."] } },
          { label: "Norepinephrine alone", points: 3, correct: false, why: "A pressor raises the number but leaves a right ventricle that is still under-filled. Fluid first.", outcome: { flags: ["fluids", "crashHandled"], patch: { support: { nitroglycerin: 0, norepinephrine: 0.5 } }, reveal: ["The pressure comes up on norepinephrine."] } },
          { label: "Wait for the nitroglycerin to wear off", points: -5, correct: false, why: "Waiting with a pressure this low in an infarcted right ventricle risks arrest.", outcome: { reveal: ["He is no better."] } },
        ],
      },
    },
    // Complete heart block
    {
      id: "block", requires: ["fluids"], forbids: ["paced"], when: (p) => p.hr < 55, forS: 10, repeatAfterS: 60,
      prompt: {
        text: "The fluid has helped the pressure, but his heart rate is still 42 and the ECG shows complete heart block. What now?",
        options: [
          { label: "Pace him (transcutaneous, then a transvenous wire)", points: 15, correct: true, why: "Complete heart block from an infarcted AV node does not respond to atropine. Pacing restores the rate, and the rate is what the right ventricle needs.", outcome: { flags: ["paced"], patch: { support: { pacing: true, paceRate: 70 } }, reveal: ["Pacing at 70. His pressure improves with the rate."] } },
          { label: "More atropine", points: -3, correct: false, why: "The block is in the node. Atropine cannot fix it.", outcome: { patch: { drugs: { atropine: 1 } }, reveal: ["No response."] } },
        ],
      },
    },
    // Definitive therapy
    {
      id: "cath", requires: ["fluids"], forbids: ["pciOrdered"], when: (p) => p.map >= 60, forS: 10, repeatAfterS: 60,
      prompt: {
        text: "He is holding a pressure. ST elevation with a right-ventricular infarct and heart block. What is the definitive treatment?",
        options: [
          { label: "Primary PCI of the right coronary artery", points: 20, correct: true, why: "An occluded artery is the cause of all of it. Opening it is what restores conduction and right-ventricular function.", outcome: { flags: ["pciOrdered"], order: "pci", reveal: ["Proximal RCA occlusion on the angiogram. PCI is under way."] } },
          { label: "Fibrinolytic and transfer later", points: 4, correct: false, why: "Lysis is for when PCI cannot be done in time. The cath lab is available, and PCI works better, particularly in shock.", outcome: { reveal: ["The cath lab is free in 20 minutes."] } },
          { label: "Medical therapy only", points: -15, correct: false, why: "Without reperfusion the infarct and the block stay.", outcome: { reveal: ["Nothing changes."] } },
        ],
      },
    },
    { id: "reperfused", when: (p) => p.pci, outcome: { flags: ["reperfused"], reveal: ["Flow is restored in the right coronary artery. Conduction often recovers over hours to days."] } },
    {
      id: "after", requires: ["reperfused"],
      prompt: {
        text: "The artery is open. What is the safest place for him now?",
        options: [
          { label: "The coronary care unit, with a pacing wire in place", points: 15, correct: true, why: "AV block and right-ventricular dysfunction can persist or recur for days after reperfusion: he needs monitoring and a pacer ready.", outcome: { end: "success", reveal: ["Admitted to the CCU with a temporary pacing wire."] } },
          { label: "A ward bed on telemetry", points: -5, correct: false, why: "Heart block after an inferior infarct can return without warning.", outcome: { end: "fail", reveal: ["He drops his rate overnight with no pacer available."] } },
        ],
      },
    },
  ],
};
