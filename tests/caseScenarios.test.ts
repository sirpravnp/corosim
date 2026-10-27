import { describe, it, expect } from "vitest";
import { CaseRunner, CaseDef, Probe, Tick } from "../src/cases/engine";
import { CASES } from "../src/cases";
import { Simulation } from "../src/sim/simulation";

const P = (o: Partial<Probe> = {}): Probe => ({ map: 70, hr: 45, arrest: "none", rhythmClass: "perfusing", shocks: 0, epiDoses: 0, amioMg: 0, lidoDoses: 0, cpr: false, ecmo: false, impella: false, iabp: false, pci: false, pciPending: false, drugs: {}, ef: 0.4, lvIschemia: 0, rvIschemia: 0, congestion: 0, fluidsL: 0, dead: false, ...o });

/** Play a case against a patient who is just reactive enough: a PCI order lands 12 s later, pacing and a device show in the probe, a rate-control drug slows AF, a shock converts. */
function play(def: CaseDef, pick: (opts: { points?: number }[]) => number) {
  const r = new CaseRunner(def); let orderedAt = -1, paced = false, impella = false, rateDrug = false, dilt = 0, sinus = false;
  const af = def.start.patient?.rhythm?.startsWith("af") ?? false;
  const note = (t: Tick) => {
    for (const p of t.patches) {
      if (p.support?.pacing) paced = true; if (p.devices?.impella) impella = true;
      if ((p.support?.diltiazem ?? 0) > 0 || (p.drugs?.betaBlocker ?? 0) > 0) rateDrug = true;
      if (p.support?.diltiazem !== undefined) dilt = p.support.diltiazem;
    }
    if (t.orders.includes("pci") && orderedAt < 0) orderedAt = r.t;
    for (const sh of t.shocks) { sinus = true; note(r.resolve(sh.onSuccess ?? {})); } // every shock converts
  };
  for (let i = 0; i < 2000 && !r.over; i++) {
    const pci = orderedAt >= 0 && r.t - orderedAt >= 12;
    const hr = af ? (sinus ? 80 : rateDrug ? 100 : 150) : paced ? 70 : 45;
    const probe = P({ hr, map: dilt > 0.3 ? 60 : 75, impella, pci, pciPending: orderedAt >= 0 && !pci, ecmo: false });
    note(r.tick(probe, 1));
    if (r.open) note(r.answer(pick(r.open.prompt.options)));
  }
  return r;
}
const best = (o: { points?: number }[]) => o.reduce((b, x, i) => ((x.points ?? 0) > (o[b].points ?? 0) ? i : b), 0);
const worst = (o: { points?: number }[]) => o.reduce((b, x, i) => ((x.points ?? 0) < (o[b].points ?? 0) ? i : b), 0);

describe("every case can be won and can be lost", () => {
  for (const def of CASES.filter((c) => c.id !== "ecpella")) {
    it(`${def.title}: the best answers succeed with nearly the top score; the worst do not succeed`, () => {
      const good = play(def, best); expect(good.result).toBe("success");
      const d = good.debrief(); expect(d.score).toBeGreaterThanOrEqual(d.max * 0.85); expect(d.lines.join(" ")).not.toContain("Not done");
      const bad = play(def, worst); expect(bad.result).not.toBe("success"); expect(bad.debrief().score).toBeLessThan(d.score / 2);
    });
  }
});

describe("the starting patients are what the cards say, and the options do what they claim", () => {
  const mk = (def: CaseDef) => { const s = new Simulation({ seed: def.start.seed ?? 3 }, { engine: "core" }); s.reset(def.start, { settled: true }); s.warmup(10); s.step(60, { minutes: 2 }); return s; };
  const vit = (s: Simulation) => ({ hr: s.rolling(10).hr, map: s.map, c: s.circ! });
  const opt = (def: CaseDef, cp: string, i: number) => def.checkpoints.find((c) => c.id === cp)!.prompt!.options[i].outcome!.patch!;
  const after = (s: Simulation, patch: object, secs = 90, minutes = 2) => { s.apply(patch); s.step(secs, { minutes }); return vit(s); };
  /** Shock until it converts (a shock is a chance, and a failed one is part of the case), at most three times. */
  const convert = (s: Simulation, sh: { joules: number; sync?: boolean }) => { for (let i = 0; i < 3; i++) if (s.shock({ joules: sh.joules, sync: sh.sync }).success) return true; return false; };
  const byId = (id: string) => CASES.find((c) => c.id === id)!;

  it("Slow and low: complete heart block, an infarcted right ventricle, nitro hurts and fluid and pacing help", () => {
    const def = byId("inferior-rv"), s = mk(def), v = vit(s);
    expect(v.hr).toBeLessThan(55); expect(v.c.rvIschemia).toBeGreaterThan(0.5); expect(s.rstate.avDegree).toBe(3); expect(v.map).toBeLessThan(80);
    const nitro = after(mk(def), opt(def, "first", 0));
    expect(nitro.map).toBeLessThan(v.map - 8);
    const fluid = after(mk(def), opt(def, "first", 1));
    expect(fluid.map).toBeGreaterThan(v.map);
    const paced = after(mk(def), opt(def, "block", 0));
    expect(paced.hr).toBeGreaterThan(60);
  }, 120000);

  it("Racing heart: fast AF in a stable patient; rate control slows it, a shock converts it", () => {
    const def = byId("af-rvr"), v = vit(mk(def));
    expect(v.hr).toBeGreaterThan(135); expect(v.map).toBeGreaterThan(70);
    expect(after(mk(def), opt(def, "first", 0), 90, 6).hr).toBeLessThan(120); // diltiazem
    expect(after(mk(def), opt(def, "first", 1), 90, 6).hr).toBeLessThan(120); // metoprolol
    const s = mk(def); const sh = def.checkpoints[0].prompt!.options[2].outcome!.shock!;
    expect(convert(s, sh)).toBe(true); s.step(20, { minutes: 1 });
    expect(s.patient.rhythm).toBe("sinus"); expect(vit(s).hr).toBeLessThan(100);
  }, 120000);

  it("Short of breath and racing: a failing, congested ventricle in fast AF; diltiazem costs output and pressure, cardioversion converts", () => {
    const def = byId("af-hf"), s = mk(def), v = vit(s);
    expect(v.hr).toBeGreaterThan(140); expect(v.c.congestion).toBeGreaterThan(0.5); expect(v.map).toBeLessThan(85);
    const ref = after(mk(def), {}, 90, 6), dilt = after(mk(def), opt(def, "first", 1), 90, 6);
    expect(dilt.map).toBeLessThan(ref.map - 3); expect(dilt.hr).toBeLessThan(ref.hr - 4);
    const sh = def.checkpoints[0].prompt!.options[0].outcome!.shock!, c = mk(def);
    expect(convert(c, sh)).toBe(true); c.step(20, { minutes: 1 }); expect(c.patient.rhythm).toBe("sinus");
  }, 180000);

  it("Pressure in the chest: a failing anterior wall with a held pressure; a beta blocker makes it worse", () => {
    const def = byId("anterior-stemi"), v = vit(mk(def));
    expect(v.c.lvIschemia).toBeGreaterThan(0.3); expect(v.map).toBeGreaterThan(65);
    const bb = after(mk(def), opt(def, "pain", 1));
    expect(bb.c.ejectionFraction).toBeLessThan(v.c.ejectionFraction);
  }, 120000);

  it("Cold and wet: a very poor ventricle; the pressor and inotrope raise pressure and output and nitroglycerin drops the pressure", () => {
    const def = byId("lm-shock"), v = vit(mk(def));
    expect(v.c.ejectionFraction).toBeLessThan(0.25); expect(v.map).toBeLessThan(80);
    const ref = after(mk(def), {}); // the same patient left alone for the same time: it drifts on its own
    const good = after(mk(def), opt(def, "shock", 0));
    expect(good.map).toBeGreaterThan(ref.map + 5);
    const nit = after(mk(def), opt(def, "shock", 3));
    expect(nit.map).toBeLessThan(ref.map);
  }, 120000);
});
