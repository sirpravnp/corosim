import type { CaseDef } from "./engine";

/** A left main occlusion in cardiogenic shock: the pressure first, then the vessel with mechanical support, and no reflex vasodilator, fluid or beta blocker. */
const IMPELLA = { devices: { impella: { level: 6 } } };

export const LM_SHOCK: CaseDef = {
  id: "lm-shock",
  title: "Cold and wet",
  tier: "hard",
  blurb: "Chest pain, then breathlessness, in a woman whose pressure is falling.",
  card: {
    presents: "72-year-old woman with three hours of chest pain, now breathless and clammy with mottled skin. Heart rate 112, BP 77/64, crackles to the mid-lung fields.",
    pmh: "Hypertension, type 2 diabetes, stage 3 kidney disease. Takes metoprolol, amlodipine and metformin. No allergies.",
    info: ["The ECG shows ST elevation in aVR with widespread ST depression.", "A bedside echo shows a very poorly contracting left ventricle, ejection fraction about 15%."],
  },
  start: { lesions: [{ artery: "LM", occluded: true }], devices: { impella: { model: "CP", level: 0 } }, seed: 3 },
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 900,
  musts: [
    { flag: "supported", label: "restore the pressure with a vasopressor" },
    { flag: "vented", label: "support and unload the left ventricle (Impella)" },
    { flag: "pciOrdered", label: "take her for emergent PCI of the left main" },
  ],
  checkpoints: [
    {
      id: "shock", atS: 5, forbids: ["supported"], repeatAfterS: 40,
      prompt: {
        text: "She is cool, mottled and wet, with a pressure of 77/64 and an ejection fraction near 15%. What do you start?",
        options: [
          { label: "Norepinephrine for the pressure, with dobutamine for the output", points: 15, correct: true, why: "In cardiogenic shock the pressure comes first, because coronary and organ perfusion depend on it, and norepinephrine is the usual pressor. A vasoconstrictor alone costs some output in a failing ventricle, so dobutamine is added to support it.", outcome: { flags: ["supported", "norepi"], patch: { support: { norepinephrine: 0.5, dobutamine: 0.3 } }, reveal: ["Norepinephrine and a low dose of dobutamine are running. The pressure and the output come up."] } },
          { label: "Dobutamine alone", points: 5, correct: false, why: "Dobutamine lifts the output, but it vasodilates at higher doses and with a systolic in the 70s it should not be the only agent. It is paired with a pressor.", outcome: { flags: ["supported"], patch: { support: { dobutamine: 0.5 } }, reveal: ["The output improves a little. The pressure is still marginal."] } },
          { label: "A large fluid bolus for the low pressure", points: -10, correct: false, why: "She is already wet. Volume into a failing ventricle goes to the lungs.", outcome: { patch: { support: { fluids: 1.5 } }, reveal: ["The crackles climb and her oxygenation worsens."] } },
          { label: "IV nitroglycerin for the pulmonary edema", points: -15, correct: false, why: "Nitrates drop an already low pressure. In shock, edema is treated by restoring pressure and unloading the ventricle, not by vasodilating.", outcome: { patch: { support: { nitroglycerin: 0.5 } }, reveal: ["Her pressure falls further."] } },
        ],
      },
    },
    {
      id: "strategy", requires: ["supported"], forbids: ["pciOrdered"], when: (p) => p.map >= 50, forS: 10, repeatAfterS: 60,
      prompt: {
        text: "On a pressor her pressure is in the 70s, but she is still cold, her lactate is high and the left main is occluded. What is the plan?",
        options: [
          { label: "Emergent PCI with an Impella to support and unload the left ventricle", points: 25, correct: true, why: "A left main in shock needs reperfusion and a ventricle that is supported while it is stunned. The Impella raises output and takes the load off the left ventricle.", outcome: { flags: ["pciOrdered", "vented"], order: "pci", patch: IMPELLA, reveal: ["Left main occlusion on the angiogram. The Impella is in and PCI is under way."] } },
          { label: "Emergent PCI alone", points: 10, correct: false, why: "Reperfusion is right but she may not tolerate the procedure without support: a stunned ventricle in shock often needs a device.", outcome: { flags: ["pciOrdered"], order: "pci", reveal: ["Left main occlusion on the angiogram. PCI is under way."] } },
          { label: "Emergency bypass surgery", points: -5, correct: false, why: "Surgery takes hours to set up. In shock with an occluded left main, PCI is faster.", outcome: { reveal: ["The OR will be ready in four hours."] } },
          { label: "Medical therapy and see how she does", points: -20, correct: false, why: "A shock from an occluded left main does not recover without reperfusion.", outcome: { reveal: ["She is worse."] } },
        ],
      },
    },
    // PCI alone: she does not tolerate it
    {
      id: "tolerate", branch: true, requires: ["pciOrdered"], forbids: ["vented"], when: (p) => p.pciPending, forS: 8,
      prompt: {
        text: "During the procedure her pressure falls and the ventricle barely moves. What do you add?",
        options: [
          { label: "An Impella", points: 10, correct: true, why: "Mechanical support is what lets a stunned ventricle ride out the reperfusion.", outcome: { flags: ["vented"], patch: IMPELLA, reveal: ["The Impella is placed and her pressure stabilizes."] } },
          { label: "More fluid", points: -10, correct: false, why: "Fluid will not make a failing ventricle eject.", outcome: { reveal: ["Her lungs worsen."] } },
        ],
      },
    },
    { id: "reperfused", when: (p) => p.pci, outcome: { flags: ["reperfused"], reveal: ["The left main is open. Her pressure is better but she still needs support."] } },
    {
      id: "after", requires: ["reperfused"],
      prompt: {
        text: "The left main is open. What do you do about the support?",
        options: [
          { label: "Keep the Impella and pressor, admit to the cardiac ICU, and wean by echo and pressor needs", points: 20, correct: true, why: "Stunned myocardium recovers over days. Support is withdrawn as the echo and the pressor requirements improve.", outcome: { end: "success", reveal: ["Admitted to the CICU on the Impella and a low dose of norepinephrine."] } },
          { label: "Remove the Impella and stop the pressor now that the artery is open", points: -15, correct: false, why: "The ventricle is stunned, not recovered. Taking support away now risks a return to shock.", outcome: { end: "fail", reveal: ["She goes back into shock within the hour."] } },
        ],
      },
    },
  ],
};
