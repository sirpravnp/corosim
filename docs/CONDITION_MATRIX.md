# Condition matrix

Every input the core engine accepts, the single-condition states to run, the interactions worth running, and a predicted hemodynamic picture for each meaningful interaction. A smaller Composer model runs the matrix. It does not change the engine.

Predictions are not owner spec cells. Do not write them into `scripts/eval/spec/*.csv`.

## How a prediction is labelled

| Basis | Meaning |
| --- | --- |
| measured | A number already recorded. The 8-seed snapshot is commit `4b7b4f7` (31 Oct 2026). Seed-1 stenosis and clock numbers are from `cursor/stenosis-and-clock-1f80` at `1aa7245`, not from that snapshot. |
| engine | A claim in code or in `docs/VALVES.md` (a gradient band, a procedure delay, a clamp). |
| directional | Order, sign, or which side of healthy. No invented magnitude. |
| invariant | A physical rule: fraction in 0..1, forward valve flow, no silent NaN stenosis, death only after sustained no-flow. |

When a row has both an **intended** picture and a **known-now** picture, record both. A miss against intended is a place the solver can change. A miss against known-now means this build is not the build that was measured.

## Anchor

Healthy resting adult, core engine, seed spread from `4b7b4f7` at 180 s: MAP about 87–95 mmHg (mean 89.8), CO about 5.1–5.2 L/min, chamber EF about 0.62, sinus, ischemic mass 0, infarct 0, no ST shift. Plan bands used in the evaluation: MAP 85–95, CO 4.8–5.5, EF about 0.62. Clinical time at speed 1 is 2 minutes per simulated second. Checkpoints below are simulated seconds.

Three ejection fractions stay labelled and are not collapsed: chamber `(EDV−ESV)/EDV`, aortic-valve stroke volume / LV EDV, and Fick stroke volume / LV EDV. Two coronary perfusion pressures stay labelled: CPP is aortic diastolic minus LVEDP; coronary driving pressure is the network's own driving pressure.

---

## 1. Catalog

Each row is one knob. A single-condition state turns that knob on and leaves everything else at the healthy adult.

### 1.1 Coronary arteries

Present in the typical right-dominant tree (`dominance: right`, `lm: bifurcation`, `saNodeFrom: RCA`, `conusOstium: shared`, `ladCourse: normal`):

| Id | Notes |
| --- | --- |
| LM | Absent when `lm` is `absent` (separate LAD and LCx ostia). |
| LAD | Territory shrinks when `ladCourse` is `short`, grows when `wrap`. |
| D1, D2 | Diagonals. |
| LCX, OM1, OM2 | Circumflex system. |
| RCA, AM, CONUS | Conus has a separate ostium when `conusOstium` is `separate`. |
| SAN | From the RCA in the typical tree. From the LCx when `saNodeFrom` is `LCx`. |
| AVN | From the RCA unless dominance is `left`. |
| PDA | Alias of `PDA_R` when right-dominant. `PDA_L` exists only when dominance is `left`. |
| PLV | Alias of `PLV_R` when right-dominant. `PLV_L` exists when dominance is `co` or `left`. |
| RAMUS | Exists only when `lm` is `trifurcation`. |

`LesionSpec`: `artery`, `stenosis` 0..0.99 (fractional diameter loss), `occluded`, `position` 0 proximal .. 1 distal. A non-numeric stenosis warns and drops the lesion. It must not become a silent 70%.

### 1.2 Anatomy

| Field | Levels |
| --- | --- |
| dominance | `right` (typical), `co`, `left` |
| lm | `bifurcation` (typical), `trifurcation`, `absent` |
| saNodeFrom | `RCA` (typical), `LCx` |
| conusOstium | `shared` (typical), `separate` |
| ladCourse | `normal` (typical), `short`, `wrap` |

### 1.3 Rhythms the core engine runs

`patient.rhythm` of `sinus` or `af` is the coronary model: rate and conduction follow ischemia and reflexes. Any other id must be in `SIM_RHYTHMS` (`src/physics/rhythmSource.ts`). Library ischemia tracings (`stemi-anterior`, `wellens-a`, `pericarditis`, `pe`, …) are not simulator rhythms. Do not set `patient.rhythm` to `hyperk` to imitate a high serum potassium. Serum potassium morphs the coronary tracing and adds a hazard floor on its own.

| Id | What the heart does |
| --- | --- |
| sinus / nsr | Coronary model, resting rate. |
| sinus-brady, sinus-tachy, sinus-arrhythmia | Library rates, about 46, 122, and a varying 68. |
| af | Coronary-model atrial fibrillation. No atrial kick. |
| af-rvr | Library AF near 148. |
| flutter-21, flutter-var | Atrial flutter, atrial strength about 0.3 of normal (`engine`). |
| mat | Multifocal atrial tachycardia near 112. |
| junctional, accel-junctional | About 48 and 82, no atrial kick. |
| svt | AVNRT near 182. |
| wpw | Pre-excitation pattern on a sinus mechanism. |
| avb1 | Long PR, 1:1. |
| wenckebach, mobitz2, avb-21 | Dropped beats. |
| chb, chb-wide | Complete block, escape about 40 or 32. External pacing over a library rhythm is not modelled (`engine`, comment in `rhythmSource.ts`). |
| rbbb, lbbb, lafb, bifascicular | Conduction delay. `patient.bbb` is `none`, `rbbb`, or `lbbb` and can sit on top of a coronary-model sinus. |
| pvc-bigeminy | Every other beat is a PVC. |
| aivr | Ventricular rhythm near 78. |
| vt-mono | Monomorphic VT near 172. Ventricular strength 0.6, systole 1.25× (`engine`). |
| vt-poly, torsades | Polymorphic. Strength 0.35, systole 1.45× (`engine`). |
| vf-coarse, vf-fine | No ventricular contraction. Strength 0. |
| asystole | No ventricular contraction. |
| paced | Ventricular paced near 70. Strength 0.9 (`engine`). |
| hyperk, hyperk-sine, hypok, long-qt, hypothermia | Library morphologies. They do not read `electrolytes`. |

### 1.4 Valves

Four valves: `av`, `mv`, `tv`, `pv`. Native severity is 0..1 on each of stenosis and regurgitation, built with `valveSet` (`src/sim/valves.ts`). Full stenosis leaves `1 − span` of normal area (`span` 0.85, pulmonary 0.9). Regurgitant area is `severity × REGURG_AREA_FRAC × normal area`.

Prosthesis kinds: `bioprosthetic`, `mechanical`, `transcatheter`. Sizes are the labelled millimetres in `PROSTHESIS_EOA`. Extra fields: `leak` cm², `obstruction` 0..1, `inRing` (valve-in-valve, EOA × 0.8). Mechanical closing leak is 0.03 cm². Transcatheter trace leak is 0.02 cm². A bioprosthesis has none (`engine`).

Interventions, via `intervene`, then `apply({ heart })`:

| Action | Valves | Effect (`engine`) |
| --- | --- | --- |
| replace | all four | Native lesion replaced by the prosthesis. |
| tavr | aortic | Transcatheter aortic valve. |
| balloon | aortic, mitral, pulmonary | Area gain up to a ceiling, plus a small new leak. Not for a prosthesis. Not for the tricuspid valve. |
| teer | mitral, tricuspid | Each clip keeps a fraction of the regurgitant orifice and takes area off the opening. 1..4 clips. |
| repair | mitral, tricuspid | Annuloplasty: leak falls sharply, opening mostly kept. |

`docs/VALVES.md` gradient claims to check, not to invent past: severe aortic stenosis mean gradient about 50 mmHg on the eval snapshot (measured 47–51 at 60 s); adding mitral regurgitation drops that gradient (the doc says about 5 mmHg; the snapshot drop was about 1). Aortic prosthesis mean gradient: mechanical above a trivial native valve, bioprosthesis about 15 (band 11–18), 26 mm TAVR about 8–13, valve-in-valve higher than a lone TAVR.

### 1.5 Shunts, congenital, chamber, muscle

| Knob | Levels to test | Clamp |
| --- | --- | --- |
| asd.diameterMm | 0, 5, 15, 30 | 0..40 |
| vsd.diameterMm | 0, 3, 8, 20 | 0..40 |
| pda.diameterMm | 0, 2, 4, 8 | 0..40 |
| bt.diameterMm | 0, 3, 5 | 0..40 |
| tof.vsdMm, rvotFrac, spasm, override, rvHypertrophy | one moderate tetralogy and one with spasm | as in `clampStructuralSpec` |
| pvri | 1, 3, 8, 20 Wood units·m² | 0.2..60 |
| svrScale | 0.5, 1, 2 | 0.1..5 |
| satLung | 0.75, 0.98 | 0.3..1 |
| volumeMl | −500, +500 | −1000..5000 |
| lvSize, rvSize, laSize, raSize | 0.5, 1, 1.8 | 0.05..4 |
| lvEes, rvEes | 0.4, 1, 2 | 0.2..5 |
| lvStiffness, rvStiffness | 0.5, 2 | 0.2..5 |
| rvContractility | 0.4, 2 | 0.2..5 |
| septum | false, true | boolean |

Shunts of a few litres per minute are still "No murmur" until the flow grades in `murmurOf` (ASD and PDA about 1.5 L/min, VSD about 2, Blalock–Taussig about 1). Valve grades must not change because a shunt was added (`engine`, after the guards change).

### 1.6 Pericardium

| Knob | Levels | Clamp |
| --- | --- | --- |
| effusionMl | 0, 100, 400, 800 | 0..2000 |
| effusionRateMlMin | 0, 20 | 0..100 |
| stiffness | 0.5, 1, 4 | 0.2..10 |
| open | false, true | boolean |
| drainMl | 100 on an 400 ml effusion | action, not a stored field |

### 1.7 Blood and fluids

| Knob | Levels | Notes |
| --- | --- | --- |
| bloodLoss | −0.3, −0.2, 0, 0.15, 0.3, 0.45, 0.6 | Fraction of blood volume. Negative is overload. Clamped to −0.3..0.6. |
| fluids.hemorrhageMlMin | 0, 20, 100 | Ongoing bleed, ml/min. 100 ml/min empties the circulation. |
| fluids.given | 1 L crystalloid over 5 min; 500 ml blood; 500 ml albumin | Kinds: crystalloid, colloid, albumin, blood. |
| support.fluids | 0, 0.5, 1.5, 3 | Litres of crystalloid on the support dial. Cap 3. |
| fluids.capillaryLeak | 0, 0.6 | 0..1 |
| fluids.legRaise | false, true | Shifts up to about 350 ml, then fades over about 20 clinical minutes. |

### 1.8 Drugs and support

| Knob | Levels |
| --- | --- |
| drugs.betaBlocker | 0, 0.8 |
| drugs.atropine | 0, 1 |
| drugs.vasopressor | −1, 0, 1 |
| support.norepinephrine | 0, 0.5, 1 |
| support.dobutamine | 0, 0.5, 1 |
| support.nitroglycerin | 0, 0.5, 1 |
| support.epinephrine | 0, 0.5 |
| support.milrinone | 0, 0.5 |
| support.vasopressin | 0, 0.5 |
| support.nitroprusside | 0, 0.5 |
| support.furosemide | 0, 1 |
| support.diltiazem | 0, 0.5 |
| support.pacing | off, on at 70, on at 40, on at 110 |
| ectopyTendency | 0, 1, 3 |
| arrhythmiaTendency | 0, 1, 3 |
| electrolytes.potassium | 2.0, 3.0, 4.2, 6.0, 7.5 |
| electrolytes.magnesium | 0.2, 0.9, 3.0 |
| autonomic.baroreflexGain | 0, 1, 4 |
| autonomic.setPointShift | −10, 0, +10 |
| exertion | false, true |

Potassium 4.2 is quiet. Potassium 7.5 with no ischemia has a VT/VF hazard above 0 and a taller, narrower T on the coronary tracing. Tendency 3 is higher than tendency 1. Magnesium still uses its own factor. A run from the potassium floor is cause `electrolyte`, not `scar`.

### 1.9 Devices

`apply` retunes a device that is already in the heart. ECMO and CoroPump RP are inserted by `setPatient` when `devices` is present. The eval harness already does that. CoroPump CP is on only when `support.coroPump` is true and level > 0. CoroPump RP and ECMO are on by being present. `deviceFlow` does not include CoroPump RP flow.

| Device | Levels |
| --- | --- |
| iabp | off; 1:1, 1:2, 1:3; inflate −40 ms and +40 ms; volume 20 and 40 ml |
| coroPump | off; CP level 6 correct; models 2.5, CP, 5.5 at level 9; position `aortic` and `deep`; level 0 |
| coroPumpRp | absent; level 0; level 9 |
| ecmo | absent; 2, 4, and 6 L/min; sweep 0 and 5; FiO2 0.21 and 1 |
| ecmo + coroPump | ECPELLA: ECMO 4 L/min and CoroPump CP level 6 |

Level 0 CoroPump RP must not run retrograde (`engine`, guards).

### 1.10 Ventilation

`mode` `spontaneous` or `positive`. PEEP 0, 5, 15 cmH2O. Tidal volume 4 and 8 ml/kg.

### 1.11 Actions

These are not a resting insult. They fire at a simulated time.

| Action | Timing (`engine`) |
| --- | --- |
| revascularize(`pci`) | 60 clinical minutes, about 30 sim seconds at speed 1 |
| revascularize(`lysis`) | 40 clinical minutes; success about 55%; residual stenosis 0.5 |
| revascularize(`cabg`) | 240 clinical minutes; the graft does not erase the native lesion |
| startCpr, shock, giveDrug(`epinephrine`) | Arrest. ROSC needs a perfusing rhythm and output held 10 s. |
| pericardium.drainMl | Removes that many ml now. |
| intervene then apply heart | Balloon, clip, repair, replacement. |

### 1.12 Not a simulator input

Library STEMI and mimic presets. Neonate `kind` (dropped; the patient becomes an adult). A second lesion on the same artery (dropped). Pacing over a library rhythm. Serum potassium driving the library `hyperk` painter.

---

## 2. Single-condition states

Generate these. Id prefix `mx-`. One insult on the healthy adult. Suite `matrix`, `invariantsOnly: true`. Do not set `seeds` on the state.

Checkpoint choice:

- Drugs, valves, shunts, devices, volume dials, rhythms that are not VF: `[60]`.
- Coronary stenosis and occlusion: `[60, 180]`.
- Untreated VF, asystole, polymorphic VT: `[5, 20, 40]`. Do not run untreated VF out to 180 s and call it six hours.
- Ongoing 100 ml/min bleed: `[60, 180]`, and allow death.

### 2.1 Lesion grid

For LM, LAD, LCX, RCA at position 0.2: stenosis 0.5, 0.7, 0.75, 0.85, 0.9, and occluded.

For LAD, LCX, RCA: also occluded at position 0.5 and 0.9.

For D1, D2, OM1, OM2, AM, CONUS, SAN, AVN, PDA, PLV: stenosis 0.8 and occluded, position 0.3.

**Intended** (directional, plus the LAD seed-1 curve measured at `1aa7245`):

| Pattern | Picture |
| --- | --- |
| Rest stenosis ≤ 0.6 on LM, LAD, LCX, or RCA | Mass under 0.05, EF within 0.05 of 0.62, ST within 0.3 mm of 0, sinus, MAP within 10 mmHg of healthy. |
| Proximal LAD 0.7 rest | Partial mass, about 0.02–0.20, EF still above 0.5, not a full anterior STEMI. Measured seed 1: mass 0.067, EF 0.59. |
| Proximal LAD 0.75 rest | Mass above the 0.7 case, EF lower. Measured seed 1: mass 0.250, EF 0.46. |
| Proximal LAD 0.9 or occlusion | Mass near 0.4, V2 and aVL positive, III negative, EF under 0.45, filling pressure up. Occlusion on the 8-seed snapshot: HR mean 87 (one seed in VF), MAP about 75, CO about 3.5, EF about 0.27, PCWP about 21, LVEDP about 22, mass 0.43, infarct about 0.41, V2 about +3.5, III about −3. |
| Proximal RCA occlusion | Inferior ST (III and aVF up, V2 down), slower rate, often AV block, RV ischemia, MAP well below healthy. 8-seed snapshot: HR about 32, MAP about 54, CVP about 13, infarct about 0.19, mass 0.34. |
| Proximal LCx occlusion | Lateral or posterior territory, smaller anterior ST than a proximal LAD, mass below an LAD occlusion. Directional. |
| LM occlusion | Larger mass than LAD, lower MAP and EF, widespread ST, low SpO2 when the output collapses. 8-seed snapshot: MAP about 50, EF about 0.11, PCWP about 33, SpO2 about 0.65. |
| Branch occlusion | Mass below the parent epicardial occlusion. MAP closer to healthy than LM. Directional. |
| Distal occlusion versus proximal | Less mass, smaller ST, higher EF than the proximal occlusion of the same artery. Directional. |

**Known-now** if the stenosis-curve change is not in the build: rest LAD stays near healthy through 70% and the territory appears abruptly near 75%. Report which of the two pictures you got.

### 2.2 Anatomy, with no lesion

Each non-typical level alone. Intended: hemodynamics within the healthy band. Mass 0. The tree contains the extra or missing branches (ramus, PDA from the LCx, no left main). Directional. A change in resting MAP or EF is a finding.

### 2.3 Rhythm singles

One state per rhythm in section 1.3, healthy heart, no lesion.

| Rhythm | Intended |
| --- | --- |
| sinus-brady | HR near 46, MAP and CO below the resting sinus, still perfusing. Directional. |
| sinus-tachy | HR near 122, pulse pressure narrower than rest. Directional. |
| af | Irregular, no atrial kick, CO a little below sinus, MAP still in or near the healthy band. Directional. |
| af-rvr, svt, flutter-21 | HR well above 120, CO and MAP below sinus because filling time is short. Directional. |
| avb1 | HR near sinus, long PR, MAP near healthy. Directional. |
| wenckebach, mobitz2, avb-21 | Ventricular rate below the atrial rate. Directional. |
| chb, chb-wide | Ventricular rate near the escape (about 40 or 32), not 70, label does not say paced. Engine. |
| vt-mono | HR near 170, MAP below sinus, still some pulsatile pressure on a healthy heart. Engine: strength 0.6, short filling. |
| vt-poly, torsades | Very fast, little useful pressure. Engine: strength 0.35. |
| vf-coarse, vf-fine, asystole | No organized output. MAP falls toward filling pressure. HR readout 0 for VF. Invariant: not dead on the first beat. |
| paced | HR near 70, EF a little below sinus. Engine: strength 0.9. |
| lbbb, rbbb | Wide QRS, MAP and CO near sinus. Directional. |
| hyperk library rhythm | The library shape, not a serum-potassium effect. Say so in the report. |

### 2.4 Valve singles

Native, one valve at a time: stenosis 0.5 and 1, regurgitation 0.5 and 1. Then each prosthesis kind at its default size on the aortic valve, plus a 19 mm aortic bioprosthesis (mismatch) and a 26 mm TAVR. Pulmonary and tricuspid: stenosis 1 and regurgitation 1 only. Mitral: the same four native levels.

| Lesion | Intended |
| --- | --- |
| Severe aortic stenosis | Mean gradient about 40–60 mmHg, LV systolic pressure well above aortic systolic pressure, slow upstroke. Measured 8-seed at 60 s: mean gradient 47–51, LV peak about 175, aortic SBP about 110. |
| Severe aortic regurgitation | Wide pulse pressure, low aortic diastolic pressure, large LV stroke volume. Directional. |
| Severe mitral regurgitation | Regurgitant fraction well above 0.3, pulmonary venous and LA pressure up. Measured chronic severe MR fraction about 0.47. |
| Severe mitral stenosis | LA pressure up, cardiac output down, mitral gradient present. Directional. |
| Severe tricuspid regurgitation | CVP up, pulsatile RA pressure. Directional. |
| Severe pulmonary stenosis | RV systolic pressure above PA systolic pressure. Directional. |
| 23 mm mechanical AVR on a normal annulus | Small mean gradient, regurgitant volume above 1 ml from the closing leak. Measured mechanical snapshot mean gradient about 13, regurgitant volume about 5.5. |
| 26 mm TAVR | Mean gradient at the top of about 8–13. Measured about 13. |
| Valve-in-valve | Gradient above a lone TAVR of the same labelled size. Engine: EOA × 0.8. Measured about 25 against "about 15". |

Gorlin and Hakki areas stay null when the mean gradient is under the floor (aortic 10 mmHg, mitral 2 mmHg) or when the valve does not open. That null is a contract, not a bug.

### 2.5 The rest of the singles

One state per level in sections 1.5–1.10. Predictions:

| State | Intended |
| --- | --- |
| ASD 15 mm, VSD 8 mm, PDA 4 mm, PVRI normal | Left-to-right shunt, Qp:Qs above 1.2, aortic saturation still high, murmur text names the shunt once flow is past the grade. Directional. ASD 15 mm was about 2.5 L/min on an earlier read. |
| Same shunts with PVRI 20 | Qp:Qs falls. A large VSD or PDA can reverse. Directional. |
| Tetralogy, rvotFrac well below 1 | Right-to-left or balanced shunt, lower aortic saturation than an isolated VSD. Directional. |
| lvEes 0.4 | EF down, LVEDP up, CO down. Directional. |
| rvSize 0.5 and raSize 2 | Right-sided volumes follow the scale. Pressures must stay finite. Invariant. |
| Effusion 400 ml, stiffness 1, septum on | Pulsus, low output, equalization of diastolic pressures if the sac constrains. Directional. Open pericardium: the same effusion does not constrain. Directional. |
| bloodLoss 0.15, 0.3, 0.45 | Graded tachycardia and a falling filling pressure, no ST, not dead at 6 h. Measured on the 8-seed snapshot for the three hemorrhage states. |
| bloodLoss −0.2 | Higher filling pressure, no ST. Directional. |
| hemorrhage 100 ml/min | Stressed volume reaches 0 and the patient can die with cause `noFlow` after the empty circulation is held, not on one beat. Known-now before the guards change: dead stayed false. Report which you got. |
| Norepinephrine 0.5, healthy | MAP up, HR flat or down. Measured: MAP about 99, HR about 65. |
| Dobutamine 0.5, healthy | HR, CO, and EF up. Measured: HR about 78, CO about 5.5, EF about 0.66, MAP about 92. |
| Nitroglycerin 0.5, healthy | MAP and filling pressure down, no ST. Directional. |
| Beta blocker 0.8 | HR down. Directional. |
| Potassium 7.5, tendency 1, no lesion | Coronary T taller than at 4.2, hazard above 0, not the library sine wave. Potassium 4.2 stays quiet over six clinical hours. Engine, and the potassium tests. |
| Potassium 2.0 | Flatter T than 4.2, hazard above 0. Directional. |
| CoroPump CP level 6, healthy | Forward device flow, native EF lower than chamber EF would suggest once the pump carries stroke volume. The two EF definitions may differ by about 0.1. Known split: about 0.30 versus 0.13 in one CoroPump read. |
| CoroPump RP level 0 | Flow near 0, not about −1 L/min. Engine. |
| CoroPump RP level 9, healthy | Forward flow about 3–4 L/min, and that flow is not inside `deviceFlow`. |
| ECMO 4 L/min, healthy | Circuit flow near the target, native pulse pressure narrow. Directional. |
| PEEP 15, spontaneous versus positive | Positive pressure with PEEP lowers venous return. MAP and CO at or below spontaneous. Directional. |
| Baroreflex gain 0 versus 4, no other insult | Little difference at rest. The difference appears once volume is lost (section 3). |

---

## 3. Interaction states

Only combinations where one knob should change the other's picture. Skip the full cross product.

### 3.1 Stenosis and demand or anatomy

| Id story | Intended |
| --- | --- |
| LAD 0.6 rest versus exertion | Exertion ischemic; rest quiet or nearly so. Measured seed 1 on the stenosis branch: exertion at 60% had mass about 0.10 while rest at 60% was 0. At 70%, exertion mass was far above rest. |
| RCA 0.75 and LCX 0.75, rest versus exertion | Same direction: exertion worse. Directional. |
| RCA occlusion, dominance right versus left versus co | Right-dominant: inferior ST, slower rate, often block, mass of the RCA territory. Left-dominant: less inferior mass, sinus more often, PDA not supplied by the RCA. Seed-1 probe: left-dominant RCA occlusion mass about 0.13 and sinus, against right-dominant mass 0.34 and block. |
| LAD occlusion, course normal versus short versus wrap | Wrap: more mass and more anterior-inferior ST. Short: less mass. Directional. |
| LAD occlusion plus LBBB, and plus RBBB | ST still present. LBBB distorts the anterior leads. The rhythm label names the block. Directional. |
| LAD 0.8 plus RCA 0.8 | Mass and ST of both territories, lower CO than either lesion alone. Directional. |
| LM occlusion versus LAD occlusion plus LCX occlusion | Both are a large left-sided infarct. LM should be at least as severe. Directional. |
| SAN occlusion with `saNodeFrom: RCA`, and the same lesion with `saNodeFrom: LCx` | Only the anatomy that actually feeds the node should slow the sinus rate. Directional. |
| AVN occlusion, right-dominant versus left-dominant | Block only when the occluded vessel is the one that feeds the node. Directional. |

### 3.2 Ischemia and treatment

| Id story | Intended |
| --- | --- |
| Proximal LAD occlusion, PCI ordered at 2 s, 30 s, and 60 s | Infarct at 180 s rises with the delay. Flow returns, so ischemic mass after a successful PCI is near 0 while infarct stays. Seed-1 probe: order at 2 s infarct about 0.13; at 30 s about 0.25. The 60 s order can be confounded by VF. |
| Lysis at 20 s | Some seeds reperfuse (plan band about 55%, wide). Residual stenosis remains. Engine: success 0.55, residual 0.5. Do not treat one seed as a rate. |
| CABG ordered at 5 s | Native lesion remains. Ischemic mass need not go to 0. Directional, and the seed-1 probe still had mass at 180 s. |
| LAD occlusion plus norepinephrine 0.5 | MAP above the untreated occlusion, EF not better, demand higher. Engine: afterload loss scales with LV ischemia. |
| LAD occlusion plus dobutamine 0.5 | EF and CO above the untreated occlusion, more ectopy. Engine. |
| RCA occlusion plus nitroglycerin 0.5 | Preload loss hurts the ischemic right ventricle: CO and MAP fall more than the same dose on a healthy heart. Engine: `nitroPreloadRv`. |
| LAD occlusion plus IABP 1:1 | Coronary driving pressure or diastolic augmentation up, a modest CO gain. Engine. |
| LM occlusion plus CoroPump CP level 9 | Device flow forward, lower LVEDP than unsupported LM, chamber EF and aortic-valve EF allowed to disagree. |
| RCA occlusion plus CoroPump RP level 9 | Forward RP flow about 3–4 L/min while the right ventricle is ischemic, HR still follows the RCA rhythm (often block). `deviceFlow` stays 0. |
| LM occlusion plus ECMO 4 L/min, no vent | Circuit flow near target, native ejection small, left-sided pressures may rise. Weiss tau may be null. Known-now. |
| ECMO 4 plus CoroPump CP | Higher total device flow than ECMO alone, lower LVEDP than ECMO without a vent. Directional. |
| LAD occlusion, potassium 7.5, arrhythmiaTendency 3 | More VT/VF than the same lesion at potassium 4.2 and tendency 1. One seed is not a rate. Directional. |
| Potassium 7.5, tendency 1, no lesion, versus the same plus a proximal LAD | The lesion's ischemic hazard stacks on the electrolyte floor. Directional. |

### 3.3 Valves together, and valves with a lesion or a drug

| Id story | Intended |
| --- | --- |
| Severe aortic stenosis plus moderate mitral regurgitation | Aortic gradient a little below stenosis alone, mitral regurgitant volume above the regurgitation alone. Engine, `valves.ts` header. Measured drop in mean gradient was about 1 mmHg, not the doc's about 5. Report the gap. |
| Severe aortic regurgitation plus mitral stenosis | LV filling constrained, CO below either lesion alone. Directional. |
| Severe mitral stenosis plus mitral regurgitation | Both a gradient and a regurgitant fraction. Directional. |
| Severe aortic stenosis plus proximal LAD 0.8 | LVEDP rises and EF falls more than either insult alone. An earlier note: LVEDP 8.6 to 16.8 and EF 0.60 to 0.37 across the pair. |
| Severe aortic stenosis plus dobutamine 0.5 | Gradient rises with the higher output. Directional. |
| Severe mitral regurgitation plus norepinephrine 0.5 | Regurgitant fraction does not fall just because MAP rose. Directional. |
| Mechanical AVR 23 mm, then a 26 mm TAVR inside it | Blocked: a transcatheter valve cannot sit in a mechanical valve. Engine. Warning, valve unchanged. |
| Failed 23 mm aortic bioprosthesis (`obstruction` 0.5), then TAVR in-ring | Gradient falls versus the obstructed surgical valve, but stays above a lone 26 mm TAVR. Engine. |
| Severe mitral regurgitation, then two-clip TEER | Regurgitant fraction down, a small transmitral gradient may appear. Engine. |
| Severe aortic stenosis, then balloon, effect 1 | Area up, a little new regurgitation, gradient down. Engine. |
| Severe tricuspid regurgitation, then balloon | No change. Balloon is not offered. Engine. |

### 3.4 Volume, reflexes, pericardium, ventilation

| Id story | Intended |
| --- | --- |
| bloodLoss 0.3, baroreflex gain 0 versus 4 | Gain 0: lower HR and lower MAP than gain 4. Seed-1 probe: gain 0 about HR 91 and MAP 66; gain 4 about HR 98 and MAP 88. |
| bloodLoss 0.3 plus leg raise | More blood volume and a higher MAP than the same bleed with leg raise false, during the first 20 clinical minutes. Engine. |
| bloodLoss 0.3 plus norepinephrine 0.5 | MAP above the untreated bleed. Directional. |
| Hemorrhage 100 ml/min plus norepinephrine 1 | Pressor does not replace volume. Death can still occur. Directional. |
| bloodLoss 0.3 at speed 1, 3, and 6, read at 10 clinical minutes | HR within about 5% and MAP within about 8% of the speed-1 value. Measured seed 1 after the clock fix: HR 74.1 / 73.1 / 73.3, MAP 82.5 / 87.6 / 87.6. |
| Effusion 400 ml, septum off versus on | Septum on: the left ventricle is smaller because the right side bows into it. Directional. |
| Effusion 400 accumulating at 20 ml/min, then drain 150 ml at 60 s | Output rises after the drain. Directional. |
| Effusion 800 plus PEA-range output | Narrow pulse pressure, pulsus, electrical activity still present. Directional. |
| PVRI 8, septum on, plus nitroglycerin 0.5 | CO falls more than nitroglycerin on a healthy heart. Directional. |
| PEEP 15, positive pressure, plus bloodLoss 0.3 | CO below either insult alone. Directional. |
| satLung 0.75 plus pulmonary edema from bloodLoss −0.2 and a stiff LV (`lvStiffness` 2) | Arterial saturation below healthy. Directional. |

### 3.5 Rhythm, pacing, arrest, electrolytes

| Id story | Intended |
| --- | --- |
| Library `chb` plus pacing at 70 | Rate stays near the escape, not 70. Engine: pacing over a library rhythm is not modelled. |
| RCA occlusion that has produced block, plus pacing at 70 | Rate captures near 70 and the label can say paced. Seed-1 probe did this. Contrast with the row above. |
| AF plus pacing at 70 | Pacing does not organize AF into a paced ventricular rhythm unless the engine's own rule says the rate is at or below the pace rate and the rhythm is sinus or AF. Read `paced()` and report what you got. |
| VT on a healthy heart versus VT on a proximal LAD occlusion | Healthy VT keeps more pressure. The occlusion degenerates or loses output sooner. Engine comment in `rhythms.ts`. |
| VF, no CPR, read at 20 s | Not dead yet if the no-flow clock is longer than that. Output about 0. |
| VF plus CPR plus epinephrine plus a shock | ROSC is counted only after 10 s of perfusion. A checkpoint at 25 s can be too early. The stochastic eval used 40 s. |
| Potassium 4.2, magnesium 0.2, tendency 3, no lesion | Magnesium raises hazard. Less than potassium 7.5 at the same tendency, or say if it does not. Directional. |
| Potassium 7.5 plus magnesium 3 | High magnesium should blunt the potassium hazard relative to magnesium 0.9. Directional. If it does not, that is a finding. |
| Ectopy tendency 0 plus proximal LAD occlusion | Few or no PVCs despite ischemia. Tendency 3 on the same lesion: more PVCs. Directional. |

### 3.6 Devices that fight each other

| Id story | Intended |
| --- | --- |
| CoroPump position `aortic` versus `correct`, on a proximal LAD occlusion | Aortic position alarms or flows less. Placement is not "correct". Directional. |
| CoroPump position `deep` | Suction or a worse unloading pattern than `correct`. Directional. |
| IABP inflate +40 ms versus 0, on a proximal LAD occlusion | Late inflation augments less. Directional. |
| ECMO FiO2 0.21 versus 1, on an LM occlusion with hypoxemia | Return saturation and arterial saturation higher at FiO2 1. Directional. |
| ECMO 4 L/min plus bloodLoss 0.45 | Flow falls or suction appears because venous volume is gone. Directional. |
| CoroPump level 0 with `support.coroPump` true | No forward flow. Distinct from "device absent". |

---

## 4. What to record

At every checkpoint, for every state, seed 1: HR, MAP, CO, chamber EF, aortic-valve EF, Fick EF when the row has a shunt or a low output, PCWP, LVEDP, CVP, rhythm label, ischemic mass, infarct fraction, V2, aVL, III, aVF, Qp:Qs, SpO2, device flow, CoroPump RP flow, ECMO flow, dead, death cause, and the warnings array.

Also the invariant pass. A null that the invariant list already allows (Gorlin under the gradient floor, tau with no falling limb, Fick EF with no rate) is not a new finding. A crash is.

---

## 5. Instructions for the Composer model

You are a smaller Composer model. Execute this file. Do not redesign it.

1. Branch from `cursor/solver-probe-scenarios-1f80` with a name `cursor/condition-matrix-run-1f80`. If the stenosis, potassium, or guards pull requests have merged into the branch you were told to test, use that branch instead and say so at the top of the report. Do not merge them yourself.
2. Do not edit `src/`. Do not edit `tests/fixtures`. Do not fill expectation cells in `scripts/eval/spec/*.csv`.
3. Add `scripts/eval/matrix.ts` that exports `matrixStates(): State[]`, following `scripts/eval/probe.ts`. Suite `"matrix"`. `invariantsOnly: true`. Id prefix `mx-`. Build the singles from the tables in section 2 and the interactions from section 3. Use `valveSet` and `intervene` for valves. Use the existing revascularize, CPR, shock, and drug helpers the probe file uses.
4. Register the suite where `probe` is registered (`states.ts`, `run.ts` list padding and the skip message, `report.ts` one line per state). Do not add `matrix` to `DEFAULT_SUITES`. The nightly job must not run it.
5. Typecheck until `npx tsc --noEmit -p . 2>&1 | grep scripts/eval` prints nothing.
6. Run seed 1 only: `npx tsx scripts/eval/run.ts observe --suite matrix --seeds 1`. Then `npx tsx scripts/eval/run.ts check --suite matrix --invariants-only --seeds 1`. Do not pass `--seeds 1` in a way that the state object's own `seeds` field would ignore. Do not set `seeds` on the states.
7. Score each row against section 2 and section 3. Write `docs/MATRIX_REPORT.md` with one line per state: id, the numbers you recorded, `match` or `miss` against intended, `match` or `miss` against known-now when that column exists, and the basis. Group the misses at the top under "where the solver can change". Do not propose code changes in that file beyond naming the subsystem (network, valves, autonomic, devices, rhythm).
8. Commit the harness and `docs/MATRIX_REPORT.md`. Do not commit `scripts/eval/out/`. Push and open a pull request onto the branch you started from.
9. If a state crashes, record the error and continue. Do not "fix" the crash in `src/`.
10. Stochastic rates (lysis success, ROSC, VT on ischemia) need 24 seeds and a Wilson interval, and only for the three rows marked as rates. One seed is an anecdote. Say so.
11. Keep chamber EF, aortic-valve EF, and Fick EF as three numbers. Keep CPP and coronary driving pressure as two numbers.
12. Time is America/New_York when you write a timestamp.

A full seed-1 pass is on the order of a few hundred states. Coronary rows are the slow ones. If you must split the work, split by section (lesions, valves, interactions) into separate commits on the same branch, and do not drop a section.

## 6. Known findings to rediscover, not to silence

These were already true on the 8-seed snapshot. Matching them is a successful run, not a regression to hide.

- Weiss tau is often null on a pulsatile ischemic beat, and absurd or null on VA-ECMO without a vent.
- Right-atrial A wave is null in some sinus ischemic beats.
- Stressed volume hits 0 in a 100 ml/min bleed by 180 s.
- Gorlin area is null when the valve is shut or the gradient is under the floor.
- Aortic-valve EF can leave 0..1 when the LV is at the schema's small size, while chamber EF stays in range.
- LA volume can go negative in a large effusion.
- Library complete heart block does not capture when paced. Ischemic complete heart block can.
- Qp:Qs by flow and Qp:Qs by Fick can still differ by a few hundredths after the Fick cardiac-output identity. Fick cardiac output itself should match flow cardiac output on a healthy heart once that oxygen-path change is in the build.
- Death does not flip back to alive. Infarct does not shrink.
