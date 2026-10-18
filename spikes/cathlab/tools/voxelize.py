"""Turn the tetrahedral four-chamber mesh into a 1 mm label volume in CoroSim's heart frame (cm: x lateral, y anterior, z toward the base)."""
import numpy as np
from scipy import ndimage as ndi
d = np.load("data/average.npz"); P = d["pts"].astype(np.float64); T = d["tets"]; tag = d["tag"]
Z, PHI, RHO, V = d["Z"], d["PHI"], d["RHO"], d["V"]
lv = V == -1
apex = P[lv & (Z >= 0) & (Z < 0.03)].mean(0); base = P[lv & (Z > 0.97)].mean(0)
zax = (base - apex) / np.linalg.norm(base - apex)
sept = P[lv & (np.abs(PHI) < 0.3) & (Z > 0.3) & (Z < 0.7)].mean(0); free = P[lv & (np.abs(PHI) > 2.84) & (Z > 0.3) & (Z < 0.7)].mean(0)
xv = free - sept; xv -= xv.dot(zax) * zax; xax = xv / np.linalg.norm(xv)
yax = np.cross(xax, zax)   # anterior positive; with x lateral and z toward the base this frame is left-handed, as in the TEE poses
R = np.stack([xax, yax, zax])           # rows: new axes
Q = (P - base) @ R.T / 10.0              # cm, origin at the LV base centre
def cen(tg): return Q[T[tag == tg]].mean(1).mean(0)
names = {1:"LV",2:"RV",3:"LA",4:"RA",5:"Ao",6:"PA"}
print("LV length cm", np.linalg.norm(base-apex)/10)
for k, n in names.items(): print(n, np.round(cen(k), 2))
for k in range(7, 25): print("tag", k, np.round(cen(k), 2), (tag == k).sum())
np.savez_compressed("data/frame.npz", Q=Q.astype(np.float32), R=R, base=base, apex=apex)

# ---- voxelize ----
cent = Q[T].mean(1)                                   # tet centroids, cm
lo = np.floor(Q.min(0) * 10 - 6).astype(int); hi = np.ceil(Q.max(0) * 10 + 6).astype(int)
shape = tuple(hi - lo + 1); print("grid", shape, "origin(mm)", lo)
idx = np.round(cent * 10).astype(int) - lo
lab = np.zeros(shape, np.uint8); zc = np.full(shape, 255, np.uint8); pc = np.full(shape, 255, np.uint8); rc = np.full(shape, 255, np.uint8)
tz = Z[T].mean(1); tp = PHI[T].mean(1); tr = RHO[T].mean(1); tv = V[T].mean(1)
order = [1, 2, 3, 4, 5, 6] + list(range(11, 25)) + [7, 8, 9, 10]      # valve planes last so they stay visible
for tg in order:
    m = tag == tg; ii = idx[m]
    lab[ii[:, 0], ii[:, 1], ii[:, 2]] = tg
    if tg in (1, 2):
        ok = tz[m] >= 0
        a = ii[ok]; zc[a[:, 0], a[:, 1], a[:, 2]] = np.clip(tz[m][ok] * 254, 0, 254).astype(np.uint8)
        pc[a[:, 0], a[:, 1], a[:, 2]] = np.clip((tp[m][ok] + np.pi) / (2 * np.pi) * 254, 0, 254).astype(np.uint8)
        rc[a[:, 0], a[:, 1], a[:, 2]] = np.clip(tr[m][ok] * 254, 0, 254).astype(np.uint8)
print("voxel counts per tag", {int(k): int(v) for k, v in zip(*np.unique(lab, return_counts=True))})
np.savez_compressed("data/vox_raw.npz", lab=lab, zc=zc, pc=pc, rc=rc, lo=lo)
