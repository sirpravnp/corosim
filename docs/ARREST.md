# Cardiac arrest model: what is checked against the literature

Constants live in `src/config/arrest.ts` (state machine) and `src/config/arrestSim.ts` (CPR calibration). This note records what was checked
against PubMed (PMIDs given) and what is still a teaching assumption. It is a partial check: items marked **not checked** have not been
looked up and must not be presented as verified.

| Constant | Value in the model | Evidence found | Status |
|---|---|---|---|
| Survival fall with delay, no CPR/shock/ACLS | not used directly | Larsen 1993, PMID 8214853: 67 % if all immediate, minus 2.3 %/min to CPR, 1.1 %/min to defibrillation, 2.1 %/min to ACLS; 5.5 %/min with no treatment (King County, witnessed VF) | verified |
| Fall in shock success per minute of untreated VF | 8.5 %/min (`shock.declinePerMin`) | the 7-10 %/min figure often quoted is for survival and is not in Larsen 1993 (which gives 5.5 %/min with no treatment, 1.1 %/min for delay to shock) | **assumed**; consider lowering toward 5-6 %/min; no test bar changed |
| Epinephrine 1 mg | raises ROSC odds, small CPR-output boost | review PMID 36864469 (Perkins, Couper 2023): adrenaline 1 mg is highly effective for ROSC (number needed to treat 4) but much less for 30-day survival (NNT 111), neurological benefit uncertain | direction verified |
| Amiodarone / lidocaine in shock-refractory VF | small increase in shock response | ALPS trial analyses: PMID 31941354 (survival to discharge 23 %; IV route amiodarone adjusted RR 1.26, lidocaine 1.21 vs placebo; no benefit by IO route); PMID 35243875 (ROSC odds fall with time to drug: OR 0.92 per minute amiodarone, 0.95 lidocaine and placebo; amiodarone benefit only with early dosing); PMID 35236764 (Bayesian reanalysis: survival gain about 2.9 % amiodarone, 1.7 % lidocaine) | direction verified; sizes in the model are assumed and probably generous |
| CPR cardiac output about 25-30 % of normal | `perfusion()` max 0.30 | PubMed search for closed-chest CPR output did not return usable results; the figure comes from the Weisfeldt and Becker review cited in the config header | **not checked** |
| Irreversible injury from about 4 min, death at 10 min of no flow | 240 s / 600 s | not looked up | **not checked** (teaching defaults; `deathAfterNoFlowS` is configurable) |
| Biphasic 200 J first-shock success 90 % | `shock.baseSuccess` 0.9 | not looked up | **not checked** |
| CPR rate 100-120/min, depth 5-6 cm | best technique window | not looked up here | **not checked** |

Next step: look up the unchecked rows, and decide with a clinician whether to lower `declinePerMin` and the drug effect sizes.
