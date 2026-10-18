# TEE echo (phase 2 of docs/CATH_LAB_INTEGRATION.md)

Pure modules, drawn by a thin component:

| file | does |
|---|---|
| `ids.ts` | region ids, the 17 AHA segment names, label text |
| `volume.ts` | decode `heart.bin.gz` (DecompressionStream in the browser; Node tests gunzip and call `indexHeart`), index by `heart.json` |
| `procedural.ts` | the vessels, arch and papillary muscles the mesh lacks (schematic) |
| `views.ts` | the 23 views, poses built from the landmarks |
| `slice.ts` | view + omniplane + cycle -> region-id map (no canvas) |
| `motion.ts` | segment dysfunction -> wall motion by reference-position sampling; beat phase from the Simulation's beat stream |
| `render.ts` | ids -> pixels (speckle on the tissue, edge enhancement, depth gain), label placement, territory tint |
| `component.ts` | `mountEcho(canvas, { heart })`: setView, setOmniplane, setLabels, setTerritories, update(sim), frame(sim) |
| `data.ts` | the shipped volume and its credit line |

`src/sim/cath.ts` `echoModel(sim)` turns the sim's bed ischemia and scar into severity per AHA segment, wall-motion score, EF and HR.
Test host: `/cath/echo-testhost.html` in `npm run dev` (all 23 views, a live view, patient picker).

Anatomy: Rodero et al. 2021, PLoS Comput Biol 17(4):e1008851, average four-chamber heart, CC BY 4.0, Zenodo 10.5281/zenodo.4593739. The average shape, not a patient.

## Open items (noted, not fixed)

- View orientation conventions (image-left/right, omniplane direction) are from the ASE/SCA guidelines as recalled, not checked. One thing to look at first: the ME four-chamber cut shows the *anteroseptal* and inferolateral segments, where the guideline lists inferoseptal and anterolateral. Either the segment labelling of the volume is rotated by one sector or the plane is; a cardiologist's call.
- The great veins, pulmonary veins, appendage, ascending aorta, arch and descending aorta are procedural tubes.
- Papillary muscles are ellipsoids (the spike's version never drew them; fixed here), no chordae.
- Segment severity is territory-weighted by artery group; a mid-vessel lesion lowers its whole group's mean (no per-level mapping yet).
- Wall-motion thresholds (`src/config/echo.ts`) and valve timing (`motion.ts`) are teaching assumptions.
