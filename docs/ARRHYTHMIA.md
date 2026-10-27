# Ischemic VT, VF and AIVR (task B3b)

Core engine only (`src/physics/arrhythmia.ts`, constants and their sources in `src/config/arrhythmia.ts`). The legacy engine and
`tests/fixtures/acs.json` are untouched. The model sits on the ischemic PVC model of task B3a (`docs/ECTOPY.md`), reads its burden,
time since onset, reperfusion store, tone and T-wave timing, and hooks into its beat decisions and into the beat stream. A sustained
rhythm runs as the EKG library's own rhythm (`vt-mono`, `vt-poly`, `vf-coarse`, `aivr`), so the strip, the 3D heart and the
hemodynamics of task B2 all show it.

## What it does

1. **Hazard of an initiating event, per clinical minute:**
   `lambda = susceptibility x tendency x sympathetic x drugs x K x Mg x [kI H(burden) T(age) + kR H(burst) + kS H(scar) M(scar age)]`.
   H is a steep Hill curve of the transmurality-weighted ischemic burden (a proximal LAD 0.83, a mid LAD 0.56, a circumflex 0.33,
   a distal LAD 0.05); T is a hyperacute peak decaying over about half an hour with a small subacute tail; burst is the B3a
   reperfusion store; scar is the healed necrotic mass. Sympathetic tone (net of beta-blockade), adrenergic drugs, hypo- and
   hyperkalaemia and hypomagnesaemia multiply it. The patient's susceptibility is seeded, lognormal (sigma 0.8) and loosely
   correlated with the PVC susceptibility. `arrhythmiaTendency` (0..3, scenario field) is the teacher's multiplier.
2. **R-on-T initiation against the live T wave.** An event waits for the next conducted beat and rides on a premature beat: R on T
   (coupling 0.80-0.98 of the T wave's end at that RR) in 60%, late-coupled otherwise. An ordinary ischemic PVC that lands on the T
   wave starts a run only rarely. R on T weights the result toward VF and polymorphic VT.
3. **What a run becomes:** non-sustained VT (3+ beats at 130-210/min, back to sinus), sustained monomorphic VT (150-210/min,
   P waves dissociated), polymorphic VT (200-260/min) or VF (ischemia mix 72/6/6/16%; reperfusion almost all short runs; scar
   monomorphic).
4. **Course, in heartbeat time.** Polymorphic VT stops (mean 8 s) or degenerates to VF (mean 6 s), 4 in 7 to VF. Monomorphic VT
   degenerates to VF through hemodynamic collapse (MAP below 70, fast below 35 mmHg) and, while acute ischemia goes on, through the
   ischemic substrate (mean about 2.5 min on an occluded proximal LAD); a VT in a heart without acute ischemia is left to the pressure
   route. VF does not stop by itself (defibrillation, CPR and death are task B4).
5. **AIVR on reperfusion:** enhanced automaticity, not re-entry: its own hazard from the reperfusion store; it takes over at 5-20%
   above the sinus rate (55-110/min), lasts a lognormal ~20 heartbeat s, and ends by itself or when the sinus overtakes it.
6. **Scar VT later:** a slow hazard once a scar has healed (days of clinical time); monomorphic, 130-190/min. The Simulator's clock
   rarely reaches it; `induce("scar")` shows it.

State: `Simulation.state().rhythm.arrhythmia` (current run, last run, counts, hazards per hour, K and Mg); the rhythm label and
library id switch to the running arrhythmia; `explain()` says what runs and why. Scenario fields: `arrhythmiaTendency`,
`electrolytes { potassium, magnesium }` (MCP schema updated).

## Targets against measured rates

Rig (`tests/arrhythmiaRates.test.ts`): coronary network, ischemia kinetics, rhythm, ectopy, arrhythmia and beat stream at rest tone,
no hemodynamics (MAP held at 85), 400 seeds, Simulator clock (2 clinical minutes per heartbeat second). Measured on this branch.

| Measure | Literature | Measured (400 seeds) | Test bar |
|---|---|---|---|
| VF in the first clinical hour, proximal LAD occlusion | VF before primary PCI 11.6% of first STEMIs presenting within 12 h (Jabbari 2015, PMID 25559012), 12% (Glinge 2020, PMID 32101559), 9.5% (Ravn Jacobsen 2020, PMID 32067598); anterior infarction OR 2.1 (Jabbari 2015) | 11.0% | 5-20% |
| VF in the second hour, same | early (0-4 h) primary VF 3.1% against 0.6% in 4-48 h (GISSI-2, Volpi 1998, PMID 9708651) | 5.5% (first hour holds twice the second) | hour 1 > 1.3 x hour 2 |
| VF in the first hour, right coronary (proximal) / circumflex / distal LAD | smaller and non-anterior infarcts less | 8.5% / 2.3% / 0% | circumflex < VF(LAD) / 1.5, distal < / 4 |
| Non-sustained VT, first hour, proximal LAD | common; warning arrhythmias in 55% of patients without VF (El-Sherif 1976, PMID 57784) | 27.5% | > 1.5 x VF |
| Sustained monomorphic VT, first hour | rarer than VF early (GUSTO-I sustained VT/VF 10.2% over the stay, Newby 1998, PMID 9843464) | 3.0% | < VF |
| AIVR after reperfusing a proximal LAD at 2 h | 42% during primary PCI, with larger areas at risk (Terkelsen 2009, PMID 19962468); 18.9% on telemetry after primary PCI, more with extensive anterior infarcts (Wu 2025, PMID 40618073) | 46% (distal LAD 1.5%, circumflex 13%) | 25-65%; distal < LAD / 4 |
| Non-sustained VT after reperfusion | 26% during primary PCI (Terkelsen 2009) | 23.5% | 12-40% |
| VF after reperfusion | 1.6% during primary PCI (Jabbari 2015, PMID 26150175; Ravn Jacobsen 2020) | 1.8% | at most 5% |
| Hypokalaemia 3.2 mmol/l | OR 1.90 for VF before primary PCI (Ravn Jacobsen 2020); VF 17.2% with K <= 3.5 against 7.4% (Nordrehaug 1983, PMID 6651995) | hazard x 1.9 | VF share > 1.3 x normal K |
| Stable 70% LAD stenosis at rest, 2 clinical hours | no ischemia, no arrhythmia | 0 events in 400 seeds (and at tendency 3) | none |

Full Simulation (`tests/arrhythmiaSim.test.ts`, 4 arrhythmia-prone patients, tendency 3): runs of VT in all, VF in some (the library's
VF, MAP < 30, no output, "cardiac arrest" in the explanation); after primary PCI at 2 hours AIVR in at least 2 of 4, at 55-110/min
above the sinus rate, ending by itself; an induced monomorphic VT on the occlusion lowers stroke volume and systolic pressure and
degenerates to VF within 5 minutes; a 70% stenosis at rest gives nothing.

## Judgement calls

- **Clocks.** Hazards run on the clinical clock (they follow the infarct); the course of a running arrhythmia runs on heartbeat
  time (beats and pressure). At 2 clinical minutes per second, a polymorphic VT lasting 5 s spans 10 clinical minutes of infarct
  evolution, which is fine for hazards that change over tens of minutes.
- **The first hour.** The ischemic burden builds over about 40 clinical minutes (the ischemia kinetics run in heartbeat seconds), so
  the hazard the patient feels peaks at 20-40 minutes rather than in the first few minutes of phase 1a. The hazard's own decay was
  made faster (tau 30 min) so the first hour still holds about twice the VF of the second.
- **VF counts include degeneration** (polymorphic VT to VF, monomorphic VT to VF). The literature counts VF however it began.
- **Anterior against inferior:** no territory weighting, only mass (as in B3a): a proximal RCA (large, dominant) gives 8.5% against
  11% for a proximal LAD. The literature's anterior OR 2.1 is against all other infarcts, most of them smaller.
- **90% stenosis:** the coronary network leaves the LAD beds at about 10% of demand at rest behind a 90% lesion, so ischemia
  saturates and a "90% stenosis at rest" behaves like an occlusion here too (docs/ECTOPY.md, note on 90% against 99%). The stable
  stenosis target is the 70% lesion.
- **Ischemic degeneration of monomorphic VT.** The core engine holds MAP near 70 in a VT of 200/min on a large infarct (stroke volume
  falls by half or more, rate doubles, vasoconstriction), so the pressure route alone rarely fires; a substrate route stands in for
  wave break in heterogeneous ischemic tissue. Its rate is assumed.
- **Termination.** Setting the patient's rhythm, or `arrhythmiaTendency` 0, ends a running VT or VF (the teacher's override until B4
  brings shocks, CPR and drugs).

## Not modelled (later items)

- Defibrillation, cardioversion, CPR, no-flow injury, ROSC, death, antiarrhythmic drugs (task B4).
- Torsades from long QT and drugs; bundle-branch re-entry; VT storm; ICD.
- Hemodynamic readouts lag: the monitor's flow window (30 s, `LIVE_SOURCE.flowWindowS`) keeps averaging the premature beats before
  a VF onset, so `rolling().cardiacOutput` and its MAP read high for up to 30 s after VF starts; `state().meanArterialPressure`
  follows at once.
- Tools to start, stop and shock an arrhythmia from chat (task D3); the page controls (C-items).
