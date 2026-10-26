/**
 * Constants of the live heart (core/live.ts): how beats and slow inputs become events and parameter patches.
 * Tags: [lit] from the literature, [assumed] teaching values.
 */
export const LIVE = {
  /** Activation strength of a premature ventricular beat (1 = normal): weak, asynchronous contraction. [assumed] */
  pvcStrength: 0.8,
  /** Activation strength of the beat after a PVC (post-extrasystolic potentiation, on top of the longer filling). [assumed] */
  potentiatedStrength: 1.1,
  /** Largest integration step, s: `LiveHeart.step(dt)` splits a longer dt into steps of at most this. Equals the solver's step of `periodic()`. [assumed] */
  maxStep: 0.0005,
  /** Spacing of the stored trace samples, s (2 ms). [assumed] */
  traceEvery: 0.002,
  /** Length of the trace ring buffer, s. [assumed] */
  traceSeconds: 30,
  /** An atrial event counts as the atrial kick of a ventricular event when it came this long before it, s: at least `kickMinLead` (an atrium contracting later has nothing left to add) and at most `kickMaxLead` (about the longest PR). [assumed] */
  kickMinLead: 0.04, kickMaxLead: 0.35,
  /** Beats of history the record list keeps. [assumed] */
  maxRecords: 600,
};

/**
 * Mapping of the venous tone factor to the unstressed volume Vu of the venous reservoirs. Tone 1 is the design point. With tone τ,
 * Vu = Vu_design · clamp(1 − gain·(τ − 1), factorRange): higher tone lowers Vu, and the blood it frees becomes stressed volume
 * (the total is unchanged). The splanchnic bed is the large, controllable reservoir (about half of the venous capacitance responds
 * to sympathetic tone, Gelman 2008 [lit]); the cavae respond less. Tone is clamped to `toneRange`. The gains and limits are
 * [assumed]: at tone 1.5 the splanchnic Vu falls by 40 %. `factorRange[0]` is the venoconstriction reserve: whatever the tone, no
 * reservoir gives up more than 40 % of its unstressed volume, at most 0.8 L from the splanchnic bed (2 L unstressed), about 15 % of
 * the blood volume, within the 10-20 % Gelman 2008 [lit] finds recruitable; a large hemorrhage exhausts it (A7b).
 */
export const VENOUS_TONE = {
  gain: { SPL: 0.8, IVC: 0.2, SVC: 0.2 } as Record<string, number>,
  toneRange: [0.5, 2] as [number, number],
  factorRange: [0.6, 1.8] as [number, number],
};

/** Range of the other modifier factors (contractility, resistance, relax): outside it the engine is not meaningful. [assumed] */
export const MODIFIER_RANGE = { contractility: [0.2, 3], resistance: [0.2, 4], relax: [0.5, 3] } as const;
