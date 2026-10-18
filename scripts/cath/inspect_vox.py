import numpy as np, sys, matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import ListedColormap
f = sys.argv[1]; out = sys.argv[2]
d = np.load(f); lab = d["lab"] if "lab" in d else d["out"]; lo = d["lo"]
rng = np.random.RandomState(3); cols = rng.rand(64, 3) * 0.8 + 0.2; cols[0] = (0, 0, 0)
cols[1] = (0.9, 0.3, 0.3); cols[2] = (0.3, 0.4, 0.9); cols[3] = (0.9, 0.8, 0.3); cols[4] = (0.3, 0.8, 0.8); cols[5] = (0.9, 0.5, 0.1); cols[6] = (0.6, 0.9, 0.3)
cmap = ListedColormap(cols)
cuts = [("z", -40), ("z", 10), ("z", 40), ("y", 0), ("y", 25), ("x", 0)]  # mm in heart frame
fig, ax = plt.subplots(2, 3, figsize=(15, 10))
for a, (k, v) in zip(ax.ravel(), cuts):
    i = {"x": 0, "y": 1, "z": 2}[k]; s = v - lo[i]
    sl = np.take(lab, int(s), axis=i)
    a.imshow(sl.T, origin="lower", cmap=cmap, vmin=0, vmax=63, extent=None); a.set_title(f"{k}={v} mm"); a.set_xlabel("axes: remaining dims")
plt.tight_layout(); plt.savefig(out, dpi=60)
