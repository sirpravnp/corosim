// Dumps the real CoroSim coronary tree + solved flows for a few scenarios, for the cath-lab look-and-feel prototype.
import { writeFileSync } from "node:fs";
import { Simulation } from "../../src/sim/simulation";
import { buildTree } from "../../src/anatomy/tree";

const tree = buildTree();
const cases: Record<string, any> = {
  "Proximal LAD occlusion (anterior STEMI)": { lesions: [{ artery: "LAD", occluded: true, position: 0.2 }] },
  "Mid-LAD 75% stenosis (intermediate)": { lesions: [{ artery: "LAD", stenosis: 0.75, position: 0.5 }], exertion: false },
  "Proximal RCA occlusion (inferior STEMI)": { lesions: [{ artery: "RCA", occluded: true, position: 0.25 }] },
  "Mid-LAD 75% stenosis, exertion": { lesions: [{ artery: "LAD", stenosis: 0.75, position: 0.5 }], exertion: true },
  "Normal": {},
};
const out: any = { tree: tree.segments.map((s) => ({ id: s.id, name: s.name, group: s.group, parent: s.parent, attach: s.attach, length: s.length, samples: s.samples.map((p) => p.map((v) => +v.toFixed(2))) })), cases: {} };
for (const [name, sc] of Object.entries(cases)) {
  const sim = new Simulation({ ...sc, seed: 7 });
  sim.warmup(60);
  const st: any = sim.state();
  const net: any = (sim as any).analysis.cond;
  const hyp: any = (sim as any).analysis.hyper.seg;
  const seg: any = {};
  for (const id of Object.keys(net.seg)) { const r = net.seg[id]; seg[id] = { s: r.s.map((v: number) => +v.toFixed(2)), v: r.v.map((x: number) => +x.toFixed(4)), hP: hyp[id].P.map((x: number) => +x.toFixed(1)), d: r.d.map((v: number) => +(v * 1e3).toFixed(3)), Q: r.Q.map((v: number) => +v.toExponential(3)), P: r.P.map((v: number) => +v.toFixed(1)), blockedFrom: r.blockedFrom }; }
  out.cases[name] = { seg, beds: st.compromisedBeds, allBeds: net.terminals.map((t: any) => ({ key: t.key, seg: t.segId, label: t.label, ratio: t.ratio, severity: (sim as any).sev[t.key] ?? 0 })), ef: st.ventricle.ejectionFraction, hr: st.rolling10s.hr, ffr: st.ffr, map: st.meanArterialPressure };
}
writeFileSync(new URL("data.json", import.meta.url).pathname, JSON.stringify(out));
console.log(Object.keys(out.cases), out.tree.map((s: any) => `${s.id}:${s.samples.length}:${s.length.toFixed(0)}mm`).join(" "));
const c = out.cases["Proximal LAD occlusion (anterior STEMI)"];
console.log(JSON.stringify(c.beds), c.ef, c.hr, Object.keys(c.seg).slice(0, 5), c.seg.LAD.d.length, c.seg.LAD.d.slice(0, 4), c.seg.LAD.blockedFrom);
console.log(JSON.stringify(c.allBeds));
