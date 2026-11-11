import { byId } from "../config/labDevices";
import { LAB } from "../config/lab";
import { planSizing } from "./balloonStent";
import type { Action, Guidewire, LabEngineLike, Plaque, VGraph } from "./types";

export type Hint = {
  kind: "advance" | "withdraw" | "torque" | "shape" | "engage" | "inject" | "select" | "inflate" | "deflate" | "deploy" | "wait" | "none";
  mm?: number;
  deg?: number;
  bendDeg?: number;
  atm?: number;
  why: string;
  target?: { segId: string; mm: number };
  /** The one action that carries the hint out (what a "Show me" button or an MCP caller performs); absent when nothing is to be done. */
  action?: Action;
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

/** The action a hint means: the planner names any device, site or target in parentheses at the end of its reason. */
export function hintAction(h: Hint): Action | undefined {
  const id = h.why.match(/\(([a-zA-Z0-9._-]+)\)/)?.[1];
  switch (h.kind) {
    case "advance": return { t: "advance", mm: h.mm ?? 4 };
    case "withdraw": return { t: "advance", mm: -(h.mm ?? 4) };
    case "torque": return { t: "torque", deg: h.deg ?? 0 };
    case "shape": return { t: "shape", tipBendDeg: h.bendDeg ?? 45 };
    case "engage": return { t: "autoAdvance", to: h.target?.segId === "RCA" ? "RCA" : "LM" };
    case "inject": return { t: "inject", where: h.target?.segId === "RCA" ? "RCA" : "LCA", ml: 6 };
    case "inflate": return { t: "inflate", atm: h.atm ?? 10, seconds: 5 };
    case "deflate": return { t: "deflate" };
    case "deploy": return { t: "deploy", atm: h.atm ?? 14, seconds: 5 };
    case "select": {
      if (!id) return undefined;
      if (/^(femoral|radial)-[RL]$/.test(id)) return { t: "access", site: id as "femoral-R" };
      if (id.startsWith("sheath-")) return { t: "sheath", french: Number(id.slice(7)) as 5 | 6 | 7 };
      if (id === "heparin") return { t: "drug", id: "heparin", dose: 5000 };
      if (id.startsWith("target-")) return { t: "target", segId: id.slice(7) };
      const slot = id.startsWith("guide") ? "guide" : id.startsWith("wire") ? "wire" : id.startsWith("bal") ? "balloon" : id.startsWith("stent") ? "stent" : null;
      return slot ? { t: "select", slot, id } : undefined;
    }
    default: return undefined;
  }
}

/** Next procedural step for the lab, with the action that performs it; never mutates the engine. */
export function nextHint(engine: LabEngineLike, goal: { segId: string; centerMm: number }): Hint {
  const h = planHint(engine, goal);
  const action = hintAction(h);
  return action ? { ...h, action } : h;
}

function planHint(engine: LabEngineLike, goal: { segId: string; centerMm: number }): Hint {
  const st = engine.state();
  const g = engine.graph();
  const plaques = engine.plaques();
  const plaque = plaques.find((p) => p.segId === goal.segId)
    ?? plaques.find((p) => Math.abs(p.centerMm - goal.centerMm) < 30)
    ?? plaques[0];
  const root = coronaryRoot(g, goal.segId);
  const tgt = { segId: goal.segId, mm: goal.centerMm };

  if (!st.access) {
    return { kind: "select", why: "Gain right femoral access (femoral-R).", target: tgt };
  }
  if (!st.sheathFr) {
    return { kind: "select", why: "Place a 6 French sheath (sheath-6).", target: tgt };
  }
  if (st.act < 200) {
    return { kind: "select", why: "Give heparin 5000 units (heparin).", target: tgt };
  }
  // aim at the goal vessel; with a guide already seated in the other coronary, exchange the guide first (below)
  if (st.targetSeg !== goal.segId && (!st.guide?.engaged || st.guide.engaged === root)) {
    return { kind: "select", why: `Set the treatment target to ${goal.segId} (target-${goal.segId}).`, target: tgt };
  }
  if (!st.guide) {
    const id = guideFor(root);
    return { kind: "select", why: `Select the ${root === "RCA" ? "JR4" : "JL4"} guide (${id}).`, target: tgt };
  }
  if (!st.guide.engaged) {
    return {
      kind: "engage",
      why: `Advance the guide to engage the ${root} ostium.`,
      target: { segId: root, mm: 0 },
    };
  }
  if (st.guide.engaged !== root) {
    const id = guideFor(root);
    return {
      kind: "select",
      why: `The guide is seated in the ${st.guide.engaged}; exchange it for a ${root === "RCA" ? "JR4" : "JL4"} guide for the ${root} (${id}).`,
      target: { segId: root, mm: 0 },
    };
  }

  if (!st.wire) {
    const id = wireFor(plaque);
    if (plaque && (plaque.cto || plaque.ds >= 0.99)) {
      return {
        kind: "select",
        why: `Occlusion ahead: load a stiff CTO wire (${id}) before any advance into the cap.`,
        target: tgt,
      };
    }
    return { kind: "select", why: `Load a workhorse wire (${id}).`, target: tgt };
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
      target: tgt,
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
      target: tgt,
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
        target: tgt,
      };
    }
    const proximal = goalPlaque.centerMm - goalPlaque.lengthMm / 2;
    if (tip.tipMm < proximal - 0.5) {
      return {
        kind: "advance",
        mm: Math.min(8, proximal - tip.tipMm),
        why: `Advance to the proximal edge of the ${goal.segId} lesion.`,
        target: tgt,
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
      target: tgt,
    };
  }

  if (!pciLoaded && !atTreatmentSite) {
    return {
      kind: "advance",
      mm: Math.min(5, goal.centerMm - tip.tipMm + 1),
      why: `Advance the wire to the treatment site at ${Math.round(goal.centerMm)} mm.`,
      target: tgt,
    };
  }

  // Never move devices while a balloon is inflated.
  if (st.balloon && st.balloon.inflatedAtm > 0) {
    return { kind: "deflate", why: "Deflate the balloon before the next step.", target: tgt };
  }

  // PCI: predilate → stent → postdilate if needed.
  if (goalPlaque && goalPlaque.stents.length > 0) {
    const ap = goalPlaque.stents[goalPlaque.stents.length - 1]!.apposition;
    if (ap < 0.85) {
      if (!st.balloon || !st.balloon.id.includes("nc")) {
        const id = nearestBalloonId(goalPlaque.referenceMm, 12).replace("semi", "nc");
        return { kind: "select", why: `Select a noncompliant balloon for postdilation (${id}).`, target: tgt };
      }
      if (st.balloon.inflatedAtm <= 0) {
        return { kind: "inflate", atm: 16, why: "Postdilate to improve stent apposition.", target: tgt };
      }
      return { kind: "deflate", why: "Deflate after postdilation.", target: tgt };
    }
    return { kind: "none", why: "The lesion is stented; confirm final result with injection and FFR if needed.", target: tgt };
  }

  const didPredilate = st.log.some((a) => a.t === "inflate");
  if (goalPlaque && !didPredilate) {
    if (!st.balloon) {
      const id = nearestBalloonId(goalPlaque.referenceMm * 0.85, Math.max(12, goalPlaque.lengthMm));
      return { kind: "select", why: `Select a predilation balloon (${id}).`, target: tgt };
    }
    if (st.balloon.inflatedAtm > 0) {
      return { kind: "deflate", why: "Deflate the balloon before stenting.", target: tgt };
    }
    return { kind: "inflate", atm: 10, why: "Inflate the balloon to predilate the lesion.", target: tgt };
  }

  if (st.balloon && st.balloon.inflatedAtm > 0) {
    return { kind: "deflate", why: "Deflate before delivering the stent.", target: tgt };
  }
  if (!st.stent || (goalPlaque && goalPlaque.stents.length === 0 && st.stent.deployed)) {
    const size = planSizing(goalPlaque?.referenceMm ?? plaque?.referenceMm ?? 3, goalPlaque?.lengthMm ?? plaque?.lengthMm ?? 16);
    const id = nearestStentId(size.stentMm, size.lengthMm);
    return { kind: "select", why: `Select a DES sized to the vessel (${id}).`, target: tgt };
  }
  if (!st.stent.deployed) {
    return { kind: "deploy", atm: 14, why: "Deploy the stent across the lesion.", target: tgt };
  }

  return { kind: "none", why: "No further procedural step is required for this goal.", target: tgt };
}
