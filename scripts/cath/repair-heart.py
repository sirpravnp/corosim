"""Repair the chamber labels of src/cath/data/heart.bin.gz so each blood pool is one connected piece.

fill2.py labels each cavity voxel by the nearest wall, which goes wrong near shared walls: RV cavity along the septum (an LV wall)
came out as LV (39 ml), LV inflow just below the mitral plane as LA, and RV inflow just below the tricuspid plane as RA. Here every
piece that is not its label's largest is given to the chamber it is continuous with (the blood label it shares the most voxel faces
with); a piece that touches no other blood goes to the nearest main pool. Idempotent. Run after fill2.py (build-heart.sh does).
"""
import gzip, json
import numpy as np
from scipy import ndimage as ndi

meta = json.load(open("src/cath/data/heart.json"))
shape = tuple(meta["shape"]); n = int(np.prod(shape)); lo = np.array(meta["origin_mm"], float)
raw = bytearray(gzip.open("src/cath/data/heart.bin.gz").read())
lab = np.frombuffer(bytes(raw[:n]), np.uint8).reshape(shape).copy()
CH = (1, 2, 3, 4)  # LV, RV, RA, LA
six = ndi.generate_binary_structure(3, 1)
moved = []
for _ in range(4):
    changed = False
    for l in CH:
        cc, k = ndi.label(lab == l, structure=six)
        if k <= 1: continue
        sz = ndi.sum(np.ones_like(cc), cc, range(1, k + 1)); main = 1 + int(np.argmax(sz))
        for piece in range(1, k + 1):
            if piece == main: continue
            m = cc == piece
            ring = ndi.binary_dilation(m, structure=six) & ~m
            touch = {c: int(((lab == c) & ring).sum()) for c in CH if c != l}
            to = max(touch, key=touch.get) if max(touch.values()) > 0 else None
            if to is None:
                mains = np.isin(lab, CH) & ~m
                _, (ix, iy, iz) = ndi.distance_transform_edt(~mains, return_indices=True)
                p = np.argwhere(m)[0]; to = int(lab[ix[tuple(p)], iy[tuple(p)], iz[tuple(p)]])
            lab[m] = to; changed = True
            moved.append((l, to, int(m.sum()), np.round(np.argwhere(m).mean(0) + lo, 1).tolist()))
    if not changed: break
names = {1: "LV", 2: "RV", 3: "RA", 4: "LA"}
for a, b, c, where in moved: print(f"{c:6d} voxels {names[a]} -> {names[b]} at {where}")
cm = lambda i: (np.argwhere(lab == i).mean(0) + lo) / 10.0
meta["centroids"] = {nm: cm(i).tolist() for i, nm in names.items()}
raw[:n] = lab.tobytes()
open("src/cath/data/heart.bin.gz", "wb").write(gzip.compress(bytes(raw), 9, mtime=0))
json.dump(meta, open("src/cath/data/heart.json", "w"))
print("volumes ml:", {names[i]: round(float((lab == i).sum()) / 1000, 1) for i in CH})
