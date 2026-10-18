import json, numpy as np, pandas as pd
w=json.load(open('out/vp_last.json')); D=np.array(w['data']).reshape(-1,3)
py=pd.read_csv('out/py_T06.csv'); v0=py[py.name=='v0']; o=py[py.name=='v21']
ref=[v0.pressure_in.to_numpy()[1:], v0.flow_in.to_numpy()[1:], o.flow_out.to_numpy()[1:]]
for j,n in enumerate(w['names']):
    print(n, 'rows', len(D), len(ref[j]), 'max norm diff %.3e' % (np.max(np.abs(D[:,j]-ref[j]))/np.max(np.abs(ref[j]))))
