# Spike P0: svZeroDSolver in the browser (WASM)

**Question:** can svZeroDSolver run as WebAssembly fast enough to solve one heartbeat per beat, live?

## Verdict

**Conditional PASS.** The WASM build works, matches `pysvzerod` to ~1e-11, and handles a per-beat period change without patching the solver. The <20 ms/beat target is **not** met at the default 1 ms step. It is met by coarsening the step to 4 ms or by using the SIMD build.

Measured on an Apple-silicon Mac, in Node and in real Chrome Web Workers. Both gave the same numbers. Model: 44 BloodVessels, 14 junctions, 30 `CORONARY` outlets, 206 unknowns.

| steps/beat (dt) | Newton tol | plain WASM | SIMD+LTO WASM | flow error vs 1 ms |
|---|---|---|---|---|
| 1001 (1 ms) | 1e-8 (default) | 101 ms | 77 ms | ref |
| 1001 (1 ms) | 1e-3 | 55 ms | 42 ms | 0 |
| 501 (2 ms) | 1e-3 | 27 ms | 21 ms | 0.15 % |
| 251 (4 ms) | 1e-3 | **14 ms** | **11 ms** | 0.62 % |
| 126 (8 ms) | 1e-3 | **7.7 ms** | **5.9 ms** | 1.1 % |

- Times are the median per beat after warm-up. Source: `sweep.cjs`, output in `out/sweep.md`. Chrome worker runs (`chrome_bench.cjs`) gave 57 / 29 / 14.9 / 8.0 ms for plain WASM and 45 / 21 / 11 / 5.9 ms for SIMD at 1001 / 501 / 251 / 126 steps.
- Error is the max difference in total coronary flow, as a percentage of its peak, against the 1001-step 1e-8 reference.
- Cost is linear in steps: about 100 µs/step at default tolerance, about 55 µs/step at tol 1e-3. A 1e-3 tolerance is about 1e-8 relative here, since pressures are ~1e5 dyn/cm². It drops Newton from 2 iterations to 1 per step.
- **Practical setting:** 4 ms steps (250 per beat) at tol 1e-3 with the SIMD build gives ~11 ms/beat and <1 % flow error. That leaves headroom for slower devices, which I did not test.
- Native C++ (same shim, `-O3`) takes 57 ms/beat at 1 ms steps, so WASM is ~1.8x slower than native.
- **Where the time goes:** a native `sample` profile puts about 85 % in `Eigen::SparseLU::factorize`. `SparseSystem::solve()` refactorizes on every Newton iteration, although this tree has constant matrices apart from the stenosis term. This is the main optimization lever (below).
- **Cycles to periodic state:** 3 cycles at 1e-3 relative change in mean values for 5 monitored signals. It is a loose criterion. The model has short time constants (Ca·Ra ≈ 0.1 to 0.2 s), so a stiffer model needs more cycles. The cycle-to-cycle check in `Solver::run_integration` is not used by the shim.
- **Caveat on the in-app Browser pane:** it measured 4 to 7x slower (392 ms/beat at 1 ms steps) because the pane was hidden and throttled. Plain JS in that pane ran at normal speed, so I discarded those numbers. Headless Chrome via CDP agrees with Node.
- Not tested: mobile devices, Safari, Firefox.

## Bundle size

| file | raw | gzip -9 | brotli -11 |
|---|---|---|---|
| `svzerod_wasm.wasm` | 631 KB | 204 KB | 160 KB |
| `svzerod_wasm.js` (glue) | 105 KB | 27 KB | 24 KB |
| SIMD `.wasm` | 654 KB | 209 KB | 164 KB |
| SIMD `.js` | 106 KB | 27 KB | 24 KB |

Total is about 740 KB raw, 231 KB gzip, 184 KB brotli. C++ exceptions are enabled (`-fexceptions`) because the solver throws on bad input. The SIMD build needs `-msimd128`, which every current browser supports, so ship plain WASM only as a fallback if at all.

## Licence

`LICENSE.txt` is the standard BSD-3-Clause text: copyright Stanford University, The Regents of the University of California, and others. Source files carry `SPDX-License-Identifier: BSD-3-Clause`. Eigen 3.4.0 is MPL-2 and nlohmann/json is MIT. All three are fine for a static site, but ship the notices.

## Source and build

- svZeroDSolver commit `8969093263fd5b47374e224c51b413a67dcb9945` (2026-10-16).
- Emscripten 6.0.12 with emsdk. emsdk needs Python 3.10 or later, so I used `brew install python@3.12` and `EMSDK_PYTHON`. I also installed `cmake` and `ninja` with brew.
- Eigen 3.4.0 and nlohmann/json 3.11.2 come in through CMake `FetchContent`. pybind11 and the Python module are not needed.
- Disk: `vendor/` is 1.9 GB, almost all emsdk. It is gitignored along with `build-*/`, `.venv/` and `out/`.

To reproduce:

```bash
cd spikes/zerod-wasm
./build.sh                                   # clones, builds wasm, simd wasm, native
python3 gen_model.py model.json --cycles 40  # the test model
node bench.cjs model.json 30                 # per-beat timing
node sweep.cjs                               # the table above
python3.12 -m venv .venv && .venv/bin/pip install svzerod numpy
.venv/bin/python run_py.py model.json out_py.csv
node compare.cjs model.json out/wasm_last.json && .venv/bin/python compare.py out/wasm_last.json out_py.csv
node varperiod.cjs && .venv/bin/python compare_vp.py   # needs out/m_T06.json, see "Variable period"
```

Browser bench:

```bash
python3 -m http.server 8791 --bind 127.0.0.1   # not 8765: AnkiConnect uses it here
node chrome_bench.cjs http://127.0.0.1:8791/web/index.html
```

I wrote my own `CMakeLists.txt`, which builds `src/algebra`, `src/model` and `SimulationParameters.cpp` plus `shim.cpp`. The upstream CMake needs Python and pybind11 and is not used.

## Existing step-wise interface

`src/interface/interface.cpp` exposes `extern "C"` functions: `initialize`, `increment_time`, `run_simulation`, `update_block_params`, `read_block_params`, `update_state`, `return_y` and `return_ydot`. It can change block parameters between calls and can set the state. It is built around coupling with a 3D solver: it advances over an *external* step of `external_step_size`, and its signatures use `std::string&` and `std::vector&` in `extern "C"`. It also reads a file path instead of a JSON string. It does not fit embind, so I did not use it.

`Solver` (the Python-facing class) only has `run()`, and its integrator state is private.

So `shim.cpp` (~150 lines) re-implements the `Solver` constructor and `setup_initial` using the public `Model`, `Integrator`, `State` and `load_*` functions. **No upstream file is modified.** `Integrator::step(state, time)` is the stepping primitive. It takes any number of steps, and the step size can change between calls through `update_params(dt)`.

## JS API (`shim.cpp`, embind class `Sim`, factory `createSvZeroD()`)

```js
const M = await createSvZeroD();           // dist/svzerod_wasm_simd.js
const s = new M.Sim(jsonString);           // full svZeroD config; throws std::runtime_error (use M.getExceptionMessage(e))
s.ptsPerCycle(); s.period(); s.dt(); s.time(); s.stateSize();
s.setOutputs(VectorString)                 // DOF names, e.g. 'pressure:AORTA:v0', 'flow:v21:OUT21' (pattern <kind>:<blockA>:<blockB>)
s.step(n); s.runCycle();                   // advance n steps, or ptsPerCycle-1 steps; rows are appended per step
s.clearBuffer(); s.bufferRows();
s.bufferView(); s.timesView();             // Float64Array views into WASM memory (zero-copy; valid until next step/clear)
s.getY(name);                              // instantaneous value
s.readBlockParams(block); s.updateBlockParams(block, VectorDouble);          // constant parameters
s.updateBlockTimeSeries(block, paramIdx, VectorDouble t, VectorDouble v);    // time series, e.g. Pim = index 4
s.setPeriod(T, pts); s.setTime(t);         // variable-period hooks (below)
s.delete();                                // embind object
```

Block names for boundary conditions are the `bc_name`. Vessels use `vessel_name`. Junctions use `junction_name`. `OpenLoopCoronaryBC` parameter order is Ra, Rv, Ca, Cim, Pim, Pv, Ram, so Pim is index 4. `VectorDouble` and `VectorString` need `.push_back`.

## Test model (`gen_model.py`)

- cgs units, 80/120 mmHg prescribed aortic pressure at the inlet (`PRESSURE` BC, 101 samples, continuous across the beat), T = 1 s.
- A random tree with 44 BloodVessels (Murray-law radii, Poiseuille R, inertance L, C from E = 4e6 dyn/cm², one stenosed segment) and 14 `NORMAL_JUNCTION`s.
- 30 terminal `CORONARY` outlets (Ra1/Ra2/Rv1, Ca, Cc, P_v = 5 mmHg) with a per-bed scaled LV-like intramyocardial pressure series.
- Result: mean aortic pressure 102 mmHg, mean inflow 4.6 ml/s.
- Stiffness and size are representative. Realism was not a goal. `ClosedLoopHeartPulmonary` as the inlet was **not** tested (see below).

## pysvzerod comparison

`svzerod` 3.2 (pip, Python 3.12) and the WASM build, same JSON, 40 cycles at 1001 steps and tol 1e-8:

- 66 signals compared over the last beat (1000 steps each): aortic P and Q, every outlet flow and pressure, and 4 junction pressures.
- Max normalized difference |wasm − python| / max|python| is **1.2e-11**, which is solver tolerance.
- Python itself took 2.0 s for 40 cycles (~49 ms/beat), against 57 ms/beat native in my shim and ~100 ms in WASM.

## Variable cycle period: findings

`grep cardiac_cycle_period` shows one global value, `Model::cardiac_cycle_period`. It is set from the JSON or from the period of the first periodic time series, then used in four ways:

1. **Time-series parameters** (`Parameter::get`) wrap with `fmod(time, cycle_period)`. The period is derived from the series itself: `times.back() − times[0]`. `Model::add_parameter` throws if the periods of different series are inconsistent. This covers `PRESSURE`/`FLOW` BCs, Pim and `P_v` series.
2. **`ClosedLoopHeartPulmonary::get_activation_and_elastance_functions`** reads `model->cardiac_cycle_period` and `model->time` directly on every call. `Tsa = T · TSA` and `tpwave = T / TPWAVE`. The atrial activation and the 25-mode Fourier elastance both evaluate at `fmod(time, T)`.
3. **`ActivationFunction`** (HalfCosine, PiecewiseCosine, TwoHill, DoubleTanh, Fourier, WrappingCosine) stores `cardiac_period_` at construction and uses `fmod(time, cardiac_period_)`. It has **no setter**. TwoHill also precomputes a normalization over the period (`calculate_normalization_factor`). Used by `ChamberElastanceInductor`, `LinearElastanceChamber` and `ChamberSphere` (`activation_func_->compute(model->time)`).
4. **`OpenLoopCoronaryVarResBC::get_Ram`** uses `fmod(time, model->cardiac_cycle_period)`.

`Solver` also uses the period to compute the step size, `T/(pts−1)`.

### What works without patching (tested)

Per beat, from outside, keeping the state across beats:

1. `setPeriod(T, pts)` sets `model->cardiac_cycle_period`, `dt = T/(pts−1)` and calls `Integrator::update_params(dt)`. It is public API and cheap.
2. `setTime(0)`, so each beat starts at local time 0.
3. Rewrite each time-series parameter (`updateBlockTimeSeries`) with the new beat's timing: aortic pressure and every Pim.
4. Run the beat.

**Test (`varperiod.cjs`):** settle 10 beats at T = 1.0 s, switch to T = 0.6 s (601 steps) by the procedure above, run 40 more beats, then compare the last beat with a fresh `pysvzerod` run of a native T = 0.6 model. Max normalized difference is **7e-11 to 6e-10** on aortic P, aortic Q and one outlet flow. The `apply()` call for 31 series costs 0.8 ms.

This covers any `Parameter`-driven model (open-loop coronary, Windkessel, prescribed inlet) and `ClosedLoopHeartPulmonary` (items 1 and 2 above) with no C++ changes.

- For the heart, `TSA` and `TPWAVE` are constant parameters (fractions of T), so per-beat atrial timing can be set with `updateBlockParams`.
- `ELV_S` and `ERV_S` (elastance scale) can be changed per beat the same way, which allows PVC-like weak beats.
- Caveat: the closed-loop heart was **not** run in this spike. This is from reading the code.

### What needs a fork patch

- **Chamber blocks driven by `ActivationFunction`** (`ChamberElastanceInductor`, `LinearElastanceChamber`, `ChamberSphere`). The stored period cannot change. A patch needs:
  - a virtual `ActivationFunction::set_period(T)` (TwoHill also recomputes its normalization);
  - a `Model::set_cardiac_period(T)` that walks the blocks and calls it.
  - Effort: about 0.5 to 1 day including tests.
- **Per-beat activation *onset* or shape** (not just period) is not possible with these functions either. The usual workaround is to treat each beat as an independent call with its own `set_param` values (`t_shift`, `t_active` and so on), which also needs a small `ActivationFunction` setter exposed. Effort: about 1 day.
- **`OpenLoopCoronaryVarResBC`** takes the period from the model. It works with `setPeriod` alone, but its `T_vc` and `T_vr` parameters are absolute times, so they should be scaled per beat via `updateBlockParams`.
- Not an issue: the period check in `Model::add_parameter` and `Solver`'s consistency check only fire at load time. `Solver::setup_initial` never runs in the shim after the first beat.

### Recommendation

**Drive parameters from outside between beats.** It is already working and verified, it needs no fork, and it keeps the upstream merge path open. Use a thin per-beat controller: `setPeriod`, `setTime(0)`, rewrite the time-series parameters and optionally the heart parameters, then `runCycle`. Add the small `set_period` patch (about 1 day) only if chamber-activation blocks are needed.

Beat-boundary caveats:
- The generalized-alpha integrator's `ydot` carries over from the previous beat. Changing `dt` abruptly is fine in the test but should be watched for large T jumps.
- A step per beat at 4 ms is not exactly commensurate with arbitrary T, so use `pts = round(T/dt)+1` and let dt vary slightly.

## Optimization options (not done)

- **Avoid refactorizing the sparse matrix:** the Jacobian is constant for fixed dt when no stenosis term is active. Reuse the LU for linear steps. Expected several-fold gain on the dominant 85 %. It needs a small patch in `SparseSystem::solve`.
- **Per-beat cost scales with model size:** a 60-vessel tree would cost roughly 1.5 to 2x more, since sparse LU is superlinear.
- Tolerance and step size are already tuned above. Larger T (slower heart rate) costs more steps at fixed dt, so a rate of 40 bpm at 4 ms means 375 steps and ~17 ms.

## Blockers and open points

- None blocking. The 20 ms target is met only with dt ≥ ~3 ms (SIMD) or ≥ ~3.5 ms (plain), or with the LU-reuse patch at 1 to 2 ms.
- Heart rate matters: at 4 ms steps the budget is ~11 ms at 60 bpm and grows as the rate falls. Rates above 100 bpm run in under 7 ms.
- Not covered: `ClosedLoopHeartPulmonary` as inlet, mobile browsers, and long-run drift across thousands of variable beats.
- If a TypeScript port is still wanted, a tree-structured solver (no generic sparse LU) could likely beat this WASM by a large factor, but that is a separate estimate and was not needed here.

## Files (all under `spikes/zerod-wasm/`)

`shim.cpp`, `CMakeLists.txt`, `build.sh`, `gen_model.py`, `run_py.py`, `bench.cjs`, `sweep.cjs`, `compare.cjs`, `compare.py`, `varperiod.cjs`, `compare_vp.py`, `chrome_bench.cjs`, `web/` (worker bench), `dist/` (built wasm and js, 1.9 MB), `model.json`.
