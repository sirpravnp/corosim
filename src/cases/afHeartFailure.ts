import type { CaseDef } from "./engine";

/**
 * Fast AF in a patient whose ventricle is already failing and congested. The usual rate-control drugs are the trap here: diltiazem weakens an
 * ejection fraction that is already poor and a beta blocker is risky in decompensated failure. The route is a synchronized cardioversion.
 */
const SHOCK = {
  joules: 120, sync: true,
  onSuccess: { flags: ["converted"], reveal: ["The shock converts him to sinus rhythm at 82. He is breathing a little easier."] },
  onFail: { reveal: ["No conversion; he is still in AF."] },
};
const STOP_DILT = { support: { diltiazem: 0 } };

export const AF_HF: CaseDef = {
  id: "af-hf",
  title: "Short of breath and racing",
  tier: "medium",
  blurb: "Fast AF in a man whose weak heart is already failing.",
  card: {
    presents: "66-year-old man with five days of worsening breathlessness, needing to sleep upright, with swollen legs and a racing, irregular heartbeat. He is using his neck muscles to breathe. Heart rate 158, BP 83/69, crackles to the mid-chest.",
    pmh: "Ischemic cardiomyopathy, ejection fraction about 25%. Takes carvedilol, lisinopril and furosemide but has run out of his medicines for a week. No allergies.",
    info: ["The ECG shows atrial fibrillation with a rapid ventricular response and old Q waves.", "A bedside echo shows a dilated, poorly contracting left ventricle."],
  },
  start: { patient: { rhythm: "af-rvr" }, heart: { lvEes: 0.2 }, fluids: { given: [{ kind: "crystalloid", ml: 1000 }] }, seed: 7 },
  stable: (p) => p.map >= 60 && p.arrest === "none",
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 600,
  musts: [
    { flag: "converted", label: "cardiovert: fast AF is what is making a failing ventricle decompensate" },
    { flag: "anticoag", label: "anticoagulate after cardioversion" },
  ],
  checkpoints: [
    {
      id: "first", atS: 5, forbids: ["converted"], repeatAfterS: 30,
      prompt: {
        text: "He is in fast AF with a weak ventricle, a low pressure and pulmonary edema. What is your first step?",
        options: [
          { label: "Synchronized cardioversion", points: 25, correct: true, why: "AF with a rapid rate is what is driving this failing ventricle to decompensate. When AF with a fast rate causes hypotension and pulmonary edema, synchronized cardioversion is the treatment, without waiting for anticoagulation.", outcome: { shock: SHOCK, reveal: ["He is given a synchronized shock."] } },
          { label: "IV diltiazem to slow the rate", points: -20, correct: false, why: "Diltiazem weakens contraction and dilates arterioles. In a ventricle with an ejection fraction of 25% and a low pressure it can drop the output and the pressure sharply. It is avoided in systolic heart failure.", outcome: { flags: ["dilt"], patch: { support: { diltiazem: 0.6 } }, reveal: ["Diltiazem is running. His rate falls but his pressure falls with it."] } },
          { label: "IV metoprolol to slow the rate", points: -12, correct: false, why: "A beta blocker in decompensated heart failure with a low pressure risks cardiogenic shock. The rate is a driver of the failure here, not just a number.", outcome: { patch: { drugs: { betaBlocker: 0.6 } }, reveal: ["Metoprolol is in. The rate comes down a little; he looks worse."] } },
          { label: "IV furosemide for the congestion, and treat the rate later", points: 3, correct: false, why: "A diuretic treats the lungs, but leaves the cause: a ventricular rate that the weak heart cannot tolerate.", outcome: { patch: { support: { furosemide: 0.6 } }, reveal: ["Furosemide is given. He passes urine but is still racing."] } },
        ],
      },
    },
    // Diltiazem given: the pressure falls
    {
      id: "crash", branch: true, requires: ["dilt"], forbids: ["crashHandled", "converted"], when: (p) => p.map < 70, forS: 4, repeatAfterS: 40,
      prompt: {
        text: "After the diltiazem his pressure is falling and he is cooler. What do you do?",
        options: [
          { label: "Stop the diltiazem and cardiovert", points: 10, correct: true, why: "Take away the drug that is weakening the ventricle and treat the rhythm that is driving the failure.", outcome: { flags: ["crashHandled"], patch: STOP_DILT, shock: SHOCK, reveal: ["The diltiazem is stopped and he is given a synchronized shock."] } },
          { label: "Start norepinephrine to hold the pressure", points: 2, correct: false, why: "A pressor props the pressure but does not remove the diltiazem or treat the rhythm.", outcome: { flags: ["crashHandled"], patch: { support: { norepinephrine: 0.5 } }, reveal: ["Norepinephrine is running. His pressure improves."] } },
          { label: "Give more diltiazem to control the rate", points: -10, correct: false, why: "More of the drug that is lowering his output.", outcome: { patch: { support: { diltiazem: 1 } }, reveal: ["His pressure falls further."] } },
        ],
      },
    },
    // After conversion
    {
      id: "after", requires: ["converted"], forbids: ["anticoag"],
      prompt: {
        text: "He is back in sinus rhythm and breathing more easily. What next?",
        options: [
          { label: "Anticoagulate, restart his heart-failure medicines, look for the trigger (the missed medicines), and admit him", points: 20, correct: true, why: "After cardioversion the atria are stunned and clot can form, so he is anticoagulated for at least four weeks and, with his risk, probably longer. His heart-failure therapy has to be restarted, and he needs admission while he is decongested.", outcome: { flags: ["anticoag"], end: "success", reveal: ["Admitted with an anticoagulant started and his heart-failure medicines restarted."] } },
          { label: "Discharge him: he converted and feels better", points: -15, correct: false, why: "His heart failure is still decompensated, and he has just been cardioverted without anticoagulation.", outcome: { end: "fail", reveal: ["He is back in AF within days and has a stroke."] } },
        ],
      },
    },
  ],
};
