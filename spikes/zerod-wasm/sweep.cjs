// Sweep steps/beat x Newton tolerance. Prints ms/beat and error vs the 1001-pt, 1e-8 reference.
// node sweep.cjs [dist/svzerod_wasm.cjs]
const { execFileSync } = require('child_process');
const create = require(process.argv[2] || './dist/svzerod_wasm.cjs');
const gen = (pts, tol) => {
  const f = `out/sw_${pts}.json`;
  execFileSync('python3', ['gen_model.py', f, '--pts', String(pts)], { stdio: 'ignore' });
  const m = JSON.parse(require('fs').readFileSync(f)); m.simulation_parameters.absolute_tolerance = tol;
  return JSON.stringify(m);
};
(async () => {
  const M = await create();
  const run = (pts, tol, cycles = 12) => {
    const json = gen(pts, tol); const cfg = JSON.parse(json);
    const s = new M.Sim(json);
    const outs = cfg.boundary_conditions.filter(b => b.bc_type === 'CORONARY').map(b => 'flow:v' + b.bc_name.slice(3) + ':' + b.bc_name);
    const names = ['pressure:AORTA:v0', ...outs];
    const v = new M.VectorString(); names.forEach(n => v.push_back(n)); s.setOutputs(v);
    const ts = [];
    for (let c = 0; c < cycles; c++) { s.clearBuffer(); const a = performance.now(); s.runCycle(); ts.push(performance.now() - a); }
    ts.splice(0, 4); ts.sort((a, b) => a - b);
    const nc = names.length, n = s.bufferRows(), d = Array.from(s.bufferView());
    // beat-resolved mean aortic P, peak aortic P, total outlet flow trace
    const tot = []; for (let i = 0; i < n; i++) { let q = 0; for (let j = 1; j < nc; j++) q += d[i * nc + j]; tot.push(q); }
    const P = []; for (let i = 0; i < n; i++) P.push(d[i * nc]);
    return { ms: ts[ts.length >> 1], P, tot, T: cfg.simulation_parameters.number_of_time_pts_per_cardiac_cycle };
  };
  const ref = run(1001, 1e-8);
  // row i holds time (i+1)/n of the beat
  const at = (arr, x) => { const f = Math.min(Math.max(x * arr.length - 1, 0), arr.length - 1), i = Math.floor(f); return arr[i] + (arr[Math.min(i + 1, arr.length - 1)] - arr[i]) * (f - i); };
  console.log('| steps/beat | dt (ms) | tol | ms/beat | max rel err total coronary Q | max err aortic P (mmHg) |\n|---|---|---|---|---|---|');
  const qmax = Math.max(...ref.tot.map(Math.abs));
  for (const [pts, tol] of [[1001, 1e-8], [1001, 1e-3], [501, 1e-3], [251, 1e-3], [251, 1e-8], [126, 1e-3], [101, 1e-3], [51, 1e-3]]) {
    const r = run(pts, tol); let eq = 0, ep = 0;
    for (let i = 0; i < ref.tot.length; i++) { const x = (i + 1) / ref.tot.length; eq = Math.max(eq, Math.abs(at(r.tot, x) - ref.tot[i]) / qmax); ep = Math.max(ep, Math.abs(at(r.P, x) - ref.P[i])); }
    console.log(`| ${pts} | ${(1000 / (pts - 1)).toFixed(2)} | ${tol} | ${r.ms.toFixed(1)} | ${(eq * 100).toFixed(2)}% | ${(ep / 1333.22).toFixed(3)} |`);
  }
})();
