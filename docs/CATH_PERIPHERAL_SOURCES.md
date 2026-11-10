# Peripheral vascular sources (unified cath)

Licenses re-checked against Wikimedia Commons file pages on 2026-11-10. Reference images are downloaded by `scripts/cath/peripheral/fetch-refs.ts` into **untracked** `scripts/cath/work/refs/` and are never embedded in the site. The renderer draws from `src/cath/data/peripheral.json` only.

Where a clean normal bilateral run-off DSA or radial-to-arch angiogram was not available, centerlines are hand-defined from Gray's plates and the pathology angiograms below and marked `origin: "assumed"` in the JSON.

## License table

| Source | License | Role | Notes |
|---|---|---|---|
| `Leriche-Syndrom-DSA.jpg` (Hellerhoff) | CC BY-SA 3.0 | Abdominal aorta and bifurcation look | Visual check for AORTA_ABD; pixels not shipped |
| `AAA i AAIC.jpg`, `Catheterization selective angiography.JPG` (Milorad Dimic) | CC BY 3.0 rs / CC BY-SA 3.0 | Iliac tortuosity and catheter lie | Visual check for EIA / CIA |
| `PSA iliaca.jpg` (Marta.burrel) | CC BY-SA 4.0 | Iliac origin angles | Visual check for CIA / IIA |
| `Neutral popliteal artery angiogram.png` (Minhle90) | CC BY-SA 4.0 | Popliteal course | Visual check for POP |
| `Multiple nearly occlusion of left superficial femoral artery and stented.jpg` (Drquochoai) | CC BY-SA 4.0 | SFA course | Visual check for SFA |
| `Angiography of the right foot with posterior tibial arteriosclerosis.jpg` (Cerevisae) | CC BY-SA 4.0 | Distal tibial / pedal | Visual check for ATA, PTA, DP |
| `M.Buerger 1.JPG` (Milorad Dimic) | GFDL / CC BY 3.0 | Distal runoff pattern | Visual check for PERONEAL |
| `Femoral-artery-grays-illustrations.jpg` (Radiopaedia) | CC BY-SA 4.0 | CFA / profunda / SFA order | Visual check for CFA, PFA |
| `Femoral artery.svg` (InjuryMap) | CC BY-SA 4.0 | Lower-limb branch names | Visual check for PFA |
| `Arteriografia de troncs supra-aòrtics. IMG 2507.JPG` (Amadalvarez) | CC BY-SA 4.0 | Supra-aortic trunks | Visual check for SUBCLAV, AXILLARY, CCA |
| `Takayasu Arteritis.jpg` (Justin Ly, MedPix) | public domain | LAO arch angiogram | Visual check for ARCH |
| `Gray505.png`, `Gray506.png` | public domain | Arch and root plates | Visual check for AORTA_THOR, VERT |
| `Radial artery catheterization.jpg` | CC BY-SA 3.0 / 4.0 | Radial access path | Visual check for BRACHIAL, RADIAL |
| `Ensemble des voies… catheterisme…` (Claude Bernard) | public domain | Historical catheter routes | Visual check for ULNAR path sanity |
| BodyParts3D (DBCLS) artery meshes | CC BY 4.0 (current page) | Intended centerline source | Not used in this bake; unavailable offline → assumed |
| Nevit Dilmen STL (`3DPX-002591` and related) | CC BY-SA 3.0 | CT-derived aorta / iliac surfaces | Not used in this bake; share-alike centerlines deferred |
| Vascular Model Repository | research terms | Tortuosity reference | Skipped: terms not confirmed compatible |
| TotalSegmentator CT (Zenodo 10.5281/zenodo.6802613) | CC BY 4.0 (secondary) | Aorta / iliac variability | Not used; femoral not a labeled class |

## Caliber references [lit]

Adult lumen diameters used to set `radiusMm` (half of diameter): aorta about 20 mm, CFA about 8 mm, SFA about 6 mm, popliteal about 5 mm, tibial about 3 mm.

## Bake

```bash
npx tsx scripts/cath/peripheral/fetch-refs.ts   # optional; writes gitignored work/refs/
npx tsx scripts/cath/peripheral/bake.ts         # writes src/cath/data/peripheral.json
```

Every segment in the baked JSON sets `origin: "assumed"` and `checkedAgainst` to the Commons filename (or Gray plate) used as the visual reference for that vessel.
