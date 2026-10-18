// Node benchmark: node bench.cjs model.json [maxCycles] [outCsv]
const fs = require('fs');
const create = require('./dist/svzerod_wasm.cjs');
(async () => {
  const M = await create();
  const json = fs.readFileSync(process.argv[2], 'utf8');
  const maxCycles = +(process.argv[3] || 60);
  const cfg = JSON.parse(json);
  const outs = cfg.boundary_conditions.filter(b => b.bc_type === 'CORONARY').map(b => b.bc_name);
  let t0 = performance.now();
  const s = new M.Sim(json);
  console.log('construct ms', (performance.now() - t0).toFixed(1), 'state size', s.stateSize(), 'pts', s.ptsPerCycle());
  const names = ['AORTA:v0', 'pressure:AORTA:v0'].slice(1).concat(
    outs.slice(0, 4).map(o => 'flow:v' + o.slice(3) + ':' + o));
  const vec = new M.VectorString(); names.forEach(n => vec.push_back(n)); s.setOutputs(vec);
  const times = []; let prev = null, conv = -1;
  for (let c = 0; c < maxCycles; c++) {
    s.clearBuffer();
    const a = performance.now(); s.runCycle(); const dt = performance.now() - a;
    times.push(dt);
    const buf = Array.from(s.bufferView());
    const nrow = s.bufferRows(), nc = names.length;
    const mean = new Array(nc).fill(0);
    for (let r = 0; r < nrow; r++) for (let j = 0; j < nc; j++) mean[j] += buf[r * nc + j] / nrow;
    if (prev && conv < 0) {
      let e = 0; for (let j = 0; j < nc; j++) e = Math.max(e, Math.abs(mean[j] - prev[j]) / Math.abs(prev[j]));
      if (e < 1e-3) conv = c + 1;
    }
    prev = mean;
  }
  const warm = times.slice(Math.min(10, times.length - 1)).sort((a, b) => a - b);
  console.log('cycles to periodic (1e-3 rel mean change):', conv);
  console.log('first-cycle ms', times[0].toFixed(1), ' steady: median', warm[warm.length >> 1].toFixed(1), 'min', warm[0].toFixed(1), 'p95', warm[Math.floor(warm.length * .95)].toFixed(1));
  if (process.argv[4]) { // dump last cycle of all recorded signals
    s.clearBuffer(); s.runCycle(); const b = Array.from(s.bufferView());
    fs.writeFileSync(process.argv[4], JSON.stringify({ names, nc: names.length, data: b }));
  }
})();
