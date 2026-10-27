import type { CaseDef } from "./engine";

/** The straightforward one: an anterior STEMI in a patient who is holding his pressure. Time to reperfusion is the lesson; the traps are delay and an early beta blocker. */
export const ANTERIOR_STEMI: CaseDef = {
  id: "anterior-stemi",
  title: "Pressure in the chest",
  tier: "easy",
  blurb: "An anterior STEMI in a man who is still holding his pressure.",
  card: {
    presents: "55-year-old man with 90 minutes of substernal pressure spreading to the jaw, sweating and nausea. Heart rate 102, BP 98/77, lungs clear.",
    pmh: "Current smoker, high cholesterol, father had a heart attack at 52. No regular medicines. No allergies.",
    info: ["The ECG shows ST elevation in V1 to V4."],
  },
  start: { lesions: [{ artery: "LAD", occluded: true, position: 0.1 }], seed: 3 },
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 900,
  musts: [{ flag: "pciOrdered", label: "activate the cath lab for primary PCI" }],
  checkpoints: [
    {
      id: "plan", atS: 5, forbids: ["pciOrdered"], repeatAfterS: 40,
      prompt: {
        text: "Anterior ST elevation and 90 minutes of pain. What is your plan?",
        options: [
          { label: "Aspirin and heparin, and activate the cath lab now", points: 20, correct: true, why: "An occluded artery means muscle dies by the minute. Antiplatelet and anticoagulant therapy start at once and the cath lab is called without waiting for any blood test.", outcome: { flags: ["pciOrdered"], order: "pci", reveal: ["The cath lab is activated. Proximal LAD occlusion on the angiogram; PCI is under way."] } },
          { label: "Send a troponin and repeat the ECG in an hour", points: -15, correct: false, why: "A STEMI is a clinical and ECG diagnosis. Waiting for a troponin costs myocardium.", outcome: { reveal: ["An hour is a long time. The ST elevation is more marked and the pain is no better."] } },
          { label: "Admit to telemetry and consider a CT for pulmonary embolism", points: -10, correct: false, why: "The ECG already shows the diagnosis. Chasing another cause delays reperfusion.", outcome: { reveal: ["The pain continues."] } },
        ],
      },
    },
    {
      id: "pain", requires: ["pciOrdered"], forbids: ["painDone"], atS: 20,
      prompt: {
        text: "While he waits for the lab, his pain is 8/10, BP 98/77, heart rate 102. What do you give?",
        options: [
          { label: "Titrated IV nitroglycerin, stopping if his systolic falls under 90", points: 10, correct: true, why: "Nitrates relieve ischemic pain and preload. They are safe with a pressure like his, with a limit set.", outcome: { flags: ["painDone"], patch: { support: { nitroglycerin: 0.25 } }, reveal: ["The pain eases a little on the nitroglycerin."] } },
          { label: "IV metoprolol now, to slow his heart", points: -10, correct: false, why: "Beta blockers are held early in a large anterior infarct with a failing ventricle: they can precipitate heart failure and shock. Start them once he is stable.", outcome: { flags: ["painDone"], patch: { drugs: { betaBlocker: 0.6 } }, reveal: ["His heart rate comes down, but his pressure and output are worse."] } },
          { label: "Oxygen only", points: 2, correct: false, why: "He is not hypoxic, and oxygen alone does nothing for the ischemia.", outcome: { flags: ["painDone"], reveal: ["No change."] } },
        ],
      },
    },
    { id: "reperfused", when: (p) => p.pci, outcome: { flags: ["reperfused"], reveal: ["The artery is open and the ST elevation is resolving."] } },
    {
      id: "after", requires: ["reperfused"],
      prompt: {
        text: "The LAD is open. Which plan do you start on the way to the unit?",
        options: [
          { label: "Dual antiplatelet therapy, a high-intensity statin, an echocardiogram, and a beta blocker and ACE inhibitor once he is stable", points: 15, correct: true, why: "The core of secondary prevention after a STEMI starts now; the echo defines his ejection fraction and guides the rest.", outcome: { end: "success", reveal: ["Admitted to the coronary care unit."] } },
          { label: "Aspirin only, and a stress test next week", points: -10, correct: false, why: "A stent needs dual antiplatelet therapy, and a stress test is not needed after a STEMI treated with PCI.", outcome: { end: "fail", reveal: ["The stent thromboses a few days later."] } },
        ],
      },
    },
  ],
};
