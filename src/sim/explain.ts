import { Simulation } from "./simulation";
import { AUTONOMIC } from "../physics/autonomic";
import { CIRC } from "../physics/circulation";
import { Ectopy, EctopyPhase } from "../physics/ectopy";
import { ECTOPY } from "../config/ectopy";
import { libraryRhythm } from "../physics/rhythmSource";
import type { Arrhythmia, RunCause } from "../physics/arrhythmia";

export interface Explanation {
  headline: string;
  vitals: string;
  /** Causal statements derived from the model's own state, not free text: safe for an LLM to build on. */
  mechanisms: string[];
  teachingPoints: string[];
  caveats: string[];
}

const PHASE_WHY: Record<EctopyPhase, string> = {
  none: "",
  hyperacute: "ischemic ectopy peaks in the first hour or two after onset",
  subacute: "ischemic ectopy falls over the hours after onset",
  late: "many hours after onset, ischemic ectopy has settled to a low level",
  reperfusion: "reperfusion of ischemic muscle brings a burst of ectopy that settles over tens of minutes, then a slow tail over hours",
};

/**
 * The core engine's ectopy (B3a) as measured over the last minute of beats: frequent, occasional or none, with the phase that
 * explains it. Nothing when the heart has no ischemic history (no ectopy to speak of).
 */
export function ectopyStatement(e: Ectopy, t: number): string | null {
  const phase = e.phase(), r = e.recent(t);
  if (phase === "none" && r.pvcs === 0) return null;
  const why = PHASE_WHY[phase], per = `${r.pvcs} of the last ${r.beats} beats (${Math.round(r.share * 100)}%)`;
  const pause = "each is followed by a compensatory pause and a stronger next beat";
  if (r.pvcs === 0) return `No premature ventricular beats over the last minute${why ? `, although ${why}` : ""}; how many a patient has varies widely between patients.`;
  if (r.share >= ECTOPY.frequent) return `Frequent premature ventricular beats: ${per}${why ? `; ${why}` : ""}; ${pause}.`;
  return `Occasional premature ventricular beats: ${per}${why ? `; ${why}` : ""}; ${pause}.`;
}

export const CAUSE_WHY: Record<RunCause, string> = {
  ischemia: "a premature beat on the vulnerable phase of acutely ischemic myocardium started it",
  reperfusion: "it came with reperfusion of the ischemic muscle",
  scar: "a re-entry circuit around healed infarct scar runs it",
  degeneration: "a ventricular tachycardia broke up into fibrillation",
  induced: "it was started on purpose",
};

/** The core engine's VT/VF and AIVR (B3b): what runs now, or the last run in the past minute. Nothing when nothing happened. */
export function arrhythmiaStatement(a: Arrhythmia, t: number): string | null {
  const s = a.state(t), cur = s.current;
  if (cur) {
    const what = `${cur.label[0].toUpperCase()}${cur.label.slice(1)}${cur.rate ? ` at ${cur.rate}/min` : ""} for ${Math.round(cur.forS)} s`;
    const tail = cur.kind === "vf" ? "no organized contraction and no cardiac output: cardiac arrest (defibrillation is not yet modelled)"
      : cur.kind === "aivr" ? "a benign reperfusion rhythm, slightly faster than the sinus node, which ends by itself"
      : cur.kind === "poly" ? "chaotic contraction; it stops by itself or degenerates to ventricular fibrillation within seconds"
      : "dyssynchronous contraction and short filling; it degenerates to ventricular fibrillation if the pressure collapses or while acute ischemia goes on";
    return `${what}: ${CAUSE_WHY[cur.cause]}; ${tail}.`;
  }
  const l = s.last;
  if (!l || t - (l.end ?? l.t) > 60) return null;
  if (l.kind === "nsvt") return `A run of ${l.beats} beats of non-sustained ventricular tachycardia at ${l.rate}/min${l.couplingVsT !== undefined && l.couplingVsT < 1 ? ", started by an R-on-T premature beat" : ""}; ${CAUSE_WHY[l.cause]}.`;
  return `${l.label[0].toUpperCase()}${l.label.slice(1)} ended (${l.outcome ?? "stopped"}) ${Math.round(t - (l.end ?? l.t))} s ago.`;
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
  const map = st.meanArterialPressure, roll = sim.rolling(10), hr = Math.round(roll.hr || 0), sbp = Math.round(roll.sbp || 0), dbp = Math.round(roll.dbp || 0), sv = Math.round(roll.sv || 0);
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
  const ect = sim.stream.ectopy;
  if (ect) { const e = ectopyStatement(ect, sim.t); if (e) mech.push(e); } // core engine (B3a): what the monitor actually showed
  if (sim.arrhythmia) { const a = arrhythmiaStatement(sim.arrhythmia, sim.t); if (a) mech.push(a); } // core engine (B3b)
  else if (st.rhythm.pvcSeverity > 0.6) mech.push("Ischemic burden is above the ectopy threshold, so premature ventricular beats occur; each is followed by a compensatory pause and a stronger next beat.");

  const rs = sim.rstate, sup = st.support, v = st.ventricle;
  const lib = libraryRhythm(rs.rhythm);
  if (lib) mech.push(`${lib.name} (from the EKG library; it sets the beats the ventricles get): ${lib.summary}${/^(vf|asystole)/.test(lib.id) ? " The ventricles do not contract: there is no output and the pressure falls to the mean filling pressure." : ""}`);
  if (rs.rhythm === "af") mech.push("Atrial fibrillation: no P waves, an irregular ventricular response set by the AV node, and no atrial kick (each beat fills less).");
  if (rs.bbb !== "none") mech.push(`Pre-existing ${rs.bbb === "lbbb" ? "left" : "right"} bundle branch block widens the QRS${rs.bbb === "lbbb" ? " and masks ST changes" : ""}.`);
  if (v.lvInfarctFraction > 0.02) mech.push(`Irreversible injury: ${Math.round(v.lvInfarctFraction * 100)}% of the left ventricle has infarcted (${st.clinicalMinutes} clinical minutes of evolution); estimated LVEF ${Math.round(v.ejectionFraction * 100)}%. Reperfusion stops further loss but does not restore it.`);
  if (sup.norepinephrine) mech.push(`Norepinephrine (${Math.round(sup.norepinephrine * 100)}%) raises resistance and pressure, and adds afterload and oxygen demand to an ischemic ventricle.`);
  if (sup.dobutamine) mech.push(`Dobutamine (${Math.round(sup.dobutamine * 100)}%) restores some lost contractility at the cost of oxygen demand and more ectopy.`);
  if (sup.nitroglycerin) mech.push(`Nitroglycerin lowers preload${v.rvIschemia > 0.3 ? "; with right-ventricular ischemia this preload loss is large and dangerous" : ""}.`);
  if (sup.fluids) mech.push(`${sup.fluids.toFixed(1)} L of fluid given${v.pulmonaryCongestion > 0.2 ? `; the failing left ventricle is backing it into the lungs (congestion ${Math.round(v.pulmonaryCongestion * 100)}%)` : ", restoring filling"}.`);
  if (sup.iabp) mech.push("Intra-aortic balloon pump: diastolic augmentation raises coronary perfusion pressure and slightly unloads the ventricle.");
  if (sup.impella) mech.push(`Microaxial pump moves ${sup.deviceFlowLpm} L/min continuously${v.rvIschemia > 0.4 ? ", limited because the failing right ventricle cannot deliver blood to it" : ""}; arterial pressure no longer falls fully between beats.`);
  if (sup.pacing) mech.push(`Pacing at ${sup.paceRate} bpm holds the rate; while paced the heart rate no longer varies beat to beat.`);
  if (sup.atropine && !n.drugs.atropine) mech.push("Atropine removes vagal tone: faster rate, relief of tone-mediated AV block, and loss of respiratory sinus arrhythmia.");
  if (n.bloodLoss > 0.02) mech.push(`Blood volume is ${Math.round(n.bloodLoss * 100)}% below normal, so filling and stroke volume fall (stroke volume ${sv} ml vs ~70 ml normally).`);
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
    // Said as physiology, not as model numbers: the reflex shows up in rate, resistance and contractility.
    if (dS > 0.12) mech.push(last.afferent < -0.1 ? "Reflex sympathetic activation from the low arterial pressure is driving the tachycardia, vasoconstriction and extra contractility." : "Sympathetic activation from volume loss or the ischemic reflex is driving rate and vasoconstriction.");
    if (dS < -0.12 || dV > 0.12) mech.push("The high arterial pressure is reflexly slowing the heart and relaxing the vessels (baroreflex).");
    else if (dV < -0.12 && dS <= 0.12) mech.push("Vagal withdrawal is speeding the sinus node.");
  }
  if (m.hrv && m.hrv.lfPeakHz && m.hrv.lfHf !== null && m.hrv.lfHf > 5 && m.map.sd! > 12) mech.push(`Pressure oscillates (MAP SD ${m.map.sd} mmHg) with a spectral peak at ${m.hrv.lfPeakHz} Hz: a baroreflex limit cycle.`);

  if (pulse < 30 && sv < 55) teach.push("Pulse pressure is narrow because stroke volume is low (pulse pressure ≈ stroke volume ÷ arterial compliance); this is an early sign of hypovolemia or pump failure.");
  if (hr > 100 && map >= CIRC.hypotensionMap) teach.push("Compensated: pressure is defended by tachycardia and vasoconstriction, at the cost of falling stroke volume. Pressure is a late sign.");
  if (map < CIRC.hypotensionMap) teach.push("Reflex compensation is failing or exhausted: mean pressure is below the level that reliably perfuses the coronaries, which can worsen ischemia (a vicious cycle).");

  const headline = map < CIRC.shockMap ? `Shock: MAP ${map} mmHg` : map < CIRC.hypotensionMap ? `Hypotension: MAP ${map} mmHg` : hr > 100 ? "Tachycardia with maintained pressure" : hr < 55 ? "Bradycardia" : "Hemodynamically stable";
  return {
    headline,
    vitals: `HR ${hr} bpm, BP ${sbp}/${dbp} (MAP ${map}), SV ${sv} ml, CO ${roll.cardiacOutput.toFixed(1)} L/min, rhythm: ${st.rhythm.label}`,
    mechanisms: mech,
    teachingPoints: teach,
    caveats: ["Teaching model, not for clinical decisions. Mention limits only when they change the answer."],
  };
}
