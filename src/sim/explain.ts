import { Simulation } from "./simulation";
import { AUTONOMIC } from "../physics/autonomic";
import { CIRC } from "../physics/circulation";

export interface Explanation {
  headline: string;
  vitals: string;
  /** Causal statements derived from the model's own state, not free text: safe for an LLM to build on. */
  mechanisms: string[];
  teachingPoints: string[];
  caveats: string[];
}

/**
 * Turn the current state into grounded facts: what is abnormal, and which part of the model produced it.
 * An LLM asked to explain the patient should quote these, which keeps its explanation tied to what the
 * simulation actually computed rather than to what a typical textbook patient would show.
 */
export function explain(sim: Simulation): Explanation {
  const st = sim.state();
  const m = sim.metrics(Math.min(sim.t, 60));
  const mech: string[] = [], teach: string[] = [];
  const n = sim.n, last = st.lastBeat;
  const map = st.meanArterialPressure, hr = st.rolling10s.hr, sbp = st.rolling10s.sbp, dbp = st.rolling10s.dbp;
  const pulse = sbp - dbp;
  const restTone = { s: AUTONOMIC.restSympathetic, v: AUTONOMIC.restVagal };

  if (n.lesions.length) {
    for (const l of n.lesionSpecs) {
      const f = st.ffr.find((x) => x.artery === l.artery);
      mech.push(`${l.occluded ? "Complete occlusion" : `${Math.round(l.stenosis * 100)}% diameter stenosis`} of ${l.artery}${f && !l.occluded ? ` (FFR ${f.ffr})` : ""}.`);
    }
    if (st.compromisedBeds.length) {
      const top = st.compromisedBeds.slice(0, 3).map((b) => `${b.artery} bed ${b.bed} (ischemia ${b.ischemia}, ${b.massPct}% of myocardium, flow ${b.flowRatio}× demand)`).join("; ");
      mech.push(`Ischemic myocardium: ${top}. About ${Math.round(st.ischemicMassFraction * 100)}% of the myocardium has supply below demand.`);
    } else if (sim.t > 0) mech.push("No bed is ischemic yet: autoregulation is still meeting demand despite the lesion, or ischemia has not had time to develop (it takes about 20 s).");
  }
  if (st.rhythm.avBlock) mech.push(`AV-node artery ischemia has caused ${st.rhythm.label}; the ventricular rate is set by the block, not the sinus node.`);
  if (st.rhythm.pvcSeverity > 0.6) mech.push("Ischemic burden is above the ectopy threshold, so premature ventricular beats occur; each is followed by a compensatory pause and a stronger next beat.");

  if (n.bloodLoss > 0.02) mech.push(`Blood volume is ${Math.round(n.bloodLoss * 100)}% below normal, so filling and stroke volume fall (stroke volume ${st.rolling10s.sv} ml vs ~70 ml normally).`);
  if (n.bloodLoss < -0.02) mech.push(`Blood volume is ${Math.round(-n.bloodLoss * 100)}% above normal, so filling and stroke volume rise.`);
  if (n.drugs.betaBlocker > 0.05) mech.push(`Beta blockade (${Math.round(n.drugs.betaBlocker * 100)}%) removes sympathetic drive to the sinus node and myocardium: slower rate, weaker contraction, and a blunted reflex tachycardia.`);
  if (n.drugs.atropine > 0.05) mech.push(`Vagal blockade (${Math.round(n.drugs.atropine * 100)}%) removes parasympathetic tone: faster rate, and respiratory sinus arrhythmia and beat-to-beat vagal baroreflex control are lost.`);
  if (n.drugs.vasopressor > 0.05) mech.push("A vasopressor raises systemic resistance, so pressure rises; the baroreflex answers by raising vagal tone and withdrawing sympathetic tone (reflex bradycardia).");
  if (n.drugs.vasopressor < -0.05) mech.push("A vasodilator lowers systemic resistance, so pressure falls; the baroreflex answers with tachycardia and added inotropy.");
  if (n.autonomic.baroreflexGain < 0.2) mech.push("The baroreflex is effectively cut (gain ≈ 0): pressure is no longer buffered, so any disturbance shows its full open-loop size.");
  else if (n.autonomic.baroreflexGain > 1.8) mech.push(`Baroreflex loop gain is raised to ${n.autonomic.baroreflexGain}: with the sympathetic delay of a few seconds this destabilises into a sustained ~0.1 Hz (Mayer-wave) oscillation of pressure and heart rate.`);
  if (n.autonomic.setPointShift > 5) mech.push(`The baroreceptor set point is reset upward by ${n.autonomic.setPointShift} mmHg (as in chronic hypertension), so the reflex defends a higher pressure.`);

  if (last) {
    const dS = last.sympathetic - restTone.s, dV = last.vagal - restTone.v;
    if (dS > 0.12) mech.push(`Sympathetic tone is raised (${last.sympathetic.toFixed(2)} vs ${restTone.s} at rest), ${last.afferent < -0.1 ? "driven by baroreceptors unloaded by low pressure" : "driven by non-baroreceptor inputs (volume or ischemic reflexes)"}.`);
    if (dS < -0.12) mech.push(`Sympathetic tone is suppressed (${last.sympathetic.toFixed(2)}), consistent with baroreceptor loading from high pressure.`);
    if (dV > 0.12) mech.push(`Vagal tone is raised (${last.vagal.toFixed(2)} vs ${restTone.v} at rest), consistent with baroreceptor loading.`);
    if (dV < -0.12) mech.push(`Vagal tone is withdrawn (${last.vagal.toFixed(2)}), which speeds the sinus node within a beat or two.`);
  }
  if (m.hrv && m.hrv.lfPeakHz && m.hrv.lfHf !== null && m.hrv.lfHf > 5 && m.map.sd! > 12) mech.push(`Pressure oscillates (MAP SD ${m.map.sd} mmHg) with a spectral peak at ${m.hrv.lfPeakHz} Hz: a baroreflex limit cycle.`);

  if (pulse < 30 && st.rolling10s.sv < 55) teach.push("Pulse pressure is narrow because stroke volume is low (pulse pressure ≈ stroke volume ÷ arterial compliance); this is an early sign of hypovolemia or pump failure.");
  if (hr > 100 && map >= CIRC.hypotensionMap) teach.push("Compensated: pressure is defended by tachycardia and vasoconstriction, at the cost of falling stroke volume. Pressure is a late sign.");
  if (map < CIRC.hypotensionMap) teach.push("Reflex compensation is failing or exhausted: mean pressure is below the level that reliably perfuses the coronaries, which can worsen ischemia (a vicious cycle).");
  teach.push("Beat-to-beat variation here is generated, not scripted: respiration gates vagal tone (RSA); noise in sympathetic, vagal and vascular tone is filtered through a baroreflex with fast vagal and slow sympathetic arms.");
  if (st.autonomic.baroreflexGainMsPerMmHg !== null) teach.push(`The model's own vagal baroreflex gain right now is ${st.autonomic.baroreflexGainMsPerMmHg} ms of R-R interval per mmHg (normal people: roughly 5–20). The sequence-method estimate from the beats is ${m.baroreflexSensitivity.msPerMmHg ?? "n/a"} ms/mmHg and is inflated by respiratory coupling.`);

  const headline = map < CIRC.shockMap ? `Shock: MAP ${map} mmHg` : map < CIRC.hypotensionMap ? `Hypotension: MAP ${map} mmHg` : hr > 100 ? "Tachycardia with maintained pressure" : hr < 55 ? "Bradycardia" : "Hemodynamically stable";
  return {
    headline,
    vitals: `HR ${hr} bpm, BP ${sbp}/${dbp} (MAP ${map}), SV ${st.rolling10s.sv} ml, CO ${((hr * st.rolling10s.sv) / 1000).toFixed(1)} L/min, rhythm: ${st.rhythm.label}`,
    mechanisms: mech,
    teachingPoints: teach,
    caveats: [
      "Educational model. Constants are teaching assumptions; the model has not been validated against patient data and must not inform clinical decisions.",
      "Anatomy is schematic. The ventricle is not simulated in 3D: use SimVascular or a full 0D/1D/3D solver for patient-specific hemodynamics.",
      "Reference resting adult: 72 bpm, stroke volume 70 ml, MAP 90 mmHg.",
    ],
  };
}
