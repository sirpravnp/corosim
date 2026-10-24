// Intrathoracic pressure constants (core/thorax.ts, physics/respiratory.ts). [lit] = from the literature or a textbook value; [assumed] = a teaching choice.

/**
 * Pleural pressure and its transmission to the vessels and the abdomen.
 *
 * The model's calibrated state (MAP 90, CO 5.2, CVP 3-6, ...) stands for quiet spontaneous breathing averaged over the breath, where
 * the pleural pressure swings from -5 mmHg (end-expiration) to -9 (end-inspiration), mean -7. That mean is the zero of the pressures
 * the model applies: the thorax adds P_pl - P_ref to the thoracic and pericardial nodes, so quiet spontaneous breathing (depth 1)
 * leaves the breath-averaged numbers where they were and adds only the swing. Absolute pleural pressure is reported in the tap
 * `pleuralPressure`.
 */
export const THORAX = {
  /** Pleural pressure at end-expiration (functional residual capacity), mmHg. [lit: about -5 mmHg] */
  endExpPleural: -5,
  /** The model's zero: mean pleural pressure of quiet spontaneous breathing, mmHg = endExpPleural - spontaneousSwing/2. Intrathoracic pressure above it loads the heart, below it unloads it. [derived] */
  refPleural: -7,
  /** Spontaneous breathing: fall of pleural pressure from end-expiration to peak inspiration at depth 1, mmHg (-5 to -9; deep breathing, depth 2, to -13). [lit: -8 to -10 mmHg at tidal inspiration] */
  spontaneousSwing: 4,
  /** Rise of intra-abdominal pressure at peak spontaneous inspiration (depth 1), mmHg: the diaphragm descends and compresses the abdominal contents. [lit: 1-3 mmHg; assumed 1] */
  diaphragmAbdominal: 1,
  /** Positive-pressure ventilation: rise of pleural pressure from end-expiration to the end of inspiration per ml/kg of tidal volume, mmHg. 8 ml/kg gives +7.2 mmHg (plateau 18-20 cmH2O of which about 40 % reaches the pleura). [lit: +5 to +10 mmHg; coefficient assumed] */
  ppvSwingPerMlKg: 0.9,
  /** Default tidal volume of mechanical ventilation, ml/kg. [lit: protective ventilation 6-8 ml/kg] */
  defaultTidalMlKg: 8,
  /** Fraction of PEEP that reaches the pleural space (compliant lungs transmit about a quarter to a half, stiff lungs less, a stiff chest wall more). [assumed 0.5; lit range 0.25-0.75] */
  peepTransmission: 0.5,
  /** Fraction of the pleural pressure rise (by PEEP and by inspiration) that reaches the abdomen under positive-pressure ventilation: the diaphragm is pushed down. [assumed] */
  abdominalTransmission: 0.5,
  /** Shielding of the heart by a stiff sac: the cavities receive 1/(1 + k·(stiffness − 1)) of the chest pressure; k = 1 gives 0.17 at stiffness 6. The SVC, which runs inside the pericardial reflection, is shielded with the chambers. Qualitative [lit: Hatle 1989, intrathoracic and intracardiac pressures dissociate in constriction]; the size is assumed. */
  constrictionShield: 1,
  /** mmHg per cmH2O. [lit] */
  mmHgPerCmH2O: 0.7355,
  /** Default breathing rate, breaths/min. [lit] */
  defaultRate: 14,
  /** Depth is clamped to this range (0 = no breathing effort, 2 = deep breathing; the scale of `AUTONOMIC.respDepth`). [assumed] */
  depthRange: [0, 2] as [number, number],
};

/** Output definitions of physics/respiratory.ts. */
export const RESPIRATORY = {
  /** A breath needs at least this many beats to count in pulsus, PPV and SVV. [assumed] */
  minBeatsPerBreath: 3,
  /** PPV above this fraction predicts fluid responsiveness (Michard 2000); SVV above 0.10-0.13 likewise. [lit] */
  ppvThreshold: 0.13,
};
