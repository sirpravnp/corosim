// Web Worker benchmark: runs each build x model, reports median ms/beat after warm-up.
self.onmessage = async (e) => {
  const out = [];
  for (const build of ['svzerod_wasm', 'svzerod_wasm_simd']) {
    importScripts('../dist/' + build + '.js');
    // createSvZeroD is defined by the classic script; reload per build
    const M = await createSvZeroD({ locateFile: f => '../dist/' + build + '.wasm' });
    for (const p of [1001, 501, 251, 126]) {
      const json = await (await fetch('models/p' + p + '.json')).text();
      const s = new M.Sim(json);
      const ts = [];
      for (let c = 0; c < 14; c++) { const a = performance.now(); s.runCycle(); ts.push(performance.now() - a); }
      ts.splice(0, 4); ts.sort((a, b) => a - b);
      out.push({ build, stepsPerBeat: p, medianMs: +ts[ts.length >> 1].toFixed(1), minMs: +ts[0].toFixed(1), maxMs: +ts[ts.length - 1].toFixed(1) });
      s.delete();
    }
  }
  self.postMessage({ ua: navigator.userAgent, hw: navigator.hardwareConcurrency, results: out });
};
