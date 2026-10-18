// Development only: a page that shows all 23 TEE views for a chosen patient, plus one live view driven by the Simulation's beat stream.
import { Simulation } from "../../sim/simulation";
import { HEART_CREDIT, loadBakedHeart } from "./data";
import { mountEcho } from "./component";
import type { Heart } from "./volume";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const CASES: Record<string, object> = {
  "Normal": {},
  "Proximal LAD occlusion": { lesions: [{ artery: "LAD", occluded: true, position: 0.2 }] },
  "Proximal RCA occlusion": { lesions: [{ artery: "RCA", occluded: true, position: 0.25 }] },
  "Proximal circumflex occlusion": { lesions: [{ artery: "LCX", occluded: true, position: 0.3 }] },
};
for (const k of Object.keys(CASES)) $("case").append(new Option(k));
$("credit").textContent = HEART_CREDIT;

(async () => {
  const heart: Heart = await loadBakedHeart();
  let sim = new Simulation({ seed: 7 });
  const big = mountEcho($<HTMLCanvasElement>("big"), { heart, size: 400, labels: true });
  const tiles = big.views.map((v) => {
    const fig = document.createElement("figure"), c = document.createElement("canvas"), cap = document.createElement("figcaption");
    cap.textContent = v.name; fig.append(c, cap); $("grid").append(fig);
    const p = mountEcho(c, { heart, size: 260, view: v.id, labels: true });
    c.onclick = () => { $<HTMLSelectElement>("view").value = v.id; pick(); };
    return p;
  });
  const sel = $<HTMLSelectElement>("view");
  for (const v of big.views) sel.append(new Option(v.name, v.id));
  const omni = $<HTMLInputElement>("omni");
  const pick = () => { big.setView(sel.value); omni.value = String(big.omniplane); $("omniv").textContent = `${big.omniplane}°`; };
  sel.onchange = pick; pick();
  omni.oninput = () => { big.setOmniplane(+omni.value); $("omniv").textContent = `${big.omniplane}°`; };
  $<HTMLInputElement>("lab").onchange = (e) => { const on = (e.target as HTMLInputElement).checked; big.setLabels(on); tiles.forEach((t) => t.setLabels(on)); drawGrid(); };
  $<HTMLInputElement>("terr").onchange = (e) => { const on = (e.target as HTMLInputElement).checked; big.setTerritories(on); tiles.forEach((t) => t.setTerritories(on)); drawGrid(); };

  const drawGrid = () => { const ts = 0.29; tiles.forEach((t) => t.frame({ since: ts, rr: 0.8, pvc: false })); }; // end-systole
  const load = () => {
    sim = new Simulation({ ...(CASES[$<HTMLSelectElement>("case").value] as object), seed: 7 }); sim.warmup(60);
    for (const p of [big, ...tiles]) p.update(sim as never);
    const m = big.model!;
    $("info").textContent = `EF ${Math.round(m.ef * 100)}%  HR ${Math.round(m.hr)}  wall-motion score index ${m.scoreIndex.toFixed(2)}\n` +
      m.segments.filter((s) => s.score > 1).map((s) => `${s.name}: ${s.motion}`).join("\n");
    drawGrid();
  };
  $("case").onchange = load; load();

  let last = performance.now();
  const loop = (now: number) => {
    sim.warmup(Math.min(0.1, (now - last) / 1000)); last = now;
    const t0 = performance.now(); big.frame(sim as never); $("ms").textContent = `${(performance.now() - t0).toFixed(0)} ms/frame`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  (window as unknown as { ready: boolean }).ready = true;
})();
