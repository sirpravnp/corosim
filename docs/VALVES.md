# Valves in the engine (B5)

Several valve lesions at once, prosthetic valves and valve interventions for the adult Simulator. Code: `src/config/valves.ts` (all constants, each marked [lit] or [assumed]), `src/physics/structural.ts` (`ValveLesion.prosthesis`, `resolveValve`), `src/sim/valves.ts` (`valveSet`, `intervene`, `assessHeart`, `murmurOf`), `src/sim/structural.ts` (grading), `src/physics/core/valves.ts` (integration fix). Educational model, not clinical advice.

## How it works

Each of the four valves is an orifice between two chambers with an opening area and a regurgitant (leak) area, Gorlin flow `Q = 44.3·A·√ΔP`. They were always independent edges of the circulation, so a combined lesion needs no special coupling: the interactions are the circulation's own. Measured on the model (resting adult, no reflexes):

- Aortic stenosis + mitral regurgitation: severe aortic gradient (about 43 mmHg mean) and a mitral regurgitant fraction of about 51 % against 47 % for the same leak alone, because the stenosis raises the LV systolic pressure that drives the leak. The leak also takes forward flow, so the aortic gradient is lower than in aortic stenosis alone (43 against 48 mmHg).
- Aortic regurgitation + mitral stenosis: wide pulse pressure, low diastolic pressure, raised left atrial pressure and a mitral gradient.

`ValveLesion` is `{ open, reg, prosthesis }`. `open` is the opening as a fraction of normal, `reg` the regurgitant orifice (cm²). `valveSet({ av: { stenosis: 0.9 }, mv: { regurgitation: 0.6 } })` builds them from 0..1 severities with the same spans as the single-lesion sliders (`STENOSIS_SPAN`, `REGURG_AREA_FRAC`; numbers unchanged).

## Prosthetic valves

`prosthesis: { kind: "bioprosthetic" | "mechanical" | "transcatheter", sizeMm, leak?, obstruction?, inRing? }` replaces the native valve in that position (the native `open` and `reg` are then ignored).

- **Opening**: the effective orifice area (EOA) of the kind and labelled size, from `PROSTHESIS_EOA`. Aortic values follow the reference tables of Pibarot and Dumesnil (Circulation 2009;119:1034) and the ASE prosthetic valve guideline (Zoghbi, JASE 2009;22:975): for example 21 mm bioprosthesis 1.5 cm², 23 mm bileaflet mechanical 2.0, 26 mm transcatheter 1.9 (SAPIEN 3 and Evolut echo cores of PARTNER 3 and Evolut Low Risk: EOA 1.5 to 2.0, mean gradient 8 to 13 mmHg). Mitral rows follow the same sources. Tricuspid, pulmonary and the transcatheter mitral/tricuspid/pulmonary rows are [assumed] from them. The EOA never exceeds the native valve's normal area.
- **Closing leak**: a mechanical bileaflet valve has a physiological closing backflow and washing jets of about 5 to 10 % of the stroke (ASE 2009), 0.03 cm² here (about 7 %); a tissue valve has none; a transcatheter valve 0.02 cm² (trace to mild, PARTNER 3).
- **`leak`**: an added paravalvular (or degenerative) regurgitant orifice, cm². Graded on the ASE orifice scale (mild < 0.1, moderate 0.1 to 0.3, severe >= 0.3 cm² for the aorta; the other valves scale with their normal area, `GRADE.eroaFraction`).
- **`obstruction`** 0..1: the share of the orifice lost to thrombus, pannus or degeneration. 1 is a stuck valve.
- **`inRing`**: a transcatheter valve inside a failed surgical bioprosthesis (valve-in-valve): keeps 80 % of the tabulated EOA, so the gradient is higher (VIVID registry: mean about 15 mmHg). Set automatically by `intervene` when the host is a bioprosthesis.

Grading of a prosthesis (`ValveFinding.prosthesis`, `stenosis`, `regurgitation`):

- Stenosis by the **mean gradient**, not by the share of a native valve's area (a normal 1.7 cm² prosthesis is not a stenosis): aortic < 20 normal, 20 to 35 "possible" (graded moderate), > 35 severe; mitral 5 and 10 mmHg (ASE 2009). Tricuspid 3.5 and 5 and pulmonary 15 and 25 are [assumed]; the tricuspid values are low because the model's right atrium fills through the whole beat at rest, so even a 0.7 cm² tricuspid valve reads about 4 mmHg.
- Regurgitation: the closing leak is physiological and not graded; the `leak` orifice and a regurgitant fraction past the moderate bin are.
- **Patient-prosthesis mismatch** by indexed EOA (BSA 1.8 m²): aortic moderate < 0.85, severe < 0.65 cm²/m² (VARC-3, Pibarot); mitral moderate < 1.2, severe < 0.9 (Dumesnil). Not defined on the right side.
- The cath-lab read `leftHeartCath(n, beat, "adult", { aortic: true, mitral: true })` grades named prostheses by gradient. The page and the MCP tool do not pass it yet (they have no access to the heart spec), so they still grade a prosthesis as a native valve.

Examination (`murmurOf`): crisp metallic click for a mechanical valve (muffled when obstruction > 0.3); soft closure for tissue and transcatheter valves; murmurs from the graded stenosis and regurgitation of each valve.

## Interventions

`intervene(heart, action)` is pure: it returns the new heart, the **patch** (complete for the valve it touches, every field set so a merge leaves nothing stale; give it to `Simulation.apply({ heart: patch })`), what changed and why nothing was done if it refuses.

| Action | Effect | Source |
|---|---|---|
| `tavr` / `replace` (transcatheter, any valve) | Native lesion replaced by the prosthesis (size default 26 mm aortic). Native regurgitation of that valve is gone; other valves are untouched. | PARTNER 3, Evolut Low Risk |
| `replace` (bioprosthetic, mechanical) | Surgical replacement, no paravalvular leak unless asked. Refuses a transcatheter valve into a mechanical one. | ASE 2009 |
| `balloon` aortic | Area +0.3 cm² up to 1.2 cm², new regurgitant orifice 0.03 cm². Gradient about 48 to 34 mmHg in the model; the valve stays stenotic. | NHLBI balloon valvuloplasty registry (area 0.5 to 0.8, gradient 55 to 30) |
| `balloon` mitral | Area +1.0 cm² up to 2.2 cm², new leak 0.04 cm². | Wilkins score <= 8 results (area about doubles, mild MR common) |
| `balloon` pulmonary | Area +1.5 cm² up to 3.2 cm², new leak 0.05 cm². | Valvular pulmonary stenosis series |
| `teer` mitral (MitraClip) | Per clip the leak is multiplied by 0.55 and 0.5 cm² of opening is lost (1 to 4 clips, default 2); warns when the opening falls under 3 cm² (risk of iatrogenic stenosis). | COAPT (MR <= 2+ in 95 %, mean gradient 4 to 5 mmHg); per-clip factors [assumed] |
| `teer` tricuspid | Leak x 0.6 and 0.4 cm² lost per clip. | TRILUMINATE; factors [assumed] |
| `repair` mitral / tricuspid (annuloplasty) | Leak to 10 % / 15 %, opening to 90 %. | [assumed] |

`effect` (0..1) scales a balloon result for a calcified or high-score valve. Refusals (a balloon on a prosthesis or a tricuspid valve, a clip on a valve that does not leak, TAVR into a mechanical valve) return an empty patch and a warning.

## Assumptions and limits

- Gradients in this model read about 30 to 50 % above the steady-flow Gorlin value for the same area (the ejection flow peaks sharply; see the note on the structural page), so a normal 21 to 25 mm aortic bioprosthesis reads 11 to 18 mmHg mean, at the upper end of the ASE range; the EOA tables are the literature's, not tuned to the model's gradient.
- Valve pathology that has no effect in the structural engine is not modelled: left ventricular hypertrophy or dilatation, the late rise in wedge pressure in aortic stenosis, functional MR that improves after TAVR (here the mitral leak stays), pulmonary hypertension after mitral surgery, conduction block or pacemaker need after TAVR (the rhythm engine is B2's), anticoagulation and valve thrombosis as a process (set `obstruction` instead), endocarditis, and procedural complications other than the leaks above.
- Restenosis after balloon valvuloplasty is not time-dependent; set `open` again to model it.
- A small orifice makes the valve's flow equation stiff. `InertialValve` now keeps the effective inertance high enough that its relaxation time is at least 0.4 ms (the engine steps by 0.5 ms), which only matters for orifices under about 0.5 cm²; larger orifices, and every existing test, are unchanged. Without it, a mechanical valve of 2 cm² with its 0.03 cm² closing leak did not settle.
- The adult only: newborn lesions stay on the Structural page.
