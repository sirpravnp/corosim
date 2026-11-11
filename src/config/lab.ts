// Cath lab procedure simulator knobs. [assumed] until cited or clinician-reviewed.

export const LAB = {
  /** Clinical minutes of infarct evolution per simulated second while the lab runs in real-time mode. */
  realtimeMinutesPerSecond: 1 / 60,
  /** Ischemia rise time constant (s) used only in real-time lab mode; clinical mode keeps config/ecg ISCHEMIA. */
  ischemiaTauSeconds: 20,
  /** ACT rise per heparin unit (s). [assumed] */
  actPerHeparinUnit: 0.05,
  /** ACT decay (s) per elapsed simulated second in the lab. [assumed] */
  actDecayPerSecond: 1 / 12,
  hydrophilicCrossingDiscount: 0.4,
  // Crossing a lesion with the wire. The force the tip delivers comes from the wire, the guide's backup and how much of the push the
  // route transmits; it does not depend on how far one press moves the wire. Scaled so a workhorse wire on a well-seated guide crosses
  // a 50 to 90 percent lesion on contact and a fresh occlusion after a few steady presses. [assumed]
  crossingForceScale: 27, // route transmission at a mid-LAD lesion is about 0.08 from the femoral artery
  capLoadPerPress: 0.25, // each steady press held against the cap adds this fraction of force
  capLoadMax: 4, // presses: force at most doubles
  // A soft wire short of half the force a lesion needs buckles back once loaded against it, or at once on a hard shove (this many mm). [assumed]
  prolapseShoveMm: 8,
  prolapseBelowFraction: 0.5,
  microchannelFloppyFactor: 0.5, // force a floppy hydrophilic wire needs through a CTO with microchannels [assumed]
  prolapseBackMm: 6,
  // Wire perforation, per millimeter the tip travels through a lesion: the device risk (tip load, calcium, coating) times this.
  // A workhorse wire across a soft 16 mm lesion comes out near 0.5 percent, a stiff hydrophilic wire through calcium a few percent;
  // pushing a wire tip into the end of a small distal vessel adds its own risk per millimeter. [assumed; wire perforation in PCI
  // is a fraction of a percent of procedures]
  perforationPerMmScale: 0.0025,
  distalPerforationPerMm: 0.002,
  branchMatchRotDeg: 25,
  branchBendChoiceDeg: 45,
  /** Keyboard control defaults for the cath-lab page (W/S advance, A/D torque). [assumed] */
  controls: {
    advanceMm: 2,
    withdrawMm: 2,
    fineMm: 0.5,
    burstMm: 10,
    torqueDeg: 15,
    bendDeg: 8,
    repeatMs: 55,
  },
} as const;
