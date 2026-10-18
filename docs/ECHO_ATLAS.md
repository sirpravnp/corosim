# Echo atlas: standard views from the 3D heart, paired with open reference images

Status: proposal, no app code. Builds on the TEE slicer already in `spikes/cathlab/` and planned in `docs/CATH_LAB_INTEGRATION.md` (`src/cath/echo/*`).

## Idea

One atlas for transthoracic and transesophageal echo. A **view** is a named probe pose, not a continuous scan:

```
View = { id, window, probePose, angle, depth, expected structures, reference images[] }
```

The user picks a window (parasternal, apical, subcostal, suprasternal, mid-esophageal, transgastric, upper-esophageal, deep-transgastric), or places the probe near a landmark and the atlas snaps to the nearest standard view. The page shows our cut through the CT-derived heart next to a real reference image of that view, with the same structure labels on both.

Discrete by design: the only poses that exist are the guideline views (about 20 TTE, 28 TEE per ASE/SCA). That makes it a lookup table, so every view can be curated and checked by hand.

## What we already have

- A labelled 1 mm four-chamber volume (Rodero et al., CC BY 4.0) with LV, RV, RA, LA, four valve planes, ostia, and a heart frame (`src/cath/data/heart.json`, `heart.bin.gz`).
- A sector slicer driven by probe pose plus omniplane angle, and 23 TEE view definitions (spike).
- Wall-motion hooks from the simulator (bed severity to LV segments, EF, HR), so views can show the patient's own ischemia.

## What is new

1. **Shared view schema** replacing the TEE-only definitions. `window` is one of `tte` or `tee`; TEE has an omniplane angle (0 to 180), TTE has probe rotation and tilt instead.
2. **TTE poses.** The TEE probe sits behind the left atrium, so its pose falls out of the anatomy. TTE needs a chest wall we don't have. Cheapest honest answer: define each TTE pose from heart landmarks (apex and LV long axis for apical; LV long axis rotated toward the aortic root for parasternal long; short-axis perpendicular to it; IVC and RA for subcostal; arch for suprasternal) and draw only a schematic torso for the probe marker. No lung or rib model, so we cannot reproduce acoustic window loss. Say so in the UI.
3. **Reference image manifest**, one JSON entry per image: view id, file or URL, license, author, source, which structures are visible and where (labelled landmark points). Nothing ships without license and attribution filled in.
4. **Pairing UI**: our slice and the reference side by side, synced label toggles, optional opacity overlay, "match the view" mode that scores the learner's probe pose against the canonical pose.

## Correlating to the images: don't register, annotate

Our heart is an average shape; a real image is one person's heart at an unknown depth and gain. Pixel registration would be wrong and misleading. Instead, per view we record 4 to 8 landmark points on the reference (for A4C: apex, MV annulus, TV annulus, crux, LA roof) and the same landmarks on our slice, and show them paired. That teaches "what you should be able to find" and avoids implying the model matches the patient.

## Image sources and licensing (not yet audited)

I did two searches only and could not confirm licenses for most of this. Treat as leads.

| Source | Views | Terms (unverified) | Use |
|---|---|---|---|
| [CAMUS](https://creatis.insa-lyon.fr/Challenge/camus) | A4C, A2C only | open for research, citation required | dev-time validation only |
| [EchoNet-Dynamic](https://aimi.stanford.edu/datasets/echonet-dynamic-cardiac-ultrasound) | A4C only | Stanford DUA, non-commercial research | dev-time only, cannot redistribute |
| TMED (Tufts) | PLAX, PSAX, A4C, A2C | DUA, terms not confirmed | dev-time only |
| MIMIC-IV-Echo (PhysioNet) | many TTE | credentialed access | dev-time only |
| [Lipton, Basic Cardiac POCUS chapter](https://openbook.ums.edu.my/pointofcareultrasoundforundergraduates/chapter/identifying-and-obtaining-standard-echocardiographic-views/) | PLAX, PSAX, A4C | CC BY 4.0, but figures are adapted, verify originals | candidate to ship |
| Wikimedia Commons, PMC/Open-i CC BY figures | scattered, TEE especially | per file | candidate to ship, needs a hand search |

Consequences:
- The datasets with data-use agreements cover only a few TTE views and cannot be bundled. They are useful for checking our renders (for example, does an off-the-shelf view classifier label our A4C slice as A4C), not as the atlas images.
- Shippable images are CC BY / CC0 only, so coverage of the TEE views will be thin. Realistic fallbacks: a hand-curated Commons/PMC set, a short list of "link out" references per view, or a partnership with a teaching-echo group that can contribute images.
- ASE guideline figures are copyrighted; link, don't copy.

## Phases

0. **Audit (1 to 2 days).** Search Commons and PMC per view, fill the manifest, count how many of the ~48 views have at least one shippable image. This decides whether the atlas ships full or partial.
1. **Schema and promote** the 23 TEE views into `src/cath/echo/views.ts` with the unified type; unit-test pose to slice.
2. **TTE views** from landmarks, checked by eye against textbook figures; get a clinician (you) to sign off each pose.
3. **Atlas page** with pairing and landmark overlays.
4. **Couple to the sim** (wall motion, rhythm) and add MCP tools: `corosim_echo_view(id)` and `corosim_echo_list`.
5. **Quiz mode**: name the view, or place the probe for a named view.

## Risks

- TEE views are well defined by the anatomy we have; TTE views depend on pose choices a sonographer would judge, so they need your review.
- The model has no papillary muscles, trabeculae, leaflets with motion, or pericardium, so slices look like labelled cartoons next to real speckle. The renderer's speckle and edge enhancement help but the gap stays.
- Doppler, strain, contrast and 3D echo are out of scope.

## Audit result, 2026-10-18 (Wikimedia Commons only, metadata checked, images NOT yet viewed)

Reduced to the standard set, 16 views. Commons licenses read from the API; whether each file really shows the named view, normal anatomy, and is usable at this size is still unchecked.

| View | Candidate | License | Notes |
|---|---|---|---|
| TTE PLAX | `Echoparasternallongaxis.jpg` (Balaji.md) | CC BY-SA 4.0 | 1058x794, likely a real frame; also `PLAX Mmode.jpg` (PD) is M-mode, not wanted |
| TTE PSAX (LV level) | `Echoapicalshortaxis.jpg` (Balaji.md) | CC BY-SA 4.0 | filename says "apical short axis"; check whether it is really PSAX |
| TTE PSAX aortic valve | `Aortic valve sa.png` (Lynch, Jaffe) | CC BY 2.5 | probably an illustration, not an echo frame |
| TTE A4C | `Echoapicalfourchamber.jpg` (Balaji.md); `Echocardiogram 4chambers.jpg` (PD); `A4CTTS` video (CardioNetworks) | CC BY-SA 4.0 / PD / CC BY-SA 3.0 | best-covered view |
| TTE A2C | `Apical2Chamber.png` (Lynch, Jaffe) | CC BY 2.5 | probably an illustration |
| TTE subcostal 4C | `Subcostal normal` video (CardioNetworks); `Heart subcostal echocardiography view.jpg` (Lynch) | CC BY-SA 3.0 / CC BY 2.5 | |
| TTE A3C / A5C, RV inflow, PSAX MV and papillary, IVC, suprasternal | none found | n/a | the search may just be weak; try ECHOpedia and PMC next |
| TEE (ME 4C, 2C, LAX, AV SAX, bicaval, TG SAX, descending aorta, RV in/out) | none found as normal still images | n/a | Commons TEE holds mostly pathology case-report videos (BMC, CC BY) and probe diagrams |

Takeaways:
- Roughly 5 of the 8 core TTE views have a plausible open image; TEE has effectively none. CC BY-SA means anything we ship from these must carry attribution and share-alike.
- Several hits are Lynch/Jaffe Yale illustrations, not real scans. Fine for teaching anatomy, but not "real image" coverage.
- PMC / Open-i CC BY case-report figures are the likely source for TEE normal views and remain unsearched. Failing that, TEE stays on our own slice (see the fallback in the earlier section).
- Search used the Commons API; throttling (HTTP 429) cut the first pass short.

## Audit result, PMC pass (Europe PMC, CC BY 4.0 articles; Open-i API is down)

Open-i returned an error page, so this used the Europe PMC REST API with `LICENSE:"cc by"`. Licenses come from the article XML; figures were read by caption only, not viewed.

| Article | Gives | Caveat |
|---|---|---|
| [PMC8662909](https://pmc.ncbi.nlm.nih.gov/articles/PMC8662909/) (Cardiovasc Ultrasound 2021) | Fig 3-6: graphic plus sonogram for subcostal, subxiphoid, PSAX, PLAX, human TTE | small figures; "graphic" panels are probably the authors' own drawings, still CC BY |
| [PMC6048745](https://pmc.ncbi.nlm.nih.gov/articles/PMC6048745/) (Cardiovasc Ultrasound 2018) | Fig 2-4: mid-esophageal descending aorta LAX and SAX, transgastric SAX | hemorrhage/REBOA models, likely animal, with a catheter in view; verify before use |
| PMC8191119, PMC11887252 (BMC Med Educ) | none: figures are charts and a simulator photo | useful as a list of the exam's required TEE views, not as images |

Full-text searches for the ME four-chamber, two-chamber, long-axis, bicaval, A5C and RV inflow views found no review or teaching article with CC BY figures. Individual case reports with a normal frame may exist, but finding them by caption means reading figures one at a time.

Conclusion so far: open coverage is real for PLAX, PSAX, A4C and subcostal TTE, partial for A2C, and almost absent for TEE. A fully real-image TEE atlas is not achievable from what I can find; TEE would need our own slice, a licensed contribution, or a clinician providing images.

## Decision, 2026-10-18: atlas is TTE-only for now

TEE is dropped from scope: open coverage is near zero (see the audits above) and the existing TEE slicer stays in the cath lab untouched. The view list is the TTE set: PLAX, RV inflow, PSAX at the aortic valve, mitral valve and papillary levels, A4C, A5C, A2C, A3C, subcostal 4C, IVC, suprasternal.

## Candidate review (images viewed), corrects the Commons table above

| File | Actually is | Verdict |
|---|---|---|
| `Echoparasternallongaxis.jpg`, `Echoapicalfourchamber.jpg`, `Echoapicalshortaxis.jpg` (Balaji.md, CC BY-SA 4.0) | Hand drawings from the Wikibooks "Intensive Care Medicine" pages: labelled sector, plus a torso with probe position and a probe-orientation clock | **Not echo images.** But the torso drawings carry exactly the probe position and orientation data the atlas needs (reference for our poses). Note the "apical short axis" one shows a short axis, so it is not mislabelled. |
| `Echocardiogram 4chambers.jpg` (public domain) | Real A4C frame, 636x434, Norwegian machine overlay | **Usable** as the A4C real image; slightly dark, patient and abnormality unknown, check the title text |
| `Apical2Chamber.png`, `Aortic valve sa.png` (Lynch, Jaffe, CC BY 2.5) | ~400 px composite: small real echo inset next to an anatomical cutaway with matching labels | Real but tiny (inset about 200 px), labelled. Good for the pairing idea, poor as the main image |
| `Heart subcostal echocardiography view.jpg` (Lynch, CC BY 2.5) | Pure illustration, no echo | Not an echo image |
| `Apical 4 chamber view.png` | not viewed | |
| PMC8662909 figs 3-6 | could not download (the PMC and publisher hosts refused scripted requests) | still unverified |

So the real-image count is lower than I said: one clean real A4C, two small real insets (A2C, PSAX at the AV), and the CardioNetworks normal subcostal and A4C videos (still to check). PLAX has no real still yet. The next sources worth trying are CardioNetworks ECHOpedia normal-view videos, the PMC8662909 sonograms (open them in a browser), and a hand search of PMC case reports for normal frames.

## Browser check: PMC8662909 and the CardioNetworks videos (viewed)

- **PMC8662909 figs 3 to 6** (subcostal, PSAX, PLAX; fig 4 is a second subxiphoid): each is a banner from a commercial teaching site (TwinOaksAnesthesia) with its logo and URL, a stock heart graphic, and a small dark sonogram. The article is CC BY, but the figure is third-party branded teaching material, so the license may not cover it. Image quality is low and the "sub-costal" sonogram looks like an apical-style frame. **Rejected.**
- **`Subcostal normal` (CardioNetworks ECHOpedia, CC BY-SA 3.0)**: a real normal subcostal loop, 500x385, with ECG trace and an ECHOpedia watermark ("Courtesy of Dept. of Echocardiography AMC, I.A.C. van der Bilt"). **Usable**, keep the watermark and attribution.
- **`A4CTTS`**: the name suggests a Takotsubo case, not a normal heart, and the sector is cropped. **Not usable as the normal A4C.**

Where this leaves TTE real-image coverage: A4C has one clean PD frame, subcostal has one normal loop, A2C and PSAX-AV have small CC BY insets, and PLAX, RV inflow, PSAX MV and papillary, A5C, A3C, IVC and suprasternal have nothing. Searching further on Commons and PMC is unlikely to close that; the gaps need contributed images. A practical split: ship the four views that have something, mark the rest "image pending", and ask for contributions.

## Built, 2026-10-18: `/echo/`

A TTE-only atlas page: `echo/index.html`, `src/echo/` (`volume.ts` label volume and surface, `poses.ts` probe poses from the CT heart's landmarks, `views.ts` the 10 views and the image manifest, `scene.ts` three.js probe and sector, `page.ts`), tests in `tests/echoPoses.test.ts`. Images sit in `src/echo/media/` with license and source in `views.ts`.

- 10 views: PLAX, RV inflow, PSAX at AV, MV and papillary level, A4C, A5C, A2C, A3C, subcostal 4C. IVC and suprasternal are left out for now: the model has no vena cava or arch to aim at.
- 4 have real images (A4C, A2C, PSAX AV, subcostal); the other 6 show "Image pending" and the page lists what a contribution needs.
- Poses are derived, not hand-placed: A4C is the plane through the apex, mitral and tricuspid valves; A3C is the plane through the aortic valve (it comes out 52 degrees from A4C, close to the textbook 60); A2C sits 60 degrees the other way. Tests check each plane holds what it should.
- Not modelled: ribs, lungs, sternum, so a pose does not show whether the window exists. A pose also does not show a patient's heart; the shape is the CT average.
- The masthead is a static copy because another session is moving every page onto `src/shell/`. When that lands, add one line to `PAGES` in `src/shell/shell.ts` and switch this page to `mountShell`.

### Update: simulator heart, four views

The 3D pane now draws the simulator's own heart (`src/anatomy/heartSurface.ts`, the one the main page shows), not the CT volume, and only the four views with a reference image have a probe: A4C, A2C, PSAX at the aortic valve and subcostal. The other six are listed with "image pending" and no 3D probe. `volume.ts` and the CT loading were removed from the atlas; `src/echo/poses.ts` holds hand-placed landmarks on the schematic heart (apex, mitral, tricuspid, aortic root) and derives each plane from them: A4C is the plane through the apex, mitral and tricuspid valves; A2C is 60 degrees from it, turned toward the left atrium; PSAX AV is cut across the aortic root, beam front to back; subcostal is the A4C plane entered from below and the right. Tests in `tests/echoPoses.test.ts` check each plane holds what it should. Units are now mm in the patient frame (x left, y up, z anterior).

### Update: tabs and the cross-section

Each view now has four tabs: **Probe** (the 3D heart with probe and sector), **Slice**, **TTE image**, and **Compare** (slice and image side by side, the default). The slice is a cross-section of the simulator's 3D heart along the probe's plane: `src/echo/slice.ts` classifies every point of the plane (muscle wall, LV, RV, RA, LA, aortic root) from the same surface the 3D view draws, adding wall thickness (LV 10 mm, septum 9, RV free wall 3.5, atria 2.5), the interatrial septum and open valves; `src/echo/render.ts` paints it flat with outlines, laid out like the echo picture (probe at top, index mark on the right, sector outlined, the rest of the cut dimmed) with optional chamber labels. The RV is a crescent around an LV envelope, so the A2C cut shows no right ventricle. Landmarks were nudged (mitral and tricuspid posterior, aortic root a little below the valve plane) so A4C shows no aorta and PSAX AV shows RA, Ao, LA and RVOT. Not modelled: leaflets, papillary muscles, trabeculae.

### Update: better images from the Yale/Lynch atlas, 6 of 10 views covered

A closer look at Commons found Patrick J. Lynch's (Yale) figure [Heart normal tte views.jpg](https://commons.wikimedia.org/wiki/File:Heart_normal_tte_views.jpg), CC BY 2.5, 1897x757: eight panels of normal transthoracic frames, each with the matching anatomical cutaway. Four panels are now cropped into the atlas, replacing the earlier weaker images: A4C, A2C, PLAX and PSAX at the papillary level (about 450x360 each, with the frame lines trimmed). PSAX at the aortic valve still uses the small Yale composite (`Aortic valve sa.png`, CC BY 2.5), and subcostal still uses the ECHOpedia loop (CC BY-SA 3.0). The public-domain A4C frame is gone from the atlas.

Coverage is now 6 of 10 views, and PLAX and PSAX PM got probe poses and slices (8 pose tests, 10 slice tests). Still without an image: RV inflow, PSAX at the mitral level, A5C and A3C.

Not found, and why: the ASE chamber-quantification and TTE-protocol guideline figures are the official reference, but they are copyrighted (Elsevier/ASE), so they cannot be used here without a licence. ECHOpedia also has normal loops for PLAX, short axis at the apical and papillary levels, and suprasternal that could be added as moving alternatives (CC BY-SA 3.0).

### Update: clean images only, 3 of 10 views

"Clean" means the ultrasound picture and nothing else: no anatomical cutaway, no labels, no ECG, text, depth scale or watermark. The Yale/Lynch panels fail that (their anatomy artwork overlaps the echo frame) and so do the small Yale composites, so they were dropped. The public-domain A4C frame turned out to be displayed upside down (probe at the bottom), so it was dropped too.

What remains are three ECHOpedia normal loops (CC BY-SA 3.0, I.A.C. van der Bilt, AMC): PLAX, PSAX at the papillary level and subcostal. `src/echo/cleanVideo.ts` plays each one into a canvas, cropped to the sector's bounding box, with everything outside the sector wedge painted black and saturated (yellow) marker pixels blacked out; the ultrasound itself is untouched. The wedge angles and radius per loop are in `views.ts`. The credit and license stay in the caption. The papillary-level loop is dark and low-gain in the source.

Pending (no clean open image found): A4C, A5C, A2C, A3C, RV inflow, PSAX at the aortic and mitral levels. Commons has no normal-view category for these; ECHOpedia's other loops are pathology cases. Fastest fix is a contributed set (see "Images wanted" on the page).

### Update: slice and tabs removed

The cross-section (`slice.ts`, `render.ts`, their tests) and the four tabs are gone. Each view is now the simulator's 3D heart with the probe and imaging sector on the left, seen square onto the plane with the probe at the top as on an echo screen, and the clean echo loop on the right where one exists. Poses stay for the six views that have them (A4C, A2C, PLAX, PSAX AV, PSAX PM, subcostal); `tests/echoPoses.test.ts` (10 tests) covers them. Three views have a clean loop: PLAX, PSAX PM, subcostal.

### Update: only views with both a probe and an image

The atlas now lists three views: PLAX, PSAX at the papillary level and subcostal four-chamber, the ones that have both a probe pose on the 3D heart and a clean echo loop. The other seven (RV inflow, PSAX at the aortic and mitral levels, A4C, A5C, A2C, A3C) were removed from the page, along with their poses, the "Images wanted" section and the pending badges. They can come back one at a time when a clean open image exists: add a pose in `src/echo/poses.ts`, a `ViewDef` and an image in `src/echo/views.ts`, and the loop's crop and sector in its `clean` spec. Earlier notes above record what was tried for each.
