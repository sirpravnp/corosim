"""Parse the ASCII VTK tetrahedral heart mesh (Rodero et al. 2021, CC BY 4.0) into numpy arrays."""
import numpy as np, sys
def parse(path):
    with open(path) as f: L = f.readlines()
    idx = {}
    for i, l in enumerate(L):
        for key in ("POINTS", "CELLS", "CELL_TYPES", "CELL_DATA", "POINT_DATA"):
            if l.startswith(key + " ") or l.strip() == key: idx.setdefault(key, i)
        if l.startswith("SCALARS ") or l.startswith("VECTORS "): idx[l.split()[1]] = i
    npts = int(L[idx["POINTS"]].split()[1]); ncell = int(L[idx["CELLS"]].split()[1]); nint = int(L[idx["CELLS"]].split()[2])
    pts = np.array(" ".join(L[idx["POINTS"] + 1: idx["POINTS"] + 1 + npts]).split(), dtype=np.float32).reshape(-1, 3) if len(L[idx["POINTS"] + 1].split()) == 3 else None
    if pts is None: raise RuntimeError("unexpected POINTS layout")
    cells = np.array(" ".join(L[idx["CELLS"] + 1: idx["CELLS"] + 1 + ncell]).split(), dtype=np.int64).reshape(ncell, 5)
    assert (cells[:, 0] == 4).all()
    tid = np.array(L[idx["ID"] + 2: idx["ID"] + 2 + ncell], dtype=np.int32)
    pd = {}
    for name in ("RHO.dat", "PHI.dat", "Z.dat", "V.dat"):
        pd[name] = np.array(L[idx[name] + 2: idx[name] + 2 + npts], dtype=np.float32)
    return pts, cells[:, 1:], tid, pd
if __name__ == "__main__":
    p, c, t, pd = parse(sys.argv[1])
    np.savez_compressed(sys.argv[2], pts=p, tets=c, tag=t, **{k.split(".")[0]: v for k, v in pd.items()})
    print(p.shape, c.shape, t.shape, {k: (float(v.min()), float(v.max())) for k, v in pd.items()}, "bbox mm", p.min(0), p.max(0))
