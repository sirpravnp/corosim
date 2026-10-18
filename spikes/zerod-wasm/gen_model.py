#!/usr/bin/env python3
"""Generate a CoroSim-sized svZeroDSolver model: branching coronary tree
(BloodVessel + NORMAL_JUNCTION) with a CORONARY (OpenLoopCoronaryBC) outlet per
terminal bed and a prescribed aortic pressure waveform at the inlet. cgs units.
usage: gen_model.py [--leaves 30] [--pts 1001] [--cycles 10] [--period 1.0] [--seed 1] out.json
"""
import argparse, json, math, random

MMHG = 1333.22
def aortic_wave(t, T):
    x = t / T
    sys_end = 0.38
    if x < sys_end:
        return 80 + 40 * math.sin(0.5 * math.pi * min(x / 0.12, 1.0)) * (1 - 0.08 * (x / sys_end))
    # exponential run-off with small dicrotic notch
    end_gap = 36 * math.exp(-(1 - sys_end) / 0.30)
    base = 80 + 36 * math.exp(-(x - sys_end) / 0.30) - end_gap * ((x - sys_end) / (1 - sys_end)) ** 3
    notch = 2.0 * math.exp(-((x - 0.42) / 0.02) ** 2)
    return max(base + notch, 76.0)

def lv_pressure(t, T):
    x = t / T
    if x < 0.40:
        return 120 * math.sin(math.pi * x / 0.40) ** 2
    return 5.0

def build(leaves, pts, cycles, T, seed):
    rnd = random.Random(seed)
    # grow a tree: start with root; repeatedly split a random leaf-vessel into 2-4 children
    # until we have `leaves` terminals.
    children = {0: []}
    depth = {0: 0}
    nid = 1
    terminals = [0]
    while len(terminals) < leaves:
        # prefer splitting shallow vessels so the tree is bushy
        terminals.sort(key=lambda v: depth[v] + rnd.random() * 1.5)
        v = terminals.pop(0)
        k = min(rnd.choice([2, 2, 3, 3, 4]), leaves - len(terminals) + 0)
        k = max(2, min(k, leaves - len(terminals)))
        for _ in range(k):
            children[v].append(nid); children[nid] = []; depth[nid] = depth[v] + 1
            terminals.append(nid); nid += 1
    nv = nid
    maxd = max(depth.values())
    # leaf-count under each node -> radius ~ (flow share)^(1/3) (Murray)
    cnt = {}
    def count(v):
        cnt[v] = 1 if not children[v] else sum(count(c) for c in children[v]); return cnt[v]
    count(0)
    r_root = 0.18  # cm
    vessels, junctions, bcs = [], [], []
    ts = [T * i / (pts - 1) for i in range(pts)]
    bcs.append({"bc_name": "AORTA", "bc_type": "PRESSURE",
                "bc_values": {"P": [aortic_wave(t, T) * MMHG for t in ts[:: max(1, (pts - 1) // 100)]],
                              "t": ts[:: max(1, (pts - 1) // 100)]}})
    mu, rho = 0.04, 1.06
    q_total = 4.0  # ml/s
    mean_p = 93 * MMHG
    r_bed_total = mean_p / q_total  # all beds in parallel, ignoring tree
    for v in range(nv):
        r = r_root * (cnt[v] / leaves) ** (1 / 3) + 0.02
        L = 1.5 + 2.5 * rnd.random() if v else 3.0
        R = 8 * mu * L / (math.pi * r ** 4)
        Lind = rho * L / (math.pi * r ** 2)
        C = 1.5 * math.pi * r ** 3 * L / (4e6 * 0.1)  # ~ E=4e6 dyn/cm2, h=0.1 r
        sten = 0.0
        if v == 3: sten = 1.0   # one stenosed segment
        el = {"R_poiseuille": R, "C": C, "L": Lind, "stenosis_coefficient": sten}
        bcd = {}
        if v == 0: bcd["inlet"] = "AORTA"
        if not children[v]: bcd["outlet"] = f"OUT{v}"
        vessels.append({"vessel_id": v, "vessel_name": f"v{v}", "vessel_length": L,
                        "zero_d_element_type": "BloodVessel", "zero_d_element_values": el,
                        **({"boundary_conditions": bcd} if bcd else {})})
        if children[v]:
            junctions.append({"junction_name": f"J{v}", "junction_type": "NORMAL_JUNCTION",
                              "inlet_vessels": [v], "outlet_vessels": children[v]})
        else:
            share = 1.0 / leaves * (0.7 + 0.6 * rnd.random())
            Rb = r_bed_total * leaves / (1 + 0.0)  # per-bed resistance (parallel)
            Rb *= (0.7 + 0.6 * rnd.random()) * 0.85  # leave room for tree resistance
            Ra, Ram, Rv = 0.2 * Rb, 0.45 * Rb, 0.35 * Rb
            tau = 0.35 + 0.3 * rnd.random()   # arterial/intramyocardial time constants (s)
            Ca, Cim = 0.25 * tau / Ra, 0.5 * tau / Ram
            kp = 0.3 + 0.6 * rnd.random()  # subendocardial -> subepicardial scaling
            bcs.append({"bc_name": f"OUT{v}", "bc_type": "CORONARY",
                        "bc_values": {"Ra1": Ra, "Ra2": Ram, "Rv1": Rv, "Ca": Ca, "Cc": Cim,
                                      "P_v": 5 * MMHG,
                                      "t": ts[:: max(1, (pts - 1) // 100)],
                                      "Pim": [kp * lv_pressure(t, T) * MMHG for t in ts[:: max(1, (pts - 1) // 100)]]}})
    return {"simulation_parameters": {
                "number_of_cardiac_cycles": cycles,
                "number_of_time_pts_per_cardiac_cycle": pts,
                "absolute_tolerance": 1e-8, "output_all_cycles": False},
            "boundary_conditions": bcs, "vessels": vessels, "junctions": junctions}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out"); ap.add_argument("--leaves", type=int, default=30)
    ap.add_argument("--pts", type=int, default=1001); ap.add_argument("--cycles", type=int, default=10)
    ap.add_argument("--period", type=float, default=1.0); ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    m = build(a.leaves, a.pts, a.cycles, a.period, a.seed)
    json.dump(m, open(a.out, "w"), indent=1)
    print(f"{len(m['vessels'])} vessels, {len(m['junctions'])} junctions, "
          f"{sum(b['bc_type']=='CORONARY' for b in m['boundary_conditions'])} outlets -> {a.out}")
