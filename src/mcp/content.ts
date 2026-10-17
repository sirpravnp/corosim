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
  build_patient: {
    description: "Turn a free-text clinical case into a CoroSim scenario and explain what happens.",
    text: "Read corosim_get_schema, then translate the case below into a Scenario and call corosim_set_scenario. Read the returned warnings. Then call corosim_explain and tell me, in plain language and quoting the numbers it returned, what the patient's hemodynamics are and why. State which parts of the case the model cannot represent.\n\nCase: {{case}}",
  },
  baroreflex_demo: {
    description: "A short guided experiment showing the baroreflex: vasopressor bolus with and without the reflex.",
    text: "Use corosim_compare with three scenarios on the same seed: (1) baseline, (2) vasopressor 0.8, (3) vasopressor 0.8 with autonomic.baroreflexGain 0. Then explain, using the returned deltas, why heart rate falls in (2) but not (3) and why mean pressure rises further in (3). Finish with one question for the learner.",
  },
  hemorrhage_ladder: {
    description: "Compare ATLS-class hemorrhage with and without a working baroreflex.",
    text: "Use corosim_compare with bloodLoss 0, 0.15, 0.30 and 0.45. Tabulate heart rate, systolic and diastolic pressure, pulse pressure, stroke volume and MAP. Explain what compensates at each step and which number changes first. Then rerun 0.15 with baroreflexGain 0 and say what the reflex was contributing.",
  },
  explain_current_state: {
    description: "Explain the current simulated patient to a learner.",
    text: "Call corosim_explain and corosim_get_state. Explain the patient's hemodynamics to a {{level}} using only what the model returned. Separate what the model computed from general physiology you add.",
  },
};
