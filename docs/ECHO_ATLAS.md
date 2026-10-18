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
