import { buildTree } from "../anatomy/tree";
import { mulberry32 } from "../physics/ecg";
import { byId } from "../config/labDevices";
import { LAB } from "../config/lab";
import {
  draw, forcedEffect, perforationRisk, subintimalRisk, thrombusRisk, type Complication, type Effect, type ForcedEvent,
} from "./complications";
import {
  applyEffect, baseRiskContext, mergeBedResistance, ostialJailLesion,
} from "./effects";
import { buildAccess, unify } from "./access";
import { routeArcTo } from "./geometry";
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
  access: null, sheathFr: null, sheath: null, act: 0, guide: null, wire: null, balloon: null, stent: null,
  targetSeg: null,
  carm: { rot: 30, tilt: 20 }, contrastMl: 0, fluoroSeconds: 0, doseMGy: 0, elapsedS: 0, log: [],
});

/** Walk the coronary tree to the LM or RCA ostium that feeds `segId`. */
const coronaryRoot = (g: VGraph, segId: string): "LM" | "RCA" => {
  let id: string | null = segId;
  const seen = new Set<string>();
  while (id && g.byId[id] && !seen.has(id)) {
    if (id === "LM" || id === "RCA") return id;
    seen.add(id);
    id = g.byId[id].parent;
  }
  return "LM";
};

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
  private extraLiveLesions: Lesion[] = [];
  private bedResistance: Record<string, number> = {};
  private accessUltrasound = false;
  private accessClosed = false;
  private manualHold = false;
  private tamponadeRate = 0;
  private vfAt = -1e9; // when ischemia last started VF: it fires once, then again only if the patient has been perfusing for a while
  private effusion = 0; // mL of blood in the pericardium; it fills while a perforation is open
  private perforationSealed = false;
  private ischemiaSeconds = 0;
  private forcedFired = new Set<string>();

  constructor(
    private sim: Simulation,
    private opts: { seed: number; access: AccessVariant; plaques: Plaque[]; forced?: ForcedEvent[] },
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
    applyToSim(this.sim, this.plaqueList, {
      occlusions: this.occlusions,
      bedResistance: this.bedResistance,
      liveLesions: this.extraLiveLesions,
    });
  }

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
    this.plaqueList = this.opts.plaques.map((p) => ({ ...p, stents: [...p.stents] }));
    this.st.targetSeg = this.plaqueList[0]?.segId ?? null;
    this.occlusions = [];
    this.extraLiveLesions = [];
    this.bedResistance = {};
    this.accessUltrasound = false;
    this.accessClosed = false;
    this.manualHold = false;
    this.tamponadeRate = 0; this.effusion = 0; this.vfAt = -1e9;
    this.perforationSealed = false;
    this.ischemiaSeconds = 0;
    this.forcedFired = new Set();
    this.rand = mulberry32(this.opts.seed);
    this.sim.setRealtime(false);
    this.sim.setLive(null);
  }

  /** Vessel the wire should treat; defaults to the first plaque. */
  private treatTarget(): string {
    return this.st.targetSeg ?? this.plaqueList[0]?.segId ?? "LAD";
  }

  /** Let `seconds` of the procedure pass with no action: the patient keeps bleeding, ischemic and breathing. The page calls this every frame once access is gained. */
  tick(seconds: number): LabEvent[] {
    const out: LabEvent[] = [];
    if (!this.st.access || seconds <= 0) return out;
    this.advanceTime(seconds, out);
    return out;
  }

  /** Blood in the pericardium, in mL. */
  effusionMl(): number { return this.effusion; }

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

  private territorySeg(): string {
    if (this.tipSeg && this.sim.tree.byId[this.tipSeg]) return this.tipSeg;
    return this.treatTarget();
  }

  private applyComplicationResult(eff: Effect | null, out: LabEvent[], label?: Complication) {
    if (!eff) return;
    applyEffect(this.sim, eff);
    mergeBedResistance(this.bedResistance, eff);
    if (eff.lesions) this.extraLiveLesions.push(...eff.lesions);
    if (eff.tamponade && eff.tamponade > 0) { this.tamponadeRate = 0.05; this.effusion = Math.max(this.effusion, eff.tamponade * 100); }
    if (label) {
      const kind = label === "arrhythmia-vf" ? "arrest" : label;
      out.push(this.ev(kind, `${label} with hemodynamic effect.`, kind === "arrest" || kind === "perforation" ? "bad" : "caution", kind === "perforation" ? { segId: this.tipSeg, mm: this.tipMm } : undefined)); // where it happened, so the picture can show the leak
    }
  }

  private checkForced(trigger: string, out: LabEvent[]) {
    for (const f of this.opts.forced ?? []) {
      if (f.trigger !== trigger || this.forcedFired.has(trigger)) continue;
      const eff = forcedEffect(f.complication, this.territorySeg());
      this.applyComplicationResult(eff, out, f.complication);
      if (f.once) this.forcedFired.add(trigger);
    }
  }

  private advanceTime(seconds: number, out: LabEvent[]) {
    if (seconds <= 0) return;
    const s = this.st;
    s.elapsedS += seconds;
    this.decayAct(seconds);

    if (s.access?.startsWith("femoral") && !this.accessClosed) {
      const rate = this.accessUltrasound ? 0.006 : 0.012;
      applyEffect(this.sim, { bloodLoss: rate * (seconds / 60) });
      if (!this.accessUltrasound) applyEffect(this.sim, { bloodLoss: 0.004 * (seconds / 1200) });
    }
    if (s.access?.startsWith("radial") && this.manualHold) {
      /* manual hold stops radial ooze */
    }

    if (this.tamponadeRate > 0 && !this.perforationSealed) {
      // an open perforation bleeds into the pericardium about 2.5 mL a second (150 mL a minute: a free perforation tamponades in a minute or two); the sac's own pressure-volume curve does the rest
      const before = Math.floor(this.effusion / 2);
      this.effusion += 2.5 * seconds;
      if (Math.floor(this.effusion / 2) !== before) this.sim.apply({ pericardium: { effusionMl: this.effusion, effusionRateMlMin: 0 } });
    }

    if (this.occlusions.length) {
      this.ischemiaSeconds += seconds;
      const ctx = baseRiskContext({
        territorySeg: this.occlusions[0].segId,
        ischemiaSeverity: 0.92,
        ischemiaSeconds: this.ischemiaSeconds,
      });
      const arrested = this.sim.arrest?.status === "arrest" || this.sim.dead || this.sim.rhythmClass().rhythmClass !== "perfusing";
      const vf = arrested || s.elapsedS - this.vfAt < 30 || this.ischemiaSeconds < 25 ? null : draw("arrhythmia-vf", ctx, this.rand, true); // sustained occlusion: VF after about 25 s, as before, not a per-frame dice roll
      if (vf) {
        this.vfAt = s.elapsedS;
        applyEffect(this.sim, vf);
        out.push(this.ev("arrest", "Ventricular fibrillation from sustained ischemia.", "bad"));
      }
    }

    this.sim.step(seconds);
    this.syncSim();
  }

  private riskFromAction(a: Action): Partial<import("./complications").RiskContext> {
    const territory = this.territorySeg();
    const pl = this.plaqueList.find((p) => p.segId === territory);
    const radial = !!this.st.access?.startsWith("radial");
    if (a.t === "inflate") {
      const b = this.st.balloon ? (byId[this.st.balloon.id] as Balloon) : null;
      return { pressureAtm: a.atm, ratedAtm: b?.ratedBurstAtm ?? 16, calcium: pl?.calcium ?? 0, territorySeg: territory, thrombus: pl?.thrombus ?? 0 };
    }
    if (a.t === "deploy") {
      const st = this.st.stent ? (byId[this.st.stent.id] as Stent) : null;
      const ref = pl?.referenceMm ?? 3;
      const oversize = st ? Math.max(0, st.nominalMm / ref - 1) : 0;
      return { pressureAtm: a.atm, ratedAtm: 16, calcium: pl?.calcium ?? 0, oversize, territorySeg: territory, thrombus: pl?.thrombus ?? 0 };
    }
    return { territorySeg: territory, thrombus: pl?.thrombus ?? 0, act: this.st.act, radial };
  }

  private rollComplications(a: Action, out: LabEvent[]) {
    const territory = this.territorySeg();
    const extra = this.riskFromAction(a);
    const ctx = baseRiskContext(extra);
    const checks: Complication[] = [];
    if (a.t === "inflate") checks.push("dissection", "no-reflow");
    if (a.t === "deploy") checks.push("no-reflow", "dissection");
    if (a.t === "advance" && this.active === "wire") checks.push("perforation");
    for (const c of checks) {
      const eff = draw(c, ctx, this.rand);
      this.applyComplicationResult(eff, out, c);
    }
  }

  private guideQuality(curve: GuideCatheter["curve"], target: "LM" | "RCA"): number {
    if (target === "LM" && !targetsLm.has(curve)) return 0;
    if (target === "RCA" && targetsLm.has(curve) && curve !== "JR4") return 0.4;
    const ideal = guideSweetMm[curve] ?? 35;
    return Math.max(0, Math.min(1, 1 - Math.abs(this.opts.access.aorticRootMm - ideal) / 18));
  }

  private arcAlongRoute(segId: string, mm: number): number {
    return routeArcTo(this.g, this.route, segId, mm);
  }

  private syncGuideState() {
    if (!this.st.guide) return;
    this.st.guide = { ...this.st.guide, tipSeg: this.tipSeg, tipMm: this.tipMm };
    if (this.st.sheath && this.st.access) {
      const root = this.route[0];
      const rootLen = this.g.byId[root]?.length ?? 0;
      const arc = this.arcAlongRoute(this.tipSeg, this.tipMm);
      this.st.sheath = { ...this.st.sheath, lengthMm: Math.min(arc, rootLen + 30) };
    }
  }

  private guideResistance(out: LabEvent[], prevSeg: string) {
    if (this.active !== "guide") return;
  const seg = this.g.byId[this.tipSeg];
    if (prevSeg !== this.tipSeg && seg) {
      if (seg.id.startsWith("ILIAC") && seg.calcification > 0.5) out.push(this.ev("resistance", "Calcified iliac: stiff push.", "caution"));
      if (seg.id === "RADIAL_R" && seg.tortuosity > 0.5) out.push(this.ev("resistance", "Radial loop resists the guide.", "caution"));
      if (seg.id === "ARCH" && this.opts.access.arch === "III") {
        out.push(this.ev("resistance", "Type III arch: support is limited.", "caution"));
        if (this.st.guide) this.st.guide = { ...this.st.guide, quality: Math.max(0, this.st.guide.quality * 0.85) };
      }
    }
  }

  private syncGuideEngagement(guide: GuideCatheter) {
    if (!this.st.guide) return;
    const asc = this.g.byId.AORTA_ASC;
    const atOstium = this.tipSeg === "LM" || this.tipSeg === "RCA"
      || (this.tipSeg === "AORTA_ASC" && this.tipMm >= asc.length * 0.85);
    if (!atOstium) {
      this.st.guide = { ...this.st.guide, engaged: null, quality: 0 };
      return;
    }
    const target: "LM" | "RCA" = targetsLm.has(guide.curve) ? "LM" : "RCA";
    // A right coronary guide must sit in the RCA (or at its ostium), not the LM.
    if (target === "RCA" && this.tipSeg === "LM") {
      this.st.guide = { ...this.st.guide, engaged: null, quality: 0 };
      return;
    }
    if (target === "LM" && this.tipSeg === "RCA") {
      this.st.guide = { ...this.st.guide, engaged: null, quality: 0 };
      return;
    }
    const q = this.guideQuality(guide.curve, target);
    if (target === "LM" && !targetsLm.has(guide.curve)) {
      this.st.guide = { ...this.st.guide, engaged: null, quality: q };
      return;
    }
    const engaged = q >= 0.45 ? target : null;
    // Park the guide at the ostium, not deep in the vessel (deep seating is a separate advance).
    if (engaged && (this.tipSeg === "LM" || this.tipSeg === "RCA")) {
      const ostial = Math.min(4, this.g.byId[this.tipSeg].length * 0.2);
      if (this.tipMm > ostial) this.tipMm = ostial;
    }
    this.st.guide = { ...this.st.guide, engaged, quality: q, tipSeg: this.tipSeg, tipMm: this.tipMm };
  }

  private moveActive(mm: number, out: LabEvent[]) {
    if (!this.active || !this.st.access) return;
    const prevSeg = this.tipSeg;
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
      this.guideResistance(out, prevSeg);
      const g = byId[this.st.guide.id] as GuideCatheter;
      this.syncGuideEngagement(g);
      this.syncGuideState();
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
        this.accessUltrasound = a.ultrasound ?? false;
        this.route = routeTo(this.g, a.site, "LM");
        this.tipSeg = this.route[0];
        this.tipMm = 0;
        this.sim.setRealtime(true);
        out.push(this.ev("access", `Access at the ${a.site}.`));
        break;
      case "sheath":
        s.sheathFr = a.french;
        if (s.access) s.sheath = { site: s.access, french: a.french, lengthMm: 0 };
        out.push(this.ev("sheath", `${a.french} French sheath in.`));
        break;
      case "close":
        this.accessClosed = true;
        this.manualHold = a.method === "manual";
        if (a.method === "closure-device") out.push(this.ev("closure", "Femoral closure device deployed."));
        else out.push(this.ev("closure", "Manual hold at the access site."));
        break;
      case "drug":
        if (a.id === "heparin") {
          s.act = Math.min(300, s.act + a.dose * LAB.actPerHeparinUnit);
          out.push(this.ev("drug", "Heparin given."));
        } else if (a.id === "protamine") {
          this.perforationSealed = true;
          this.tamponadeRate = 0;
          out.push(this.ev("drug", "Protamine given; perforation sealed."));
        } else if (a.id === "adenosine" || a.id === "nitro") {
          for (const k of Object.keys(this.bedResistance)) this.bedResistance[k] = 1 + (this.bedResistance[k] - 1) * 0.45;
          out.push(this.ev("drug", `${a.id} for microvascular recovery.`));
        } else {
          out.push(this.ev("drug", `Gave ${a.id}.`));
        }
        break;
      case "target": {
        const root = coronaryRoot(this.g, a.segId);
        if (s.guide?.engaged && s.guide.engaged !== root) {
          out.push(this.ev("bad-target", `The engaged guide is in the ${s.guide.engaged}; it cannot reach ${a.segId}.`, "caution"));
          break;
        }
        if (!this.g.byId[a.segId]) {
          out.push(this.ev("bad-target", `Unknown vessel ${a.segId}.`, "caution"));
          break;
        }
        s.targetSeg = a.segId;
        out.push(this.ev("target", `Treating ${a.segId}.`));
        break;
      }
      case "select":
        if (a.slot === "guide") {
          const g = byId[a.id] as GuideCatheter | undefined;
          if (!g || g.kind !== "guide") return [this.ev("no-device", "Unknown guide.", "bad")];
          this.active = "guide";
          const root = coronaryRoot(this.g, this.treatTarget());
          this.route = routeTo(this.g, this.site, root);
          this.tipSeg = this.route[0];
          this.tipMm = 0;
          s.guide = { id: a.id, engaged: null, quality: 0, tipSeg: this.tipSeg, tipMm: 0 };
          out.push(this.ev("guide", `Guide ${g.name} selected.`));
        } else if (a.slot === "wire") {
          if (!s.guide?.engaged) return [this.ev("no-guide", "Engage the guide before the wire.", "bad")];
          this.active = "wire";
          this.route = routeTo(this.g, this.site, this.treatTarget());
          const gtip = s.guide;
          this.tipSeg = gtip.tipSeg;
          this.tipMm = gtip.tipMm;
          if (!this.route.includes(this.tipSeg)) {
            this.tipSeg = s.guide.engaged ?? "LM";
            this.tipMm = this.g.byId[this.tipSeg].length * 0.92;
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
          if (r.event) {
            out.push(r.event);
            if (r.event.kind === "perforation") {
              this.applyComplicationResult(draw("perforation", baseRiskContext({ calcium: 0.5, tipLoad: w.tipLoadGf, territorySeg: this.territorySeg() }), this.rand, true), out, "perforation");
            }
          } else if (r.moved < Math.abs(a.mm) * 0.25 && a.mm > 2) {
            out.push(this.ev("resistance", "Heavy lesion resistance.", "caution"));
          }
          const pl = this.plaqueList.find((p) => p.segId === r.tipSeg && Math.abs(p.centerMm - r.tipMm) < p.lengthMm / 2 + 2);
          if (pl && a.mm > 0) {
            if (this.rand() < perforationRisk(w, pl)) {
              this.applyComplicationResult(draw("perforation", baseRiskContext({ tipLoad: w.tipLoadGf, calcium: pl.calcium, territorySeg: pl.segId, hydrophilic: w.coating === "hydrophilic" }), this.rand), out, "perforation");
            }
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
      case "autoAdvance": {
        if (!s.guide) return [this.ev("no-guide", "Select a guide first.", "bad")];
        this.active = "guide";
        this.route = routeTo(this.g, this.site, a.to === "RCA" ? "RCA" : "LM");
        const target = a.to === "ostium"
          ? { seg: this.g.ostium.LM.segId, mm: this.g.ostium.LM.mm }
          : a.to === "LM"
            ? { seg: "LM", mm: 0 }
            : { seg: "RCA", mm: 0 };
        const goal = this.arcAlongRoute(target.seg, target.mm);
        const step = 12;
        let guard = 0;
        while (this.arcAlongRoute(this.tipSeg, this.tipMm) + 0.5 < goal && guard++ < 500) {
          this.moveActive(step, out);
        }
        const gdev = byId[s.guide.id] as GuideCatheter;
        this.syncGuideEngagement(gdev);
        this.syncGuideState();
        break;
      }
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
        const rupture = r.events.some((e) => e.kind === "balloon-rupture");
        if (rupture) {
          s.balloon = { ...s.balloon, inflatedAtm: 0 };
          const ctx = baseRiskContext({ pressureAtm: a.atm, ratedAtm: b.ratedBurstAtm, calcium: 0.2, territorySeg: this.territorySeg() });
          this.applyComplicationResult(draw("dissection", ctx, this.rand, true), out, "dissection");
        } else if (a.atm > 0) {
          s.balloon = { ...s.balloon, inflatedAtm: a.atm, centerMm: this.tipMm, segId: this.tipSeg };
          const seg = this.g.byId[this.tipSeg];
          this.occlusions = [{
            segId: this.tipSeg, pos: this.tipMm / seg.length, ds: 0.99, occluded: true, lengthMm: b.lengthMm,
          }];
          this.ischemiaSeconds = 0;
        }
        if (a.atm > 0 && !rupture) this.advanceTime(a.seconds, out);
        else if (a.seconds > 0) this.advanceTime(a.seconds, out);
        this.rollComplications(a, out);
        break;
      }
      case "deflate":
        if (s.balloon) s.balloon = { ...s.balloon, inflatedAtm: 0 };
        this.occlusions = [];
        this.ischemiaSeconds = 0;
        this.syncSim();
        out.push(this.ev("deflate", "Balloon deflated."));
        if (s.balloon?.inflatedAtm === 0 && this.perforationSealed) this.tamponadeRate = 0;
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
            this.extraLiveLesions.push(ostialJailLesion(j.branchSeg, j.ostialDs));
          }
        }
        this.checkForced("post-stent", out);
        this.advanceTime(a.seconds, out);
        this.rollComplications(a, out);
        break;
      }
      default:
        break;
    }

    s.log = [...s.log, a];
    if (a.t !== "carm" && a.t !== "shape" && a.t !== "torque" && a.t !== "inflate" && a.t !== "deploy") {
      this.rollComplications(a, out);
    }
    if (a.t !== "carm" && a.t !== "shape" && a.t !== "torque") this.syncSim();
    return out;
  }
}
