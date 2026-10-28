import { ischemicBurden } from "../physics/ecgLink";
import { INFARCT } from "../config/management";
import { A, sites, S, sim, takeAnalysis, sev, T, K, ecg, playClock, rstate, takeRC } from "./state";
import { renderer, scene, camera, controls } from "./scene";
import { pumpMyocardium, o2Now, paintMyocardium } from "./heart3d";
import { built, blockedFlags, shapeVessels, stepParticles, updateBranchLod } from "./vessels3d";
import { updateMarkers } from "./markers";
import { manageStep } from "./manage";
import { liveUi } from "./readouts";
import { flush } from "./model";
import { caseStep } from "./cases";
import { settlingUi } from "./workspace";
import { arrestSync, arrestUi } from "./arrest";

let last = performance.now(), uiClock = 0, paintClock = 0;
let wasSettling = false, settleDrawn = -Infinity;
let o2Clock = 0, o2Key = "";
export function frame(now: number) {
  const realDt = Math.min(0.05, (now - last) / 1000); last = now;
  if (sim.settling) { // the core engine is being built: give it a slice of this frame, keep the 3D view alive, hold the clock
    wasSettling = true; settlingUi(true);
    sim.settleStep(10); pumpMyocardium(4);
    if (now - settleDrawn > 500) { controls.update(); camera.updateMatrixWorld(); updateMarkers(0); renderer.render(scene, camera); settleDrawn = performance.now(); } // the view is drawn a few times a second meanwhile: a slow renderer must not set the pace of the settling
    requestAnimationFrame(frame);
    return;
  }
  if (wasSettling) { wasSettling = false; settlingUi(false); ecg.reset(sim.t); liveUi(); } // settled: the strip starts from now
  // A case's prompt holds the clock; a case runs at the simulator's own time scale.
  const held = K.runner?.paused ?? false;
  const dt = held ? 0 : playClock.advance(realDt, sim.t, () => sim.stream.beats.filter((b) => !b.pOnly).map((b) => b.t));
  flush();
  pumpMyocardium(4);
  const minutes = dt * S.speed * INFARCT.minutesPerSecond; // the clinical clock
  arrestSync(); // a rhythm the arrest machine changed (shock, ROSC) becomes the page's own
  sim.speed = S.speed; sim.patient = { rhythm: S.rhythm, bbb: S.bbb }; sim.support = T.support; sim.treated = T.treated; // shared: an AI's treatment and the panel's are one record
  sim.realTimeWhenCritical = K.phase !== "run"; // a case keeps its own compressed clock (src/cases); elsewhere a critical patient's clock runs in real time
  const used = sim.step(dt, { minutes }); // the clinical minutes that passed: fewer than asked while the patient is critical
  if (used > 0) manageStep(used, ischemicBurden(sites, sev));
  if (sim.analysis !== A) { takeAnalysis(); for (const b of built) b.blocked = blockedFlags(b.seg); shapeVessels(); } // perfusion pressure or demand moved
  takeRC();
  const fx = sim.ecgInputs();
  if (!sim.dead) ecg.step(dt, fx.injury, fx.tBoost, rstate!.rhythm); // death freezes the strip
  ecg.draw();
  if (K.phase === "run") caseStep(dt * S.speed);
  if (S.flow) stepParticles(dt);
  if ((paintClock += dt) > 0.1) { paintClock = 0; paintMyocardium(); }
  if (S.mode === "o2" && (o2Clock += dt) > 0.5) { o2Clock = 0; const f = o2Now(), k = `${f.ready}|${f.arterial.toFixed(3)}`; if (k !== o2Key) { o2Key = k; shapeVessels(); } }
  if ((uiClock += dt) > 0.25) { uiClock = 0; liveUi(); arrestUi(); }
  controls.update(); updateBranchLod(); camera.updateMatrixWorld(); updateMarkers(dt); renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
