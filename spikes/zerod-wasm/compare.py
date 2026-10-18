import json, sys, numpy as np, pandas as pd
w = json.load(open(sys.argv[1])); py = pd.read_csv(sys.argv[2])
names = w['names']; nc = len(names); D = np.array(w['data']).reshape(-1, nc)
worst = 0
rows = []
for j, n in enumerate(names):
    kind, a, b = n.split(':')            # e.g. flow:v5:OUT5  or pressure:AORTA:v0
    if a == 'AORTA':
        vess, col = 'v0', ('flow_in' if kind == 'flow' else 'pressure_in')
    elif b.startswith('J'):
        vess, col = a, ('pressure_out')
    else:
        vess, col = a, ('flow_out' if kind == 'flow' else 'pressure_out')
    ref = py[py.name == vess][col].to_numpy()[1:]       # drop t=0 duplicate of previous cycle end
    x = D[:, j]
    err = np.max(np.abs(x - ref)) / (np.max(np.abs(ref)) + 1e-30)
    rows.append((n, err)); worst = max(worst, err)
print(f"signals compared: {len(rows)}, steps/signal: {len(ref)}")
print(f"max normalised abs difference (|wasm-python| / max|python|): {worst:.3e}")
print("worst 3:", sorted(rows, key=lambda r: -r[1])[:3])
