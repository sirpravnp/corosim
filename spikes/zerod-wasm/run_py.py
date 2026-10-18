import json, sys, time, numpy as np, svzerod
cfg = json.load(open(sys.argv[1]))
t0 = time.time()
s = svzerod.Solver(cfg); s.run()
dt = time.time() - t0
df = s.get_full_result()
print("python total", round(dt,3), "s for", cfg["simulation_parameters"]["number_of_cardiac_cycles"], "cycles")
print(df.columns.tolist()[:12], len(df))
df.to_csv(sys.argv[2], index=False)
