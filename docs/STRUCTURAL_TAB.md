# Structural tab: congenital and valve variants on the simulator's own 3D heart, with hemodynamic estimates

Status: plan, no app code. Revised after clarifying scope: the base is the **procedural heart the sim and EKG pages already draw** (`src/anatomy/heartSurface.ts`, rendered in `src/app.ts` and `src/viewer/heartScene.ts`), not the CT volume used by the cath lab spike.

## What we are building

A **structural page** at `/structural/` (same shape as `/cath/` and `/ekg/`). Pick a lesion, set its severity or its stage, and watch three things change together:

1. **The 3D heart**, reshaped to show the lesion, with a cutaway to see the septum, valves and shunts, and flow arrows colored by oxygen saturation.
2. **Hemodynamic estimates**: chamber and vessel pressures, saturations in every chamber and pre/post-ductal, Qp:Qs, cardiac output, ventricular loops, and the numbers a cath lab or echo report would give.
3. **The same report through MCP**, so an AI can run it on the user's patient.

First lesions: **PDA, tetralogy of Fallot, Ebstein anomaly, pulmonary atresia, tricuspid atresia, TAPVR, HLHS.** Acquired valve lesions (AS, AR, MS, MR, TR) come from the same engine at little extra cost, since the congenital set already needs valves with stenosis and regurgitation. Educational and synthetic only, like the rest of CoroSim.

## What we have, and what is missing

| Have | Gap |
|---|---|
| Procedural heart as a signed distance field (`heartSdf`): LV, RV, RA, LA, aorta with arch, atrial appendages, RVOT conus, septal plane `SEPT_N`/`SEPT_D`; surface-nets mesher; per-vertex `Part` labels | **No pulmonary artery, venae cavae, pulmonary veins, ductus, septum interior or valves.** The file's header says the pulmonary vessels and cavae were left out on purpose. All of these lesions live in exactly those structures. |
| The scene's heart already deforms (`rotateHeart`, per-vertex coloring by bed) | Remeshing per slider change; see Geometry |
| `circulation()` and `BeatHemodynamics`: MAP = CO × SVR, per-beat Windkessel | **No right heart, no pulmonary circuit, no shunts, no saturations, no valves.** A single systemic loop cannot express a single ventricle, a duct or mixing. |
| Seeded `Simulation` core, `Scenario` schema, `#s=` links, MCP tools, EKG dipole heart | Scenario has no structural fields. The ECG has no RVH, right-axis, superior-axis or Ebstein/WPW patterns. |

## Decision 1: a compartment graph, not a bigger `circulation()`

Build `src/physics/structural.ts`, DOM-free: a closed-loop lumped model defined as a **graph**, so every lesion is an edit to the graph or its parameters rather than new code.

**Nodes** (each with volume, elastance or compliance, and an oxygen saturation):
SVC/IVC (systemic venous), RA, RV, main PA, pulmonary bed, pulmonary veins, LA, LV, ascending aorta and arch (upper body: head, arms, coronaries), descending aorta (lower body). Splitting the aorta at the duct is what lets the model show **pre- vs post-ductal saturation**, the classic differential cyanosis.

**Edges:**
- Valves: forward flow by the Bernoulli/Gorlin relation with an effective orifice area, backward flow through a regurgitant orifice. Area zero is an atretic valve.
- Defects: ASD, VSD and the ductus are orifices between nodes; flow follows the pressure difference and defect size, in both directions, with the saturation of the donor node.
- Vessels: resistance edges for the systemic and pulmonary beds, a modified Blalock-Taussig shunt as a small tube from aorta to PA.
- Connections that can be rerouted: the pulmonary vein outlet (TAPVR moves it to the RA, SVC, coronary sinus or portal vein) and the ventricle-to-vessel links (single-ventricle patterns).

Chambers are time-varying elastances stepped with RK4, a few thousand steps per beat, cheap in TypeScript. No WASM. (svZeroDSolver, spiked in `docs/spikes/zerod-wasm.md`, stays an option if we later want 1D vessels.)

**Calibration anchors:** an adult with no lesion must reproduce the existing resting patient (72 bpm, SV 70 ml, MAP 90) so the two engines agree on a normal heart. A neonate preset uses age-scaled constants (HR about 140, CO about 200 ml/kg/min, MAP about 45 to 50, SaO2 above 95%, PVR falling over the first days). Weight and age are inputs.

## Neonatal dynamics: "time is duct"

Most of this list is **duct-dependent**, so the interesting state is not static severity but time:

| Variable | Behavior |
|---|---|
| Age (hours, days) | PVR falls from fetal levels over days; pulmonary overcirculation appears as it falls |
| Ductal patency | Closes over hours to days unless held open; sets both pulmonary flow (pulmonary atresia, Fallot with severe obstruction) and systemic flow (HLHS) |
| Prostaglandin E1 | Reopens or holds the duct; apnea and fever as side effects worth flagging |
| Oxygen, ventilation, CO2 | Oxygen drops PVR, which helps a PDA-dependent pulmonary circuit but starves systemic flow in HLHS |
| Atrial communication | Restrictive in HLHS (pulmonary venous hypertension), required in tricuspid atresia, TAPVR and pulmonary atresia; balloon atrial septostomy widens it |

The clock reuses the "time is muscle" pattern: a few seconds of wall time stand for hours of clinical time, with the duct closing as it runs.

## Lesion catalogue

| Lesion | Graph change and parameters | What the learner should see |
|---|---|---|
| **PDA** | Edge aorta (post-ductal) to PA; diameter, length, age | Left-to-right shunt, wide pulse pressure, low diastolic, LA/LV volume load, Qp:Qs; Eisenmenger when PVR passes systemic. Also the building block for the rest. |
| **Tetralogy of Fallot** | Large VSD, RVOT obstruction (infundibular and valvar, dynamic), overriding aorta fraction, RVH | Right-to-left shunt across the VSD set by RVOT resistance vs SVR, saturation, **tet spell** (SVR falls or infundibular spasm, saturation drops) and what fixes it (knees to chest, phenylephrine, oxygen, beta blocker), BT shunt, repair |
| **Pulmonary atresia** (with VSD, or with intact septum and a small RV) | Pulmonary valve area zero; pulmonary flow only via PDA, BT shunt or collaterals | Cyanosis that tracks duct closure; PGE1 response; with intact septum the RA empties across the ASD and RV pressure is suprasystemic |
| **Tricuspid atresia** (types Ia, Ib, Ic) | Tricuspid area zero; ASD mandatory; VSD size; PS or none; great-artery relation | RA to LA obligatory shunt, LV supports both circulations, pulmonary flow set by VSD and PS (balance: too little is cyanosis, too much is failure), **superior QRS axis** on the ECG, Glenn/Fontan path |
| **Ebstein anomaly** | Tricuspid septal leaflet displaced; atrialized RV fraction; TR area; PFO or ASD; accessory pathway flag | Giant RA, severe TR, small functional RV, right-to-left shunt at the atria, **functional pulmonary atresia in the newborn that resolves as PVR falls**, WPW/SVT and tall right-atrial P waves |
| **TAPVR** (supracardiac, cardiac, infracardiac, mixed; obstructed or not) | Pulmonary vein outlet rerouted to SVC, RA, coronary sinus or portal vein; obstruction as a resistance on the vein; ASD size | All pulmonary venous blood reaches the right heart; the ASD is the only way to fill the left heart; **obstruction gives pulmonary edema and severe cyanosis**, worst in the infracardiac type; prostaglandin worsens it |
| **HLHS** | Mitral and aortic atresia or stenosis, small LV; RV supports the systemic circulation through the duct; retrograde flow in the arch; ASD restrictive or not | Systemic and coronary flow depend on the duct; falling PVR steals systemic flow (pulmonary overcirculation, low diastolic pressure, lactate); a restrictive ASD gives pulmonary venous hypertension; the Qp:Qs balancing act. Stage actions: Norwood (Sano or BT), Glenn, Fontan |

Staged palliation (BT shunt, Norwood, Glenn, Fontan) and repair are **treatment actions** that edit the graph, as `corosim_treat` does for PCI: the learner sees before and after. Fontan physiology needs central venous pressure and no ventricle in front of the lungs, so it is the hardest and is last.

Valve lesions (all in Phase 1 because the congenital set needs them): AS, AR, MS, MR, TR, TS, PS, PR as an area or EROA.

## Outputs (the hemodynamic estimates)

- Pressures in every node, with traces; PV loops for each working ventricle (one loop in single-ventricle physiology).
- Saturation in every chamber and pre-ductal vs post-ductal SpO2; arterial oxygen content; Qp, Qs, **Qp:Qs from Fick saturations**, checked against the flow ratio the model produced; PVR and SVR in Wood units.
- Cardiac output and index, SV, EF, EDV and ESV for each ventricle.
- Valve gradients, areas, regurgitant volume and fraction, with ASE/ACC grade thresholds.
- Findings: murmur (timing, grade), cyanosis, differential cyanosis, perfusion (capillary refill, lactate, urine output flags), chest film pattern (oligemic, plethoric, edema), ECG axis and hypertrophy pattern.
- Guideline hint in the Management panel's style: decide first, then check.

## Geometry on the procedural heart

The heart is an SDF, so a lesion is an SDF edit, and the mesher already exists. What changes:

1. **Add the missing great vessels and veins to `parts()`**: main PA with right and left branches, SVC, IVC, four pulmonary veins joining the LA, a ductus between the PA and the descending aorta, a coronary sinus. New `Part` values for each so they color and label. This is a one-time extension that also fixes the "left out" note in `heartSurface.ts`, and the sim and EKG pages can keep them hidden.
2. **Morph from parameters**, not a mesh swap:
   - hypoplastic LV and aortic arch (HLHS): scale the LV ellipsoid and the arch tube radius; a thin ascending aorta;
   - dilated RA (Ebstein, tricuspid atresia), RV hypertrophy and a boot-shaped apex (Fallot), small or absent RV outflow (pulmonary atresia): scale chamber primitives and wall offset;
   - TAPVR: remove the four veins entering the LA and add a vertical vein, or one that enters the SVC, RA or coronary sinus, or runs below the diaphragm; a small posterior LA;
   - PDA and BT shunt: a tube between named points, radius from the lesion.
3. **Cutaway.** The SDF has only an outer surface. For a section view, clip the mesh with a plane, draw the cut face, and add procedural interior props: the septum as a plane at `SEPT_N`/`SEPT_D` with holes where ASD and VSD sit, valve rings at the base plane with leaflets that open and close (or are absent for atresia), and jets as cones scaled by the solved velocity.
4. **Cost.** Meshing at 1.4 mm takes a noticeable moment. Use a coarser step (2.5 to 3 mm) while a slider moves and a fine pass on release, and cache by parameters. Phase 2 measures this before committing.

Honest limit: this is a schematic heart, as the README says. Lesions are illustrative shapes, not measured anatomy, and the page says so.

## Where it fits in the code

```
src/config/structural.ts    NEW  lesion catalogue, normal and neonatal values, grade thresholds, each constant tagged [lit] or [assumed]
src/physics/structural.ts   NEW  compartment graph, elastances, valves, defects, saturation mixing, RK4 per beat, neonatal clock
src/physics/valves.ts       NEW  Gorlin/Bernoulli orifice, EROA regurgitation, grading
src/anatomy/heartSurface.ts EDIT add PA, cavae, pulmonary veins, ductus; accept a morph parameter set
src/sim/structural.ts       NEW  report read by the page and MCP: pressures, saturations, Qp:Qs, findings, guideline hint
src/sim/scenario.ts         EDIT add `structural?: StructuralSpec` (lesion, severity, age, duct, stage), normalize, #s= encoding
src/physics/ecg.ts          EDIT later: right and superior axis, RVH, tall P, Ebstein/WPW patterns on the existing dipole heart
src/structural/             NEW  page.ts, heartView.ts (cutaway, props, jets), loops.ts (traces, PV loops), controls
structural/index.html       NEW  page shell, masthead entry
vite.config.ts              EDIT add the entry
tests/structural.test.ts    NEW
```

**Coupling to the existing simulator.** Phase 1 to 4 are standalone (like `src/sim/cath.ts`). A later phase feeds the structural engine's stroke volume, pressures and saturations into `circulation()` so the autonomic loop, drugs and arrhythmia act on it.

## Validation

- Unit tests (DOM-free): no lesion matches the existing resting patient; mass conservation at every node; Qp:Qs from saturations equals Qp:Qs from flows; PDA flow rises as PVR falls; closing the duct in pulmonary atresia drops saturation and in HLHS drops systemic flow; TAPVR with an obstructed vein raises pulmonary venous pressure while an open ASD is required for any left-heart filling; Ebstein shunt shrinks as PVR falls; tricuspid atresia without an ASD is incompatible with life and the page says so.
- Against the literature: published typical saturations, Qp:Qs, pressures and gradients per lesion, and neonatal normals. Targets live in `config/structural.ts` so a miss is a failing test.
- **Clinician review of every lesion's numbers and every teaching claim** (yours, plus a pediatric cardiologist if one is available). Congenital physiology is full of exceptions, so this is the main gate before release.

## Phases

| Phase | Deliverable | Rough size |
|---|---|---|
| 0. Engine spike | Graph with saturations; normal adult and neonate, PDA, Tet. Check the anchors and the tet spell | 1.5 wk |
| 1. Right-heart and valve lesions | Valve primitives, Ebstein, pulmonary atresia, tricuspid atresia; acquired valve set; report and tests; page with traces and loops, no 3D yet | 2 wk |
| 2. Great vessels and cutaway | Extend `heartSdf` with PA, cavae, veins, ductus; morph parameters; cutaway, septum, valve props; timing of remeshing | 2 wk |
| 3. Venous and single-ventricle lesions | TAPVR (all types, obstruction), HLHS and the neonatal duct/PVR clock | 2 wk |
| 4. Treatments | PGE1, atrial septostomy, BT shunt, Norwood, Glenn, repair; Fontan last | 2 wk |
| 5. MCP and links | `corosim_structural_set`, `_report`, `_treat`; show in chat as an MCP App like the EKG viewer; `#s=` links | 1 wk |
| 6. ECG patterns | Right and superior axis, RVH, Ebstein/WPW on the EKG page's heart | 1 wk |
| 7. Couple to the simulator | Structural engine drives `circulation()` | 1.5 wk |

Phases 0 and 1 are the risk; if the engine is believable, 2 to 5 are geometry and plumbing.

## Risks and limits

- **Lumped model.** Good for pressures, flows and saturations to teaching accuracy. No wave reflection, no flow patterns inside chambers, no growth. 3D flow arrows are schematic, not CFD, and the UI says so.
- **Sizes vary by orders of magnitude** from newborn to adult, so every constant needs an age or weight scale. Getting the neonatal set right is more work than the adult one.
- **Fontan and univentricular physiology** invert the usual model (central venous pressure drives flow). Isolate it in its own phase.
- **The heart is schematic.** Adding the great vessels is new geometry, and some lesions (a vertical vein, an infradiaphragmatic connection) need a view that shows them clearly.
- **Regulatory posture.** Synthetic patients and no real patient data keeps this educational, in line with `docs/CLINICAL_RESEARCH_PATH.md`.

## Open questions

1. **Order of the first release.** Recommend PDA and Tet in Phase 0, then Ebstein, pulmonary atresia and tricuspid atresia, then TAPVR and HLHS. Say if HLHS must be earlier for a demo.
2. **Treatments in scope?** Recommend yes through Glenn; Fontan only after the rest is signed off.
3. **Clinician review owner** and the sources to treat as ground truth for each lesion.
4. **Acquired valve lesions** ride on the same engine; confirm they stay in the first release or move to a follow-up.
