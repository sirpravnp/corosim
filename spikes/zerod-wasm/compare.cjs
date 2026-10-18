// Run model.json for its configured number of cycles in WASM; dump last-cycle signals for compare.py
const fs = require('fs'); const create = require('./dist/svzerod_wasm.cjs');
(async () => {
  const M = await create(); const json = fs.readFileSync(process.argv[2], 'utf8'); const cfg = JSON.parse(json);
  const leaves = cfg.vessels.filter(v => v.boundary_conditions && v.boundary_conditions.outlet);
  const names = ['pressure:AORTA:v0', 'flow:AORTA:v0'];
  for (const v of leaves) { names.push('flow:' + v.vessel_name + ':' + v.boundary_conditions.outlet, 'pressure:' + v.vessel_name + ':' + v.boundary_conditions.outlet); }
  // a few interior (junction) nodes
  for (const j of cfg.junctions.slice(0, 4)) names.push('pressure:v' + j.inlet_vessels[0] + ':' + j.junction_name);
  const s = new M.Sim(json); const N = cfg.simulation_parameters.number_of_cardiac_cycles;
  for (let c = 0; c < N - 1; c++) s.runCycle();
  const vec = new M.VectorString(); names.forEach(n => vec.push_back(n)); s.setOutputs(vec);
  s.runCycle();
  fs.writeFileSync(process.argv[3], JSON.stringify({ names, data: Array.from(s.bufferView()), times: Array.from(s.timesView()) }));
})();
