import { BLOOD, CORONARY } from "../config/anatomy";
import { FLOW } from "../config/tree";
import { Segment, Tree, diameterAt } from "../anatomy/tree";
import { area, defaultLesion } from "./geometry";
import { pressureAlong } from "./hemodynamics";
import { severityTarget } from "./ischemia";

export interface Lesion { segId: string; pos: number; ds: number; occluded?: boolean } // pos: 0..1 along the segment

interface Dense { s: number[]; d: number[]; w0: number; w1: number; ref: number; sc: number; lesion?: Lesion }
interface Terminal { key: string; seg: Segment; pos: number; mass: number; label: string; Qrest: number; Rmin: number }

export interface SegResult { s: number[]; d: number[]; P: number[]; Q: number[]; v: number[]; wss: number[]; blockedFrom: number | null }
export interface TerminalResult {
  key: string; segId: string; label: string; group: string; mass: number;
  Qrest: number; Q: number; Pd: number; demand: number; ratio: number; severity: number; blocked: boolean;
}
export interface NetResult { seg: Record<string, SegResult>; terminals: TerminalResult[]; atRisk: number; iterations: number; pa: number }

const HALF = 7; // mm, half of the 14 mm lesion window
const lesionFactor = (xm: number, L: ReturnType<typeof defaultLesion>) => {
  if (xm < L.entranceLength) return 0.5 * (1 - Math.cos((Math.PI * xm) / L.entranceLength));
  if (xm <= L.entranceLength + L.plateau) return 1;
  return 0.5 * (1 + Math.cos((Math.PI * (xm - L.entranceLength - L.plateau)) / L.exitLength));
};

function denseProfile(tree: Tree, seg: Segment, lesion?: Lesion): Dense {
  const L = seg.length;
  const sc = lesion ? Math.min(L - HALF, Math.max(HALF, lesion.pos * L)) : -1;
  const set = new Set<number>();
  for (let s = 0; s <= L; s += 1) set.add(+s.toFixed(3));
  set.add(+L.toFixed(3));
  if (lesion) for (let s = sc - HALF; s <= sc + HALF + 1e-9; s += 0.25) set.add(+s.toFixed(3));
  const s = [...set].sort((a, b) => a - b);
  const spec = defaultLesion();
  const d = s.map((si) => {
    let di = diameterAt(tree, seg, si);
    if (lesion && si >= sc - HALF && si <= sc + HALF) di *= 1 - lesion.ds * lesionFactor((si - (sc - HALF)) * 1e-3, spec);
    return di;
  });
  let w0 = -1, w1 = -1;
  if (lesion) { w0 = s.findIndex((x) => x >= sc - HALF - 1e-6); w1 = s.length - 1 - [...s].reverse().findIndex((x) => x <= sc + HALF + 1e-6); }
  return { s, d, w0, w1, ref: lesion ? diameterAt(tree, seg, sc) : 0, sc, lesion };
}

/**
 * Steady-state flow through the whole coronary tree.
 * demandMult: 1 = rest, 2.5 = exertion, Infinity = maximal hyperemia (beds fully dilated).
 * Each bed takes min(demand, (Pd − Pzf)/Rmin); pressure falls along each artery by Poiseuille loss
 * (and the lesion model inside lesion windows), so beds beyond a lesion are starved first.
 */
export function solveNetwork(tree: Tree, lesions: Lesion[], demandMult: number, aorticPressure = CORONARY.meanAorticPressure): NetResult {
  // Each bed's maximal dilation is a fixed property, set at the reference pressure; the driving pressure can fall.
  const Pref = CORONARY.meanAorticPressure, Pa = aorticPressure, Pzf = CORONARY.zeroFlowPressure;
  const dense: Record<string, Dense> = {};
  // An occlusion carries no flow beyond it, so it needs no lesion window (and ds = 1 would give zero area → NaN).
  for (const seg of tree.segments) dense[seg.id] = denseProfile(tree, seg, lesions.find((l) => l.segId === seg.id && !l.occluded));

  const terms: Terminal[] = [];
  for (const seg of tree.segments) {
    seg.taps.forEach((t, k) => terms.push(mkTerm(`${seg.id}#${k}`, seg, t.pos * seg.length, t.mass, `${seg.name} – small branches`)));
    if (seg.endMass > 0) terms.push(mkTerm(`${seg.id}#end`, seg, seg.length, seg.endMass, `${seg.name} – distal bed`));
  }
  function mkTerm(key: string, seg: Segment, pos: number, mass: number, label: string): Terminal {
    const Qrest = mass * FLOW.totalRestingFlow;
    return { key, seg, pos, mass, label, Qrest, Rmin: (Pref - Pzf) / (Qrest * FLOW.maxCoronaryFlowReserve) };
  }

  // occlusions: terminals fed through an occluded point get no flow
  const occ: Record<string, number> = {};
  for (const l of lesions) if (l.occluded) { const sg = tree.byId[l.segId]; occ[l.segId] = Math.min(sg.length - HALF, Math.max(HALF, l.pos * sg.length)); }
  const blocked = (t: Terminal) => {
    let seg: Segment | null = t.seg, pos = t.pos;
    while (seg) {
      if (occ[seg.id] !== undefined && occ[seg.id] < pos) return true;
      if (!seg.parent) return false;
      pos = seg.attach * tree.byId[seg.parent].length; seg = tree.byId[seg.parent];
    }
    return false;
  };
  const isBlocked = terms.map(blocked);
  const demandOf = (t: Terminal) => (Number.isFinite(demandMult) ? demandMult : Infinity) * t.Qrest;

  let Q = terms.map((t, i) => (isBlocked[i] ? 0 : Math.min(demandOf(t), t.Qrest * FLOW.maxCoronaryFlowReserve)));
  const P: Record<string, number[]> = {}, Qs: Record<string, number[]> = {};
  let it = 0, omega = 0.5, prev = Infinity;
  const order = tree.segments; // parents precede children
  for (; it < 1500; it++) {
    const sub: Record<string, number> = Object.fromEntries(order.map((s) => [s.id, 0]));
    terms.forEach((t, i) => { let seg: Segment | null = t.seg; while (seg) { sub[seg.id] += Q[i]; seg = seg.parent ? tree.byId[seg.parent] : null; } });
    for (const seg of order) {
      const D = dense[seg.id], n = D.s.length;
      const ev: { pos: number; q: number }[] = [];
      terms.forEach((t, i) => { if (t.seg === seg) ev.push({ pos: t.pos, q: Q[i] }); });
      for (const cid of seg.children) ev.push({ pos: tree.byId[cid].attach * seg.length, q: sub[cid] });
      ev.sort((a, b) => a.pos - b.pos);
      const suffix = new Array(ev.length + 1).fill(0);
      for (let k = ev.length - 1; k >= 0; k--) suffix[k] = suffix[k + 1] + ev[k].q;
      const q: number[] = new Array(n); let ptr = 0;
      for (let i = 0; i < n; i++) { while (ptr < ev.length && ev[ptr].pos <= D.s[i] + 1e-9) ptr++; q[i] = suffix[ptr]; }
      let p0 = Pa;
      if (seg.parent) { const pp = P[seg.parent], ps = dense[seg.parent].s, x = seg.attach * tree.byId[seg.parent].length; p0 = interp(ps, pp, x); }
      const pr: number[] = new Array(n); pr[0] = p0;
      let i = 1;
      while (i < n) {
        if (D.lesion && i === D.w0 + 1) {
          const xs = D.s.slice(D.w0, D.w1 + 1).map((x) => (x - D.s[D.w0]) * 1e-3), ds = D.d.slice(D.w0, D.w1 + 1);
          const Qw = q[Math.floor((D.w0 + D.w1) / 2)];
          const pw = pressureAlong({ x: xs, d: ds }, D.ref, Qw, pr[D.w0]);
          for (let k = 1; k < pw.length; k++) pr[D.w0 + k] = pw[k];
          i = D.w1 + 1; continue;
        }
        const dx = (D.s[i] - D.s[i - 1]) * 1e-3;
        const g = (j: number) => q[j] / area(D.d[j]) ** 2;
        pr[i] = pr[i - 1] - 8 * Math.PI * BLOOD.viscosity * 0.5 * (g(i - 1) + g(i)) * dx;
        i++;
      }
      P[seg.id] = pr; Qs[seg.id] = q;
    }
    let maxDelta = 0;
    terms.forEach((t, i) => {
      if (isBlocked[i]) return;
      const Pd = interp(dense[t.seg.id].s, P[t.seg.id], t.pos);
      const cap = Math.max(0, (Pd - Pzf) / t.Rmin);
      const target = Math.min(demandOf(t), cap);
      const nq = (1 - omega) * Q[i] + omega * target;
      maxDelta = Math.max(maxDelta, Math.abs(nq - Q[i]) / t.Qrest);
      Q[i] = nq;
    });
    if (maxDelta < 1e-7) break;
    if (maxDelta > prev * 0.97) omega = Math.max(0.01, omega * 0.8); // back off when not improving (steep stenosis feedback)
    prev = maxDelta;
  }

  const seg: Record<string, SegResult> = {};
  for (const sg of tree.segments) {
    const D = dense[sg.id], q = Qs[sg.id];
    const blockedFrom = occ[sg.id] !== undefined ? occ[sg.id] : null;
    seg[sg.id] = {
      s: D.s, d: D.d, P: P[sg.id].map((v) => Math.max(v, 0)), Q: q,
      v: q.map((qq, i) => qq / area(D.d[i])),
      wss: q.map((qq, i) => (4 * BLOOD.viscosity * qq) / (Math.PI * (D.d[i] / 2) ** 3)),
      blockedFrom,
    };
  }
  const base = Number.isFinite(demandMult) ? demandMult : 1;
  const terminals: TerminalResult[] = terms.map((t, i) => {
    const Pd = Math.max(0, interp(dense[t.seg.id].s, P[t.seg.id], t.pos));
    const demand = base * t.Qrest, ratio = demand > 0 ? Q[i] / demand : 1;
    return { key: t.key, segId: t.seg.id, label: t.label, group: t.seg.group, mass: t.mass, Qrest: t.Qrest, Q: Q[i], Pd, demand, ratio, severity: severityTarget(Q[i], demand), blocked: isBlocked[i] };
  });
  const atRisk = terminals.reduce((a, t) => a + (t.ratio < 0.95 ? t.mass : 0), 0);
  return { seg, terminals, atRisk, iterations: it, pa: Pa };
}

function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  return ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / (xs[hi] - xs[lo]);
}

/** FFR of each lesion: hyperemic pressure just beyond the lesion window ÷ aortic pressure. */
export function lesionFFR(tree: Tree, lesions: Lesion[], hyper: NetResult): number[] {
  return lesions.map((l) => {
    const sg = tree.byId[l.segId], r = hyper.seg[sg.id];
    const sc = Math.min(sg.length - HALF, Math.max(HALF, l.pos * sg.length));
    return interp(r.s, r.P, Math.min(sg.length, sc + HALF + 3)) / hyper.pa;
  });
}

export interface Analysis { cond: NetResult; hyper: NetResult; ffr: number[] }
export function analyze(tree: Tree, lesions: Lesion[], exertion: boolean, aorticPressure = CORONARY.meanAorticPressure): Analysis {
  // FFR is defined at maximal hyperemia, so it keeps the reference pressure; the working state uses the live one.
  const hyper = solveNetwork(tree, lesions, Infinity);
  return { cond: solveNetwork(tree, lesions, exertion ? FLOW.exertionDemand : 1, aorticPressure), hyper, ffr: lesionFFR(tree, lesions, hyper) };
}
