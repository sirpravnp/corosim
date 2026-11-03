# Adult congenital lesions in the Simulator (decision D1)

Neonates left the Simulator (A2); newborn lessons stay on the Structural page. The Simulator keeps the atrial septal defect and gains
three adult lessons. They are entries of the structural lesion library (`src/sim/structural.ts`, `group: "congenital"`,
`patient: "adult"`), so they appear in the Valves tab's "Structural heart" dropdown under Congenital exactly as ASD does, open from the
Structural page's "Open in Simulator" link, round-trip through share links, and are recognised again from a loaded patient
(`lesionForHeart`). Nothing new is added to the engines: each is a combination of the existing structural fields (`vsd`, `pda`, `pvri`,
`rvContractility`, `rvSize`, `valves.pv`) read by the same oxygen, cath and pressure panels. Tests: `tests/congenitalAdult.test.ts` (slow).

| Lesion id | Sliders (default) | Structural fields built |
|---|---|---|
| `asd` (kept) | defect 12 mm | `asd` |
| `vsd-eisenmenger` | VSD 4 to 14 mm (8), pulmonary resistance 1.5 to 60 WU.m2 (40) | `vsd`, `pvri`, `rvContractility` 1 to 1.8 rising with resistance |
| `tof-repaired` | pulmonary regurgitation 0 to 1 (0.6), residual outflow narrowing 0 to 1 (0.2) | `valves.pv {open, reg}`, `rvSize` 1 + 2 x regurgitation |
| `pda-adult` | duct 1 to 10 mm (6), pulmonary resistance 1 to 30 (1.5) | `pda`, `pvri` |

## Measured values (defaults)

Structural engine (no reflexes) / Simulator core engine (reflexes, lung water), after 40 s warm-up and 30 s of run. Normal adult for reference:
aorta 110/65, PA 19/7, RV end-diastolic 115 ml, RV EF 0.62, SpO2 98 %.

| Lesion | Qp:Qs | SpO2 | Aortic pulse pressure | Other |
|---|---|---|---|---|
| ASD, 12 mm | 1.47 / 1.47 | 97.4 / 97.5 % | 38 / 38 | PA 20/5 |
| Adult PDA, 6 mm | 2.26 / 2.32 | 98 / 91.9 % | 65 / 68 (diastolic 28 / 48) | PA 31/18, shunt aorta to PA all cycle |
| Adult PDA, pvri 30, 8 mm | 1.05 | 96.6 pre-ductal, 84.3 post-ductal | 17 | reversed duct, bluer foot |
| VSD, early (pvri 5) | 2.10 / 2.12 | 97.9 / 95.6 % | 37 | PA 42/15, shunt left to right |
| VSD, Eisenmenger (pvri 40, 8 mm) | 0.87 (net VSD flow -6.8 ml/s) | 82.3 / 69.2 % | 25 / 23 | PA 68/54, RV 68 against aorta 66; right-to-left 0.82 vs left-to-right 0.41 L/min |
| Repaired TOF (reg 0.6) | 1.00 | 98 / 98 % | 42 | PR fraction 0.28 / 0.29, RV end-diastolic 210 / 222 ml (1.8 x normal, about 120 ml/m2), RV EF 0.45 / 0.44, PA diastolic 4 |

## Sources and assumptions

Citations are given from memory of the guidelines and reviews named; the numbers in the model are teaching values chosen to sit inside the ranges they report, not fitted to patients.

* **Eisenmenger.** Progression from a left-to-right VSD to reversal as pulmonary vascular resistance reaches or exceeds systemic, with
  suprasystemic-to-systemic RV and PA pressures and resting saturations of roughly 75 to 90 % (Beghetti and Galie, J Am Coll Cardiol 2009;53:733;
  ESC 2020 adult congenital heart disease guideline, Baumgartner et al., Eur Heart J 2021;42:563). The model has no pulmonary arteriolar
  remodelling: the stage is set by the resistance slider (pvri; 5 early, about 25 balanced, 40 fixed and reversed), and `rvContractility` rises
  with it to stand for RV hypertrophy. A fixed 8 mm defect equalises RV and LV systolic pressures at high resistance.
* **Repaired TOF.** Transannular patch or pulmonary valvotomy leaves free pulmonary regurgitation; moderate to severe PR is a regurgitant
  fraction above about 30 % (cardiac MRI practice; ACC/AHA 2018 adult congenital heart disease guideline, Stout et al., Circulation 2019;139:e698). The usual
  replacement threshold is an RV end-diastolic volume index of about 150 ml/m2; the default is below it (about 120 ml/m2, dilated but not at
  the threshold) and the slider passes it. RV dilation is set directly (`rvSize`), since the model has no remodelling over years.
  The VSD patch leaves no shunt. Residual outflow narrowing halves the pulmonary valve opening at most.
* **Adult PDA.** A moderate duct (Qp:Qs 1.5 to 2.5) with normal lung resistance gives a continuous aorta-to-PA shunt, a wide pulse pressure with
  low diastolic pressure, a volume-loaded left heart and a raised PA pressure (Schneider and Moore, Circulation 2006;114:1873; Baumgartner 2021).
  With resistance raised, the shunt narrows and reverses and the foot is bluer than the right hand (differential cyanosis).
* **ASD** is unchanged: 12 mm, Qp:Qs 1.5.

## Limits worth knowing

* **Lung water in the Simulator lowers the saturation of every high-PA lesion.** The core engine's lung-water model takes the pulmonary capillary
  pressure as PCWP + 0.4 x (mean PA - PCWP) (config/fluids.ts). In Eisenmenger and the high-resistance duct the pre-capillary arterioles
  protect the capillaries, which this formula cannot know, so the Simulator reads about 13 points lower than the structural engine (69 against 82 %)
  and the adult PDA about 6 points lower. The tests keep the Simulator's bars wider for that reason (Eisenmenger under 85 % and above 55 %; PDA above 88 %).
  The Simulator's Qp:Qs readout for Eisenmenger sits at 1.0 (it is not driven below 1); the reversal is shown by the structural engine, the
  saturation and the cath panels.
* No remodelling in time, no exercise, no erythrocytosis (Hb is fixed at 14 g/dl), no paradoxical emboli. The model has no reflex-driven spells, so the
  repaired-TOF lesson does not model arrhythmia (ventricular tachycardia in dilated RVs is a rhythm topic).
* Oximetric Qp:Qs and the flow ratio disagree by more than 10 % in the engine at very large pulmonary regurgitation (slider above about 0.65), where
  regurgitant blood re-enters the right ventricle; the default avoids it.
