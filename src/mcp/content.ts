import { AUTONOMIC } from "../physics/autonomic";

export const MODEL_CARD = `# CoroSim model card

**Purpose:** teaching. Show how a coronary lesion, volume status, drugs and the autonomic nervous system combine to set beat-to-beat heart rate, blood pressure and rhythm. It is not a substitute for SimVascular, CRIMSON or any image-based solver, and it must not inform clinical decisions.

## What is simulated
- Coronary tree (9 anatomic variants), Poiseuille + expansion-loss stenosis model, autoregulation, flow reserve, FFR.
- Per-bed ischemia (about 20 s to develop, tau about 8 s to recover) → ECG injury currents, sympathetic/vagal reflexes, SA/AV-node ischemia (first/second/third-degree block), ectopy.
- Every ventricular beat: Frank–Starling filling from its own R–R interval, atrial kick, PVC weakness, post-extrasystolic potentiation, two-element Windkessel pressure stepped beat to beat.
- Closed-loop autonomic control: baroreceptor logistic on sensed pressure (diastolic + 1/3 pulse); vagal arm (~${AUTONOMIC.vagalDelay + 0.5} s latency, tau ${AUTONOMIC.vagalTau} s) and sympathetic arm (~${AUTONOMIC.sympatheticDelay + 0.5} s latency, tau ${AUTONOMIC.sympatheticTau} s, vascular tau ${AUTONOMIC.vascularTau} s) act on heart rate, contractility, resistance and venous tone.
- Respiration (default ${AUTONOMIC.respRate}/min) gates vagal tone (respiratory sinus arrhythmia) and swings stroke volume.
- Physiological noise: Ornstein–Uhlenbeck fluctuations in sympathetic, vagal and vascular tone, beat-to-beat contractility noise, sinus-node jitter. Seeded and reproducible.
- CNS ischemic response below ~${AUTONOMIC.cnsOnset} mmHg and a cardiopulmonary volume reflex.

## Not simulated
Ventricular pressure–volume mechanics, valves, the right heart as a separate pump, 3D flow, wall mechanics, coronary flow phasicity, hormones (RAAS, ADH), renal volume control, long-term remodeling, sedation/anesthesia, pain.

## Calibration
Constants are teaching assumptions tuned so that a resting adult is 72 bpm, stroke volume 70 ml, 120/72 mmHg, SDNN about 50 ms, RMSSD about 50 ms, and so hemorrhage follows ATLS classes qualitatively (tachycardia, narrowing pulse pressure, then hypotension). They are not fitted to patient data. The Mayer-wave resonance is about 0.13 Hz in the model (about 0.1 Hz in people).

## Reading the numbers
- Baroreflex sensitivity by the sequence method is inflated by respiratory coupling (RSA drives pressure as well as the reverse). \`autonomic.baroreflexGainMsPerMmHg\` in the state is the model's own vagal gain.
- LF/HF depends on breathing rate; it is not a clean index of sympathovagal balance in the model, as in people.
- Instantaneous heart rate around a PVC is not a rate; use mean values.
`;

export const PROMPTS: Record<string, { description: string; text: string }> = {
  rounds: {
    description: "Teach on the current patient like attending rounds: present, ask, act on the learner's plan, debrief, repeat.",
    text: "Run a teaching round on my CoroSim patient. Call corosim_get_state. Present the patient as on rounds, without the diagnosis: one-line summary, vitals, rhythm, 12-lead ST findings by lead, and how the patient looks (stable, compensated, shocked). Then stop and ask me: what is going on, which artery, and what would you do first? When I answer, tell me briefly what I got right and what I missed, then carry out my plan with corosim_adjust or corosim_treat and show what changed (before → after numbers). Compare my plan with assessment.guidelineNextSteps and say why the guidelines order things that way. Give two or three teaching points, then advance the case with corosim_run (5–20 s) and start the next round. Keep each turn short. Learner level: {{level}}",
  },
  build_patient: {
    description: "Turn a free-text clinical case into a CoroSim patient and present it for teaching.",
    text: "Read corosim_get_schema, translate the case below into a Scenario (pick reasonable values for anything unstated and say what you picked in one line), and call corosim_set_scenario. Then present the patient as on rounds: one-line summary, vitals, rhythm, 12-lead ST findings, and the main problem from the assessment. Ask me what I think is happening and what I would do next; do not lecture yet. Mention a model limit only if it changes the case, in one sentence.\n\nCase: {{case}}",
  },
  manage: {
    description: "Manage the current patient to the guidelines, step by step, showing the effect of each step.",
    text: "Call corosim_get_state and take the patient through assessment.guidelineNextSteps in order. For each step: say what you are doing and why in one line, do it (corosim_adjust for support, corosim_treat for reperfusion), and show the vitals, ECG and infarct size before and after. Stop when the assessment says the patient is stable. End with a short summary of the muscle saved or lost and what made the difference.",
  },
  baroreflex_demo: {
    description: "A short experiment showing the baroreflex: vasopressor with and without the reflex.",
    text: "Use corosim_compare with three scenarios on the same seed: (1) baseline, (2) vasopressor 0.8, (3) vasopressor 0.8 with autonomic.baroreflexGain 0. Explain from the deltas why heart rate falls in (2) but not (3) and why mean pressure rises further in (3). Finish with one question for the learner.",
  },
  hemorrhage_ladder: {
    description: "Compare hemorrhage classes, and what the reflexes contribute.",
    text: "Use corosim_compare with bloodLoss 0, 0.15, 0.30 and 0.45. Tabulate heart rate, systolic and diastolic pressure, pulse pressure, stroke volume and MAP. Explain what compensates at each step and which number changes first. Then rerun 0.15 with autonomic.baroreflexGain 0 and say what the reflex was contributing.",
  },
  explain_current_state: {
    description: "Explain the current patient to a learner.",
    text: "Call corosim_get_state and corosim_explain. Explain the patient to a {{level}}: the clinical picture first (vitals, ECG, the problem), then the mechanism, then what should happen next and why. Be concise.",
  },
};
