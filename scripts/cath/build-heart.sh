#!/usr/bin/env bash
# Rebuilds src/cath/data/heart.bin.gz and heart.json from the open four-chamber mesh. Run from the repo root: npm run build:heart
# Needs python3 with numpy and scipy, curl and tar, about 1 GB of disk and a few minutes.
# The raw mesh (58 MB download, 187 MB unpacked) and the intermediates live in scripts/cath/work/ and stay out of git.
#
# Source (CC BY 4.0): Rodero C, Strocchi M, Marciniak M, et al. Linking statistical shape models and simulated function in the
# healthy adult human heart. PLoS Comput Biol 17(4): e1008851 (2021). Zenodo doi:10.5281/zenodo.4593739, file average.tar.gz.
set -euo pipefail
WORK=scripts/cath/work
mkdir -p "$WORK/average"
if [ ! -f "$WORK/average/average.vtk" ]; then
  curl -L -o "$WORK/average.tar.gz" "https://zenodo.org/api/records/4593739/files/average.tar.gz/content"
  tar -xzf "$WORK/average.tar.gz" -C "$WORK/average"
fi
python3 scripts/cath/parse_vtk.py "$WORK/average/average.vtk" "$WORK/average.npz"
python3 scripts/cath/voxelize.py   # frame and 1 mm label volume
python3 scripts/cath/fill2.py      # cavities, valves, segments -> src/cath/data/heart.bin.gz + heart.json
