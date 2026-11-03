import { Simulation } from "../sim/simulation";
import type { EkgSpec, Morph } from "./engine";
import type { EkgPreset } from "./library";

export * from "./library";

/** The coronary model behind an acute coronary preset: the lesion, settled, so its ST vector and the 3D heart agree. */
export function coronarySim(p: EkgPreset, sim = new Simulation({ seed: 1 })): Simulation {
  sim.reset(p.coronary?.scenario ?? {}, { settled: true });
  return sim;
}

/**
 * The preset's full spec, ready for the engine: the coronary model's injury vector (and its hyperacute T boost)
 * scaled into the morphology for the acute coronary presets. Pass the simulation to reuse it (the page's 3D heart).
 */
export function resolveSpec(p: EkgPreset, sim?: Simulation): EkgSpec {
  if (!p.coronary) return p.spec;
  const s = coronarySim(p, sim), { injury, tBoost } = s.ecgInputs(), k = p.coronary.scale ?? 1;
  const morph: Morph = { ...(p.spec.morph ?? {}) };
  const own = morph.injury ?? [0, 0, 0]; // a custom tracing may add its own ST change on top of the lesion's
  morph.injury = [own[0] + injury[0] * k, own[1] + injury[1] * k, own[2] + injury[2] * k];
  morph.tBoost = (morph.tBoost ?? 0) + tBoost * k;
  return { ...p.spec, morph };
}

