/**
 * How the rhythms of the EKG library act on the heart's mechanics when they run in the Simulator (task B2; physics/rhythmSource.ts,
 * physics/core/live.ts). Each constant is the activation strength the core engine's chamber gets for a beat of that origin (1 = a
 * normal, synchronous contraction; a strength below 1 scales the elastance curve, `ElastanceChamber`). Rate, filling time, the loss of
 * the atrial kick and AV dissociation need no constant: they follow from the beat times themselves (a short RR fills little and
 * contracts briefly; a ventricular beat with no P wave before it has no kick; a P wave that lands in systole contracts against a
 * closed valve and gives a cannon wave).
 * Tags: [lit] from the literature, [assumed] teaching values chosen within it.
 */
export const RHYTHM_MECH = {
  /**
   * Monomorphic ventricular rhythms (VT, accelerated idioventricular rhythm, ventricular escape): activation spreads through muscle
   * instead of the Purkinje system, so the walls contract out of step and less of the shortening ejects. The same strength as a
   * PVC (`LIVE.pvcStrength`). VT at 150-200/min is often tolerated for a while in a normal heart and pulseless in a poor one: the
   * rate and the ventricle decide, not a label: here the short RR (less filling, shorter systole) does most of it [assumed].
   */
  ventricular: 0.6,
  /**
   * Polymorphic VT and torsades: the activation front wanders beat to beat, contraction is chaotic; at 200-250/min these rhythms
   * usually give no useful pressure and degenerate to VF [assumed, within the clinical picture].
   */
  polymorphic: 0.35,
  /**
   * Right-ventricular apical pacing: a left-bundle-branch-like activation sequence, dyssynchronous, with a modest fall in ejection
   * fraction: acute RV apical pacing took LVEF from 53 to 47 % (about x 0.9; Wolber 2010, PMID 20946287) [lit].
   */
  paced: 0.9,
  /**
   * Duration of contraction of a beat that spreads through muscle (VT, idioventricular, escape), relative to a normally conducted
   * beat at the same rate (core `HeartEvent.systole`): the QRS is twice as wide (160 against 90 ms) and the regional delays of
   * 50-100 ms prolong the isovolumic phases and the whole of systole, so less of a short cycle is left for filling. This, more than
   * the weaker contraction, is what makes a fast VT lose its output [assumed: about a quarter longer].
   */
  ventricularSystole: 1.25,
  /** The same for right-ventricular pacing, whose activation is also through muscle but starts at one well-defined site [assumed]. */
  pacedSystole: 1.15,
  /** The same for polymorphic VT and torsades: the front wanders and the walls contract at different times through most of the cycle [assumed]. */
  polymorphicSystole: 1.45,
  /**
   * The atria in flutter: an organised circuit at about 300/min, with some mechanical activity (flutter waves are seen on the jugular
   * venous pulse and transmitral Doppler) but little effective contraction; atrial function is depressed and recovers over weeks
   * after cardioversion [assumed: about a third of a normal atrial contraction].
   */
  flutterAtrial: 0.3,
  /**
   * Spacing (s) of the timing ticks that close a beat record when the ventricles do not contract at all (VF, asystole): the
   * hemodynamic readouts (pressure falling toward the mean filling pressure, zero output) refresh once a second. Not a beat: a
   * strength-0 event that resets nothing mechanical and is not counted in the heart rate.
   */
  tickS: 1,
};
