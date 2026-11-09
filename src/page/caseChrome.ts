// ---------------------------------------------------------------- which regions of the page exist (DOM-free; the page applies it)
export interface CaseChrome {
  diseaseTabs: boolean; // dock tabs Patient, Rhythm, Coronary, Valves, Pericardium (and Advanced, baseline inside them)
  mode: boolean;        // the Simulator/Playground switch
  toolbar: boolean;     // pause, step, heartbeat, clinical clock, snapshots, CSV
  stage: boolean;       // Figure 1, the 3D heart
  tableOne: boolean;    // Table 1, the perfusion beds
  stMap: boolean;       // the ST map and the long ECG caption
  panelsPicker: boolean;
  treatments: boolean;  // the Support tab (retitled Treatments)
}

/** A case, running or in its debrief, shows the bedside and the learner's treatments only; every other page and the case front door are unchanged. */
export function caseChrome(inCases: boolean, phase: "idle" | "run" | "over"): CaseChrome {
  const bare = inCases && phase !== "idle";
  return { diseaseTabs: !bare, mode: !bare, toolbar: !bare, stage: !bare, tableOne: !bare, stMap: !bare, panelsPicker: !bare, treatments: true };
}
