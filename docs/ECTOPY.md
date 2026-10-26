# Ischemic ventricular ectopy (core engine, task B3a)

The premature-ventricular-beat (PVC) half of the ischemic arrhythmia model. Code: `src/physics/ectopy.ts`; every constant with its
source or `[assumed]` and the behaviour it controls: `src/config/ectopy.ts`. Tests: `tests/ectopy.test.ts` (rate model and beat
generator, 40 seeds, no hemodynamics, on the rig in `tests/ectopyRig.ts`) and `tests/ectopySim.test.ts` (the full Simulation,
slow). The legacy engine (game page, daily cases, `tests/fixtures/acs.json`) keeps the old rule untouched.

## The old rule and why it went

Per sinus beat, probability 0.35 x ectopy, ectopy rising from 0 at a whole-heart "global severity" of 0.6 to 1. Any large infarct
gave about 25% of all beats as PVCs, for every patient, for as long as the artery stayed shut, and dropped to 0 within a minute of
reperfusion; a distal LAD or a diagonal gave none; no PVCs during complete heart block. Clinically ectopy varies a great deal between
patients, scales with infarct size, peaks early and often bursts on reperfusion.

## The model

Per eligible ventricular beat (sinus-conducted, AF or escape beat: the ischemic myocardium fires whatever drives the ventricles)
the expected number of PVCs is

    rate = S x tendency x exp(2.3 (sympathetic x (1 - betaBlock) - 0.3)) x (1 + 0.6 beta1Drive) x K x Mg
           x [ 0.07 H(b) T(age) + 0.15 H(burst) + 0.05 H(tail) ]

- **b**, the weighted burden: sum over beds of severity x mass x (0.25 + 0.75 x transmurality). Transmural (occlusion-type) ischemia
  counts in full, subendocardial (demand) ischemia at a quarter.
- **H(x)** = y^2 / (1 + y^2), y = (x - 0.01) / 0.25 for the ischemic term (zero below 1% of the myocardium, smooth above); the
  reperfusion stores use the same curve without the floor. In this anatomy a proximal LAD occlusion has b = 0.43 (H 0.74), mid LAD
  0.28 (0.55), circumflex 0.21 (0.40), distal LAD 0.10 (0.11), first diagonal 0.08 (0.07).
- **T(age)**, time since onset of the ischemic episode in clinical minutes:
  (1 - e^(-t/3)) x (0.85 e^(-t/120) + 0.12 e^(-t/720) + 0.03). Peak in the first hour; the first-hour mean is about 7 times the
  value at 8 hours. An hour without ischemia ends the episode (a new occlusion starts a new hyperacute phase). A patient loaded with
  its ischemia already settled starts 40 clinical minutes into the episode (the 20 s the ischemia takes to develop), so a paused
  clinical clock does not hold it at the zero of onset.
- **Reperfusion**: each fall of b by at least 0.02 (the deadband keeps the perfusion-pressure swings of a steady lesion out) adds
  fall x W(age) to a burst store (time constant 30 clinical min) and a tail store (480 min).
  W(d) = (1 - e^(-d/12)) x (0.4 + 0.6 e^(-d/480)): nothing after a minute of ischemia, most after 15-60 min, less after many hours.
- **S**, the patient's susceptibility: lognormal, median 1, sigma 1.2 (natural log), fixed by the scenario seed. **tendency** is the
  scenario's `ectopyTendency` (0..3; 0 = no PVC ever).
- Sympathetic tone is the autonomic model's cardiac tone (rest 0.3); the beta-1 drive is the receptor-level drugs' (dobutamine,
  epinephrine, norepinephrine), with the multiplier the old rule used. **K**, **Mg**: electrolyte hooks, 1 for now.

Then, per beat: p = 0.4 (1 - exp(-rate x N x M / 0.4)), where N = exp(0.5 z - 0.125) is a slow random factor (z an Ornstein-Uhlenbeck
process, 90 s correlation in heartbeat time, mean 1) and M = 4 for the beat right after a PVC (so bigeminy runs happen), else 1. A
PVC is followed directly by a second (couplet) with probability min(0.2, 0.05 + 0.3 p); nothing longer. Coupling interval
RR x clip(0.6 (1 + 0.08 gaussian), 0.42, 0.78); the next sinus P wave, and any whose QRS would fall within 0.3 s of the last PVC,
is blocked (compensatory pause).

The clinical clock runs at 2 clinical minutes per simulated second, so the hyperacute hour is 30 s of simulation and a 30-minute
reperfusion burst is 15 s; burstiness (N, M, couplets) runs on heartbeat time because it shapes beat sequences.

## Targets and sources

| Target | Value used | Source |
|---|---|---|
| Spread between patients | Lognormal sigma 1.2: a fifth of patients below 0.36 x, a tenth above 4.7 x | After thrombolytic reperfusion PVCs 1 to 1336 an hour, median 44 (Cercek 1987, PMID 2441585); late after MI 24% of patients have 3 or more PVCs an hour, 76% fewer (Bordalo e Sa 1990, PMID 1706604) |
| Level | Median patient about 4-5% of beats at the hyperacute peak of a proximal LAD occlusion, mean over patients about 9%, upper decile 15-25%, saturation at 40% of eligible beats | Plan decision D3 (usual ceiling 10-15%, early peak); Holter counts of tens to hundreds an hour (Cercek 1987) [level assumed within these] |
| Infarct size | Smooth rise with ischemic mass; distal LAD, diagonal: at most a few percent | PVC and VT frequency correlate with peak CK (Gressin 1992, PMID 1731450) [curve assumed] |
| Infarct site | None: mass only | Anterior MI more VF in a small series (Gupta 1983, PMID 6869924) but inferior MI predicted early VT/VF in APEX-AMI (Mehta 2009, PMID 19417195, HR 2.16): the evidence points both ways |
| Time course | Peak in the first 1-2 h, first-hour mean about 7 x the 8-hour value, late floor a few percent of the peak | Primary VF 3.1% in the first 4 h against 0.6% from 4 to 48 h, about 50 x the hourly hazard (Volpi 1998 GISSI-2, PMID 9708651); risk of primary VF set by time since onset (Goldman 1979, PMID 392960) [time constants assumed] |
| Reperfusion burst | Burst (30 min) and tail (8 h), larger with larger and longer ischemia | Nearly all patients had PVCs and couplets after reperfusion, falling from 8-12 h (Cercek 1987); patency gave 14 x the PVCs over the first day (Gressin 1992); in the rat reperfusion VF is bell-shaped in ischemia duration, peak after 10 min (Tosaki 1987, PMID 3618797), VT in the mouse likewise (Sakamoto 1999, PMID 10651161) [sizes, time constants and the flatter human bell assumed] |
| Couplets | About one couplet per ten PVCs | Median 4 couplets against 44 PVCs an hour after reperfusion (Cercek 1987) |
| Potassium | Hook only (1) | VF 17.2% with K <= 3.5 mmol/l against 7.4%, and earlier (Nordrehaug 1983, PMID 6651995) |
| Magnesium | Hook only (1) | IV magnesium reduced PVCs and runs after MI (Thiele 2000, PMID 10907229) |
| VT/VF (context for B3b) | Not modelled here | VT/VF in 5.7% of 5745 primary-PCI STEMIs, 64% before the end of the catheterization, 90% within 48 h (Mehta 2009); early primary VF 3.1% (Volpi 1998) |

## Measured (seed 1-20, core engine)

PVC share of all ventricular beats over the first 90 s (3 clinical hours) after the lesion is put in, full Simulation on the core
engine, seeds 1-20 (mean, min-max, %). "Before" is the old rule on the same engine.

| Lesion | Before | After |
|---|---|---|
| Proximal LAD occlusion | 23.0 (17.6-26.4) | 3.6 (0.0-15.9) |
| Mid LAD occlusion | 17.1 (13.1-21.4) | 2.0 (0.0-11.5) |
| Distal LAD occlusion | 0.0 (0.0-0.0) | 0.4 (0.0-4.0) |
| Proximal RCA occlusion (complete heart block) | 1.3 (0.0-2.9) | 4.1 (0.0-17.6) |
| Circumflex occlusion | 6.0 (3.1-9.5) | 2.3 (0.0-13.5) |
| 90% proximal LAD stenosis | 23.0 (17.6-26.4) | 2.7 (0.0-15.2) |

The RCA rises because the old rule made PVCs only after sinus-conducted beats, so complete heart block silenced it; ectopy now
follows any ventricular beat. Seeds 1-20 happen to have a lowish median susceptibility (0.57); over 400 seeds it is 1.

The rig (40 seeds, rest tone) gives a proximal LAD occlusion a
mean PVC share over the first 3 clinical hours of about 4% (median 1.4%, range 0-16%), distal LAD 0.6% (max 3%), first diagonal 0.3%,
and after reperfusion at 2 hours a burst to a mean of about 11% in the first 40 clinical minutes, decaying to about 2% after 6 hours.

## What the model deliberately does not capture

- VT, non-sustained or sustained, polymorphic VT, VF, accelerated idioventricular rhythm and arrest (task B3b): no run longer than a
  couplet. R-on-T PVCs are possible only rarely (coupling floor 0.42 x RR), and they start nothing.
- PVC morphology (one focus, one shape: the strip draws every PVC alike), interpolated PVCs, fusion beats, parasystole.
- Electrolytes and magnesium as live inputs; antiarrhythmic drugs (lidocaine, amiodarone); heart failure and age as risk factors.
- Scar-related ectopy in the chronic phase (days to weeks): the late floor stands in for it.
- Separate weighting of LV and RV, or of anterior against inferior territory (the evidence is mixed, see above).
- Hemodynamic effect of PVCs is unchanged (task B1 decides which beats count for the readouts).

## Hooks for B3b

`Ectopy.rate()` (instantaneous expected PVCs per beat), `Ectopy.ischemicRate()` and `reperfusionRate()`, `Ectopy.phase()`
("none" | "hyperacute" | "subacute" | "late" | "reperfusion"), `Ectopy.age` (clinical minutes since onset), `Ectopy.burden`,
`couplingVsT(coupling, rr)` (coupling relative to the end of the model's T wave; below 1 = R-on-T) and `tWaveEnd(rr)`. A VT/VF
initiation model can take its hazard per clinical minute from the phase and burden, and its trigger from each PVC's `couplingVsT`.
`EctopySource.decide` is where a PVC would hand over to a run.

## A note on 90% against 99% LAD stenosis

They give identical ischemia and identical beats because the severity of a bed saturates: `severityTarget` (physics/ischemia.ts)
reaches 1 when supply falls to 40% of demand (`ISCHEMIA.fullAtSupplyDemand`), and a 90% diameter stenosis already leaves the LAD
beds at about 10% of their demand at rest (99% at 0%). Every reader of severity (rate, conduction, contractility, the old PVC rule)
then sees the same 1. Transmurality differs a little (0.84 against 1; it reaches 1 below 5% of demand), so the ST vector and the new
ectopy burden differ slightly. This is a calibration of the coronary network (how much flow a 90% lesion passes at rest) and of the
severity curve, not a trivial clamp; changing either would move the legacy fixtures, so it is left as it is.
