"""Check the CT-derived heart (src/cath/data/heart.bin.gz) against normal adult cardiac dimensions.

Measures straight from the label volume (1 mm voxels, CT frame: z from the LV apex to the base, x septum to free wall, y anterior):
chamber volumes, LV length and internal diameter, wall thickness by segment, RV size, valve annuli, aortic root, LA size, LV mass.
The source scans are end-diastolic, so the values are compared with end-diastolic normal ranges. Prints a table; exits non-zero if a
measurement falls outside its range. Run from the repo root: python3 scripts/anatomy/validate-ct-heart.py
"""
import gzip, json, sys
import numpy as np
from scipy import ndimage as ndi

meta = json.load(open("src/cath/data/heart.json"))
shape = tuple(meta["shape"]); n = int(np.prod(shape)); lo = np.array(meta["origin_mm"], float)
raw = np.frombuffer(gzip.open("src/cath/data/heart.bin.gz").read(), np.uint8)
lab = raw[:n].reshape(shape)
LV, RV, RA, LA, AO, PA = 1, 2, 3, 4, 7, 17
lvmyo = (lab >= 40) & (lab <= 56)
mm = lambda idx: idx.astype(float) + lo
rows = []
def check(name, value, lo_, hi_, unit, ref):
    ok = lo_ <= value <= hi_
    rows.append((name, value, lo_, hi_, unit, ok, ref))

# volumes (1 voxel = 1 mm^3 = 0.001 ml)
vol = lambda m: m.sum() / 1000.0
ASE = "ASE/EACVI 2015 chamber quantification"
CMR = "CMR normal values (Kawel-Boehm 2020)"
check("LV end-diastolic volume", vol(lab == LV), 60, 200, "ml", CMR)
check("RV end-diastolic volume", vol(lab == RV), 80, 230, "ml", CMR)
check("LA volume (end-diastole, below its maximum)", vol(lab == LA), 20, 90, "ml", CMR)
check("RA volume (end-diastole)", vol(lab == RA), 20, 110, "ml", CMR)
check("LV mass (myocardium x 1.05 g/ml)", lvmyo.sum() / 1000.0 * 1.05, 70, 230, "g", ASE)

# LV length: apex of the cavity to the mitral valve centre
apex = np.array(meta["lv_apex_cm"]) * 10; mv = np.array(meta["valves"]["MV"]["c"]) * 10
lvc = mm(np.argwhere(lab == LV)); cav_apex_z = lvc[:, 2].min()
check("LV length, epicardial apex to mitral valve", np.linalg.norm(mv - apex) / 10, 7.0, 10.0, "cm", ASE)
check("LV cavity length, endocardial apex to mitral valve", (mv[2] - cav_apex_z) / 10, 6.0, 9.5, "cm", ASE)

# short-axis measurements on z slices (z axis is the LV long axis): LVIDd and wall thickness at the base-to-mid level (chordal level)
def slice_at(z):
    k = int(round(z - lo[2])); return k
L = mv[2] - cav_apex_z
zk = slice_at(cav_apex_z + 0.66 * L)          # just below the mitral leaflet tips, where LVIDd is measured
sl = lab[:, :, zk]
# the main cavity piece in this slice (stray islands of the label are ignored), and the contiguous run through its centre
cc, k = ndi.label(sl == LV); sizes = ndi.sum(np.ones_like(cc), cc, range(1, k + 1)); main = cc == (1 + int(np.argmax(sizes)))
c = np.argwhere(main).mean(0)
row = int(round(c[1])); line = sl[:, row]; inrun = main[:, row]
x0 = int(round(c[0])); a = x0; b = x0
while a - 1 >= 0 and inrun[a - 1]: a -= 1
while b + 1 < len(line) and inrun[b + 1]: b += 1
xs = np.array([a, b]); lvid = b - a + 1
check("LV internal diameter, end-diastole (LVIDd)", lvid / 10, 3.8, 5.8, "cm", ASE)
# septum: myocardium between the LV cavity and the RV on the septal side (smaller x); posterior/free wall on the other side
sept = 0; x = xs.min() - 1
while x >= 0 and (40 <= line[x] <= 56 or line[x] == 25) and line[x] != RV: sept += (40 <= line[x] <= 56); x -= 1
free = 0; x = xs.max() + 1
while x < len(line) and 40 <= line[x] <= 56: free += 1; x += 1
check("Septal thickness (IVSd), on the LVIDd line", sept / 10, 0.6, 1.2, "cm", ASE)
check("Free-wall thickness on the LVIDd line", free / 10, 0.6, 1.2, "cm", ASE)
# wall thickness by segment: mean transmural thickness from a distance transform of the cavity, per AHA label
dcav = ndi.distance_transform_edt(lab != LV)
seg_th = []
for s in range(40, 57):
    m = lab == s
    if m.sum() == 0: seg_th.append(np.nan); continue
    # thickness ~ distance from the cavity at the outer edge of the segment: 95th percentile of the distance within it
    seg_th.append(np.percentile(dcav[m], 95))
seg_th = np.array(seg_th)
check("LV wall thickness, mean of 17 segments", np.nanmean(seg_th[:16]) / 10, 0.6, 1.2, "cm", ASE)
check("LV wall thickness, thinnest segment (apex excluded)", np.nanmin(seg_th[:16]) / 10, 0.35, 1.2, "cm", ASE)

# RV basal diameter as ASE defines it: in the apical four-chamber plane (through the LV apex and both atrioventricular valves), the
# widest transverse RV cavity dimension in the basal third of the RV
tv = np.array(meta["valves"]["TV"]["c"]) * 10
ax = (mv - apex) / np.linalg.norm(mv - apex)
nrm = np.cross(mv - apex, tv - apex); nrm /= np.linalg.norm(nrm)
tr = np.cross(nrm, ax)                                   # in-plane, perpendicular to the long axis
def lab_at(p):
    i, j, k = np.round(p - lo).astype(int)
    return lab[i, j, k] if 0 <= i < shape[0] and 0 <= j < shape[1] and 0 <= k < shape[2] else 0
us = np.arange(-20, 110, 0.5); vs = np.arange(-80, 80, 0.5)
grid = np.array([[lab_at(apex + u * ax + v * tr) for v in vs] for u in us])
rvrows = np.where((grid == RV).any(1))[0]
u_tv = (tv - apex) @ ax; u_rv_apex = us[rvrows].min()
basal = [r for r in rvrows if us[r] >= u_tv - (u_tv - u_rv_apex) / 3]
def widest_run(rowv):
    best = cur = 0
    for x in rowv: cur = cur + 1 if x else 0; best = max(best, cur)
    return best
rv_basal = max(widest_run(grid[r] == RV) for r in basal) * 0.5
check("RV basal diameter (four-chamber direction)", rv_basal / 10, 2.5, 4.5, "cm", ASE)

# valve annuli: diameter = 2 R from the valve planes the build fitted
# annulus diameter from the valve-plane voxels' area (projected onto the fitted plane, 1 mm cells): the build's R is a maximum radius,
# which takes in the wall and overstates the annulus
for k, tag, lo_, hi_ in (("MV", 20, 2.6, 4.0), ("TV", 22, 2.6, 4.2), ("AV", 21, 1.9, 3.0), ("PV", 23, 1.7, 3.0)):
    pts = mm(np.argwhere(lab == tag)); c0 = pts.mean(0); nn = np.array(meta["valves"][k]["n"])
    e1 = np.cross(nn, [1, 0, 0] if abs(nn[0]) < 0.9 else [0, 1, 0]); e1 /= np.linalg.norm(e1); e2 = np.cross(nn, e1)
    cells = {(int(round((p - c0) @ e1)), int(round((p - c0) @ e2))) for p in pts}
    check(f"{k} annulus diameter (area-equivalent)", 2 * np.sqrt(len(cells) / np.pi) / 10, lo_, hi_, "cm", ASE)
check("Aortic root (lumen diameter at the stub)", 2 * meta["tubes"]["ao"]["r"], 2.4, 4.0, "cm", ASE)

# LA anteroposterior diameter (PLAX direction ~ y in this frame) at the LA centre
lac = np.argwhere(lab == LA); cl = lac.mean(0).round().astype(int)
ap = np.where(lab[cl[0], :, cl[2]] == LA)[0]
check("LA anteroposterior diameter", (ap.max() - ap.min() + 1) / 10, 2.3, 4.5, "cm", ASE)

# structure: every AHA segment present, interatrial septum present, a closed pericardial layer
check("AHA segments present", float(sum((lab == s).any() for s in range(40, 57))), 17, 17, "of 17", "build")
check("Interatrial septum voxels", float((lab == 24).sum()), 200, 1e9, "voxels", "build")
# LV cavity is one connected piece; each blood pool too
# each blood pool should be one piece; stray islands are reported with their size
for name, l in (("LV", LV), ("RV", RV), ("LA", LA), ("RA", RA)):
    cc, k = ndi.label(lab == l); sz = sorted(ndi.sum(np.ones_like(cc), cc, range(1, k + 1)).astype(int).tolist(), reverse=True)
    stray = sum(sz[1:])
    print(f"   {name} pieces (voxels): {sz[:8]}")
    check(f"{name} blood pool: voxels outside the main piece", float(stray), 0, 0.002 * sz[0], "voxels", "build")

w = max(len(r[0]) for r in rows)
bad = 0
for name, v, a, b, u, ok, ref in rows:
    bad += not ok
    print(f"{'ok ' if ok else 'OUT'} {name:<{w}}  {v:8.2f} {u:<6} normal {a:g}-{b:g}   ({ref})")
print(f"\n{len(rows) - bad} of {len(rows)} within range")
sys.exit(1 if bad else 0)
