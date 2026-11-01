import type { Simulation } from "../../src/sim/simulation";
import type { HeartSpec } from "../../src/sim/patient";
import { intervene, valveSet } from "../../src/sim/valves";
import type { State } from "./states";

const heartOf = (s: Simulation): HeartSpec => (s as unknown as { heartSpec?: HeartSpec }).heartSpec ?? {};

const mx = (st: Omit<State, "suite" | "invariantsOnly">): State => ({
  ...st,
  suite: "matrix",
  invariantsOnly: true,
  checkpoints: st.checkpoints ?? [60],
});

const ladProx = (stenosis: number) => ({ artery: "LAD" as const, stenosis, position: 0.2 });

/**
 * Condition matrix, valves. Filled from docs/CONDITION_MATRIX.md sections 2.4 and 3.3.
 * Suite `matrix`, id prefix `mx-`, invariants only.
 */
export function matrixValveStates(): State[] {
  const avProst = (kind: "bioprosthetic" | "mechanical" | "transcatheter", sizeMm: number, extra?: { obstruction?: number; inRing?: boolean }) =>
    ({ av: { open: 1, reg: 0, prosthesis: { kind, sizeMm, leak: 0, obstruction: extra?.obstruction ?? 0, inRing: extra?.inRing ?? false } } });

  return [
    // ---- 2.4 native singles ----
    mx({ id: "mx-valve-av-sten-05", title: "Moderate aortic stenosis (0.5)", insult: { heart: { valves: valveSet({ av: { stenosis: 0.5 } }) } } }),
    mx({ id: "mx-valve-av-sten-1", title: "Severe aortic stenosis (1)", insult: { heart: { valves: valveSet({ av: { stenosis: 1 } }) } } }),
    mx({ id: "mx-valve-av-reg-05", title: "Moderate aortic regurgitation (0.5)", insult: { heart: { valves: valveSet({ av: { regurgitation: 0.5 } }) } } }),
    mx({ id: "mx-valve-av-reg-1", title: "Severe aortic regurgitation (1)", insult: { heart: { valves: valveSet({ av: { regurgitation: 1 } }) } } }),

    mx({ id: "mx-valve-mv-sten-05", title: "Moderate mitral stenosis (0.5)", insult: { heart: { valves: valveSet({ mv: { stenosis: 0.5 } }) } } }),
    mx({ id: "mx-valve-mv-sten-1", title: "Severe mitral stenosis (1)", insult: { heart: { valves: valveSet({ mv: { stenosis: 1 } }) } } }),
    mx({ id: "mx-valve-mv-reg-05", title: "Moderate mitral regurgitation (0.5)", insult: { heart: { valves: valveSet({ mv: { regurgitation: 0.5 } }) } } }),
    mx({ id: "mx-valve-mv-reg-1", title: "Severe mitral regurgitation (1)", insult: { heart: { valves: valveSet({ mv: { regurgitation: 1 } }) } } }),

    mx({ id: "mx-valve-tv-sten-1", title: "Severe tricuspid stenosis (1)", insult: { heart: { valves: valveSet({ tv: { stenosis: 1 } }) } } }),
    mx({ id: "mx-valve-tv-reg-1", title: "Severe tricuspid regurgitation (1)", insult: { heart: { valves: valveSet({ tv: { regurgitation: 1 } }) } } }),

    mx({ id: "mx-valve-pv-sten-1", title: "Severe pulmonary stenosis (1)", insult: { heart: { valves: valveSet({ pv: { stenosis: 1 } }) } } }),
    mx({ id: "mx-valve-pv-reg-1", title: "Severe pulmonary regurgitation (1)", insult: { heart: { valves: valveSet({ pv: { regurgitation: 1 } }) } } }),

    mx({ id: "mx-valve-avr-bio-default", title: "Default 23 mm aortic bioprosthesis", insult: { heart: { valves: avProst("bioprosthetic", 23) } } }),
    mx({ id: "mx-valve-avr-mech-default", title: "Default 23 mm mechanical aortic valve", insult: { heart: { valves: avProst("mechanical", 23) } } }),
    mx({ id: "mx-valve-avr-tavr-default", title: "Default 26 mm transcatheter aortic valve", insult: { heart: { valves: avProst("transcatheter", 26) } } }),
    mx({ id: "mx-valve-avr-bio-19", title: "19 mm aortic bioprosthesis (patient-prosthesis mismatch)", insult: { heart: { valves: avProst("bioprosthetic", 19) } } }),
    mx({ id: "mx-valve-avr-tavr-26", title: "26 mm transcatheter aortic valve", insult: { heart: { valves: avProst("transcatheter", 26) } } }),

    // ---- 3.3 interactions ----
    mx({
      id: "mx-valve-as-mr-mod",
      title: "Severe aortic stenosis plus moderate mitral regurgitation",
      insult: { heart: { valves: valveSet({ av: { stenosis: 1 }, mv: { regurgitation: 0.5 } }) } },
    }),
    mx({
      id: "mx-valve-ar-ms",
      title: "Severe aortic regurgitation plus mitral stenosis",
      insult: { heart: { valves: valveSet({ av: { regurgitation: 1 }, mv: { stenosis: 1 } }) } },
    }),
    mx({
      id: "mx-valve-ms-mr",
      title: "Severe mitral stenosis plus mitral regurgitation",
      insult: { heart: { valves: valveSet({ mv: { stenosis: 1, regurgitation: 1 } }) } },
    }),
    mx({
      id: "mx-valve-as-lad-80",
      title: "Severe aortic stenosis plus proximal LAD 80%",
      insult: { heart: { valves: valveSet({ av: { stenosis: 1 } }) }, lesions: [ladProx(0.8)] },
    }),
    mx({
      id: "mx-valve-as-dobutamine",
      title: "Severe aortic stenosis plus dobutamine 0.5",
      insult: { heart: { valves: valveSet({ av: { stenosis: 1 } }) }, support: { dobutamine: 0.5 } },
    }),
    mx({
      id: "mx-valve-mr-norepi",
      title: "Severe mitral regurgitation plus norepinephrine 0.5",
      insult: { heart: { valves: valveSet({ mv: { regurgitation: 1 } }) }, support: { norepinephrine: 0.5 } },
    }),
    mx({
      id: "mx-valve-mech-then-tavr",
      title: "23 mm mechanical AVR, then attempted 26 mm TAVR at 5 s",
      baseline: { heart: { valves: avProst("mechanical", 23) } },
      insult: {},
      actions: [{ atS: 5, label: "TAVR 26 mm in mechanical valve", run: (s) => { s.apply({ heart: intervene(heartOf(s), { type: "tavr", sizeMm: 26 }).patch }); } }],
    }),
    mx({
      id: "mx-valve-bio-fail-tavr",
      title: "Failed 23 mm aortic bioprosthesis (obstruction 0.5), then TAVR in-ring at 5 s",
      baseline: { heart: { valves: avProst("bioprosthetic", 23, { obstruction: 0.5 }) } },
      insult: {},
      actions: [{ atS: 5, label: "TAVR 26 mm valve-in-valve", run: (s) => { s.apply({ heart: intervene(heartOf(s), { type: "tavr", sizeMm: 26 }).patch }); } }],
    }),
    mx({
      id: "mx-valve-mr-teer-2",
      title: "Severe mitral regurgitation, then two-clip TEER at 5 s",
      baseline: { heart: { valves: valveSet({ mv: { regurgitation: 1 } }) } },
      insult: {},
      actions: [{ atS: 5, label: "TEER 2 clips", run: (s) => { s.apply({ heart: intervene(heartOf(s), { type: "teer", valve: "mv", clips: 2 }).patch }); } }],
    }),
    mx({
      id: "mx-valve-as-balloon",
      title: "Severe aortic stenosis, then balloon valvuloplasty (effect 1) at 5 s",
      baseline: { heart: { valves: valveSet({ av: { stenosis: 1 } }) } },
      insult: {},
      actions: [{ atS: 5, label: "Aortic balloon, effect 1", run: (s) => { s.apply({ heart: intervene(heartOf(s), { type: "balloon", valve: "av", effect: 1 }).patch }); } }],
    }),
    mx({
      id: "mx-valve-tr-balloon",
      title: "Severe tricuspid regurgitation, then attempted balloon at 5 s",
      baseline: { heart: { valves: valveSet({ tv: { regurgitation: 1 } }) } },
      insult: {},
      actions: [{ atS: 5, label: "Tricuspid balloon (not offered)", run: (s) => { s.apply({ heart: intervene(heartOf(s), { type: "balloon", valve: "tv" }).patch }); } }],
    }),
  ];
}
