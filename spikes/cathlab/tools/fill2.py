"""Second pass: lumens of the aorta/PA stubs, valve planes, procedural continuations, segment labels. Exports data/heart.bin.gz + data/heart.json for the viewer."""
import numpy as np, json, gzip
from scipy import ndimage as ndi
r = np.load("data/vox_raw.npz"); lab = r["lab"]; zc, pc, rc, lo = r["zc"], r["pc"], r["rc"], r["lo"]
shape = lab.shape
def mm(mask): return np.argwhere(mask).astype(np.float64) + lo          # voxel centres, mm
def cm(mask): return mm(mask) / 10.0
# ---------- cavities ----------
solid = lab > 0
closed = ndi.binary_closing(solid, structure=ndi.generate_binary_structure(3, 2), iterations=1)
free = ~closed; cc, n = ndi.label(free); interior = free & (cc != cc[0, 0, 0])
walls = np.isin(lab, [1, 2, 3, 4])
_, (ix, iy, iz) = ndi.distance_transform_edt(~walls, return_indices=True)
near = lab[ix, iy, iz]
out = np.zeros(shape, np.uint8)
for tg, cid in {1: 1, 2: 2, 3: 4, 4: 3}.items(): out[interior & (near == tg)] = cid
# ---------- aorta and PA: lumen from the wall's local centre line ----------
tubes = {}
def fill_tube(tag, valve_tag, lumen_id, name):
    p = mm(lab == tag); vc = mm(lab == valve_tag).mean(0)
    c = p.mean(0); u = np.linalg.svd(p - c, full_matrices=False)[2][0]
    if (p.mean(0) - vc) @ u < 0: u = -u
    s = (p - vc) @ u; s0, s1 = 0.0, s.max()
    # centre line per 1 mm slab
    cent = {}; rad = {}
    for k in range(int(s.min()), int(s1) + 1):
        m = (s >= k - 0.8) & (s < k + 0.8)
        if m.sum() < 12: continue
        ck = p[m].mean(0); cent[k] = ck; rad[k] = np.sqrt(((p[m] - ck - ((p[m] - ck) @ u)[:, None] * u) ** 2).sum(1)).mean()
    ks = sorted(cent); allv = np.argwhere(~solid | interior).astype(np.float64) + lo
    # restrict to a box around the stub
    lo_b, hi_b = p.min(0) - 25, p.max(0) + 25
    box = ((allv >= lo_b) & (allv <= hi_b)).all(1); allv = allv[box]
    sv = (allv - vc) @ u
    kk = np.clip(np.round(sv).astype(int), ks[0], ks[-1]); ok = (sv > -2) & (sv < ks[-1] + 0.5)
    cx = np.array([cent[k] for k in kk]); rr = np.array([rad[k] for k in kk])
    perp = allv - cx; perp -= (perp @ u)[:, None] * u
    dist = np.sqrt((perp ** 2).sum(1))
    lum = ok & (dist < rr - 1.0) & ((allv - vc) @ u > 0.0)
    vi = (allv[lum] - lo).astype(int)
    sel = lab[vi[:, 0], vi[:, 1], vi[:, 2]] == 0
    out[vi[sel, 0], vi[sel, 1], vi[sel, 2]] = lumen_id
    mids = [rad[k] for k in ks[len(ks) // 4: 3 * len(ks) // 4 + 1]]; med = float(np.median(mids))
    kend = max(k for k in ks if rad[k] >= 0.93 * med); end_c = cent[kend]; lumr = med - 1.0
    tubes[name] = {"vc": (vc / 10).tolist(), "u": u.tolist(), "end": (end_c / 10).tolist(), "r": float(lumr / 10), "rwall": float(med / 10)}
    print(name, "lumen voxels", int(sel.sum()), "end", np.round(end_c / 10, 2), "r(cm)", round(lumr / 10, 2), "axis", np.round(u, 2))
fill_tube(5, 9, 7, "ao"); fill_tube(6, 10, 17, "pa")
# ---------- valve planes ----------
valves = {}
for tg, nm in {7: "MV", 8: "TV", 9: "AV", 10: "PV"}.items():
    p = cm(lab == tg); c = p.mean(0); _, sv, vt = np.linalg.svd(p - c, full_matrices=False); nrm = vt[2]
    rr = np.sqrt((((p - c) - ((p - c) @ nrm)[:, None] * nrm) ** 2).sum(1)).max()
    valves[nm] = {"c": c.tolist(), "n": nrm.tolist(), "R": float(rr)}
# axis points downstream: MV -> toward LV (z<0), TV -> toward RV, AV -> toward aorta, PV -> toward PA
def orient(nm, toward):
    v = valves[nm]; n = np.array(v["n"]); 
    if (np.array(toward) - np.array(v["c"])) @ n < 0: n = -n
    v["n"] = n.tolist()
orient("MV", cm(lab == 1).mean(0)); orient("TV", cm(lab == 2).mean(0)); orient("AV", np.array(tubes["ao"]["end"])); orient("PV", np.array(tubes["pa"]["end"]))
# ---------- the vessels that open onto the atria: windows (discs) become blood; tubes are drawn by the viewer ----------
inl = {"LAA": (11, 18), "LUPV": (12, 19), "LLPV": (13, 20), "RLPV": (14, 21), "RUPV": (15, 22), "SVC": (16, 23), "IVC": (17, 24)}
atr = {"LAA": 4, "LUPV": 4, "LLPV": 4, "RLPV": 4, "RUPV": 4, "SVC": 3, "IVC": 3}
ostia = {}
for nm, (it, bt) in inl.items():
    p = cm((lab == it) | (lab == bt)); c = p.mean(0)
    host = cm(out == atr[nm]).mean(0); nrm = c - host; nrm /= np.linalg.norm(nrm)
    rr = np.sqrt(((p - c) ** 2).sum(1)).max()
    ostia[nm] = {"c": c.tolist(), "n": nrm.tolist(), "r": float(rr)}
rings = np.isin(lab, list(range(11, 25)))
blood = np.isin(out, [1, 2, 3, 4, 7, 17])
_, (bx, by, bz) = ndi.distance_transform_edt(~blood, return_indices=True)
out[rings] = out[bx[rings], by[rings], bz[rings]]
# ---------- walls ----------
wallmap = {2: 25, 3: 26, 4: 27, 5: 28, 6: 32, 7: 20, 8: 22, 9: 21, 10: 23}
for tg, cid in wallmap.items(): out[lab == tg] = cid
# ventricular septum direction and the segment angle u from the UVC phi
lvall = lab == 1
validv = lvall & (zc < 255)
_, (jx, jy, jz) = ndi.distance_transform_edt(~validv, return_indices=True)
zc = np.where(lvall, zc[jx, jy, jz], zc); pc = np.where(lvall, pc[jx, jy, jz], pc); rc = np.where(lvall, rc[jx, jy, jz], rc)
lvw = lvall & (zc < 255)
print('LV wall voxels', int(lvall.sum()), 'with UVC', int(lvw.sum()))
phi = pc.astype(np.float32) / 254.0 * 2 * np.pi - np.pi; zf = zc.astype(np.float32) / 254.0
idx = np.argwhere(lvw); P = (idx + lo) / 10.0
ph = phi[lvw]; ymean_pos = P[ph > 0.3][:, 1].mean(); ymean_neg = P[ph < -0.3][:, 1].mean()
sgn = 1.0 if ymean_pos > ymean_neg else -1.0          # +1: positive phi is the anterior side
print("anterior side sign of phi:", sgn, "(y means", round(float(ymean_pos), 2), round(float(ymean_neg), 2), ")")
u = np.degrees(ph) * sgn                                 # 0 = septum centre, + toward the anterior wall, +-180 = free wall
z = zf[lvw]
# smooth both fields over the wall so segment borders are clean (circular mean for the angle)
mk = lvw.astype(np.float32); den = ndi.gaussian_filter(mk, 1.6) + 1e-6
cs_ = np.zeros(shape, np.float32); sn_ = np.zeros(shape, np.float32); zz_ = np.zeros(shape, np.float32)
cs_[lvw] = np.cos(np.radians(u)); sn_[lvw] = np.sin(np.radians(u)); zz_[lvw] = z
us = np.degrees(np.arctan2(ndi.gaussian_filter(sn_, 1.6) / den, ndi.gaussian_filter(cs_, 1.6) / den))
zs = ndi.gaussian_filter(zz_, 1.6) / den
u = us[lvw]; z = zs[lvw]
q = np.floor(((u + 360 + 0) % 360) / 60).astype(int)    # 0:[0,60) AS 1:[60,120) A 2:[120,180) AL 3:[180,240) IL 4:[240,300) I 5:[300,360) IS
segidx6 = {0: 2, 1: 1, 2: 0, 3: 5, 4: 4, 5: 3}           # to the viewer's order: AL, A, AS, IS, I, IL
names6 = ["anterolateral", "anterior", "anteroseptal", "inferoseptal", "inferior", "inferolateral"]
seg = np.zeros(len(u), np.int32)
basal = z >= 2 / 3; mid = (z >= 1 / 3) & (z < 2 / 3); api = (z >= 0.1) & (z < 1 / 3); cap = z < 0.1
# viewer order inside a ring: AL, A, AS, IS, I, IL
ringidx = np.array([segidx6[v] for v in q])
seg[basal] = ringidx[basal]; seg[mid] = 6 + ringidx[mid]
# apical four: anterior u in [45,135), septal (-45,45), inferior [-135,-45), lateral |u|>=135
a4 = np.where((u >= 45) & (u < 135), 0, np.where(np.abs(u) < 45, 1, np.where((u < -45) & (u >= -135), 2, 3)))
seg[api] = 12 + a4[api]; seg[cap] = 16
out[idx[:, 0], idx[:, 1], idx[:, 2]] = 40 + seg
# angle table for the viewer: geometric angle about the LV axis -> u (circular mean)
ang = np.degrees(np.arctan2(P[:, 1], P[:, 0])) % 360
tab = np.zeros(72); 
for b in range(72):
    m = (ang >= b * 5) & (ang < b * 5 + 5) & (z > 0.25) & (z < 0.9)
    tab[b] = np.degrees(np.arctan2(np.sin(np.radians(u[m])).mean(), np.cos(np.radians(u[m])).mean())) if m.sum() > 5 else np.nan
for b in range(72):
    if np.isnan(tab[b]): tab[b] = tab[(b - 1) % 72]
# ---------- IAS and pericardium ----------
la = out == 4; ra = out == 3
d_la = ndi.distance_transform_edt(~la); d_ra = ndi.distance_transform_edt(~ra)
ias = ((out == 26) | (out == 27)) & (d_la + d_ra <= 8.5) & (d_la <= 6.5) & (d_ra <= 6.5)
out[ias] = 24
heart = out > 0
peri = ndi.binary_dilation(heart | solid, iterations=2) & ~(heart | solid)
out[peri & (out == 0)] = 29
# ---------- export ----------
tr = np.where(lvw, rc, 255).astype(np.uint8)            # transmural coordinate for speckle
uq = np.where(lvw, np.clip((u_full := np.zeros(shape, np.float32)) + 0, 0, 0), 0)
ufull = np.zeros(shape, np.float32); ufull[lvw] = u; uq = np.where(lvw, np.clip((ufull + 180) / 360 * 254, 0, 254), 255).astype(np.uint8)
zq = np.where(lvw, zc, 255).astype(np.uint8)
meta = {"shape": list(shape), "origin_mm": lo.tolist(), "valves": valves, "ostia": ostia, "tubes": tubes, "u_table": tab.tolist(), "sign": sgn,
        "lv_apex_cm": [0, 0, float(P[:, 2].min())], "centroids": {n: cm(out == i).mean(0).tolist() for n, i in {"LV": 1, "RV": 2, "RA": 3, "LA": 4}.items()}}
json.dump(meta, open("data/heart.json", "w"))
blob = np.concatenate([out.ravel(), tr.ravel(), uq.ravel(), zq.ravel()]).tobytes()
open("data/heart.bin.gz", "wb").write(gzip.compress(blob, 9))
np.savez_compressed("data/vox_final.npz", out=out, lo=lo)
print("ids", {int(k): int(v) for k, v in zip(*np.unique(out, return_counts=True)) if k < 40 or k == 40})
import os; print("heart.bin.gz KB", os.path.getsize("data/heart.bin.gz") // 1024)
print({k: (np.round(v["c"], 2).tolist(), round(v["R"], 2)) for k, v in valves.items()})
print({k: (np.round(v["c"], 2).tolist(), np.round(v["n"], 2).tolist(), round(v["r"], 2)) for k, v in ostia.items()})
