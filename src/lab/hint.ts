import { byId } from "../config/labDevices";
import { LAB } from "../config/lab";
import { planSizing } from "./balloonStent";
import { branchChoice } from "./wire";
import type { Guidewire, LabEngineLike, Plaque, VGraph } from "./types";

export type Hint = {
  kind: "advance" | "withdraw" | "torque" | "shape" | "engage" | "inject" | "select" | "inflate" | "deflate" | "deploy" | "wait" | "none";
  mm?: number;
  deg?: number;
  bendDeg?: number;
  atm?: number;
  why: string;
  target?: { segId: string; mm: number };
};

const ancestry = (g: VGraph, segId: string): string[] => {
  const out: string[] = [];
  let id: string | null = segId;
  const seen = new Set<string>();
  while (id && g.byId[id] && !seen.has(id)) {
    out.push(id);
    seen.add(id);
    id = g.byId[id].parent;
  }
  return out;
};

const coronaryRoot = (g: VGraph, segId: string): "LM" | "RCA" =>
  ancestry(g, segId).includes("RCA") ? "RCA" : "LM";

const guideFor = (root: "LM" | "RCA"): string => (root === "RCA" ? "guide-jr4" : "guide-jl4");

const wireFor = (p: Plaque | undefined): string => {
  if (p?.cto || (p && p.ds >= 0.99)) return "wire-stiff-cto";
  return "wire-workhorse";
};

const nearestStentId = (nominalMm: number, lengthMm: number): string => {
  const d = Math.round(nominalMm * 4) / 4;
  const lens = [8, 12, 18, 24, 28, 38];
  const len = lens.reduce((a, b) => (Math.abs(b - lengthMm) < Math.abs(a - lengthMm) ? b : a), 18);
  return `stent-des-${d.toFixed(2)}-${len}`;
};

const nearestBalloonId = (nominalMm: number, lengthMm: number): string => {
  const d = Math.min(4, Math.max(2, Math.round(nominalMm * 4) / 4));
  const len = lengthMm > 16 ? 20 : 12;
  return `bal-semi-${d.toFixed(2)}-${len}`;
};

const v3 = (a: [number, number, number], b: [number, number, number]) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  return [dx / l, dy / l, dz / l] as const;
};

const branchAngleAt = (g: VGraph, parent: string, childId: string): number => {
  const p = g.byId[parent], c = g.byId[childId];
  const u = c.attach;
  const i = Math.min(p.samples.length - 2, Math.max(0, Math.floor(u * (p.samples.length - 1))));
  const pt = v3(p.samples[i], p.samples[i + 1]);
  const ct = v3(c.samples[0], c.samples[Math.min(2, c.samples.length - 1)]);
  const dot = Math.min(1, Math.max(-1, pt[0] * ct[0] + pt[1] * ct[1] + pt[2] * ct[2]));
  return (Math.acos(dot) * 180) / Math.PI;
};

const childBranches = (g: VGraph, segId: string) =>
  g.segs
    .filter((s) => s.parent === segId)
    .map((s) => ({
      id: s.id,
      angleDeg: branchAngleAt(g, segId, s.id),
      diameterMm: Math.min(...s.diameterMm),
      attachMm: s.attach * g.byId[segId].length,
    }));

const plaqueOn = (plaques: readonly Plaque[], segId: string, mm: number) =>
  plaques.find((p) => p.segId === segId && Math.abs(p.centerMm - mm) < p.lengthMm / 2 + 2);

/** Next procedural step for the lab; never mutates the engine. */
export function nextHint(engine: LabEngineLike, goal: { segId: string; centerMm: number }): Hint {
  const st = engine.state();
  const g = engine.graph();
  const plaques = engine.plaques();
  const plaque = plaques.find((p) => p.segId === goal.segId)
    ?? plaques.find((p) => Math.abs(p.centerMm - goal.centerMm) < 30)
    ?? plaques[0];
  const root = coronaryRoot(g, goal.segId);

  if (!st.access) {
    return { kind: "select", why: "Gain right femoral access (femoral-R).", target: goal };
  }
  if (!st.sheathFr) {
    return { kind: "select", why: "Place a 6 French sheath (sheath-6).", target: goal };
  }
  if (st.act < 200) {
    return { kind: "select", why: "Give heparin 5000 units (heparin).", target: goal };
  }
  if (!st.targetSeg) {
    return { kind: "select", why: `Set the treatment target to ${goal.segId} (target-${goal.segId}).`, target: goal };
  }
  if (!st.guide) {
    const id = guideFor(root);
    return { kind: "select", why: `Select the ${root === "RCA" ? "JR4" : "JL4"} guide (${id}).`, target: goal };
  }
  if (!st.guide.engaged) {
    return {
      kind: "engage",
      why: `Advance the guide to engage the ${root} ostium.`,
      target: { segId: root, mm: 0 },
    };
  }
  if (st.guide.engaged !== root) {
    return {
      kind: "engage",
      why: `The guide is in the ${st.guide.engaged}; re-engage the ${root} for this target.`,
      target: { segId: root, mm: 0 },
    };
  }

  if (!st.wire) {
    const id = wireFor(plaque);
    if (plaque && (plaque.cto || plaque.ds >= 0.99)) {
      return {
        kind: "select",
        why: `Occlusion ahead: load a stiff CTO wire (${id}) before any advance into the cap.`,
        target: goal,
      };
    }
    return { kind: "select", why: `Load a workhorse wire (${id}).`, target: goal };
  }

  const tip = st.wire;
  const w = byId[tip.id] as Guidewire | undefined;
  const tipIsAncestorOfGoal = ancestry(g, goal.segId).includes(tip.tipSeg) || tip.tipSeg === goal.segId;

  // Wrong branch: tip is not the goal and not an ancestor of the goal → withdraw to the common parent.
  if (!tipIsAncestorOfGoal) {
    const tipAnc = ancestry(g, tip.tipSeg);
    const goalAnc = ancestry(g, goal.segId);
    const common = tipAnc.find((id) => goalAnc.includes(id)) ?? root;
    if (tip.tipSeg !== common) {
      return {
        kind: "withdraw",
        mm: 4,
        why: `Withdraw to the ${common} bifurcation before choosing the ${goal.segId} branch.`,
        target: { segId: common, mm: 0 },
      };
    }
  }

  // Route still aims at the previous target: reload once the tip is back on the shared path.
  if (tipIsAncestorOfGoal && !tip.route.includes(goal.segId) && tip.tipSeg !== goal.segId) {
    return {
      kind: "select",
      why: `Reload the wire so its route reaches ${goal.segId} (${tip.id}).`,
      target: goal,
    };
  }

  // At a parent of the goal: follow the planned route, or shape/torque into a side branch.
  if (tip.tipSeg !== goal.segId) {
    const routeIdx = tip.route.indexOf(tip.tipSeg);
    const nextOnRoute = routeIdx >= 0 ? tip.route[routeIdx + 1] : undefined;
    const kids = childBranches(g, tip.tipSeg);
    const need = kids.find((b) => b.id === goal.segId || ancestry(g, goal.segId).includes(b.id));
    const parentLen = g.byId[tip.tipSeg]?.length ?? 0;
    // Mid-segment side branch: shape and rotate before the takeoff (even when it is on the route).
    const sideBranch = need && need.attachMm < parentLen - 1;
    if (sideBranch && need) {
      if (tip.bendDeg < LAB.branchBendChoiceDeg) {
        return {
          kind: "shape",
          bendDeg: 60,
          why: `Shape a tip bend so the wire can choose the ${need.id} branch.`,
          target: { segId: need.id, mm: 0 },
        };
      }
      const delta = need.angleDeg - tip.rotDeg;
      const closest = kids.reduce((a, b) =>
        Math.abs(tip.rotDeg - b.angleDeg) < Math.abs(tip.rotDeg - a.angleDeg) ? b : a);
      const aligned = Math.abs(delta) < LAB.branchMatchRotDeg && closest.id === need.id;
      if (!aligned) {
        const rivals = kids.filter((b) => b.id !== need.id);
        let aim = need.angleDeg;
        for (const r of rivals) {
          if (Math.abs(aim - r.angleDeg) < LAB.branchMatchRotDeg) {
            aim = r.angleDeg + Math.sign(need.angleDeg - r.angleDeg || 1) * (LAB.branchMatchRotDeg + 1);
          }
        }
        const turn = aim - tip.rotDeg;
        return {
          kind: "torque",
          deg: turn === 0 ? (Math.abs(delta) < 1e-6 ? 1 : delta) : turn,
          why: `Rotate ${turn >= 0 ? "+" : ""}${Math.round(turn)}° to align with the ${need.id} takeoff.`,
          target: { segId: need.id, mm: 0 },
        };
      }
    }
    return {
      kind: "advance",
      mm: nextOnRoute ? 6 : 4,
      why: nextOnRoute
        ? `Advance along the route into ${nextOnRoute}.`
        : `Advance toward ${goal.segId}.`,
      target: goal,
    };
  }

  // On the goal segment: cross until the tip reaches the lesion center (skip once devices are loaded).
  const near = plaqueOn(plaques, tip.tipSeg, tip.tipMm);
  const goalPlaque = plaque && plaque.segId === tip.tipSeg ? plaque : near;
  const pciLoaded = !!(st.balloon || st.stent);
  const atTreatmentSite = tip.tipMm >= goal.centerMm - 1;
  if (!pciLoaded && !atTreatmentSite && goalPlaque) {
    if (goalPlaque.ds >= 0.95 && w && w.stiffness !== "stiff" && goalPlaque.ds < 0.99 && !goalPlaque.cto) {
      /* soft high-grade without CTO: continue with current wire */
    } else if (goalPlaque.ds >= 0.95 && w && w.stiffness !== "stiff") {
      return {
        kind: "select",
        why: `Do not push a soft wire into this near-total occlusion; exchange for a stiff CTO wire (wire-stiff-cto).`,
        target: goal,
      };
    }
    const proximal = goalPlaque.centerMm - goalPlaque.lengthMm / 2;
    if (tip.tipMm < proximal - 0.5) {
      return {
        kind: "advance",
        mm: Math.min(8, proximal - tip.tipMm),
        why: `Advance to the proximal edge of the ${goal.segId} lesion.`,
        target: goal,
      };
    }
    // One controlled push to the treatment site to limit random perforation rolls.
    const riskNote = goalPlaque.ds >= 0.95
      ? "Cross the occlusion with a single controlled advance; perforation and subintimal tracking risk is high."
      : `Cross the ${Math.round(goalPlaque.ds * 100)}% stenosis in ${goal.segId}.`;
    return {
      kind: "advance",
      mm: Math.max(2, goal.centerMm + 1 - tip.tipMm),
      why: riskNote,
      target: goal,
    };
  }

  if (!pciLoaded && !atTreatmentSite) {
    return {
      kind: "advance",
      mm: Math.min(5, goal.centerMm - tip.tipMm + 1),
      why: `Advance the wire to the treatment site at ${Math.round(goal.centerMm)} mm.`,
      target: goal,
    };
  }

  // Never move devices while a balloon is inflated.
  if (st.balloon && st.balloon.inflatedAtm > 0) {
    return { kind: "deflate", why: "Deflate the balloon before the next step.", target: goal };
  }

  // PCI: predilate → stent → postdilate if needed.
  if (goalPlaque && goalPlaque.stents.length > 0) {
    const ap = goalPlaque.stents[goalPlaque.stents.length - 1]!.apposition;
    if (ap < 0.85) {
      if (!st.balloon || !st.balloon.id.includes("nc")) {
        const id = nearestBalloonId(goalPlaque.referenceMm, 12).replace("semi", "nc");
        return { kind: "select", why: `Select a noncompliant balloon for postdilation (${id}).`, target: goal };
      }
      if (st.balloon.inflatedAtm <= 0) {
        return { kind: "inflate", atm: 16, why: "Postdilate to improve stent apposition.", target: goal };
      }
      return { kind: "deflate", why: "Deflate after postdilation.", target: goal };
    }
    return { kind: "none", why: "The lesion is stented; confirm final result with injection and FFR if needed.", target: goal };
  }

  const didPredilate = st.log.some((a) => a.t === "inflate");
  if (goalPlaque && !didPredilate) {
    if (!st.balloon) {
      const id = nearestBalloonId(goalPlaque.referenceMm * 0.85, Math.max(12, goalPlaque.lengthMm));
      return { kind: "select", why: `Select a predilation balloon (${id}).`, target: goal };
    }
    if (st.balloon.inflatedAtm > 0) {
      return { kind: "deflate", why: "Deflate the balloon before stenting.", target: goal };
    }
    return { kind: "inflate", atm: 10, why: "Inflate the balloon to predilate the lesion.", target: goal };
  }

  if (st.balloon && st.balloon.inflatedAtm > 0) {
    return { kind: "deflate", why: "Deflate before delivering the stent.", target: goal };
  }
  if (!st.stent || (goalPlaque && goalPlaque.stents.length === 0 && st.stent.deployed)) {
    const size = planSizing(goalPlaque?.referenceMm ?? plaque?.referenceMm ?? 3, goalPlaque?.lengthMm ?? plaque?.lengthMm ?? 16);
    const id = nearestStentId(size.stentMm, size.lengthMm);
    return { kind: "select", why: `Select a DES sized to the vessel (${id}).`, target: goal };
  }
  if (!st.stent.deployed) {
    return { kind: "deploy", atm: 14, why: "Deploy the stent across the lesion.", target: goal };
  }

  return { kind: "none", why: "No further procedural step is required for this goal.", target: goal };
}
