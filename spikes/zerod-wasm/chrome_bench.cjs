// Run web/index.html in headless Chrome via CDP and print the worker results.
// node chrome_bench.cjs http://127.0.0.1:8791/web/index.html
const { spawn } = require('child_process');
const C = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const p = spawn(C, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9333', '--user-data-dir=/private/tmp/claude-501/chrome-prof2', process.argv[2]], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch('http://127.0.0.1:9333/json')).json(); if (tabs.find(t => t.type === 'page')) break; } catch {} await sleep(300); }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}; ws.onmessage = m => { const d = JSON.parse(m.data); if (pend[d.id]) pend[d.id](d); };
  const ev = expr => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr } })); });
  for (let i = 0; i < 120; i++) { const r = await ev("document.getElementById('out').textContent"); const v = r.result.result.value; if (v && v[0] === '{') { const d = JSON.parse(v); console.log(d.ua); d.results.forEach(x => console.log(JSON.stringify(x))); break; } await sleep(1000); }
  p.kill(); process.exit(0);
})();
