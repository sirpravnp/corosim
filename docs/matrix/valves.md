Base `5e6281ccc556febd9f08aee5656910122a30e537` on `cursor/condition-matrix-run-1f80` (probe `46b0934` plus the plan and the empty suite).
NOT merged: stenosis curve, potassium ECG/hazard, solver guards, Fick EF.
2026-11-01 12:15 EST · seed **1** only (anecdote, not a rate).

## Where the solver can change

- `mx-valve-av-sten-1` · valves
- `mx-valve-bio-fail-tavr` · valves
- `mx-valve-as-mr-mod` · valves (doc ~5 mmHg AS drop with MR vs prior snapshot ~1 mmHg; this seed drops ~7 mmHg)
- `mx-valve-mv-reg-1` · valves (known-now chronic severe MR fraction ~0.47)

## States (checkpoint 60 s, seed 1)

`mx-valve-av-sten-05` · hr 72 · map 89.2 · co 5.10 · chamber EF 0.62 · aortic-valve EF 0.61 · lhc.meanGradient 10.5 · lhc.lvSystolic 133 · sbp 110 · pulsePressure 45.7 · match intended (moderate AS) · — · measured

`mx-valve-av-sten-1` · hr 72 · map 90.0 · co 4.98 · chamber EF 0.56 · aortic-valve EF 0.56 · lhc.meanGradient 68.8 · lhc.lvSystolic 203 · sbp 109 · pulsePressure 38.9 · match intended (40–60 mmHg, LV ≫ aortic) · miss known-now (47–51 mmHg at 0.95-style severe AS on 8-seed snapshot) · measured

`mx-valve-av-reg-05` · map 90.3 · co 4.89 · chamber EF 0.68 · aortic-valve EF 0.42 · pulsePressure 74.5 · lhc.avForwardMl 99.5 · lhc.aorticAreaGorlin null · match intended · — · measured

`mx-valve-av-reg-1` · map 95.5 · co 4.68 · chamber EF 0.70 · aortic-valve EF 0.32 · pulsePressure 92.0 · lhc.avForwardMl 118 · pcwp 18.1 · lvedp 32.9 · match intended · — · directional

`mx-valve-mv-sten-05` · map 90.8 · co 5.08 · lhc.mitralMeanGradient 3.30 · match intended · — · measured

`mx-valve-mv-sten-1` · map 82.1 · co 4.14 · lhc.mitralMeanGradient 18.0 · pcwp 24.4 · match intended (LA pressure up, CO down, gradient) · — · directional

`mx-valve-mv-reg-05` · map 84.3 · co 4.65 · chamber EF 0.78 · aortic-valve EF 0.45 · valve.mv.regurgFraction 0.48 · match intended · — · measured

`mx-valve-mv-reg-1` · map 80.1 · co 4.23 · chamber EF 0.85 · aortic-valve EF 0.38 · valve.mv.regurgFraction 0.56 · pcwp 20.0 · spo2 0.90 · match intended (>0.3) · miss known-now (~0.47) · measured

`mx-valve-tv-sten-1` · co 3.75 · cvp 7.84 · match intended · — · directional

`mx-valve-tv-reg-1` · cvp 5.67 · rhc.raV 10.3 · match intended (C VP up, pulsatile RA) · — · directional

`mx-valve-pv-sten-1` · rhc.rvSystolic 61.8 · paSys 9.89 · match intended (RV systolic > PA) · — · directional

`mx-valve-pv-reg-1` · map 84.9 · co 4.77 · match intended · — · measured

`mx-valve-avr-bio-default` · lhc.meanGradient 15.1 · lhc.avForwardMl 67.6 · match intended (~15, band 11–18) · match known-now · measured

`mx-valve-avr-mech-default` · lhc.meanGradient 13.4 · valve.av.regurgMl 5.35 · match intended · match known-now (~13 mmHg, ~5.5 ml) · measured

`mx-valve-avr-tavr-default` · lhc.meanGradient 13.2 · match intended (8–13 band) · match known-now (~13) · measured

`mx-valve-avr-bio-19` · lhc.meanGradient 27.1 · match intended (mismatch, higher gradient) · — · measured

`mx-valve-avr-tavr-26` · lhc.meanGradient 13.2 · match intended · match known-now · measured (same numbers as default 26 mm TAVR)

`mx-valve-as-mr-mod` · lhc.meanGradient 61.5 (AS alone 68.8) · valve.mv.regurgFraction 0.48 · match intended (AS gradient below AS alone; MR volume up) · miss known-now (snapshot AS drop ~1 mmHg vs doc ~5 mmHg) · measured

`mx-valve-ar-ms` · co 3.79 · lhc.mitralMeanGradient 19.2 · pulsePressure 82.4 · match intended (filling constrained, CO low) · — · directional

`mx-valve-ms-mr` · lhc.mitralMeanGradient 33.0 · valve.mv.regurgFraction 0.56 · co 3.06 · match intended · — · directional · invariant loop.tau null (contract)

`mx-valve-as-lad-80` · lvedp 24.2 · chamber EF 0.28 · aortic-valve EF 0.27 · lhc.meanGradient 40.8 · match intended (LVEDP and EF worse than either alone) · — · measured

`mx-valve-as-dobutamine` · lhc.meanGradient 71.7 (AS alone 68.8) · co 5.37 · match intended (gradient rises with output) · — · directional

`mx-valve-mr-norepi` · map 89.5 · valve.mv.regurgFraction 0.56 · match intended (fraction does not fall with MAP) · — · directional

`mx-valve-mech-then-tavr` · lhc.meanGradient 12.6 (unchanged mechanical prosthesis) · match intended (blocked TAVR in mechanical valve) · — · engine

`mx-valve-bio-fail-tavr` · lhc.meanGradient 20.2 (obstructed bio base 40.0 at t0; lone TAVR 13.2) · match intended (falls vs obstruction, stays above lone TAVR) · miss known-now (prior viv ~25 mmHg vs doc ~15) · measured

`mx-valve-mr-teer-2` · valve.mv.regurgFraction 0.30 (from 0.56 pre-clip baseline) · lhc.mitralMeanGradient 3.84 · match intended · — · engine

`mx-valve-as-balloon` · lhc.meanGradient 42.2 (from 68.8 pre-balloon baseline) · lhc.aorticAreaGorlin 0.80 · match intended · — · engine

`mx-valve-tr-balloon` · cvp 5.65 · co 4.37 vs severe TR alone cvp 5.67 co 4.35 · match intended (no change; balloon not offered) · — · engine

## Run notes

- Matrix observe/check used suite `matrix`, seed 1, `--jobs 3`. Valve states: **28**. Worker crashes on valve rows: **0**.
- Full-matrix `check --invariants-only` reported `mx-valve-ms-mr` loop.tau null at 60 s (section 6 contract). Gorlin/Hakki nulls under gradient floor recorded as contract, not scored as new findings.
