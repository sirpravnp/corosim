import { coreColor } from "./glyphs";
import { alpha, blob, mito } from "./anatomy";
import { ClassId, Mover, P, Particle, Waypoint, rand } from "./paint";
import { ArteryScene, BodyScene, CapScene, GutScene, LOOPS, LiverScene, Scene, posOn } from "./scenes";
import { setTrial, trial } from "./trials";

/**
 * Follow the fat (or the cholesterol): one fatty acid from a meal to the breath, seen through the stage's own tissue views. The view hosts the
 * intestine, whole body, capillary bed and liver scenes in turn, lets them run with the model as usual, dims them a little and
 * draws the one molecule on top. Each step waits on the model: no LPL in FCS stalls the capillary step, lomitapide blocks MTP so
 * the liver keeps the fat, and so on. The cholesterol story follows one molecule from a meal through the chylomicron, its
 * remnant, the liver, VLDL and LDL, and ends in bile or, when LDL-C is high, in a foam cell in the artery wall.
 */

type Host = "gut" | "body" | "cap" | "liver" | "artery";
/** What our molecule is part of at the moment. */
type Form = "TG" | "FA" | "mic" | "CM" | "alb" | "VLDL" | "drop" | "ox" | "FC" | "CE" | "cmic" | "CMR" | "LDL" | "foam" | "bile";
const PCLS: Partial<Record<Form, ClassId>> = { CM: "CM", VLDL: "VLDL", CMR: "CMR", LDL: "LDL" };
interface Seg { loop: string; s0: number; s1: number }
interface Leg {
  host: Host; chap: number; text: string; form: Form;
  /** A scene detail to draw around the molecule on this leg. */
  id?: "lipase";
  pts?: Waypoint[]; segs?: Seg[];
}

const TAU = Math.PI * 2;
const ROUTE = ["Meal", "Enterocyte", "Lymph and blood", "Fat cell", "Liver", "Muscle"];
const ROUTE_C = ["Meal", "Enterocyte", "Remnant", "Liver", "LDL", "Way out"];
const TAG: Record<Form, string> = {
  TG: "our fatty acid, in a triglyceride", FA: "our fatty acid", mic: "our fatty acid, in a micelle", CM: "inside a chylomicron",
  alb: "our fatty acid, on albumin", VLDL: "inside VLDL", drop: "stored, in the droplet", ox: "β-oxidation",
  FC: "our cholesterol", CE: "our cholesterol, as an ester", cmic: "our cholesterol, in a micelle", CMR: "inside a remnant",
  LDL: "inside LDL", foam: "in a foam cell", bile: "our cholesterol, in bile",
};
/** The trail's names for each form. */
export const FORM_NAME: Record<Form, string> = {
  TG: "triglyceride", FA: "fatty acid", mic: "micelle", CM: "chylomicron", alb: "on albumin", VLDL: "VLDL", drop: "triglyceride", ox: "CO₂",
  FC: "cholesterol", CE: "cholesteryl ester", cmic: "micelle", CMR: "remnant", LDL: "LDL", foam: "foam cell", bile: "bile",
};

/** Cholesterol: four fused rings (three six-membered, one five), the 3-hydroxyl on ring A and the side chain off ring D. */
function sterol(x: number, y: number, k: number, color: string, lw = 1.5) {
  const c = P.ctx, r = 3.4 * k, s3 = Math.sqrt(3);
  const hex = (cx: number, cy: number) => { c.beginPath(); for (let i = 0; i <= 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } c.stroke(); };
  c.save(); c.strokeStyle = color; c.lineWidth = lw; c.lineJoin = "round";
  hex(x, y); hex(x + s3 * r, y); hex(x + 1.5 * s3 * r, y - 1.5 * r);
  const dx = x + 1.5 * s3 * r + s3 * r * 0.92, dy = y - 1.5 * r; c.beginPath(); for (let i = 0; i <= 5; i++) { const a = Math.PI + (i * 2 * Math.PI) / 5; c.lineTo(dx + Math.cos(a) * r * 0.86, dy + Math.sin(a) * r * 0.86); } c.stroke();
  c.beginPath(); c.moveTo(dx + r * 0.7, dy - r * 0.5); for (let i = 1; i <= 4; i++) c.lineTo(dx + r * 0.7 + i * r * 0.85, dy - r * 0.5 + (i % 2 ? -r * 0.5 : 0)); c.stroke();
  c.lineWidth = 1; c.beginPath(); c.arc(x - r * 1.35, y + r * 0.5, r * 0.32, 0, TAU); c.stroke();
  c.restore();
}

/** A saturated chain drawn as a zigzag of n carbons from (x, y) along angle a, with its carboxyl head at the start. */
function chain(x: number, y: number, a: number, n: number, bl: number, color: string, lw: number, head = true) {
  const c = P.ctx, ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
  c.save(); c.strokeStyle = color; c.lineWidth = lw; c.lineJoin = "round"; c.lineCap = "round"; c.beginPath();
  for (let i = 0; i < n; i++) { const u = i * bl * 0.87, v = i % 2 ? bl * 0.5 : 0; const X = x + ca * u + px * v, Y = y + sa * u + py * v; if (i) c.lineTo(X, Y); else c.moveTo(X, Y); }
  c.stroke();
  if (head) { c.lineWidth = 1; c.beginPath(); c.arc(x - ca * bl * 0.7, y - sa * bl * 0.7, bl * 0.55, 0, TAU); c.stroke(); }
  c.restore();
}
/** A triglyceride: glycerol backbone with three chains; ours (the top one) in the thermal ramp's hot end. */
function triglyceride(x: number, y: number, k: number, ours = true, others = true, color = coreColor(0.95)) {
  const c = P.ctx, s = 6 * k, bl = 3 * k;
  c.save(); c.strokeStyle = P.muted; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y - s); c.lineTo(x, y + s); c.stroke(); c.restore();
  for (const i of [-1, 0, 1]) { P.dot(x, y + i * s, 1.6 * Math.max(0.8, k * 0.6), P.muted); if (i === -1 ? !ours : !others) continue; chain(x + bl, y + i * s, 0, 16, bl, i === -1 ? color : P.muted, i === -1 ? 1.9 : 1.1, false); }
}

class FollowScene implements Scene {
  id = "follow"; name = "Follow the fat";
  note = "";
  story: "fat" | "chol" = "fat";
  get caption() {
    return this.story === "fat"
      ? "Figure 1. Follow the fat: one fatty acid from a meal to the breath, through this stage's own views. Each step waits on the model, so LPL, MTP and the drugs set how long it takes and where it goes."
      : "Figure 1. Follow the cholesterol: one molecule from a meal through a chylomicron, the liver, VLDL and LDL, to bile or, when LDL-C is high, the artery wall. NPC1L1, LPL, MTP and LDLR set the pace.";
  }
  get key() { return this.story === "fat" ? ["FA", "TG", "micelle", "MTP", "CM", "LPL", "VLDL", "droplet"] : ["FC", "micelle", "NPC1L1", "CM", "CMR", "LRP1", "VLDL", "LDL", "LDLR", "ABCG58"]; }
  get route() { return this.story === "fat" ? ROUTE : ROUTE_C; }
  opts() {
    return [{ id: "fat", label: "Fat", on: this.story === "fat", group: "story" }, { id: "chol", label: "Cholesterol", on: this.story === "chol", group: "story" },
      { id: "camera", label: "Camera", on: trial("camera") }, { id: "thermo", label: "Thermogram", on: trial("thermo") }];
  }
  setOpt(id: string) {
    if (id === "fat" || id === "chol") { if (this.story !== id) { this.story = id; this.start(0); } }
    else if (id === "camera" || id === "thermo") setTrial(id);
  }
  hosts = { gut: Object.assign(new GutScene(), { story: true }), body: new BodyScene(), cap: new CapScene(), liver: new LiverScene(), artery: new ArteryScene() };
  host: Host = "gut"; legs: Leg[] = []; li = 0; leg!: Leg; m!: Mover; t = 0;
  /** Distance traveled along the body route. */
  bs = 0; x = 0; y = 0; ang = 0; n = 16; lpl = 0;
  particle?: Particle; side: "fat" | "muscle" = "fat";
  bits: { x: number; y: number; vx: number; vy: number; t: number; co2: boolean }[] = [];
  /** The camera (trial feature): zoom and center, eased; a fade covers the cut between views; the trail of forms so far. */
  cam = { z: 1, x: 0, y: 0 }; fade = 0; total = 1; trail: Form[] = [];

  init() { this.start(0); }
  /** Jump to the first leg of a route chapter. */
  jump(chap: number) { const i = this.plan().findIndex((l) => l.chap === chap); this.start(Math.max(0, i)); }
  at() { return this.leg?.chap ?? 0; }
  live() { return this.leg?.text ?? ""; }
  mini(): { hi: string | null; dot: [number, number] } | null {
    if (this.host === "body") return null;
    const dot: Record<Exclude<Host, "body">, [number, number]> = { gut: [0.535, 0.85], cap: this.side === "fat" ? [0.12, 0.31] : [0.87, 0.31], liver: [0.34, 0.55], artery: [0.566, 0.5] };
    return { hi: this.host, dot: dot[this.host] };
  }

  start(i: number) {
    this.legs = this.plan(); this.li = i; this.bits = []; this.n = 16; this.particle = undefined; this.trail = [];
    for (const h of Object.values(this.hosts)) h.init();
    this.begin();
  }
  private warmHost() { const h = this.hosts[this.host]; h.init(); for (let k = 0; k < 45; k++) h.step(1 / 30); }
  private begin() {
    this.legs = this.plan();
    if (!this.legs[this.li]) { this.start(0); return; } this.leg = this.legs[this.li]; this.t = 0;
    if (this.leg.host !== this.host) { this.host = this.leg.host; this.warmHost(); this.fade = 0.45; this.cam.z = 0; }
    const shown = this.leg.form;
    if (FORM_NAME[this.trail[this.trail.length - 1]] !== FORM_NAME[shown]) this.trail.push(shown);
    const cls = PCLS[this.leg.form];
    if (cls) { if (this.particle?.c0 !== cls) this.particle = P.particle(cls, this.x, this.y); }
    else this.particle = undefined;
    if (this.leg.segs) this.bs = 0;
    else this.m = P.mover(this.x, this.y, this.leg.pts ?? [{ x: this.x, y: this.y, d: 1 }]);
  }
  private next() { this.li++; this.begin(); }

  /**
   * The journey, rebuilt at each leg from the current geometry and model, so a drug turned on part way changes what is left of it.
   * Positions come from the host views' own layouts.
   */
  private plan(): Leg[] { return this.story === "fat" ? this.planFat() : this.planChol(); }
  private planFat(): Leg[] {
    const { W, H } = P, s = P.snap, lomi = P.has("lomi"), Ln = Math.max(0.05, s.lipolysis), fcs = P.model.geno === "fcs";
    const gut = this.hosts.gut, gg = gut.geo(), cx = gut.cells(), cw = W / 6;
    const cap = this.hosts.cap, cg = cap.geo(), liv = this.hosts.liver, lg = liv.geo();
    const lpls = cap.lpls(), lplFat = lpls.reduce((a, b) => (Math.abs(b.x - W * 0.3) < Math.abs(a.x - W * 0.3) ? b : a)).x;
    const lplMus = lpls.reduce((a, b) => (Math.abs(b.x - W * 0.72) < Math.abs(a.x - W * 0.72) ? b : a)).x;
    const fat = cap.fat.length ? cap.fat.reduce((a, b) => (Math.abs(b.cx - lplFat) + Math.abs(b.cy - H * 0.62) < Math.abs(a.cx - lplFat) + Math.abs(a.cy - H * 0.62) ? b : a)) : { cx: W * 0.25, cy: H * 0.7 };
    const lplWait = Math.min(14, 1.4 / Math.min(2, Ln)), mtpWait = lomi ? 4 : 1.2;
    const cell = cx[2], mid = (cg.t + cg.b) / 2, dock = cg.b - 28, mus = { x: W * 0.76, y: cg.tis + (H - cg.tis) * 0.5 };
    const gx = (x: number) => liv.gapNear(x), drop = { x: W * 0.13, y: H * 0.6 }, lm = { x: W * 0.17, y: H * 0.66 };
    const vx = W * 0.24;
    const L: Leg[] = [
      { host: "gut", chap: 0, form: "TG", text: "Our fatty acid starts in a triglyceride from a meal: three fatty acids on a glycerol backbone. Bile salts break the fat into fine droplets in the lumen.",
        pts: [{ x: -30, y: gg.lum * 0.55, d: 0.01 }, { x: W * 0.28, y: gg.lum * 0.55, d: 3.2 }, { x: W * 0.28, y: gg.lum * 0.55, d: 1.2 }] },
      { host: "gut", chap: 0, form: "FA", id: "lipase", text: "Pancreatic lipase cuts the two outer fatty acids off the glycerol. Ours is now a free fatty acid, beside a monoglyceride.",
        pts: [{ x: W * 0.31, y: gg.lum * 0.4, d: 1.6 }, { x: W * 0.31, y: gg.lum * 0.4, d: 1.0 }] },
      { host: "gut", chap: 0, form: "mic", text: "It joins a bile micelle with cholesterol and other fatty acids, and drifts to the brush border.",
        pts: [{ x: cell - 8, y: gg.lum - 12, d: 2.6 }] },
      { host: "gut", chap: 1, form: "FA", text: "At the microvilli it leaves the micelle and crosses the membrane into an enterocyte, then moves to the smooth ER.",
        pts: [{ x: cell - 4, y: gg.bb + 6, d: 1.0 }, { x: cell - cw * 0.12, y: H * 0.33, d: 1.4 }] },
      { host: "gut", chap: 1, form: "TG", text: lomi ? "The ER puts it back on a glycerol: a triglyceride again. MTP should now load it onto ApoB-48, but lomitapide blocks MTP, so loading is slow." : "The ER puts it back on a glycerol: a triglyceride again. MTP loads it onto ApoB-48, the protein of the chylomicron.",
        pts: [{ x: cell - cw * 0.12, y: H * 0.33, d: 1.2 }, { x: cell + 18, y: H * 0.37, d: 1.0 }, { x: cell + 18, y: H * 0.37, d: mtpWait }] },
      { host: "gut", chap: 1, form: "CM", text: "In the Golgi the particle is finished: a chylomicron, about 90% triglyceride. It leaves the base of the cell for the lacteal; it is too big for a blood capillary.",
        pts: [{ x: cell, y: H * 0.46, d: 1.2 }, { x: cell + 6, y: gg.bas - 12, d: 1.4 }, { x: cell + 10, y: gg.bas + 22, d: 0.9 }, { x: cell + 14, y: gg.lac + 18, d: 0.9 }, { x: W + 40, y: (gg.lac + gg.lacB) / 2, d: 4 }] },
      { host: "body", chap: 2, form: "CM", text: "By lymph up the thoracic duct into the left subclavian vein, through the heart and out the arteries. On this first pass it skips the liver.",
        segs: [{ loop: "lymph", s0: 0, s1: 99 }, { loop: "adip", s0: 0, s1: 3 }] },
      { host: "cap", chap: 3, form: "CM", text: fcs ? "In a capillary in fat it reaches LPL. In FCS there is almost no working LPL, so it waits a long time: chylomicrons stay in the blood for hours, and fasting triglyceride climbs past 1,000." : "In a capillary in fat it docks on LPL, which GPIHBP1 holds on the endothelium. ApoC-II on the chylomicron switches LPL on.",
        pts: [{ x: -30, y: mid, d: 0.01 }, { x: lplFat - 60, y: mid, d: 2.2 }, { x: lplFat, y: dock, d: 1.2 }, { x: lplFat, y: dock, d: lplWait }] },
      { host: "cap", chap: 3, form: "FA", text: "LPL cuts our fatty acid free. It crosses the endothelium and the interstitium into a fat cell.",
        pts: [{ x: lplFat, y: cg.b + 4, d: 0.8 }, { x: lplFat + 6, y: cg.b + 18, d: 0.6 }, { x: fat.cx, y: fat.cy, d: 2.2 }] },
      { host: "cap", chap: 3, form: "drop", text: "The fat cell puts it on a glycerol once more and stores it in its one large droplet. It can stay there for months.",
        pts: [{ x: fat.cx, y: fat.cy, d: 3.4 }] },
      { host: "cap", chap: 3, form: "alb", text: "During a fast, ATGL and hormone-sensitive lipase free it again. Fatty acids do not dissolve in plasma, so albumin carries it away.",
        pts: [{ x: fat.cx + 10, y: cg.tis + 6, d: 1.8 }, { x: fat.cx + 20, y: cg.b + 12, d: 1.0 }, { x: fat.cx + 26, y: mid, d: 0.8 }, { x: W + 40, y: mid, d: 3.0 }] },
      { host: "body", chap: 4, form: "alb", text: "On albumin it goes back to the heart and on to the liver.",
        segs: [{ loop: "adip", s0: 6, s1: 99 }, { loop: "gut", s0: 0, s1: 7 }] },
      { host: "liver", chap: 4, form: "alb", text: "In a liver sinusoid it leaves albumin, passes a fenestra into the space of Disse and enters a hepatocyte.",
        pts: [{ x: -30, y: (lg.sT + lg.sB) / 2, d: 0.01 }, { x: gx(W * 0.2) - 40, y: (lg.sT + lg.sB) / 2, d: 2.0 }, { x: gx(W * 0.2), y: lg.sB + 4, d: 1.0 }] },
      ...(lomi ? [
        { host: "liver", chap: 4, form: "drop", text: "The liver makes it into triglyceride, but lomitapide blocks MTP, so it cannot leave as VLDL. It is stored in a lipid droplet: this is how lomitapide causes fatty liver.",
          pts: [{ x: gx(W * 0.2), y: lg.mem + 10, d: 1.0 }, { x: lg.er.x + W * 0.075, y: lg.er.y, d: 1.4 }, { x: lg.er.x + W * 0.075, y: lg.er.y, d: 1.4 }, { x: drop.x, y: drop.y, d: 1.4 }, { x: drop.x, y: drop.y, d: 2.6 }] },
        { host: "liver", chap: 4, form: "ox", text: "In the end the hepatocyte burns it in its own mitochondria, two carbons at a time.",
          pts: [{ x: lm.x, y: lm.y, d: 1.2 }, { x: lm.x, y: lm.y, d: 6.8 }] },
      ] as Leg[] : [
        { host: "liver", chap: 4, form: "TG", text: "The liver puts it on a glycerol again, and MTP loads the triglyceride onto ApoB-100 in the ER.",
          pts: [{ x: gx(W * 0.2), y: lg.mem + 10, d: 1.0 }, { x: lg.er.x + W * 0.075, y: lg.er.y, d: 1.4 }, { x: lg.er.x + W * 0.075, y: lg.er.y, d: 1.6 }] },
        { host: "liver", chap: 4, form: "VLDL", text: "The Golgi finishes a VLDL particle around it, and the hepatocyte secretes it back into the sinusoid.",
          pts: [{ x: lg.golgi.x, y: lg.golgi.y, d: 1.2 }, { x: lg.golgi.x, y: lg.golgi.y, d: 0.8 }, { x: vx, y: lg.mem + 10, d: 1.0 }, { x: vx, y: lg.mem - 12, d: 0.5 }, { x: gx(vx), y: lg.sB + 2, d: 0.6 }, { x: gx(vx) + 10, y: lg.sB - 16, d: 0.5 }, { x: W + 40, y: (lg.sT + lg.sB) / 2, d: 4 }] },
        { host: "body", chap: 5, form: "VLDL", text: "VLDL leaves by the hepatic vein, passes the heart and reaches a capillary in muscle.",
          segs: [{ loop: "gut", s0: 10, s1: 99 }, { loop: "musc", s0: 0, s1: 3 }] },
        { host: "cap", chap: 5, form: "VLDL", text: fcs ? "LPL in muscle is missing too in FCS; the VLDL waits a long time." : "In the muscle capillary, LPL takes triglyceride from the VLDL.",
          pts: [{ x: -30, y: mid, d: 0.01 }, { x: lplMus - 60, y: mid, d: 3.2 }, { x: lplMus, y: dock, d: 1.2 }, { x: lplMus, y: dock, d: lplWait }] },
        { host: "cap", chap: 5, form: "FA", text: "Our fatty acid is cut free and crosses into the muscle fiber. The carnitine shuttle carries it into a mitochondrion.",
          pts: [{ x: lplMus, y: cg.b + 4, d: 0.8 }, { x: lplMus + 4, y: cg.b + 18, d: 0.6 }, { x: mus.x, y: mus.y, d: 2.2 }] },
        { host: "cap", chap: 5, form: "ox", text: "β-oxidation clips it two carbons at a time: eight acetyl-CoA, burned in the citric acid cycle to CO₂ and ATP. Its carbons leave in the breath.",
          pts: [{ x: mus.x, y: mus.y, d: 8.2 }] },
      ] as Leg[]),
    ];
    return L;
  }

  /** One cholesterol molecule: the same views, with the steps that move cholesterol (NPC1L1, ACAT2, LRP1, LDLR, ABCG5/G8). */
  private planChol(): Leg[] {
    const { W, H } = P, s = P.snap, eze = P.has("eze"), lomi = P.has("lomi"), Ln = Math.max(0.05, s.lipolysis), fcs = P.model.geno === "fcs";
    const gut = this.hosts.gut, gg = gut.geo(), cx = gut.cells(), cw = W / 6, cell = cx[2];
    const cap = this.hosts.cap, cg = cap.geo(), liv = this.hosts.liver, lg = liv.geo(), art = this.hosts.artery, ag = art.geo(), mac = art.mac();
    const lpls = cap.lpls(), near = (x: number) => lpls.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a)).x, lplFat = near(W * 0.3), lplMus = near(W * 0.72);
    const lplWait = Math.min(14, 1.4 / Math.min(2, Ln)), mtpWait = lomi ? 4 : 1.2, mid = (cg.t + cg.b) / 2, dock = cg.b - 28;
    const gx = (x: number) => liv.gapNear(x), sin = (lg.sT + lg.sB) / 2, er = { x: lg.er.x + W * 0.075, y: lg.er.y };
    const lrp = liv.slots.filter((q) => q.type === "LRP1").reduce((a, b) => (Math.abs(b.x - W * 0.3) < Math.abs(a.x - W * 0.3) ? b : a), liv.slots[0]);
    const vis = liv.visible(), ldlr = vis.length ? vis.reduce((a, b) => (Math.abs(b.x - W * 0.45) < Math.abs(a.x - W * 0.45) ? b : a)) : null;
    const o1 = liv.organelles(lrp.x), o2 = liv.organelles(ldlr?.x ?? W * 0.45), high = s.ldl >= 130;
    const ldlrWait = ldlr ? Math.min(10, 1.2 / Math.max(0.12, s.uptake)) : 10, vx = W * 0.24;
    const L: Leg[] = [
      { host: "gut", chap: 0, form: "cmic", text: eze ? "Our cholesterol molecule comes from a meal or from bile, carried in a micelle to the brush border. Ezetimibe blocks NPC1L1 here, so most cholesterol never gets in; ours waits." : "Our cholesterol molecule comes from a meal or from bile. Bile salts carry it in a micelle to the brush border.",
        pts: [{ x: -30, y: gg.lum * 0.5, d: 0.01 }, { x: cell - 8, y: gg.lum - 12, d: 3.0 }, { x: cell - 8, y: gg.lum - 12, d: eze ? 4 : 0.8 }] },
      { host: "gut", chap: 1, form: "FC", text: "NPC1L1 at the brush border takes it into the enterocyte. ABCG5/G8 pumps some cholesterol, and nearly all plant sterol, straight back out.",
        pts: [{ x: cell, y: gg.bb + 6, d: 1.0 }, { x: cell - cw * 0.12, y: H * 0.33, d: 1.4 }] },
      { host: "gut", chap: 1, form: "CE", text: "In the ER, ACAT2 joins it to a fatty acid: a cholesteryl ester, the form lipoprotein cores carry. MTP packs it with triglyceride onto ApoB-48.",
        pts: [{ x: cell - cw * 0.12, y: H * 0.33, d: 1.4 }, { x: cell + 18, y: H * 0.37, d: 1.0 }, { x: cell + 18, y: H * 0.37, d: mtpWait }] },
      { host: "gut", chap: 1, form: "CM", text: "It leaves inside a chylomicron, through the base of the cell into the lacteal.",
        pts: [{ x: cell, y: H * 0.46, d: 1.2 }, { x: cell + 6, y: gg.bas - 12, d: 1.4 }, { x: cell + 10, y: gg.bas + 22, d: 0.9 }, { x: cell + 14, y: gg.lac + 18, d: 0.9 }, { x: W + 40, y: (gg.lac + gg.lacB) / 2, d: 4 }] },
      { host: "body", chap: 1, form: "CM", text: "Up the thoracic duct, into the blood, and out to a capillary bed.", segs: [{ loop: "lymph", s0: 0, s1: 99 }, { loop: "adip", s0: 0, s1: 3 }] },
      { host: "cap", chap: 2, form: "CM", text: fcs ? "LPL should strip the chylomicron's triglyceride here; in FCS there is almost none, so it waits." : "LPL strips the triglyceride for the tissue. The cholesteryl ester is not touched: it stays aboard.",
        pts: [{ x: -30, y: mid, d: 0.01 }, { x: lplFat - 60, y: mid, d: 2.2 }, { x: lplFat, y: dock, d: 1.2 }, { x: lplFat, y: dock, d: lplWait }] },
      { host: "cap", chap: 2, form: "CMR", text: "What is left is a chylomicron remnant: smaller, richer in cholesterol, and carrying ApoE.",
        pts: [{ x: lplFat + 20, y: mid, d: 1.0 }, { x: W + 40, y: mid, d: 3.0 }] },
      { host: "body", chap: 2, form: "CMR", text: "Remnants are cleared by the liver within minutes.", segs: [{ loop: "adip", s0: 6, s1: 99 }, { loop: "gut", s0: 0, s1: 7 }] },
      { host: "liver", chap: 3, form: "CMR", text: "ApoE on the remnant binds LRP1 on the hepatocyte's microvilli, and the particle is taken in.",
        pts: [{ x: -30, y: sin, d: 0.01 }, { x: gx(lrp.x) - 40, y: sin, d: 2.0 }, { x: gx(lrp.x), y: lg.sB + 4, d: 1.0 }, { x: lrp.x, y: lg.rec - 14, d: 0.8 }, { x: lrp.x, y: lg.rec - 14, d: 0.8 }, { x: o1.endo.x, y: o1.endo.y, d: 1.2 }] },
      { host: "liver", chap: 3, form: "FC", text: "In the lysosome the ester is cut, and free cholesterol joins the cell's pool. A full pool turns SREBP-2 down, so the cell makes fewer LDLR.",
        pts: [{ x: o1.lyso.x, y: o1.lyso.y, d: 1.0 }, { x: o1.lyso.x, y: o1.lyso.y, d: 1.2 }, { x: er.x, y: er.y, d: 1.6 }] },
      { host: "liver", chap: 3, form: "CE", text: lomi ? "ACAT2 esterifies it again; MTP should pack it into VLDL, but lomitapide blocks MTP, so it waits." : "ACAT2 esterifies it again, and MTP packs it with triglyceride into VLDL.",
        pts: [{ x: er.x, y: er.y, d: mtpWait + 0.6 }, { x: lg.golgi.x, y: lg.golgi.y, d: 1.2 }] },
      { host: "liver", chap: 3, form: "VLDL", text: "The hepatocyte secretes the VLDL into the sinusoid.",
        pts: [{ x: lg.golgi.x, y: lg.golgi.y, d: 0.6 }, { x: vx, y: lg.mem + 10, d: 1.0 }, { x: vx, y: lg.mem - 12, d: 0.5 }, { x: gx(vx), y: lg.sB + 2, d: 0.6 }, { x: gx(vx) + 10, y: lg.sB - 16, d: 0.5 }, { x: W + 40, y: sin, d: 4 }] },
      { host: "body", chap: 4, form: "VLDL", text: "Out by the hepatic veins, through the heart, to a capillary in muscle.", segs: [{ loop: "gut", s0: 10, s1: 99 }, { loop: "musc", s0: 0, s1: 3 }] },
      { host: "cap", chap: 4, form: "VLDL", text: "LPL takes triglyceride from the VLDL, which shrinks to IDL.",
        pts: [{ x: -30, y: mid, d: 0.01 }, { x: lplMus - 60, y: mid, d: 3.0 }, { x: lplMus, y: dock, d: 1.2 }, { x: lplMus, y: dock, d: lplWait }] },
      { host: "cap", chap: 4, form: "LDL", text: "Hepatic lipase trims the rest. What is left is LDL: a core of cholesteryl ester on one ApoB-100, with ours inside.",
        pts: [{ x: lplMus + 16, y: mid, d: 1.0 }, { x: W + 40, y: mid, d: 3.0 }] },
      { host: "body", chap: 4, form: "LDL", text: high ? `LDL circulates for days. With LDL-C at ${Math.round(s.ldl)} mg/dL, more of it gets into the artery wall.` : "LDL circulates for two to three days before a receptor takes it.",
        segs: [{ loop: "musc", s0: 6, s1: 99 }, high ? { loop: "gut", s0: 0, s1: 2 } : { loop: "gut", s0: 0, s1: 7 }] },
      ...(high ? [
        { host: "artery", chap: 5, form: "LDL", text: "High LDL-C pushes more LDL across the endothelium; proteoglycans in the intima hold it, and it is oxidized there.",
          pts: [{ x: -30, y: (ag.t + ag.e) / 2, d: 0.01 }, { x: W * 0.32, y: (ag.t + ag.e) / 2, d: 2.2 }, { x: W * 0.36, y: ag.e + 12, d: 1.0 }, { x: W * 0.42, y: (ag.e + ag.iel) / 2, d: 1.4 }, { x: W * 0.42, y: (ag.e + ag.iel) / 2, d: 2.2 }] },
        { host: "artery", chap: 5, form: "foam", text: "A macrophage's scavenger receptor takes the oxidized LDL. Our cholesterol ends up in an ester droplet in a foam cell, the start of a plaque; HDL can carry some of it back to the liver.",
          pts: [{ x: mac.x, y: mac.y, d: 1.8 }, { x: mac.x, y: mac.y, d: 5 }] },
      ] as Leg[] : [
        { host: "liver", chap: 5, form: "LDL", text: ldlr ? `Back at the liver, ApoB-100 docks on LDLR. How soon depends on how many receptors there are: here ${s.receptors.toFixed(1)}× normal.` : "With no working LDLR, LDL has almost nowhere to dock: this is why LDL-C is so high in homozygous FH.",
          pts: [{ x: -30, y: sin, d: 0.01 }, { x: gx(ldlr?.x ?? W * 0.45) - 40, y: sin, d: 2.0 }, { x: gx(ldlr?.x ?? W * 0.45), y: lg.sB + 4, d: 1.0 }, { x: ldlr?.x ?? W * 0.45, y: lg.rec - 14, d: 0.8 }, { x: ldlr?.x ?? W * 0.45, y: lg.rec - 14, d: ldlrWait }, { x: o2.endo.x, y: o2.endo.y, d: 1.2 }] },
        { host: "liver", chap: 5, form: "FC", text: "Freed in the lysosome, it crosses the cell to the bile canaliculus, and ABCG5/G8 pumps it out.",
          pts: [{ x: o2.lyso.x, y: o2.lyso.y, d: 1.0 }, { x: o2.lyso.x, y: o2.lyso.y, d: 1.0 }, { x: lg.canal.x - 20, y: lg.canal.y, d: 1.6 }] },
        { host: "liver", chap: 5, form: "bile", text: "In bile it goes back to the gut. About half is absorbed again; the rest, the body's main way out for cholesterol, leaves in stool.",
          pts: [{ x: lg.canal.x, y: lg.canal.y, d: 0.8 }, { x: lg.canal.x, y: lg.canal.y, d: 4 }] },
      ] as Leg[]),
    ];
    return L;
  }

  step(dt: number) {
    const h = this.hosts[this.host]; h.step(dt); this.t += dt;
    if (this.host === "cap") this.side = (this.story === "fat" ? this.leg.chap === 5 : this.leg.chap === 4) ? "muscle" : "fat";
    if (this.leg.segs) {
      const segs = this.leg.segs.map((g) => { const L = LOOPS[g.loop], a = L.cum[Math.min(g.s0, L.cum.length - 1)], b = g.s1 >= L.cum.length - 1 ? L.len : L.cum[g.s1]; return { L, a, b }; });
      const total = segs.reduce((q, g) => q + (g.b - g.a), 0); this.total = total;
      this.bs += P.W * 0.16 * dt;
      if (this.bs >= total) { this.next(); return; }
      let d = this.bs; for (const g of segs) { if (d <= g.b - g.a) { const q = posOn(g.L, g.a + d); this.x = q.x; this.y = q.y; break; } d -= g.b - g.a; }
    } else {
      P.stepMover(this.m, dt); this.x = this.m.x; this.y = this.m.y;
      if (this.leg.form === "ox") {
        const tot = this.m.pts.reduce((q, w) => q + w.d, 0), start = this.m.pts.length > 1 ? this.m.pts[0].d : 0.6;
        const k = Math.max(0, Math.min(7, Math.floor(((this.t - start) / (tot - start - 1.2)) * 8)));
        while (16 - 2 * k < this.n) { this.n -= 2; this.bits.push({ x: this.x + 30, y: this.y, vx: rand(-12, 12), vy: rand(-26, -14), t: 0, co2: false }); }
      }
      if (this.m.done) {
        if (!this.legs[this.li + 1]) { this.start(0); return; }
        this.next();
      }
    }
    for (const b of this.bits) { b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt; if (b.t > 1.2) b.co2 = true; }
    this.fade = Math.max(0, this.fade - dt);
    // the camera: close on the molecule inside a tissue, pulled back to travel on the whole body, closing in again on arrival
    let z = 1;
    if (this.host !== "body") z = 1.7;
    else { const p = this.bs / Math.max(1, this.total); z = p < 0.15 ? 2.4 - (1.4 * p) / 0.15 : p > 0.8 ? 1 + (1.6 * (p - 0.8)) / 0.2 : 1; }
    if (this.cam.z === 0) this.cam = { z, x: this.x, y: this.y };
    const k = Math.min(1, dt * 3); this.cam.z += (z - this.cam.z) * k; this.cam.x += (this.x - this.cam.x) * k; this.cam.y += (this.y - this.cam.y) * k;
    this.bits = this.bits.filter((b) => b.t < 4);
  }

  draw(dt: number) {
    const c = P.ctx, h = this.hosts[this.host], { W, H } = P, cam = trial("camera");
    const z = cam ? Math.max(1, this.cam.z) : 1, cx = Math.max(W / (2 * z), Math.min(W - W / (2 * z), this.cam.x)), cy = Math.max(H / (2 * z), Math.min(H - H / (2 * z), this.cam.y));
    const sx = (x: number) => (x - cx) * z + W / 2, sy = (y: number) => (y - cy) * z + H / 2, h0 = P.hits.length;
    c.save(); if (cam) { c.translate(W / 2, H / 2); c.scale(z, z); c.translate(-cx, -cy); }
    h.draw(dt);
    // a light veil so the one molecule reads first; the host's own labels and particles stay visible underneath
    alpha(cam ? 0.22 : 0.3, () => { c.fillStyle = P.stage; c.fillRect(-W, -H, W * 3, H * 3); });
    if (this.leg.form === "ox") {
      const mx = this.x, my = this.y; c.save(); c.translate(mx, my); c.scale(2.2, 2.2); mito(0, 0, 34, 12, 0.15); c.restore();
      P.mono("mitochondrion", mx, my + 34, { a: "center" });
    }
    this.drawUs();
    for (const b of this.bits) {
      if (b.co2) { alpha(Math.max(0, 1 - (b.t - 1.2) / 2.8), () => { c.strokeStyle = P.ink; c.lineWidth = 1; c.beginPath(); c.arc(b.x, b.y, 2.6, 0, TAU); c.stroke(); }); if (b.t < 2.4) P.mono("CO₂", b.x + 6, b.y + 3, { s: 9.5 }); }
      else { chain(b.x, b.y, 0, 2, 4, coreColor(0.95), 1.6, false); if (b.t < 1) P.mono("acetyl-CoA", b.x + 8, b.y + 3, { s: 9.5 }); }
    }
    c.restore();
    // hover names follow the camera; the marker and its tag are drawn at screen size
    if (cam) for (let i = h0; i < P.hits.length; i++) { const t = P.hits[i]; t.x = sx(t.x); t.y = sy(t.y); t.r *= z; }
    this.drawMarker(cam ? sx(this.x) : this.x, cam ? sy(this.y) : this.y, this.r * (cam ? z : 1));
    if (cam) {
      if (this.fade > 0) alpha(this.fade / 0.45, () => { c.fillStyle = P.stage; c.fillRect(0, 0, W, H); });
      // the trail of forms: what our fatty acid has been part of, so far
      const names = FORM_NAME;
      // the most recent forms that fit beside the inset map; older ones fold into an ellipsis
      c.font = `11px "JetBrains Mono", ui-monospace, monospace`;
      const room = W - Math.min(118, W * 0.2) - 40, wid = (t: string) => c.measureText(t).width + 26;
      let from = this.trail.length - 1, used = wid(names[this.trail[from]]);
      while (from > 0 && used + wid(names[this.trail[from - 1]]) < room - 30) { from--; used += wid(names[this.trail[from]]); }
      let x = 12; const y = H - 14;
      if (from > 0) { P.mono("…  →", x, y); x += 38; }
      this.trail.slice(from).forEach((f, i, arr) => {
        const t = names[f], last = i === arr.length - 1, w = c.measureText(t).width;
        P.tag(t, x, y, { c: last ? P.ink : P.muted }); x += w + 8;
        if (!last) { P.mono("→", x, y); x += 18; }
      });
    }
  }

  /** Our fatty acid in its current form, a dashed ring around it and a short tag. */
  private drawUs() {
    const c = P.ctx, { x, y } = this, f = this.leg.form, body = this.host === "body", k = body ? 0.75 : 1.25;
    if (this.leg.id === "lipase") {
      // the lipase on the droplet's surface, and the other two products drifting off: a monoglyceride and the second fatty acid
      const lx = P.W * 0.28, ly = this.hosts.gut.geo().lum * 0.55, u = Math.min(1, this.t / 2.4);
      const lp = blob(lx - 6, ly - 22, 16, 9, 11, 0.15); c.fillStyle = P.muted; alpha(0.35, () => c.fill(lp)); c.strokeStyle = P.muted; c.lineWidth = 1; c.stroke(lp);
      P.mono("pancreatic lipase", lx - 26, ly - 19, { a: "right" });
      const gx = lx - 36 - 20 * u, gy = ly + 4 * u, sg = 7.8;
      c.save(); c.strokeStyle = P.muted; c.lineWidth = 1.2; c.beginPath(); c.moveTo(gx, gy - sg); c.lineTo(gx, gy + sg); c.stroke(); c.restore();
      for (const i of [-1, 0, 1]) P.dot(gx, gy + i * sg, 1.6, P.muted);
      chain(gx + 3.9, gy, 0, 16, 3.9, P.muted, 1.1, false);
      chain(lx - 6 + 70 * u, ly + 12 + 6 * u, 0.1, 16, 3, P.muted, 1.2);
      P.mono("monoglyceride", gx - 6, gy + 24, { a: "center" });
    }
    let r = 10;
    const chol = this.story === "chol";
    if (this.particle) {
      const p = this.particle; p.x = x; p.y = y; p.rot += 0.01; P.drawParticle(p, body ? 0.9 : 1.6, !body); r = P.radius(p, body ? 0.9 : 1.6) + (body ? 4 : 8);
      if (!body) { if (chol) sterol(x - 8, y + 2, 0.75, P.ink, 1.2); else triglyceride(x - 10, y, 0.9, true, false, P.ink); }
    } else if (f === "cmic" || f === "FC" || f === "CE" || f === "foam" || f === "bile") {
      if (f === "cmic") { c.fillStyle = P.ink; for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; c.fillRect(x + Math.cos(a) * 20, y + Math.sin(a) * 20, 1.6, 1.6); } }
      if (f === "foam") { P.dot(x, y, 18, coreColor(0.2)); }
      if (f === "bile") alpha(0.8, () => { c.fillStyle = P.muted; for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; c.fillRect(x + Math.cos(a) * 16, y + Math.sin(a) * 12, 2, 2); } });
      const k = f === "cmic" ? 0.95 : 1.25;
      sterol(x - 10 * k, y + 3 * k, k, P.ink, 1.6);
      if (f === "CE" || f === "foam") chain(x - 16 * k, y + 5 * k, Math.PI * 0.92, 14, 2.6, P.muted, 1.2, false);
      r = f === "cmic" ? 26 : f === "foam" ? 24 : 26;
    } else if (f === "TG") { triglyceride(x - 34, y, 1.5); r = 40; }
    else if (f === "drop") { triglyceride(x - 28, y, 1.2); r = 32; }
    else if (f === "mic") {
      c.fillStyle = P.ink; for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; c.fillRect(x + Math.cos(a) * 17, y + Math.sin(a) * 17, 1.6, 1.6); }
      P.dot(x - 4, y + 6, 3.5, coreColor(0.1)); chain(x - 12, y - 4, 0, 10, 2.6, coreColor(0.95), 2); r = 24;
    } else if (f === "alb") {
      const a = blob(x, y, body ? 5 : 10, body ? 4 : 8, 7, 0.12); c.fillStyle = P.muted; alpha(0.5, () => c.fill(a)); c.strokeStyle = P.muted; c.lineWidth = 1; c.stroke(a);
      if (!body) chain(x + 9, y - 2, -0.3, 16, 2.6, coreColor(0.95), 1.9); r = body ? 8 : 26;
    } else if (f === "ox") { chain(x - 4, y - 2, 0, this.n, 3.4, coreColor(0.95), 2.2); r = 10 + this.n * 1.5; }
    else if (f === "FA") { chain(x - 24, y, 0, 16, 3.4, coreColor(0.95), 2.2); r = 30; }
    this.r = r;
    P.reg(x, y, r * k * 0.8, chol ? "FC" : "FA", (chol ? "Our cholesterol: " : "Our fatty acid: ") + TAG[f]);
    if (f === "TG" || f === "drop") P.reg(x, y, r, "TG", "Triglyceride: three fatty acids on glycerol");
  }
  r = 10;
  /** The marker, in screen space: a dashed ring and a tag on a short leader. */
  private drawMarker(x: number, y: number, r: number) {
    const c = P.ctx, pulse = this.host === "body" ? 2 * Math.sin(this.t * 5) : 0;
    c.save(); c.strokeStyle = P.ink; c.lineWidth = 1.2; c.setLineDash([3, 3]); c.beginPath(); c.arc(x, y, r + pulse, 0, TAU); c.stroke(); c.setLineDash([]);
    const tx = x + (r + 10) * 0.7, ty = Math.max(16, y - (r + 10) * 0.7), right = tx + 190 < P.W;
    c.lineWidth = 1; c.beginPath(); c.moveTo(x + r * 0.7, y - r * 0.7); c.lineTo(tx, ty); c.lineTo(right ? tx + 8 : tx - 8, ty); c.stroke(); c.restore();
    P.tag(TAG[this.leg.form], right ? tx + 11 : tx - 11, ty + 4, { c: P.ink, a: right ? "left" : "right" });
  }
}

export const followScene = new FollowScene();
