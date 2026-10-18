// Proof of concept: change cardiac period between beats WITHOUT patching the solver.
// 1) settle at T=1.0 s  2) per beat: setPeriod(T,pts), setTime(0), rewrite time-series params
// 3) after settling at T=0.6 compare last beat with pysvzerod run of a native T=0.6 model.
const fs = require('fs'); const create = require('./dist/svzerod_wasm.cjs');
(async () => {
  const M = await create();
  process.on('unhandledRejection', e => { console.error('C++ exception:', M.getExceptionMessage ? M.getExceptionMessage(e).join(' | ') : e); process.exit(1); });
  const base = JSON.parse(fs.readFileSync('model.json', 'utf8'));
  const fast = JSON.parse(fs.readFileSync('out/m_T06.json', 'utf8'));
  const V = a => { const v = new M.VectorDouble(); a.forEach(x => v.push_back(x)); return v; };
  const s = new M.Sim(JSON.stringify(base));
  // find param index of Pim: probe by reading params of an OUT block
  const probe = s.readBlockParams('OUT21'); console.log('OUT21 param vector (len ' + probe.size() + ')');
  const apply = (cfg, T, pts) => {
    s.setPeriod(T, pts); s.setTime(0);
    for (const b of cfg.boundary_conditions) {
      if (b.bc_name === 'AORTA') s.updateBlockTimeSeries('AORTA', 0, V(b.bc_values.t), V(b.bc_values.P));
      else s.updateBlockTimeSeries(b.bc_name, 4, V(b.bc_values.t), V(b.bc_values.Pim));
    }
  };
  for (let c = 0; c < 10; c++) s.runCycle();                 // T = 1.0
  let t0 = performance.now(); apply(fast, 0.6, 601); const tApply = performance.now() - t0;
  for (let c = 0; c < 40; c++) s.runCycle();                 // T = 0.6
  const names = ['pressure:AORTA:v0', 'flow:AORTA:v0', 'flow:v21:OUT21'];
  const vec = new M.VectorString(); names.forEach(n => vec.push_back(n)); s.setOutputs(vec);
  s.runCycle();
  const D = Array.from(s.bufferView());
  console.log('apply() cost per beat ms', tApply.toFixed(2), ' rows', s.bufferRows(), 'time', s.time().toFixed(3));
  fs.writeFileSync('out/vp_last.json', JSON.stringify({ names, data: D }));
})();
