# Echo simulator

Status: built, on `/echo/`. This replaces the three-view atlas described in [ECHO_ATLAS.md](ECHO_ATLAS.md), which is kept as history.

The page is a working echo machine on the simulator's own patient. It has transthoracic and transesophageal views, a probe the student moves freely, and the 2D, M-mode, color, pulsed-wave, continuous-wave and tissue Doppler modes. It makes the standard measurements and lists them beside the engine's own values. Nothing is a stored picture: every frame is formed from the anatomy and the engine's flows, the way a scanner forms one.

## Pipeline

1. **Patient.** An echo case (`src/echo/cases.ts`) is a structural-engine spec plus what the engine does not model: wall thickness, regional wall motion, scar, leaflet thickening and calcium, pericardial fluid, an atrial septal defect. `beatOf` runs the engine (`analyze(spec, { waveform: true })`) and samples one beat. The output is 24 frames of chamber volumes, plus a 200-point waveform of valve flows, pressures and LV longitudinal shortening.
2. **Anatomy.** The heart is the mean shape of a statistical shape model built from 20 adult cardiac CT scans (Rodero et al., *PLoS Comput Biol* 2021, doi:10.1371/journal.pcbi.1008851; data CC BY 4.0). It is voxelized at 1 mm with labels and ventricular coordinates (`src/anatomy/ctHeart.ts`, `scripts/cath/build-heart.sh`) and checked against 25 ASE and CMR reference ranges (`scripts/anatomy/validate-ct-heart.py`). The LV is scaled to hold the engine's end-diastolic volume. Each frame warps the anatomy to the engine's volumes: base descent, per-segment radial shortening solved to match LV volume, wall thickening and RV motion. Valves, papillary muscles, trabeculae, vessels and pericardium are added analytically (`src/echo/ctEcho.ts`).
3. **Image formation** (`src/echo/scan.ts`). The pipeline works in polar coordinates, one scan line at a time. It uses tissue-anchored speckle, a depth-dependent point spread function, frequency compounding, specular reflection at impedance steps, and attenuation with time-gain compensation. Near-field clutter, reverberation, haze and noise come next, then log compression, scan conversion and the display gray map. It was calibrated against CC BY-SA loops from CardioNetworks ECHOpedia (`src/echo/reference.json`): grain size, dark fraction, gray-level percentiles, edge rise width and specular ratio.
4. **Flow** (`src/echo/flow.ts`). Each open valve with flow is a jet. Speed comes from the simplified Bernoulli equation across a stenotic or regurgitant orifice, or from flow over area for a normal valve. A fast free jet keeps its speed over a potential core of 12 orifice radii, then slows; a slow jet fades. Upstream, blood converges on the orifice at Q / (2 pi r^2). The ventricular outflow tracts carry a plug at flow over the tract's area.
5. **Doppler** (`src/echo/doppler.ts`, `scan.ts`).
   - **Color:** the velocity along each beam in a color box, with aliasing at the Nyquist limit, a wall filter and a write priority over tissue. Turbulence shows as variance (the green mosaic), on the BART map most scanners use.
   - **PW:** a 3 mm gate with its depth-dependent Nyquist limit, c^2 / (8 f0 d).
   - **CW:** the whole line, weighted by velocity.
   - **TDI:** the mitral annulus velocity from the LV's longitudinal shortening rate.
6. **Measurements.**
   - **Simpson's biplane:** the method of discs on A4C and A2C traces.
   - **M-mode:** PLAX at the chordal level, with Teichholz volumes.
   - **Doppler set:** mitral E, A and deceleration time, e′ and E/e′, LVOT VTI and stroke volume, aortic peak and mean gradients, continuity-equation valve area, mitral mean gradient, TR velocity and RVSP. Each Doppler line is laid along the flow it measures. The LVOT sample is moved toward the apex, out of the acceleration zone, as the guidelines advise.

## The page

`src/echo/page.ts` runs on the main thread, and `src/echo/worker.ts` runs the engine.

- **Loading:** the worker loads `heart.bin.gz`, builds the distance fields (about a second) and returns the TTE poses, the TEE view controls and a surface mesh for the 3D pane.
- **Cine loop:** one beat of 16 frames, filled every 8th frame first so it plays early, at the patient's heart rate.
- **Probe movement:** dragging the probe (TTE) or a TEE control sends draft frames (64 lines). The loop refills once the probe stops.
- **Strip modes:** the cursor starts where a sonographer would put it. Clicking the image moves it. Pointing at the strip reads a velocity and its 4v² gradient, or a depth in M-mode.
- **Reference loops:** CardioNetworks loops are shown beside PLAX, PSAX at the papillary level and subcostal, with credit.

Table 1. Views.

| Approach | Window | Views |
|---|---|---|
| TTE | Parasternal | PLAX, RV inflow, PSAX at the aortic valve, mitral valve, papillary muscles, apex |
| TTE | Apical | A4C, A5C, A2C, A3C |
| TTE | Subcostal | four-chamber, IVC |
| TTE | Suprasternal | long axis of the arch |
| TEE | Mid-esophageal | four-chamber, two-chamber, long axis, AV short axis, AV long axis, RV inflow-outflow, bicaval, descending aorta |
| TEE | Transgastric | mid short axis, two-chamber, deep long axis |

## Validation

These checks run in `tests/echoMeasure.test.ts` and `tests/echoDoppler.test.ts`, against the engine's own values.

Table 2. What the simulated echo reads back.

| Check | Result |
|---|---|
| Simpson's EF vs engine EF | within 8 points (normal, anterior infarct, LVH, AS, DCM); 10 in HCM |
| LVOT stroke volume vs engine forward stroke volume | within 10 % (normal, AS, DCM) |
| Aortic stenosis | peak velocity above 3.8 m/s, mean gradient within 15 % of the engine's, area under 1 cm² |
| Mitral stenosis | mean gradient within 15 % of the engine's |
| RV systolic pressure from the TR jet (4v² + RA pressure) | within 15 % of the engine's |
| Filling | normal: E/A over 1, e′ over 7 cm/s; DCM: restrictive (E/A over 2, E/e′ over 14) |
| Color | mitral regurgitation is a fast, aliased, turbulent jet into the LA in systole; a normal LA has no systolic color |
| M-mode | normal linear dimensions; thick walls in LVH; dilated and poorly shortening in DCM |
| Anterior infarct | Teichholz EF from one basal line reads above Simpson's, as it misses the akinetic apex |

## Known limits

- Ribs are not modeled, so there are no rib shadows. The lungs are only a near-field mask.
- Jets are straight cones. Eccentric jets that hug a wall (Coanda) are not modeled.
- Septal and lateral e′ come from one longitudinal shortening rate, so they are equal. Deceleration time is not meaningful in mitral stenosis.
- HCM: the M-mode line misses the nearly closed systolic cavity.
- A5C continuous-wave Doppler meets an aortic jet at about 25 degrees, so it reads a little low (3.8 m/s for a 4.2 m/s jet). That is a real teaching point: line the beam up with the jet.
- The TEE RV inflow-outflow (46 degrees) and bicaval (68 degrees) omniplane angles are lower than usual.

## Licensing

- CT heart: CC BY 4.0 (Rodero et al.), shipped as a derived voxel volume with attribution on the page.
- Reference loops: CC BY-SA 3.0 (CardioNetworks ECHOpedia via Wikimedia Commons). They are shown unchanged apart from masking, with credit.
- No non-commercial dataset (CAMUS, EchoNet, EchoXFlow and others) is used or shipped.
