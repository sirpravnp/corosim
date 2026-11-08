import { buildTree } from "../anatomy/tree";
import { mulberry32 } from "../physics/ecg";
import { byId } from "../config/labDevices";
import { LAB } from "../config/lab";
import { perforationRisk, subintimalRisk, thrombusRisk } from "./complications";
import { buildAccess, unify } from "./access";
import { routeTo } from "./route";
import { advanceWire } from "./wire";
import { wireModel } from "../sim/cath";
import { inflateBalloon, deployStentAt } from "./balloonStent";
import { applyToSim } from "./coupling";
import type { Balloon, Guidewire, Stent } from "./types";
import type { Lesion } from "../physics/network";
import type { Simulation } from "../sim/simulation";
import type {
  AccessSite, AccessVariant, Action, GuideCatheter, LabEngineLike, LabEvent, LabState, Plaque, VGraph,
} from "./types";

const blank = (): LabState => ({
  access: null, sheathFr: null, act: 0, guide: null, wire: null, balloon: null, stent: null,
  carm: { rot: 30, tilt: 20 }, contrastMl: 0, fluoroSeconds: 0, doseMGy: 0, elapsedS: 0, log: [],
});

const guideSweetMm: Record<GuideCatheter["curve"], number> = {
  "JL3.5": 30, "JL4": 35, "JL5": 40, "JR4": 36,
  "EBU3.5": 32, "XB3.5": 34, "AL1": 36, "AL2": 38,
};

const targetsLm = new Set(["JL3.5", "JL4", "JL5", "EBU3.5", "XB3.5", "AL1", "AL2"]);

export class LabEngine implements LabEngineLike {
  private st: LabState = blank();
  private g: VGraph;
  private site: AccessSite = "femoral-R";
  private route: string[] = [];
  private tipSeg = "";
  private tipMm = 0;
  private active: "guide" | "wire" | "balloon" | "stent" | null = null;
  private rand: () => number;
  private plaqueList: Plaque[];
  private occlusions: Lesion[] = [];
  private bedResistance: Record<string, number> = {};

  constructor(
    private sim: Simulation,
    private opts: { seed: number; access: AccessVariant; plaques: Plaque[] },
  ) {
    this.rand = mulberry32(opts.seed);
    this.plaqueList = opts.plaques.map((p) => ({ ...p, stents: [...p.stents] }));
    const tree = buildTree(this.sim.n.anatomy);
    const roots = [tree.byId.LM.samples[0], tree.byId.RCA.samples[0]];
    this.g = unify(buildAccess(opts.access, roots), tree);
    this.reset();
  }

  state(): Readonly<LabState> { return this.st; }
  graph(): VGraph { return this.g; }
  plaques(): readonly Plaque[] { return this.plaqueList; }

  private syncSim(): void {
    applyToSim(this.sim, this.plaqueList, { occlusions: this.occlusions, bedResistance: this.bedResistance });
  }

  /** Hyperemic Pd/Pa at the wire tip (pressure-wire selection only). */
  wirePdPa(): number | null {
    if (!this.st.wire || this.st.wire.id !== "wire-pressure") return null;
    const seg = this.sim.tree.byId[this.tipSeg];
    if (!seg) return null;
    const wm = wireModel(this.sim, this.tipSeg);
    return wm.at({ mm: this.tipMm }).hyperRatio;
  }

  reset(): void {
    this.st = blank();
    this.tipSeg = "";
    this.tipMm = 0;
    this.route = [];
    this.active = null;
    this.sim.setLive(null);
    this.plaqueList = this.opts.plaques.map((p) => ({ ...p, stents: [...p.stents] }));
    this.occlusions = [];
    this.bedResistance = {};
    this.rand = mulberry32(this.opts.seed);
    this.sim.setLive(null);
  }

  replay(actions: Action[]): LabEvent[] {
    this.reset();
    return actions.flatMap((a) => this.apply(a));
  }

  private ev(kind: string, text: string, severity: LabEvent["severity"] = "info", data?: Record<string, unknown>): LabEvent {
    return { at: this.st.elapsedS, kind, text, severity, data };
  }

  private decayAct(dt: number) {
    if (dt > 0) this.st.act = Math.max(0, this.st.act - LAB.actDecayPerSecond * dt);
  }

  private guideQuality(curve: GuideCatheter["curve"], target: "LM" | "RCA"): number {
    if (target === "LM" && !targetsLm.has(curve)) return 0;
    if (target === "RCA" && targetsLm.has(curve) && curve !== "JR4") return 0.4;
    const ideal = guideSweetMm[curve] ?? 35;
    return Math.max(0, Math.min(1, 1 - Math.abs(this.opts.access.aorticRootMm - ideal) / 18));
  }

  private syncGuideEngagement(guide: GuideCatheter) {
    if (!this.st.guide) return;
    const asc = this.g.byId.AORTA_ASC;
    const atOstium = this.tipSeg === "LM" || (this.tipSeg === "AORTA_ASC" && this.tipMm >= asc.length * 0.85);
    if (!atOstium) {
      this.st.guide = { ...this.st.guide, engaged: null, quality: 0 };
      return;
    }
    const target: "LM" | "RCA" = targetsLm.has(guide.curve) ? "LM" : "RCA";
    const q = this.guideQuality(guide.curve, target);
    if (target === "LM" && !targetsLm.has(guide.curve)) {
      this.st.guide = { ...this.st.guide, engaged: null, quality: q };
      return;
    }
    this.st.guide = { ...this.st.guide, engaged: q >= 0.45 ? target : null, quality: q };
  }

  private moveActive(mm: number, out: LabEvent[]) {
    if (!this.active || !this.st.access) return;
    const target = this.route[this.route.length - 1] ?? "LM";
    let left = mm;
    let idx = Math.max(0, this.route.indexOf(this.tipSeg));
    if (idx < 0) idx = 0;
    while (left > 0 && idx < this.route.length) {
      const id = this.route[idx];
      const seg = this.g.byId[id];
      const room = seg.length - this.tipMm;
      const step = Math.min(left, room);
      this.tipMm += step;
      left -= step;
      this.tipSeg = id;
      if (this.tipMm >= seg.length - 1e-6 && idx < this.route.length - 1) {
        idx++;
        this.tipSeg = this.route[idx];
        this.tipMm = 0;
      } else break;
    }
  if (this.active === "guide" && this.st.guide) {
      const g = byId[this.st.guide.id] as GuideCatheter;
      this.syncGuideEngagement(g);
    }
    if (this.active === "wire" && this.st.wire) {
      this.st.wire = { ...this.st.wire, tipSeg: this.tipSeg, tipMm: this.tipMm, route: [...this.route] };
      if (this.st.act < 250 && mm > 0) out.push(this.ev("thrombus-risk", "Low ACT: thrombus risk on the wire.", "caution"));
      if (thrombusRisk(this.st.act) > 0.3 && this.rand() < 0.05) out.push(this.ev("thrombus", "Possible thrombus on the wire.", "caution"));
    }
    this.st.fluoroSeconds += Math.abs(mm) * 0.02;
    this.st.doseMGy += Math.abs(mm) * 0.015;
  }

  apply(a: Action): LabEvent[] {
    const s = this.st;
    const out: LabEvent[] = [];
    const needsAccess = a.t !== "access" && a.t !== "carm";
    if (needsAccess && !s.access) {
      out.push(this.ev("no-access", "Get vascular access first.", "bad"));
      return out;
    }

    switch (a.t) {
      case "access":
        s.access = a.site;
        this.site = a.site;
        this.route = routeTo(this.g, a.site, "LM");
        this.tipSeg = this.route[0];
        this.tipMm = 0;
        out.push(this.ev("access", `Access at the ${a.site}.`));
        break;
      case "sheath":
        s.sheathFr = a.french;
        out.push(this.ev("sheath", `${a.french} French sheath in.`));
        break;
      case "drug":
        if (a.id === "heparin") s.act = Math.min(300, s.act + a.dose * LAB.actPerHeparinUnit);
        if (a.id === "nitro" && s.access?.startsWith("radial")) out.push(this.ev("drug", "Nitroglycerin for radial spasm.", "info"));
        else out.push(this.ev("drug", `Gave ${a.id}.`));
        break;
      case "select":
        if (a.slot === "guide") {
          const g = byId[a.id] as GuideCatheter | undefined;
          if (!g || g.kind !== "guide") return [this.ev("no-device", "Unknown guide.", "bad")];
          this.active = "guide";
          s.guide = { id: a.id, engaged: null, quality: 0 };
          this.route = routeTo(this.g, this.site, "LM");
          this.tipSeg = this.route[0];
          this.tipMm = 0;
          out.push(this.ev("guide", `Guide ${g.name} selected.`));
        } else if (a.slot === "wire") {
          if (!s.guide?.engaged) return [this.ev("no-guide", "Engage the guide before the wire.", "bad")];
          this.active = "wire";
          this.route = routeTo(this.g, this.site, "LAD");
          if (!this.route.includes(this.tipSeg)) {
            this.tipSeg = "LM";
            this.tipMm = this.g.byId.LM.length * 0.92;
          }
          s.wire = { id: a.id, tipSeg: this.tipSeg, tipMm: this.tipMm, bendDeg: 0, rotDeg: 0, route: [...this.route] };
          out.push(this.ev("wire", `Wire ${a.id} loaded.`));
        } else if (a.slot === "balloon") {
          if (!s.wire) return [this.ev("no-wire", "Cross with a wire first.", "bad")];
          this.active = "balloon";
          s.balloon = { id: a.id, segId: this.tipSeg, centerMm: this.tipMm, inflatedAtm: 0 };
          out.push(this.ev("balloon", `Balloon ${a.id} ready.`));
        } else if (a.slot === "stent") {
          if (!s.wire) return [this.ev("no-wire", "Cross with a wire first.", "bad")];
          this.active = "stent";
          s.stent = { id: a.id, segId: this.tipSeg, centerMm: this.tipMm, deployed: false };
          out.push(this.ev("stent", `Stent ${a.id} ready.`));
        }
        break;
      case "advance":
        if (s.balloon && s.balloon.inflatedAtm > 0) {
          out.push(this.ev("balloon-inflated", "Deflate the balloon before moving.", "bad"));
          break;
        }
        if (this.active === "wire" && s.wire && s.guide) {
          const w = byId[s.wire.id] as Guidewire | undefined;
          const gdev = byId[s.guide.id] as GuideCatheter;
          if (!w || w.kind !== "wire") break;
          const r = advanceWire(this.g, s, w, [...this.plaqueList], gdev.support, a.mm, this.rand);
          this.tipSeg = r.tipSeg;
          this.tipMm = r.tipMm;
          this.route = r.route;
          s.wire = { ...s.wire, tipSeg: r.tipSeg, tipMm: r.tipMm, route: r.route };
          if (r.event) out.push(r.event);
          else if (r.moved < Math.abs(a.mm) * 0.25 && a.mm > 2) {
            out.push(this.ev("resistance", "Heavy lesion resistance.", "caution"));
          }
          const pl = this.plaqueList.find((p) => p.segId === r.tipSeg && Math.abs(p.centerMm - r.tipMm) < p.lengthMm / 2 + 2);
          if (pl && a.mm > 0) {
            if (this.rand() < perforationRisk(w, pl)) out.push(this.ev("perforation", "Wire perforation risk.", "bad"));
            if (this.rand() < subintimalRisk(w, pl)) out.push(this.ev("subintimal", "Subintimal tracking.", "caution"));
          }
          if (s.act < 250 && a.mm > 0) out.push(this.ev("thrombus-risk", "Low ACT: thrombus risk on the wire.", "caution"));
          s.fluoroSeconds += Math.abs(a.mm) * 0.02;
          s.doseMGy += Math.abs(a.mm) * 0.015;
        } else this.moveActive(a.mm, out);
        break;
      case "torque":
        if (s.wire) s.wire = { ...s.wire, rotDeg: s.wire.rotDeg + a.deg };
        break;
      case "shape":
        if (s.wire) s.wire = { ...s.wire, bendDeg: a.tipBendDeg };
        break;
      case "carm":
        s.carm = { rot: a.rot, tilt: a.tilt };
        break;
      case "inject":
        s.contrastMl += a.ml;
        out.push(this.ev("contrast", `${a.ml} mL contrast into the ${a.where}.`));
        break;
      case "inflate": {
        if (!s.balloon) return [this.ev("no-balloon", "Select a balloon first.", "bad")];
        const b = byId[s.balloon.id] as Balloon;
        const r = inflateBalloon(s, b, a.atm, a.seconds, this.plaqueList, this.tipMm, this.tipSeg, this.rand);
        this.plaqueList = r.plaques;
        out.push(...r.events);
        s.balloon = { ...s.balloon, inflatedAtm: a.atm, centerMm: this.tipMm, segId: this.tipSeg };
        if (r.occludesFlow) {
          const seg = this.g.byId[this.tipSeg];
          this.occlusions = [{
            segId: this.tipSeg, pos: this.tipMm / seg.length, ds: 0.99, occluded: true, lengthMm: b.lengthMm,
          }];
        }
        this.syncSim();
        break;
      }
      case "deflate":
        if (s.balloon) s.balloon = { ...s.balloon, inflatedAtm: 0 };
        this.occlusions = [];
        this.syncSim();
        out.push(this.ev("deflate", "Balloon deflated."));
        break;
      case "deploy": {
        if (!s.stent) return [this.ev("no-stent", "Select a stent first.", "bad")];
        const st = byId[s.stent.id] as Stent;
        const r = deployStentAt(s, st, a.atm, a.seconds, this.plaqueList, this.g, this.tipMm, this.tipSeg, this.rand);
        this.plaqueList = r.plaques;
        out.push(...r.events);
        s.stent = { ...s.stent, deployed: true, centerMm: this.tipMm, segId: this.tipSeg };
        if (r.jailed.length) {
          for (const j of r.jailed) {
            out.push(this.ev("jailed", `Jailed branch ${j.branchSeg}.`, "caution", j));
            this.bedResistance[j.branchSeg] = (this.bedResistance[j.branchSeg] ?? 1) * (1 + j.ostialDs);
          }
        }
        this.syncSim();
        break;
      }
      default:
        break;
    }

    this.decayAct(a.t === "advance" ? Math.abs(a.mm) : 0);
    s.log = [...s.log, a];
    if (a.t !== "carm" && a.t !== "shape" && a.t !== "torque") this.syncSim();
    return out;
  }
}
