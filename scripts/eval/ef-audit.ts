// Why does "EF" read differently in different panels? Prints every EF definition the engine has, side by side, for a few conditions.
//   npx tsx scripts/eval/ef-audit.ts
//   monitor   LiveSource.numbers().lvEf: (EDV-ESV)/EDV of the LV CHAMBER volume, over steady beats (not premature, not cut short) of the window.
//             Shown by the Monitor and Hemodynamics panels (vitals.lvEf).
//   estimate  Simulation.state().ventricle.ejectionFraction = circ.ejectionFraction = sm.ef: AORTIC-valve stroke volume / LV EDV of EVERY beat
//             (premature ones included), exponentially smoothed (ACS_CORE.smoothTau). Shown by the ischemia panel, MCP state, explain, cath echo.
//   hemo      from Simulation.hemo(): (lvEdv - lvEsv) / lvEdv, means over the window's beats.
//   +device   estimate with the pump's flow per beat added back: a pump (Impella) empties the LV without that volume passing the aortic valve.
import { Simulation } from "../../src/sim/simulation";
import { LiveSource } from "../../src/sim/liveSource";
import type { PatientSpec } from "../../src/sim/patient";

const lad = { artery: "LAD", occluded: true, position: 0.2 };
const cases: { name: string; spec: PatientSpec; run: number }[] = [
  { name: "healthy", spec: {}, run: 20 },
  { name: "LAD occlusion, 20 s after", spec: { lesions: [lad] }, run: 20 },
  { name: "LAD occlusion, 60 s after", spec: { lesions: [lad] }, run: 60 },
  { name: "LAD occlusion + Impella P6, 60 s", spec: { lesions: [lad], support: { impella: true } }, run: 60 },
  { name: "healthy, frequent PVCs (K 6.5, tendency 3)", spec: { electrolytes: { potassium: 6.5 }, ectopyTendency: 3 }, run: 60 },
  { name: "atrial fibrillation", spec: { patient: { rhythm: "af" } }, run: 40 },
];
console.log("condition".padEnd(44), "monitor estimate hemo  | +device   hr  pvcs/20s");
for (const c of cases) {
  const s = new Simulation({}, { engine: "core" });
  s.reset({ seed: 3 }, { settled: true, warmup: 30 }); const src = new LiveSource(s); // a LiveSource only sees beats that happen after it is made: make it first
  s.warmup(10); s.step(20);
  s.apply(c.spec); s.step(c.run);
  const n = src.numbers(), st: any = s.state(), h: any = s.hemo(20);
  const roll = s.rolling(20), pvcs = s.history.filter((b) => b.t > s.t - 20 && b.pvc).length;
  const dev = st.support.deviceFlowLpm, svDev = roll.hr > 0 ? (dev * 1000) / roll.hr : 0;
  const est = st.ventricle.ejectionFraction, edv = h.lvEdv;
  console.log(c.name.padEnd(44), n.lvEf.toFixed(2).padStart(7), est.toFixed(2).padStart(8), ((h.lvEdv - h.lvEsv) / h.lvEdv).toFixed(2).padStart(5), " |", (est + svDev / edv).toFixed(2).padStart(7), Math.round(roll.hr).toString().padStart(5), String(pvcs).padStart(5));
}
