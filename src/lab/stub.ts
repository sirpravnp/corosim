import { buildTree } from "../anatomy/tree";
import type { V3 } from "../anatomy/curve";
import type { Action, LabEngineLike, LabEvent, LabState, Plaque, VGraph, VSeg } from "./types";

/**
 * A scripted stand-in for the procedure engine: right route (access, left main, LAD), no physics. It exists so the fluoroscopy
 * view and the lab page can be built and tested before `LabEngine` lands. Do not use it in the shipped page.
 */
const ACCESS = "FEM_R";
const ROUTE = [ACCESS, "LM", "LAD"];

const lerp = (a: V3, b: V3, w: number): V3 => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];

function buildGraph(): VGraph {
  const tree = buildTree();
  const lm = tree.byId.LM;
  const start: V3 = [70, -420, 35], end = lm.samples[0];
  const NS = 60;
  const samples = Array.from({ length: NS + 1 }, (_, i) => lerp(start, end, i / NS));
  const length = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
  const access: VSeg = { id: ACCESS, name: "Femoral to aortic root (stub)", parent: null, attach: 0, length, samples, diameterMm: samples.map(() => 8), tortuosity: 0, calcification: 0 };
  const segs: VSeg[] = [access];
  for (const s of tree.segments) {
    segs.push({
      id: s.id, name: s.name, parent: s.parent ?? (s.id === "LM" ? ACCESS : null), attach: s.parent ? s.attach : 1,
      length: s.length, samples: s.samples, diameterMm: s.samples.map(() => (s.id === "LM" ? 4.2 : 3)), tortuosity: 0, calcification: 0,
    });
  }
  const rca = tree.byId.RCA;
  return { segs, byId: Object.fromEntries(segs.map((s) => [s.id, s])), ostium: { LM: { segId: "LM", mm: 0 }, RCA: { segId: rca ? "RCA" : "LM", mm: 0 } } };
}

const blankState = (): LabState => ({
  access: null, sheathFr: null, sheath: null, act: 0, guide: null, wire: null, balloon: null, stent: null,
  targetSeg: null,
  carm: { rot: 30, tilt: 20 }, contrastMl: 0, fluoroSeconds: 0, doseMGy: 0, elapsedS: 0, log: [],
});

export class StubLabEngine implements LabEngineLike {
  private g = buildGraph();
  private st: LabState = blankState();
  private pl: Plaque[] = [];
  private pos = 0; // mm of wire past the puncture, along ROUTE
  private undoTally = 0;

  constructor() { this.reset(); }

  state(): Readonly<LabState> { return this.st; }
  graph(): VGraph { return this.g; }
  plaques(): readonly Plaque[] { return this.pl; }
  get undoCount(): number { return this.undoTally; }
  canUndo(): boolean { return this.st.log.length > 0; }
  undo(): LabEvent[] {
    if (!this.canUndo()) return [];
    this.undoTally += 1;
    return this.replay(this.st.log.slice(0, -1));
  }

  reset(): void {
    this.st = blankState(); this.pos = 0; this.undoTally = 0;
    const lad = this.g.byId.LAD;
    this.pl = [{
      segId: "LAD", centerMm: lad.length * 0.5, lengthMm: 18, ds: 0.75, referenceMm: 3, eccentric: 0.4, eccentricAngleDeg: 30,
      calcium: 0.1, lipid: 0.4, thrombus: 0, remodel: "none", stents: [],
    }];
  }

  replay(actions: Action[]): LabEvent[] {
    const undos = this.undoTally;
    this.reset();
    this.undoTally = undos;
    return actions.flatMap((a) => this.apply(a));
  }

  private ev(kind: string, text: string, severity: LabEvent["severity"] = "info", data?: Record<string, unknown>): LabEvent {
    return { at: this.st.elapsedS, kind, text, severity, data };
  }

  /** Where the wire tip is on the route, from its distance past the puncture. */
  private locate(): { seg: string; mm: number } {
    let left = this.pos;
    for (const id of ROUTE) {
      const len = this.g.byId[id].length;
      if (left <= len || id === ROUTE[ROUTE.length - 1]) return { seg: id, mm: Math.min(left, len) };
      left -= len;
    }
    return { seg: ACCESS, mm: 0 };
  }

  private syncWire() {
    if (!this.st.wire) return;
    const { seg, mm } = this.locate();
    this.st.wire = { ...this.st.wire, tipSeg: seg, tipMm: mm };
  }

  apply(a: Action): LabEvent[] {
    const s = this.st, out: LabEvent[] = [];
    const log = () => { s.log = [...s.log, a]; };
    if (a.t !== "access" && a.t !== "carm" && !s.access) return [this.ev("no-access", "Get vascular access first.", "bad")];
    switch (a.t) {
      case "access": s.access = a.site; out.push(this.ev("access", `Access at the ${a.site}.`)); break;
      case "sheath":
        s.sheathFr = a.french;
        if (s.access) s.sheath = { site: s.access, french: a.french, lengthMm: 0 };
        out.push(this.ev("sheath", `${a.french} French sheath in.`));
        break;
      case "drug": if (a.id === "heparin") s.act = Math.min(300, s.act + a.dose * 0.05); out.push(this.ev("drug", `Gave ${a.id}.`)); break;
      case "select":
        if (a.slot === "guide") {
          s.guide = { id: a.id, engaged: "LM", quality: 0.9, tipSeg: "LM", tipMm: 0 };
          out.push(this.ev("guide", `Guide ${a.id} engaged the left main.`));
        }
        else if (a.slot === "wire") { s.wire = { id: a.id, tipSeg: ACCESS, tipMm: 0, bendDeg: 0, rotDeg: 0, route: ROUTE }; this.pos = 0; out.push(this.ev("wire", `Wire ${a.id} loaded.`)); }
        else if (a.slot === "balloon") { const w = s.wire; if (!w) return [this.ev("no-wire", "Cross the lesion with a wire first.", "bad")]; s.balloon = { id: a.id, segId: w.tipSeg, centerMm: w.tipMm, inflatedAtm: 0 }; out.push(this.ev("balloon", `Balloon ${a.id} on the wire.`)); }
        else { const w = s.wire; if (!w) return [this.ev("no-wire", "Cross the lesion with a wire first.", "bad")]; s.stent = { id: a.id, segId: w.tipSeg, centerMm: w.tipMm, deployed: false }; out.push(this.ev("stent", `Stent ${a.id} on the wire.`)); }
        break;
      case "advance":
        if (!s.wire) return [this.ev("no-device", "No wire to advance.", "bad")];
        if (s.balloon && s.balloon.inflatedAtm > 0) return [this.ev("inflated", "Deflate the balloon before moving it.", "bad")];
        this.pos = Math.max(0, this.pos + a.mm); this.syncWire();
        if (s.balloon) s.balloon = { ...s.balloon, segId: s.wire.tipSeg, centerMm: s.wire.tipMm };
        if (s.stent && !s.stent.deployed) s.stent = { ...s.stent, segId: s.wire.tipSeg, centerMm: s.wire.tipMm };
        s.fluoroSeconds += 0.5; s.doseMGy += 0.4; break;
      case "torque": if (s.wire) s.wire = { ...s.wire, rotDeg: s.wire.rotDeg + a.deg }; break;
      case "shape": if (s.wire) s.wire = { ...s.wire, bendDeg: a.tipBendDeg }; break;
      case "inject": s.contrastMl += a.ml; out.push(this.ev("contrast", `${a.ml} mL contrast into the ${a.where}.`)); break;
      case "inflate":
        if (!s.balloon) return [this.ev("no-balloon", "No balloon selected.", "bad")];
        s.balloon = { ...s.balloon, inflatedAtm: a.atm }; s.elapsedS += a.seconds;
        out.push(this.ev("inflate", `Balloon at ${a.atm} atm.`, "info", { occludesFlow: true })); break;
      case "deflate": if (s.balloon) { s.balloon = { ...s.balloon, inflatedAtm: 0 }; out.push(this.ev("deflate", "Balloon deflated.", "info", { occludesFlow: false })); } break;
      case "deploy": {
        if (!s.stent) return [this.ev("no-stent", "No stent selected.", "bad")];
        const p = this.pl[0], m = /(\d\.\d\d)-(\d+)$/.exec(s.stent.id), d = m ? +m[1] : 3, len = m ? +m[2] : 24;
        p.stents = [...p.stents, { fromMm: s.stent.centerMm - len / 2, toMm: s.stent.centerMm + len / 2, diameterMm: d, expansionPct: 95, apposition: 1, strutUm: 81 }];
        p.ds = Math.min(p.ds, 0.08); s.stent = { ...s.stent, deployed: true }; s.elapsedS += a.seconds;
        out.push(this.ev("deploy", `Stent deployed at ${a.atm} atm.`)); break;
      }
      case "carm": s.carm = { rot: a.rot, tilt: a.tilt }; break;
      case "close": out.push(this.ev("close", `Access closed (${a.method}).`)); break;
    }
    log();
    return out;
  }
}
