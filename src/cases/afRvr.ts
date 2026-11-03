import type { CaseDef } from "./engine";

/**
 * Atrial fibrillation with a rapid ventricular response in a stable patient whose AF began three days ago: rate control first, then the question
 * that matters, which is clotting. Cardioverting AF of more than 48 hours without anticoagulation (or an echo to exclude clot) risks a stroke.
 */
const SHOCK = { joules: 120, sync: true, onSuccess: { flags: ["converted", "cvUnsafe"], reveal: ["The shock converts her to sinus rhythm at 78."] }, onFail: { reveal: ["The shock does not convert her; she is still in AF."] } };

export const AF_RVR: CaseDef = {
  id: "af-rvr",
  title: "Racing heart",
  tier: "easy",
  blurb: "Palpitations for three days and a fast, irregular pulse in a woman who feels otherwise well.",
  card: {
    presents: "71-year-old woman with three days of palpitations and tiredness. She is comfortable, breathing easily, and talking in full sentences. Irregularly irregular pulse at 146, BP 98/76, oxygen saturation 97%.",
    pmh: "Hypertension. Takes amlodipine. No heart failure, no prior stroke, no bleeding problems. No allergies.",
    info: ["The ECG shows atrial fibrillation with a narrow QRS and no ST changes.", "A bedside echo shows a normal ejection fraction."],
  },
  start: { patient: { rhythm: "af-rvr" }, seed: 7 },
  stable: (p) => p.map >= 60 && p.hr < 130 && p.arrest === "none",
  points: { survive: 30, stable: 25, harm: 20 },
  limitS: 600,
  musts: [
    { flag: "rateControl", label: "control the rate of a stable patient first" },
    { flag: "anticoag", label: "anticoagulate before any cardioversion of AF of more than 48 hours" },
  ],
  checkpoints: [
    {
      id: "first", atS: 5, forbids: ["rateControl", "converted"], repeatAfterS: 45,
      prompt: {
        text: "She is in fast AF, comfortable, with a normal blood pressure. What is your first step?",
        options: [
          { label: "IV diltiazem to slow the rate", points: 15, correct: true, why: "In a stable patient with a normal ejection fraction, slowing the rate is the first step, and a calcium channel blocker or a beta blocker does it.", outcome: { flags: ["rateControl"], patch: { support: { diltiazem: 0.8 } }, reveal: ["A diltiazem infusion is running. Her rate begins to fall."] } },
          { label: "IV metoprolol to slow the rate", points: 15, correct: true, why: "A beta blocker is an equally good first choice when the ejection fraction is normal and there is no decompensated heart failure.", outcome: { flags: ["rateControl"], patch: { drugs: { betaBlocker: 0.9 } }, reveal: ["Metoprolol is in. Her rate begins to fall."] } },
          { label: "Synchronized cardioversion now", points: -10, correct: false, why: "She is stable, and by her own account the AF has lasted about three days. After 48 hours there may be clot in the left atrial appendage, and cardioverting without anticoagulation risks a stroke.", outcome: { shock: SHOCK, reveal: ["She is given a synchronized shock."] } },
          { label: "An amiodarone bolus to convert her", points: -5, correct: false, why: "Amiodarone can convert AF to sinus rhythm, so it carries the same stroke risk after 48 hours. A stable patient is rate controlled first.", outcome: { reveal: ["Amiodarone is started. Nothing changes in the next few minutes."] } },
        ],
      },
    },
    // Cardioverted without anticoagulation: the consequence
    {
      id: "stroke", branch: true, requires: ["cvUnsafe"], when: () => true, forS: 25,
      outcome: { reveal: ["Two hours later she cannot move her right arm and her speech is slurred: an embolic stroke."], end: "fail" },
    },
    // Rate down: the question that matters
    {
      id: "clot", requires: ["rateControl"], forbids: ["cvUnsafe", "anticoag"], when: (p) => p.hr < 120, forS: 12, repeatAfterS: 40,
      prompt: {
        text: "Her rate has come down and she feels better. She now tells you the palpitations began three days ago. How do you proceed?",
        options: [
          { label: "Start anticoagulation and continue rate control; cardiovert later, after weeks of anticoagulation or an echo to exclude clot", points: 20, correct: true, why: "AF of more than 48 hours, or of unknown duration, needs anticoagulation before cardioversion (three weeks, or a transesophageal echo to exclude clot), and long-term anticoagulation is decided by her stroke risk, which here is raised by her age, sex and hypertension.", outcome: { flags: ["anticoag"], end: "success", reveal: ["She is started on an anticoagulant and kept on rate control. A cardioversion is planned after anticoagulation."] } },
          { label: "Cardiovert her now, while she is rate controlled", points: -15, correct: false, why: "Controlling the rate does not make cardioversion safe. After 48 hours of AF the stroke risk is the issue, not the rate.", outcome: { shock: SHOCK, reveal: ["She is given a synchronized shock."] } },
          { label: "No anticoagulation: she is rate controlled and feels well", points: -20, correct: false, why: "Rate control treats the symptoms. It does nothing for the risk of stroke, which anticoagulation reduces in AF.", outcome: { end: "fail", reveal: ["Two weeks later she has a stroke."] } },
        ],
      },
    },
  ],
};
