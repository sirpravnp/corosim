# Open-source landscape: cardiac CT to 3D, and what CoroSim can combine

Written from memory of the field, not a fresh literature or license audit. **Verify each license and
weight-file terms before depending on anything**, especially for commercial or hosted use.

## 1. Tools by pipeline stage

### A. Viewing and manual segmentation
| Tool | License | What it gives you |
|---|---|---|
| 3D Slicer | BSD-style | Full DICOM workflow, Segment Editor, volume rendering, extension ecosystem (SlicerHeart, SlicerVMTK, TotalSegmentator, MONAI Label) |
| ITK-SNAP | GPL | Fast manual/semi-automatic snake segmentation |
| MITK | BSD-style | Slicer alternative, good plugin framework |
| InVesalius | GPL | Lightweight DICOM to 3D mesh, mostly bone-oriented |
| Cornerstone3D / OHIF | MIT | Browser DICOM viewer with GPU volume rendering |
| Niivue | BSD | WebGL NIfTI/mesh viewer, tiny, embeddable |
| vtk.js | BSD | VTK in the browser (volume rendering, mesh, widgets) |

### B. Automatic segmentation (the biggest recent jump)
| Tool | License | Notes |
|---|---|---|
| TotalSegmentator | Apache-2.0 code; **some task weights are restricted/non-commercial** | 100+ structures; heart chambers, myocardium, aorta, coronary-artery tasks. Built on nnU-Net |
| nnU-Net | Apache-2.0 | The default self-configuring training framework; train on your own coronary labels |
| MONAI / MONAI Label | Apache-2.0 | PyTorch medical imaging toolkit, active-learning annotation inside Slicer |
| Datasets | various (check each) | ImageCAS (coronary CTA), ASOCA, MM-WHS (whole heart), CAT08 (centerlines), TotalSegmentator dataset |

### C. Vessel extraction, centerlines, geometry
| Tool | License | Notes |
|---|---|---|
| VMTK / SlicerVMTK | BSD | Centerlines, Voronoi diagrams, radius along path, branch splitting, stenosis quantification. The reference toolkit |
| SimVascular | BSD-style | Path planning, 2D lofted segmentation, mesh generation, solvers |
| scikit-image / ITK | BSD / Apache | Frangi vesselness, skeletonization, fast-marching |
| Gmsh / TetGen | GPL / AGPL-ish | Volume meshing for CFD. Check TetGen terms |

### D. Physics and simulation
| Tool | License | Notes |
|---|---|---|
| SimVascular (svSolver, svOneDSolver, svZeroDSolver) | BSD-style | Image-based 3D CFD, 1D, and 0D lumped models; CT-FFR-style workflows |
| CRIMSON | check (GPL-family) | Patient-specific hemodynamics, multi-scale coupling |
| openBF / VaMpy | check | 1D pulse-wave models of arterial trees |
| openCARP / Chaste | open | Cardiac electrophysiology (tissue-scale), heavy, HPC-oriented |
| FEniCS / SimCardio style FE codes | LGPL etc. | Mechanics and electromechanics research code |

### E. Rendering and presentation
three.js (already used), Blender (GPL, offline realistic renders, can import VTK/STL), ParaView (BSD).

### F. What the closed products do (for orientation only)
HeartFlow, Cleerly, Philips/Siemens/GE suites do CT segmentation, plaque quantification and CT-FFR.
None are open; the open stack above can approximate the segmentation and geometry parts.

## 2. The gap

Everything open falls on one of two sides:

- **Image-to-geometry** (Slicer, TotalSegmentator, VMTK): anatomy only, no physiology.
- **Physics** (SimVascular, CRIMSON, openCARP): need expert-built meshes, desktop-only, minutes to hours per run,
  and model one organ system (coronary flow *or* EP) at a time.

Nothing open takes a patient CT and gives an **interactive, whole-physiology what-if**: drag a stenosis, see
perfusion, ECG, rhythm and blood pressure respond in real time. CoroSim already has the right back half of that
(lumped network, ischemia, dipole ECG, rhythm, circulation). It is missing the front half.

## 3. Proposed combination ("CoroSim-CT")

```
DICOM (coronary CTA)
  -> TotalSegmentator / nnU-Net     heart, LV myocardium, aorta, coronary lumen masks
  -> VMTK skeletonize               centerline graph + radius per point + bifurcations
  -> graph cleanup + labeling       LAD/LCx/RCA/PDA..., dominance, branch order (rule-based, then learned)
  -> myocardial territory map       assign each LV voxel to nearest vessel segment (Voronoi / flow-weighted)
  -> JSON "patient tree"            segments: id, parent, length, radius, centerline, territory mass
  -> CoroSim src/anatomy loader     replaces the procedural tree; src/physics/* unchanged
  -> real-time sim + 3D view        patient mesh in three.js, dipole ECG positioned from LV mask
```

Why this split works:
- Heavy ML and geometry run **offline in Python** (one-off per case). The browser only loads a few-hundred-KB JSON
  plus a decimated surface mesh, so the app stays static-hosted.
- CoroSim's physics already consumes a segment tree with diameters and territories, so the integration surface is
  a schema, not a rewrite.
- Territory mass from voxels replaces the assumed bed sizes with measured ones, which is the single biggest
  realism gain for ischemia and ECG.

### What to re-engineer rather than reuse
1. **Centerline-graph to labeled coronary tree.** VMTK gives a graph, not "this is the LAD." Open labeling
   code is thin; this is the novel, publishable piece.
2. **Territory assignment.** Reimplement Voronoi/flow-weighted partitioning in a small, tested module, using
   Murray/Huo-Kassab scaling already in the repo as the prior.
3. **Browser-side lightweight solver.** Keep CoroSim's 0D network; borrow SimVascular's validated stenosis
   loss and boundary-condition formulations to calibrate it, and validate against SimVascular on a handful of
   cases.
4. **ECG lead field from real torso/heart geometry** (optional, later): replace the dipole with a boundary-element
   lead field using the segmented heart position.

### What not to rebuild
Segmentation networks (use nnU-Net/TotalSegmentator), DICOM IO (pydicom/ITK), volume viewing
(Cornerstone3D/Niivue if you want a CT slice pane), volumetric CFD (call SimVascular for validation only).

## 4. Phased plan

| Phase | Deliverable | Risk |
|---|---|---|
| 0 | Define the patient-tree JSON schema; make `src/anatomy` load it; ship one hand-made example | Low |
| 1 | Python script: NIfTI segmentation mask in, tree JSON out (VMTK + labeling) | Medium: labeling heuristics |
| 2 | Run on public CTA sets (ImageCAS, ASOCA) end to end; QA report per case | Medium: segmentation failures on distal vessels |
| 3 | Territory mapping from LV mask; compare against schematic beds | Low-medium |
| 4 | Validate stenosis/FFR trends against SimVascular on 5 to 10 cases | Medium |
| 5 | Optional in-browser upload path (WASM/ONNX segmentation) or a small local helper | High: model size and licenses |

## 5. Constraints to keep in mind

- **Not a medical device.** The README disclaimer stays; patient CT adds privacy and regulatory weight. Use
  only de-identified public datasets, and never upload patient data to the static site.
- **Weights and dataset licenses** vary (several are research-only); confirm before shipping a hosted feature.
- Coronary segmentation on CT still fails distally and around calcium and stents. Surface a per-case
  confidence/QA flag instead of silently simulating a broken tree.
