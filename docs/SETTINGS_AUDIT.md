# Settings and readout audit (Simulator page)

Measured on the live page build after PR 42. "Redundant" means two controls or readouts that set or show the same thing.

## Readouts that disagree (being fixed: branch `unify-vitals`)

One headless run, same patient, same moment:

| Quantity | Monitor | Hemodynamics | Left-heart cath | Pressures legend |
|---|---|---|---|---|
| Aortic BP (mean) | 109/64 (91) | 114/67 (93) | 109/61 (87) | 137/61 (86) |
| Heart rate | 68 (ECG-based) | 71 (beats per minute over the window) | | |
| LVEF | 63 % | 62 % | | |
| Cardiac output | 5.3 | 5.2 | | |

Cause: three different calculations. The Monitor shows the last single beat plus a smoothed MAP and the ECG's own rate; the Hemodynamics panel averages steady beats (and all beats over 30 s for MAP and CO when there is ectopy); the cath panel reads one beat; the trace legend is instantaneous. A premature beat on the Monitor can sit far from the averaged numbers. Rule going forward: one `vitals` snapshot per frame, same label means same number, and a value that is deliberately per-beat is labelled "this beat".

Checks on four patients (normal, LAD occlusion with ectopy, with Impella, 15 % blood loss) showed Monitor vs Hemodynamics within 1-6 mmHg on average, larger when the last beat is premature.

## Support tab (being redesigned: branch `support-redesign`)

Controls that set the same state in more than one place:

- Blood volume: Blood loss slider (`bl`) plus "Bleed 20%" (`x_bleed`) plus Hemorrhage ml/min (`fluids.hemorrhageMlMin`) plus IV bolus kind and volume (`fluids.given`) plus the "+500 ml" button (`m_fluid`) plus "Blood volume" (`heart.volumeMl`) under Structural heart. Kept: blood loss %, ongoing hemorrhage, IV bolus. `heart.volumeMl` moves to the Patient tab as a baseline.
- Devices: Impella and balloon pump each had two controls (manage-pane buttons and the Mechanical support toggles) and two registry fields (`support.impella` and `devices.impella`, `support.iabp` and `devices.iabp`). One control per device remains.
- Two reset buttons ("Reset" in Volume and drugs, "Reset treatment"): one remains.
- "Reperfuse" and "Assessment" were nested tabs inside Support; they become sections. Beta blocker sat under "Volume and drugs" next to blood loss; it moves to Drugs.

## Not yet acted on (proposals, need a decision)

1. **Valves tab**: the "Structural heart" lesion dropdown and its sliders overlap with "Valves one by one"; editing one clears the other's pick ("Custom heart"). Proposal: keep the per-valve controls as the main UI and turn the lesion dropdown into a preset that fills them. The group also hides systemic parameters (SVR scale, pulmonary resistance index, lung saturation, RV contractility, tetralogy flag) that are not valve settings; move them to a "Hemodynamic baseline" group on the Patient tab.
2. **Coronary tab**: four anatomy preset buttons plus five anatomy dropdowns set the same fields. Proposal: one preset dropdown with the five dropdowns under "Custom anatomy".
3. **Panels**: Monitor, Hemodynamics, Oxygen and the two cath panels repeat HR, BP, CO, PCWP, LVEDP, Qp:Qs and SvO2. Repeating a number at its own measurement site is fine once the values agree (the unify-vitals work); proposal on top of that: drop Monitor's "Estimated LVEF" and "Coronary perfusion" rows (Hemodynamics has LVEF) and keep the Monitor to rhythm, HR, BP, CO, ST and ischemia.
4. **Chat-only fields with no page control** (a parity gap, not a redundancy): epinephrine, milrinone, vasopressin, nitroprusside, furosemide, `drugs.vasopressor`, `autonomic.*`, `seed`, `ectopyTendency`, `arrhythmiaTendency`, electrolytes (K, Mg), `fluids.capillaryLeak`, `fluids.legRaise`, `devices.impellaRp`, `devices.iabp.volumeMl`. Decide which belong on the page (an "Advanced" section) and which stay chat-only.
