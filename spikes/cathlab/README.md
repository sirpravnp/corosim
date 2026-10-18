# Cath-lab look-and-feel prototype

Open `index.html` (self-contained; needs a modern browser for `DecompressionStream`). Rebuild with `node build.mjs`.

- **Angiogram, pullback**: from CoroSim's own coronary tree and solved flows. `npx tsx spikes/cathlab/export.ts` writes `data.json`.
- **Echo**: a CT-derived four-chamber heart sliced by a TEE-style plane (probe pose + omniplane angle). Labels come from the model's region ids.

## Anatomy source and credit (CC BY 4.0)

Average four-chamber heart mesh from a statistical shape model of healthy adult CT hearts:
Rodero C, Strocchi M, Marciniak M, et al. *Linking statistical shape models and simulated function in the healthy adult human heart.* PLoS Comput Biol 17(4): e1008851 (2021).
Data: "Virtual cohort of extreme and average four-chamber heart meshes from statistical shape model", Zenodo, doi:10.5281/zenodo.4593739 (file `average.tar.gz`).

## Rebuild the heart volume from the mesh

```
curl -L -o data/average.tar.gz "https://zenodo.org/api/records/4593739/files/average.tar.gz/content"
mkdir -p data/average && tar -xzf data/average.tar.gz -C data/average
python3 tools/parse_vtk.py data/average/average.vtk data/average.npz
python3 tools/voxelize.py      # frame, 1 mm label volume (data/vox_raw.npz)
python3 tools/fill2.py         # cavities, valves, segments -> data/heart.bin.gz + data/heart.json
node build.mjs
```
The open TotalSegmentator dataset was checked first and rejected: it has a single `heart` mask, no separate chambers.
