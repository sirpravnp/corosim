import { coreColor, svgG } from "./glyphs";
import { mountCards } from "./deck";
import { DRUG_INFO, LAB_NAMES, effect, effectText } from "./drugInfo";
import { DRUGS, DrugId, rates, steady, steadyLabs } from "./model";
import { P, Particle, rand } from "./paint";

/**
 * Enzyme and drug cards. The front names the protein or drug, where it works and what the model says it does; the back runs a
 * small simulation of its action. A drug card's back alternates between the untreated patient and the patient on that drug, and
 * every rate in it comes from the model (lipolysis, surface LDLR, free PCSK9, VLDL and Lp(a) output), so the card shows the same
 * effect the stage and the labs do. Only the card in the center and flipped is animated.
 */

type Anim =
  | { k: "path"; steps: string[]; at: number; glyph: string; pass?: number; ldlr?: boolean; droplet?: boolean }
  | { k: "lipo"; enz: "LPL" | "HL"; inhib?: "ANGPTL3" | "apoCIII"; sites?: number }
  | { k: "rec" }
  | { k: "xfer"; lcat?: boolean }
  | { k: "sec"; part: "VLDL" | "LPA" };
interface CardDef { kind: string; name: string; glyph: string; where: string; does: string; sim: string; anim: Anim; drug?: DrugId; cls?: string }

const CLS: Record<DrugId, string> = { statin: "small", eze: "small", bem: "small", mab: "mAb", incl: "siRNA", obi: "small", fib: "small", ipe: "small", olez: "ASO", evin: "mAb", lomi: "small", olpa: "siRNA" };
/** The sign on a drug card's front: its target's sign where it has one. */
const SIGN: Partial<Record<DrugId, string>> = { ipe: "PPARa", olpa: "apoa", olez: "apoCIII", mab: "PCSK9", incl: "PCSK9" };
const CLASSNAME: Record<string, string> = { small: "Small molecule", mAb: "Monoclonal antibody", siRNA: "siRNA", ASO: "Antisense oligonucleotide" };
const SYN = ["acetyl-CoA", "HMG-CoA", "mevalonate", "cholesterol"];

const ENZYMES: CardDef[] = [
  { kind: "Enzyme", name: "HMG-CoA reductase", glyph: "HMGCR", where: "Hepatocyte, smooth ER", does: "The rate-limiting step of cholesterol synthesis: HMG-CoA to mevalonate.", sim: "Acetyl-CoA runs down the synthesis pathway; the reductase sets its pace.", anim: { k: "path", steps: SYN, at: 2, glyph: "HMGCR" } },
  { kind: "Enzyme", name: "ATP citrate lyase", glyph: "ACL", where: "Hepatocyte cytoplasm", does: "Splits citrate from the mitochondrion into acetyl-CoA, the building block of cholesterol and fat.", sim: "Citrate becomes acetyl-CoA, which feeds cholesterol synthesis.", anim: { k: "path", steps: ["citrate", "acetyl-CoA", "HMG-CoA", "cholesterol"], at: 1, glyph: "ACL" } },
  { kind: "Transfer protein", name: "MTP", glyph: "MTP", where: "ER of hepatocytes and enterocytes", does: "Loads triglyceride onto ApoB as the particle is built, one ApoB per particle.", sim: "Triglyceride and ApoB-100 meet at MTP and leave as VLDL.", anim: { k: "path", steps: ["TG + ApoB", "MTP", "VLDL", "plasma"], at: 1, glyph: "MTP" } },
  { kind: "Enzyme", name: "Lipoprotein lipase", glyph: "LPL", where: "Capillary endothelium of fat, muscle and heart, held by GPIHBP1", does: "Hydrolyzes triglyceride in chylomicrons and VLDL; the fatty acids enter the tissue.", sim: "VLDL docks on LPL, gives up triglyceride as fatty acids and leaves smaller. ANGPTL3 holds LPL back now and then.", anim: { k: "lipo", enz: "LPL", inhib: "ANGPTL3" } },
  { kind: "Enzyme", name: "Hepatic lipase", glyph: "HL", where: "Liver sinusoids", does: "Trims what triglyceride is left in IDL, making LDL, and turns HDL2 into HDL3.", sim: "IDL passes hepatic lipase on the liver surface and leaves as LDL.", anim: { k: "lipo", enz: "HL" } },
  { kind: "Transfer protein", name: "CETP", glyph: "CETP", where: "Plasma", does: "Moves cholesteryl ester from HDL to ApoB particles and triglyceride back.", sim: "CETP shuttles cholesteryl ester (cool) from HDL to LDL and triglyceride (hot) back.", anim: { k: "xfer" } },
  { kind: "Enzyme", name: "LCAT", glyph: "LCAT", where: "Plasma, on HDL; activated by ApoA-I", does: "Esterifies free cholesterol on HDL so it moves into the core and HDL grows.", sim: "Cholesterol leaves a cell for HDL; LCAT esterifies it and it sinks into the core.", anim: { k: "xfer", lcat: true } },
  { kind: "Regulator", name: "PCSK9", glyph: "PCSK9", where: "Made in the liver; circulates", does: "Binds LDLR, so the receptor is destroyed in the lysosome instead of recycling.", sim: "LDLR carries LDL in and comes back up, unless PCSK9 rode in with it.", anim: { k: "rec" } },
  { kind: "Regulator", name: "ANGPTL3", glyph: "ANGPTL3", where: "Made in the liver; circulates", does: "Inhibits LPL and endothelial lipase, slowing triglyceride clearance.", sim: "ANGPTL3 binds LPL sites and stalls them; particles pass by with their triglyceride.", anim: { k: "lipo", enz: "LPL", inhib: "ANGPTL3" } },
];
const DRUG_ANIM: Record<DrugId, [Anim, string]> = {
  statin: [{ k: "path", steps: SYN, at: 2, glyph: "HMGCR", pass: 0.25, ldlr: true }, "Synthesis slows at the reductase; the liver, short of sterol, puts more LDLR on its surface."],
  eze: [{ k: "path", steps: ["micelle", "NPC1L1", "enterocyte", "liver"], at: 1, glyph: "NPC1L1", pass: 0.15, ldlr: true }, "Less cholesterol crosses NPC1L1, less reaches the liver, and the liver adds LDLR."],
  bem: [{ k: "path", steps: ["citrate", "acetyl-CoA", "HMG-CoA", "cholesterol"], at: 1, glyph: "ACL", pass: 0.45, ldlr: true }, "Fewer acetyl-CoA units are made, one step above the statin; LDLR rises."],
  mab: [{ k: "rec" }, "The antibody captures free PCSK9, so receptors keep recycling and more stay on the surface."],
  incl: [{ k: "rec" }, "The siRNA cuts PCSK9 mRNA in the hepatocyte; less PCSK9 is made, so fewer receptors are destroyed."],
  obi: [{ k: "xfer" }, "CETP is blocked: cholesteryl ester stays in HDL, and LDL carries less."],
  fib: [{ k: "lipo", enz: "LPL", inhib: "apoCIII", sites: 5 }, "PPAR-α makes more LPL and less ApoC-III, so particles are cleared faster."],
  ipe: [{ k: "sec", part: "VLDL" }, "The liver secretes less VLDL."],
  olez: [{ k: "lipo", enz: "LPL", inhib: "apoCIII" }, "ApoC-III is silenced; particles without it dock on LPL and are cleared faster."],
  evin: [{ k: "lipo", enz: "LPL", inhib: "ANGPTL3" }, "The antibody captures ANGPTL3, freeing LPL."],
  lomi: [{ k: "path", steps: ["TG + ApoB", "MTP", "VLDL", "plasma"], at: 1, glyph: "MTP", pass: 0.5, droplet: true }, "MTP is blocked: fewer VLDL are built and the triglyceride stays in the liver as fat."],
  olpa: [{ k: "sec", part: "LPA" }, "The siRNA silences apo(a), and the liver makes far less Lp(a)."],
};
const CARDS: CardDef[] = [
  ...ENZYMES,
  ...DRUGS.map((d): CardDef => ({ kind: "Drug", name: d.label, glyph: SIGN[d.id] ?? DRUG_INFO[d.id].key, cls: CLS[d.id], drug: d.id, where: DRUG_INFO[d.id].target, does: DRUG_INFO[d.id].action[0].toUpperCase() + DRUG_INFO[d.id].action.slice(1) + ".", sim: DRUG_ANIM[d.id][1], anim: DRUG_ANIM[d.id][0] })),
];

/** What the model says a drug changes, for a normal patient at steady state; the cards' animations take their rates from this. */
function ratios(d?: DrugId) {
  const off = new Set<DrugId>(), on = new Set<DrugId>(d ? [d] : []);
  const r0 = rates("wt", off), r1 = rates("wt", on), s0 = steady(r0), s1 = steady(r1), l0 = steadyLabs("wt", off), l1 = steadyLabs("wt", on);
  return { R: s1.R / s0.R, PC: s1.PC / s0.PC, lipo: l1.lipolysis / l0.lipolysis, vldl: r1.vldl / r0.vldl, lpa: l1.lpa / l0.lpa, c3: r1.c3 / r0.c3 };
}

// ---------------------------------------------------------------- the animations

const W = 284, H = 168;
/** The labs a learner predicts on a drug card. */
const PRED = ["ldl", "tg", "lpa"] as const;
interface Dot { x: number; y: number; v: number; stop?: number; a: number }
interface Site { x: number; busy: number; inh: number }
interface Rec { x: number; st: "up" | "in" | "gone"; t: number; tag: boolean; ldl: boolean }
interface Bit { x: number; y: number; tx: number; ty: number; t: number; c: string }

class CardSim {
  t = 0; dots: Dot[] = []; sites: Site[] = []; ps: Particle[] = []; recs: Rec[] = []; pc: { x: number; y: number; v: number; ab: boolean }[] = []; bits: Bit[] = [];
  acc = 0; acc2 = 0; grow = 0; inh: { x: number; y: number; v: number }[] = [];
  constructor(public def: CardDef, public r = ratios(def.drug)) {}
  /** The phase: a drug card spends 5 s untreated, then 5 s on the drug. */
  on() { return !!this.def.drug && this.t % 10 > 5; }
  step(dt: number) {
    const a = this.def.anim, on = this.on();
    this.t += dt;
    if (a.k === "path") {
      const xs = a.steps.map((_, i) => 40 + (i * (W - 80)) / (a.steps.length - 1)), ex = (xs[a.at - 1] + xs[a.at]) / 2;
      this.acc += 2.6 * dt; while (this.acc >= 1) { this.acc--; this.dots.push({ x: 14, y: 66 + rand(-4, 4), v: rand(42, 54), a: 1 }); }
      for (const d of this.dots) {
        if (d.stop !== undefined) { d.a -= dt * 0.5; continue; }
        const before = d.x < ex; d.x += d.v * dt;
        if (before && d.x >= ex && on && Math.random() > (a.pass ?? 1)) { d.stop = d.x; d.x = ex - rand(4, 16); d.y += rand(-6, 6); }
      }
      this.dots = this.dots.filter((d) => d.x < W - 8 && d.a > 0);
      if (a.droplet) this.grow += ((on ? 1 : 0) - this.grow) * dt * 0.8;
    } else if (a.k === "lipo") {
      const n = on && a.sites ? a.sites : 3;
      if (this.sites.length !== n) this.sites = Array.from({ length: n }, (_, i) => ({ x: 40 + (i * (W - 80)) / Math.max(1, n - 1), busy: 0, inh: 0 }));
      const lipo = on ? this.r.lipo : 1, c3 = on ? this.r.c3 : 1, d = this.def.drug;
      this.acc += 0.55 * dt; while (this.acc >= 1) { this.acc--; const p = P.particle(a.enz === "HL" ? "IDL" : "VLDL", -14, rand(46, 64)); p.c3 = a.inhib === "apoCIII" ? Math.random() < 0.8 * c3 : false; this.ps.push(p); }
      // inhibitors: free ANGPTL3 that binds a site now and then, unless an antibody holds it
      if (a.inhib === "ANGPTL3" && this.inh.length < 3) this.inh.push({ x: rand(0, W), y: rand(30, 72), v: rand(18, 30) });
      for (const q of this.inh) { q.x += q.v * dt; if (q.x > W + 10) q.x = -10; }
      const held = on && d === "evin";
      for (const s of this.sites) {
        s.busy = Math.max(0, s.busy - dt); s.inh = Math.max(0, s.inh - dt);
        if (a.inhib === "ANGPTL3" && !held && !s.inh && Math.random() < 0.25 * dt) s.inh = 2.2;
      }
      for (const p of this.ps) {
        if (p.hold > 0) { p.hold -= dt; if (p.hold <= 0) { p.tg = Math.max(0.13, p.tg - 0.22); p.c = P.classOf(p); p.vy = -26; } continue; }
        p.x += 34 * dt; p.y += p.vy * dt; p.vy *= Math.exp(-3 * dt); if (p.y < 46) p.y = 46;
        if (p.tg <= 0.2) continue;
        for (const s of this.sites) if (!s.busy && !s.inh && Math.abs(s.x - p.x) < 4 && Math.random() < Math.min(0.95, 0.55 * lipo * (p.c3 ? 0.35 : 1))) {
          s.busy = 1; p.hold = 0.8; p.x = s.x; p.y = 104 - P.radius(p, 1.1) - 10;
          for (let k = 0; k < 3; k++) this.bits.push({ x: s.x, y: 110, tx: s.x + rand(-26, 26), ty: rand(128, 160), t: 0, c: coreColor(0.95) });
        }
      }
      this.ps = this.ps.filter((p) => p.x < W + 20);
    } else if (a.k === "rec") {
      const d = this.def.drug, pcN = Math.round(5 * (on ? this.r.PC : 1)), ab = on && d === "mab";
      const want = Math.max(2, Math.min(9, Math.round(4 * (on ? this.r.R : 1)))), live = this.recs.filter((r) => r.st !== "gone");
      if (live.length < want) { const free = [...Array(9).keys()].map((i) => 20 + i * 30).filter((x) => !live.some((r) => Math.abs(r.x - x) < 5)); this.recs = this.recs.filter((r) => r.st !== "gone" || r.t > 0); if (free.length) this.recs.push({ x: free[(Math.random() * free.length) | 0], st: "up", t: rand(0.5, 2), tag: false, ldl: false }); }
      while (this.pc.length < Math.min(9, pcN)) this.pc.push({ x: rand(0, W), y: rand(20, 50), v: rand(-14, 14), ab: false });
      if (this.pc.length > pcN) this.pc.length = Math.max(0, pcN);
      for (const q of this.pc) { q.ab = ab; q.x += q.v * dt; if (q.x < 8 || q.x > W - 8) q.v *= -1; }
      if (ab) for (const r of this.recs) if (r.st === "in") r.tag = false; // the antibody has taken PCSK9 off the receptors already inside
      const pTag = live.length > want ? 0.9 : ab ? 0.04 : 0.35 * Math.min(1, this.pc.length / 5);
      for (const r of this.recs) {
        r.t -= dt;
        if (r.st === "up" && r.t <= 0) { r.st = "in"; r.t = 1.8; r.ldl = true; r.tag = Math.random() < pTag; }
        else if (r.st === "in" && r.t <= 0) { if (r.tag) { r.st = "gone"; r.t = rand(1.5, 3.5); } else { r.st = "up"; r.t = rand(1.4, 3); } r.ldl = false; }
        else if (r.st === "gone") r.t = 0;
      }
    } else if (a.k === "xfer") {
      const blocked = on;
      this.acc += (blocked && !a.lcat ? 0 : 1.1) * dt;
      while (this.acc >= 1) { this.acc--; if (a.lcat) this.bits.push({ x: 10, y: rand(60, 100), tx: 92, ty: 80, t: 0, c: P.ink }); else { this.bits.push({ x: 92, y: 80, tx: 192, ty: 80, t: 0, c: coreColor(0.1) }); this.bits.push({ x: 192, y: 88, tx: 92, ty: 88, t: 0, c: coreColor(0.95) }); } }
      this.grow += ((blocked ? 1 : 0) - this.grow) * dt * 0.6;
      if (a.lcat) { this.grow = (this.t % 12) / 12; }
    } else if (a.k === "sec") {
      const mult = on ? (a.part === "LPA" ? this.r.lpa : this.r.vldl) : 1;
      this.acc += 1.1 * mult * dt;
      while (this.acc >= 1) { this.acc--; const p = P.particle(a.part, rand(60, 120), 112); p.vy = -40; this.ps.push(p); }
      for (const p of this.ps) { if (p.y > 60) p.y += p.vy * dt; else p.x += 40 * dt; }
      this.ps = this.ps.filter((p) => p.x < W + 20);
    }
    for (const b of this.bits) b.t += dt;
    this.bits = this.bits.filter((b) => b.t < 1.6);
  }
  draw(ctx: CanvasRenderingContext2D) {
    const pc = P.ctx, ph = P.hits, pw = P.W, phh = P.H;
    P.ctx = ctx; P.hits = []; P.W = W; P.H = H;
    try { this.paint(); } finally { P.ctx = pc; P.hits = ph; P.W = pw; P.H = phh; }
  }
  private paint() {
    const c = P.ctx, a = this.def.anim, on = this.on(), d = this.def.drug;
    c.fillStyle = P.stage; c.fillRect(0, 0, W, H);
    if (a.k === "path") {
      const xs = a.steps.map((_, i) => 40 + (i * (W - 80)) / (a.steps.length - 1)), ex = (xs[a.at - 1] + xs[a.at]) / 2;
      P.line(14, 66, W - 14, 66, P.muted, 1);
      a.steps.forEach((s, i) => { if (i === a.at && a.glyph === "MTP") return; P.dot(xs[i], 66, 3, P.muted); P.mono(s, xs[i], 88, { a: "center", s: 10 }); });
      for (const dd of this.dots) { c.globalAlpha = Math.max(0, dd.a); P.dot(dd.x, dd.y, 2.6, a.glyph === "NPC1L1" ? coreColor(0.1) : a.glyph === "MTP" ? coreColor(0.9) : coreColor(0.35)); c.globalAlpha = 1; }
      P.glyph(a.glyph, ex, 44, 22, 0, P.ink, on ? 0.35 : 1);
      if (on && this.def.cls) P.glyph(this.def.cls, ex + 13, 32, 13);
      if (a.ldlr) {
        const n = Math.min(14, Math.round(6 * (on ? this.r.R : 1)));
        P.mono("LDLR on the liver", 14, 128, { s: 10 });
        for (let i = 0; i < n; i++) P.glyph("LDLR", 124 + i * 11, 124, 13);
        P.mono(`${(on ? this.r.R : 1).toFixed(1)}×`, W - 14, 146, { a: "right", s: 10, c: P.ink });
      }
      if (a.droplet) { const r = 6 + 12 * this.grow; P.dot(46, 138, r, coreColor(0.93)); P.mono("fat in the liver", 70, 142, { s: 10 }); }
    } else if (a.k === "lipo") {
      c.fillStyle = P.stage2; c.fillRect(0, 112, W, H - 112); P.line(0, 112, W, 112, P.muted, 1);
      P.mono(a.enz === "HL" ? "liver surface" : "capillary wall", 8, 126, { s: 10 }); P.mono(a.enz === "HL" ? "hepatocyte" : "tissue", 8, 160, { s: 10 });
      for (const s of this.sites) { P.glyph(a.enz, s.x, 104, 18, Math.PI, P.ink, s.inh ? 0.35 : 1); if (s.inh) P.glyph("ANGPTL3", s.x, 90, 13); }
      for (const q of this.inh) { const held = on && d === "evin"; P.glyph("ANGPTL3", q.x, q.y, 12, 0, P.ink, held ? 0.5 : 1); if (held) P.glyph("mAb", q.x + 8, q.y - 7, 10); }
      for (const p of this.ps) { P.drawParticle(p, 1.1, true); }
      if (on && d === "fib") P.glyph("PPARa", W - 20, 140, 16);
      if (on && d === "olez") P.glyph("ASO", W - 20, 140, 16);
    } else if (a.k === "rec") {
      const yM = 64;
      c.fillStyle = P.stage2; c.fillRect(0, yM, W, H - yM); P.line(0, yM, W, yM, P.ink, 1.2);
      P.mono("plasma", 8, 14, { s: 10 }); P.mono("hepatocyte", 8, yM + 14, { s: 10 });
      const ex = 120, ey = 116, lx = 226, ly = 140;
      const e = new Path2D(); e.arc(ex, ey, 13, 0, 6.28); c.strokeStyle = P.muted; c.stroke(e); P.mono("endosome", ex, ey + 26, { a: "center", s: 9.5 });
      const l = new Path2D(); l.arc(lx, ly, 10, 0, 6.28); c.fillStyle = P.muted; c.globalAlpha = 0.3; c.fill(l); c.globalAlpha = 1; P.mono("lysosome", lx, ly - 15, { a: "center", s: 9.5 });
      for (const r of this.recs) {
        if (r.st === "up") { P.glyph("LDLR", r.x, yM - 8, 15); if (r.t < 0.5) P.dot(r.x, yM - 20, 4.5, coreColor(0.13)); }
        else if (r.st === "in") { const u = 1 - r.t / 1.8, tx = r.tag && u > 0.5 ? lx : ex, ty = r.tag && u > 0.5 ? ly : ey, k = Math.min(1, u * 2), x = r.x + (tx - r.x) * k, y = yM + (ty - yM) * k; P.glyph("LDLR", x, y, 13, 0, P.ink, 0.8); if (r.ldl && u < 0.5) P.dot(x, y - 9, 4.5, coreColor(0.13)); if (r.tag) P.glyph("PCSK9", x + 7, y - 8, 10, 0, P.muted); }
      }
      for (const q of this.pc) { P.glyph("PCSK9", q.x, q.y, 12, 0, P.muted); if (q.ab) P.glyph("mAb", q.x + 8, q.y - 7, 11); }
      if (on && d === "incl") P.glyph("siRNA", 40, 140, 16);
      P.mono(`surface LDLR ${(on ? this.r.R : 1).toFixed(1)}×`, W - 8, yM + 14, { a: "right", s: 10, c: P.ink });
    } else if (a.k === "xfer") {
      if (a.lcat) {
        c.fillStyle = P.stage2; c.fillRect(0, 40, 14, 100); P.mono("cell", 4, 34, { s: 10 });
        const r = 7 + 9 * this.grow, hx = 110, hy = 80; P.dot(hx, hy, r, coreColor(0.15)); c.strokeStyle = P.ink; c.setLineDash([1.2, 1.7]); c.beginPath(); c.arc(hx, hy, r, 0, 6.28); c.stroke(); c.setLineDash([]);
        P.glyph("apoAI", hx - r - 5, hy, 9); P.glyph("LCAT", hx + r + 6, hy - 6, 12);
        P.mono("HDL grows as its core fills", W / 2 + 40, 150, { a: "center", s: 10 });
      } else {
        const rh = 11 + 6 * this.grow, rl = 13 - 3 * this.grow;
        for (const [x, r, n, tg] of [[92, rh, "HDL", 0.15], [192, rl, "LDL", 0.13]] as const) { P.dot(x, 84, r, coreColor(tg)); c.strokeStyle = P.ink; c.setLineDash([1.2, 1.7]); c.beginPath(); c.arc(x, 84, r, 0, 6.28); c.stroke(); c.setLineDash([]); P.mono(n, x, 84 + r + 16, { a: "center", s: 10 }); }
        const k = (this.t * 0.6) % 1, cx = 92 + 100 * (k < 0.5 ? k * 2 : 2 - k * 2);
        P.glyph("CETP", on ? 142 : cx, on ? 46 : 60, 20, 0, P.ink, on ? 0.35 : 1); if (on) P.glyph("small", 156, 34, 12);
      }
      for (const b of this.bits) { const u = Math.min(1, b.t / 1.4); P.dot(b.x + (b.tx - b.x) * u, b.y + (b.ty - b.y) * u - Math.sin(u * Math.PI) * 18, 3, b.c); }
    } else if (a.k === "sec") {
      c.fillStyle = P.stage2; c.fillRect(0, 112, W, H - 112); P.line(0, 112, W, 112, P.ink, 1.2); P.mono("hepatocyte", 8, 160, { s: 10 }); P.mono("plasma", 8, 14, { s: 10 });
      for (const p of this.ps) P.drawParticle(p, 1.1, true);
      if (on && d) P.glyph(this.def.cls!, 150, 138, 16);
      P.mono(`output ${(on ? (a.part === "LPA" ? this.r.lpa : this.r.vldl) : 1).toFixed(2)}×`, W - 8, 160, { a: "right", s: 10, c: P.ink });
    }
    if (a.k === "lipo") for (const b of this.bits) { const u = Math.min(1, b.t / 1.4); P.dot(b.x + (b.tx - b.x) * u, b.y + (b.ty - b.y) * u, 1.8, b.c); }
    // phase label: what the panel is showing right now
    if (d) P.label(on ? `on ${this.def.name}` : "untreated", W - 8, 16, { a: "right", s: 11.5, w: 500 });
  }
}

export function mountActionDeck(deck: HTMLElement, track: HTMLElement, count: HTMLElement, prev: HTMLButtonElement, next: HTMLButtonElement) {
  const no = (i: number) => `No. ${String(i + 1).padStart(2, "0")}`;
  const html = CARDS.map((cd, i) => {
    const hd = `<div class="hd"><span>${no(i)}</span><span>${cd.drug ? `Drug · ${CLASSNAME[cd.cls!]}` : cd.kind}</span></div><h3>${cd.name}</h3>`;
    const model = cd.drug ? `<dt class="ans">Model, alone</dt><dd class="ans">${effectText(effect("wt", [cd.drug]), 3)}</dd>` : "";
    // predict, then reveal: which way does each lab move on this drug alone?
    const predict = cd.drug ? `<div class="predict" role="group" aria-label="Your prediction">${PRED.map((k) => `<div class="prow"><span>${LAB_NAMES[k]}</span>${([["-1", "Down"], ["0", "Flat"], ["1", "Up"]] as const).map(([v, t]) => `<button type="button" data-k="${k}" data-v="${v}" aria-pressed="false">${t}</button>`).join("")}</div>`).join("")}</div>` : "";
    return `<div class="card" data-i="${i}" role="group" aria-roledescription="card" aria-label="${cd.name}">
      <div class="card-inner">
        <div class="face front">${hd}
          <div class="pic-wrap"><span class="big-sign">${svgG(cd.glyph)}${cd.cls ? `<span class="cls">${svgG(cd.cls)}</span>` : ""}</span></div>
          <dl><dt>${cd.drug ? "Target" : "Where"}</dt><dd>${cd.where}</dd><dt>Does</dt><dd>${cd.does}</dd>${model}</dl>${predict}
          <div class="ft"><span>${cd.drug ? `<span class="np">Click to see it work</span><span class="yp">Predict, then click to reveal</span>` : "Click to see it work"}</span><span>${i + 1} / ${CARDS.length}</span></div>
        </div>
        <div class="face back">${hd}
          <div class="pic-wrap sim"><canvas width="${W}" height="${H}" aria-label="Simulated action of ${cd.name}"></canvas></div>
          <div class="body"><p>${cd.sim}</p>${cd.drug ? `<p class="mono">Model, normal patient: ${effectText(effect("wt", [cd.drug]), 3)}</p><p class="verdict"></p>` : ""}</div>
          <div class="ft"><span>${cd.drug ? `<span class="np">Click to flip back</span><button type="button" class="to-stage" data-d="${cd.drug}">Put it on the stage</button>` : "Click to flip back"}</span><span>${i + 1} / ${CARDS.length}</span></div>
        </div>
      </div></div>`;
  });
  const sims = CARDS.map((cd) => new CardSim(cd));
  const preds = CARDS.map(() => ({}) as Partial<Record<(typeof PRED)[number], number>>);
  track.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button"); if (!b) return;
    const i = Number(b.closest<HTMLElement>(".card")!.dataset.i);
    if (b.classList.contains("to-stage")) {
      const t = document.querySelector<HTMLButtonElement>(`#lp-drugs button[data-d="${b.dataset.d}"]`);
      if (t && t.getAttribute("aria-pressed") !== "true") t.click();
      document.querySelector(".lp-stage")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      return;
    }
    if (b.dataset.k) {
      preds[i][b.dataset.k as (typeof PRED)[number]] = Number(b.dataset.v);
      b.parentElement!.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }
  });
  /** The reveal: each call against the model's sign (a change under 5% counts as flat). */
  function verdict(i: number) {
    const cd = CARDS[i], el = track.querySelector<HTMLElement>(`.card[data-i="${i}"] .verdict`);
    if (!cd.drug || !el) return;
    const e = effect("wt", [cd.drug]), p = preds[i], word = (v: number) => (v < 0 ? "down" : v > 0 ? "up" : "flat");
    const calls = PRED.filter((k) => p[k] !== undefined);
    if (!calls.length) { el.textContent = "Make a call on the front first, then flip to check it."; return; }
    const right = calls.filter((k) => p[k] === (e[k] <= -5 ? -1 : e[k] >= 5 ? 1 : 0)).length;
    el.innerHTML = `<b>${right} of ${calls.length} right.</b> ` + calls.map((k) => `${LAB_NAMES[k]}: you said ${word(p[k]!)}, the model gives ${e[k] > 0 ? "+" : e[k] < 0 ? "−" : ""}${Math.abs(e[k])}%.`).join(" ");
  }
  let live: number | null = null, last = 0;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvasOf = (i: number) => track.querySelector<HTMLCanvasElement>(`.card[data-i="${i}"] canvas`)!;
  function size(cv: HTMLCanvasElement) { const d = Math.min(2, devicePixelRatio || 1); if (cv.width !== W * d) { cv.width = W * d; cv.height = H * d; } const x = cv.getContext("2d")!; x.setTransform(d, 0, 0, d, 0, 0); return x; }
  function loop(ts: number) {
    if (live === null) return;
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 1 / 60; last = ts;
    const s = sims[live]; s.step(dt); s.draw(size(canvasOf(live)));
    requestAnimationFrame(loop);
  }
  mountCards(deck, track, count, prev, next, html, (i, flipped) => {
    if (flipped) verdict(i);
    const was = live; live = flipped ? i : null;
    if (live === null || reduce) {
      if (reduce && live !== null) { const s = sims[live]; for (let k = 0; k < 7 * 30; k++) s.step(1 / 30); s.draw(size(canvasOf(live))); }
      live = reduce ? null : live; return;
    }
    if (was !== live) { sims[live] = new CardSim(CARDS[live]); for (let k = 0; k < 45; k++) sims[live].step(1 / 30); last = 0; requestAnimationFrame(loop); }
  });
}
