import type { V3 } from "../../anatomy/curve";
import type { Balloon, Device, LabState, Plaque, Stent, VGraph, VSeg } from "../../lab/types";
import { AngioOptions, frameOf, type Frame } from "../angio";
import { routeTo } from "../../lab/route";
import { zoneOf } from "../../lab/camera";
import { arcLengths, balloonProfile, smoothPath, wallLines, type P2 } from "../lumen";

/** Where each device is, as patient-frame polylines (mm). Pure, so the tests can check it without a canvas. */
export interface DeviceGeometry {
  guide: V3[];
  wire: V3[];
  wireTip: V3 | null;
  balloon?: { from: V3; to: V3; diameterMm: number; inflatedAtm: number; path: V3[]; segId: string; centerMm: number; lengthMm: number; nominalAtm: number };
  stent?: { from: V3; to: V3; diameterMm: number; deployed: boolean; path: V3[] };
  /** Radiopaque markers: the two balloon or stent ends. */
  markers: V3[];
}

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The centerline from the puncture along `route`, to `tipMm` along `tipSeg`; a branch is joined at the point where it leaves its parent. */
function pathTo(g: VGraph, route: readonly string[], tipSeg: string, tipMm: number): V3[] {
  const out: V3[] = [];
  const push = (p: V3) => { if (!out.length || dist(out[out.length - 1], p) > 0.25) out.push(p); };
  for (let k = 0; k < route.length; k++) {
    const seg = g.byId[route[k]];
    if (!seg) break;
    const NS = seg.samples.length - 1;
    let last = NS;
    if (route[k] === tipSeg) last = Math.min(NS, Math.max(0, Math.round((tipMm / seg.length) * NS)));
    else { const next = g.byId[route[k + 1] ?? ""]; if (next && next.parent === seg.id) last = Math.min(NS, Math.round(next.attach * NS)); }
    for (let i = 0; i <= last; i++) push(seg.samples[i]);
    if (route[k] === tipSeg) break;
  }
  return out;
}

/** The points of a vessel from `lengthMm` centered at `centerMm`: both ends and every sample between, so a device can follow the vessel's bends. */
function span(g: VGraph, segId: string, centerMm: number, lengthMm: number): { from: V3; to: V3; path: V3[] } | null {
  const seg = g.byId[segId];
  if (!seg) return null;
  const NS = seg.samples.length - 1, ix = (mm: number) => Math.min(NS, Math.max(0, Math.round((mm / seg.length) * NS)));
  const a = ix(centerMm - lengthMm / 2), b = ix(centerMm + lengthMm / 2);
  return { from: seg.samples[a], to: seg.samples[b], path: seg.samples.slice(a, b + 1) };
}

export function deviceGeometry(st: Readonly<LabState>, g: VGraph, plaques: readonly Plaque[], lookup: (id: string) => Device | undefined): DeviceGeometry {
  const out: DeviceGeometry = { guide: [], wire: [], wireTip: null, markers: [] };
  const w = st.wire;
  if (st.guide && st.access) {
    // the guide runs from the puncture along the access route to its own tip: the aortic root until it is engaged, then the ostium
    const target = st.guide.engaged === "RCA" ? "RCA" : "LM";
    let route: readonly string[] = w?.route?.length ? w.route : [];
    if (!route.includes(st.guide.tipSeg)) { try { route = routeTo(g, st.access, target); } catch { route = []; } }
    if (route.includes(st.guide.tipSeg)) out.guide = pathTo(g, route, st.guide.tipSeg, st.guide.tipMm);
    else {
      const ostium = st.guide.engaged ? g.ostium[st.guide.engaged].segId : null;
      const ids = route.length ? route : Object.values(g.byId).filter((s) => !s.parent).slice(0, 1).map((s) => s.id);
      const stop = ostium ? ids.indexOf(ostium) : -1;
      const upTo = stop >= 0 ? ids.slice(0, stop + 1) : ids;
      const last = upTo[upTo.length - 1];
      out.guide = last ? pathTo(g, upTo, last, ostium ? 0 : g.byId[last].length) : [];
    }
  }
  if (w) {
    out.wire = pathTo(g, w.route, w.tipSeg, w.tipMm);
    out.wireTip = out.wire.length ? out.wire[out.wire.length - 1] : null;
  }
  void plaques;
  if (st.balloon) {
    const b = lookup(st.balloon.id) as Balloon | undefined, s = b ? span(g, st.balloon.segId, st.balloon.centerMm, b.lengthMm) : null;
    if (b && s) {
      const d = b.nominalMm + b.slopeMmPerAtm * ((st.balloon.inflatedAtm || b.nominalAtm) - b.nominalAtm);
      out.balloon = { ...s, diameterMm: st.balloon.inflatedAtm > 0 ? d : Math.min(1, d), inflatedAtm: st.balloon.inflatedAtm, segId: st.balloon.segId, centerMm: st.balloon.centerMm, lengthMm: b.lengthMm, nominalAtm: b.nominalAtm };
      out.markers.push(s.from, s.to);
    }
  }
  if (st.stent && !out.balloon) {
    const sd = lookup(st.stent.id) as Stent | undefined, s = sd ? span(g, st.stent.segId, st.stent.centerMm, sd.lengthMm) : null;
    if (sd && s) { out.stent = { ...s, diameterMm: sd.nominalMm, deployed: st.stent.deployed }; out.markers.push(s.from, s.to); }
  }
  if (st.stent?.deployed && !out.stent) {
    const sd = lookup(st.stent.id) as Stent | undefined, s = sd ? span(g, st.stent.segId, st.stent.centerMm, sd.lengthMm) : null;
    if (sd && s) out.stent = { ...s, diameterMm: sd.nominalMm, deployed: true };
  }
  return out;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

/**
 * Draws the devices. They go on an attenuation canvas (`att`: white is dense) that the angiogram reads as part of its optical density,
 * so a wire gets the same noise, scatter and display curve as the anatomy instead of sitting on it like a vector overlay. The roadmap,
 * which is a monitor feature and not x-ray, and the counters go on the visible canvas. Everything maps through the angiogram's `frameOf`,
 * so a wire lies on its vessel and moves with the heart.
 */
/** The shaped wire tip as the detector sees it: how far it reaches along the shaft and to the side, per unit limb length. */
export function tipView(bendDeg: number, rotDeg: number): { along: number; side: number } {
  const b = (bendDeg * Math.PI) / 180, r = (rotDeg * Math.PI) / 180;
  return { along: Math.cos(b), side: Math.sin(b) * Math.cos(r) };
}

export class FluoroView {
  private ctx: CanvasRenderingContext2D;
  readonly att: HTMLCanvasElement; private A: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.att = document.createElement("canvas"); this.att.width = canvas.width; this.att.height = canvas.height;
    this.A = this.att.getContext("2d")!;
  }

  /** The devices as attenuation. Radiopacity, from most to least: marker bands, the wire's distal coil, the guide's braided wall, stent struts, the contrast in an inflated balloon. */
  private paintDevices(F: Frame, geom: DeviceGeometry, st: Readonly<LabState>, plaques: readonly Plaque[], g: VGraph | null) {
    const A = this.A, W = this.att.width, H = this.att.height, sc = F.sc, S = (p: V3): P2 => F.toScreen(p);
    A.globalCompositeOperation = "source-over"; A.fillStyle = "#000"; A.fillRect(0, 0, W, H); A.globalCompositeOperation = "lighter";
    A.lineCap = "butt"; A.lineJoin = "round";
    const white = (a: number) => `rgba(255,255,255,${a})`;
    const trace = (pts: P2[]) => { A.beginPath(); pts.forEach((p, i) => (i ? A.lineTo(p[0], p[1]) : A.moveTo(p[0], p[1]))); };
    const ribbon = (L: P2[], R: P2[]) => { A.beginPath(); L.forEach((p, i) => (i ? A.lineTo(p[0], p[1]) : A.moveTo(p[0], p[1]))); for (let i = R.length - 1; i >= 0; i--) A.lineTo(R[i][0], R[i][1]); A.closePath(); };
    const bar = (p: P2, a: P2, lenPx: number, wPx: number, alpha: number) => {
      const dx = a[0] - p[0], dy = a[1] - p[1], l = Math.hypot(dx, dy) || 1, tx = dx / l, ty = dy / l;
      A.beginPath(); A.moveTo(p[0] - tx * lenPx / 2, p[1] - ty * lenPx / 2); A.lineTo(p[0] + tx * lenPx / 2, p[1] + ty * lenPx / 2);
      A.lineWidth = wPx; A.strokeStyle = white(alpha); A.stroke();
    };
    const dirNear = (pts: P2[], i: number): P2 => pts[Math.min(pts.length - 1, i + 1)] === pts[i] ? pts[Math.max(0, i - 1)] : pts[Math.min(pts.length - 1, i + 1)];

    // the guide: a braided wall (two dense edges) around a lighter lumen, with a soft tip
    if (geom.guide.length > 1) {
      const pts = smoothPath(geom.guide.map(S), 2), wpx = Math.max(3.4, 1.9 * sc), { left, right } = wallLines(pts, pts.map(() => wpx), undefined, 3);
      ribbon(left, right); A.fillStyle = white(0.3); A.fill(); // a braided tube is a solid gray band, a little denser at the wall
      for (const edge of [left, right]) { trace(edge); A.lineWidth = Math.max(1.1, 0.3 * sc); A.strokeStyle = white(0.05); A.stroke(); }
      const tail = pts.slice(-Math.max(2, Math.round(pts.length * 0.03))); // the distal shaft is softer and carries a marker band
      bar(pts[pts.length - 1], tail[0], Math.max(3, 1.2 * sc), wpx, 0.2);
    }
    // the wire: a thin core, then a denser distal coil with a rounded tip that is bent a little
    if (geom.wire.length > 1) {
      const pts = smoothPath(geom.wire.map(S), 2), cum = arcLengths(pts), total = cum[cum.length - 1], coilPx = 30 * sc;
      trace(pts); A.lineWidth = Math.max(1.05, 0.4 * sc); A.strokeStyle = white(0.42); A.stroke();
      const from = Math.max(0, cum.findIndex((c) => c >= total - coilPx));
      const coil = pts.slice(from);
      if (coil.length > 1) { trace(coil); A.lineWidth = Math.max(1.5, 0.62 * sc); A.strokeStyle = white(0.34); A.stroke(); A.save(); A.setLineDash([Math.max(1, 0.5 * sc), Math.max(1, 0.35 * sc)]); trace(coil); A.lineWidth = Math.max(1.5, 0.62 * sc); A.strokeStyle = white(0.22); A.stroke(); A.restore(); }
      const tip = pts[pts.length - 1], prev = pts[Math.max(0, pts.length - 4)], dx = tip[0] - prev[0], dy = tip[1] - prev[1], l = Math.hypot(dx, dy) || 1;
      // The shaped tip is a short limb bent `bendDeg` off the shaft; torque spins it about the shaft. Seen from the detector, the limb's
      // sideways reach is sin(bend)·cos(rot): it swings to one side, shortens as it turns toward or away from the tube, and comes out
      // the other side past 90 degrees. A straight wire has no limb to show.
      const t = tipView(st.wire?.bendDeg ?? 0, st.wire?.rotDeg ?? 0), len = Math.max(6, 3.6 * sc);
      const ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
      const jx = tip[0] + (ux * t.along + nx * t.side) * len, jy = tip[1] + (uy * t.along + ny * t.side) * len;
      A.beginPath(); A.moveTo(tip[0], tip[1]); A.lineTo(jx, jy); A.lineWidth = Math.max(1.5, 0.62 * sc); A.strokeStyle = white(0.4); A.stroke();
      A.beginPath(); A.arc(jx, jy, Math.max(0.9, 0.34 * sc), 0, 6.283); A.fillStyle = white(0.5); A.fill();
    }
    // the balloon: invisible deflated except for its two marker bands; inflated it holds dilute contrast, waisted where the lesion resists
    if (geom.balloon && geom.balloon.path.length > 1) {
      const b = geom.balloon, pts = smoothPath(b.path.map(S), 1), n = pts.length;
      const pl = plaques.find((p) => p.segId === b.segId && Math.abs(p.centerMm - b.centerMm) < p.lengthMm / 2 + b.lengthMm / 2);
      const prof = balloonProfile(n, b.lengthMm, b.diameterMm / 2, b.inflatedAtm, b.nominalAtm, pl ? { offsetMm: pl.centerMm - b.centerMm, lengthMm: pl.lengthMm, lumenRadiusMm: (pl.referenceMm * (1 - pl.ds)) / 2 } : undefined);
      const { left, right } = wallLines(pts, prof.map((r) => Math.max(2, 2 * r * sc)), undefined, 2);
      ribbon(left, right); A.fillStyle = white(b.inflatedAtm > 0 ? 0.2 : 0.06); A.fill();
      for (const edge of [left, right]) { trace(edge); A.lineWidth = 1; A.strokeStyle = white(b.inflatedAtm > 0 ? 0.3 : 0.12); A.stroke(); }
    }
    // the stent: a diamond mesh of struts across its width
    if (geom.stent && geom.stent.path.length > 1) {
      const s = geom.stent, pts = smoothPath(s.path.map(S), 1), n = pts.length, wpx = Math.max(2.6, s.diameterMm * sc * (s.deployed ? 1 : 0.38));
      const { left, right } = wallLines(pts, pts.map(() => wpx), undefined, 2);
      for (const edge of [left, right]) { trace(edge); A.lineWidth = s.deployed ? 1.1 : 1.6; A.strokeStyle = white(s.deployed ? 0.34 : 0.5); A.stroke(); }
      const cells = Math.max(4, Math.round(n / 1.6));
      A.beginPath();
      for (let c = 0; c < cells; c++) {
        const i = Math.floor((c / cells) * (n - 1)), j = Math.min(n - 1, Math.floor(((c + 1) / cells) * (n - 1)));
        A.moveTo(left[i][0], left[i][1]); A.lineTo(right[j][0], right[j][1]); A.moveTo(right[i][0], right[i][1]); A.lineTo(left[j][0], left[j][1]);
      }
      A.lineWidth = 0.8; A.strokeStyle = white(s.deployed ? 0.2 : 0.3); A.stroke();
    }
    // platinum marker bands at the two ends: the densest thing on the screen
    for (const m of geom.markers) {
      const k = [geom.balloon?.path, geom.stent?.path].find((p) => p && p.length > 1);
      const p = S(m), toward = k ? S(k[Math.min(k.length - 1, Math.max(0, k.indexOf(m) === 0 ? 1 : k.length - 2))]) : [p[0], p[1] + 1] as P2;
      const dx = toward[0] - p[0], dy = toward[1] - p[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, half = Math.max(2.2, 0.55 * sc * 1.4);
      A.beginPath(); A.moveTo(p[0] - nx * half, p[1] - ny * half); A.lineTo(p[0] + nx * half, p[1] + ny * half);
      A.lineWidth = Math.max(2.2, 1.3 * sc * 0.55); A.strokeStyle = white(0.8); A.stroke();
    }
    void dirNear; void g;
  }

  draw(now: number, centre: V3, opts: AngioOptions, geom: DeviceGeometry, st: Readonly<LabState>, roadmap: VGraph | null = null, plaques: readonly Plaque[] = []) {
    const { width: W, height: H } = this.canvas, C = this.ctx;
    const F = frameOf(centre, opts, now, W, H), sc = F.sc;
    this.paintDevices(F, geom, st, plaques, roadmap);
    C.clearRect(0, 0, W, H);
    C.save(); C.beginPath(); C.arc(W / 2, H / 2, W * 0.47, 0, 6.283); C.clip(); // the monitor draws only inside the collimated field
    // the roadmap: the access vessels as a faint outline on the monitor, only where there is no dye of the angiogram's own
    if (roadmap) {
      const all: VSeg[] = [...roadmap.segs, ...(roadmap.branches ?? [])];
      for (const seg of all) {
        if (zoneOf(seg.id, 0) === "coronary") continue;
        const pts = seg.samples.map((p) => F.toScreen(p)), { left, right } = wallLines(pts, seg.diameterMm.map((d) => d * sc), undefined, 2);
        C.beginPath(); left.forEach((p, i) => (i ? C.lineTo(p[0], p[1]) : C.moveTo(p[0], p[1]))); for (let i = right.length - 1; i >= 0; i--) C.lineTo(right[i][0], right[i][1]); C.closePath();
        C.fillStyle = "rgba(244,241,234,.045)"; C.fill();
        C.lineWidth = 1; C.strokeStyle = "rgba(244,241,234,.2)";
        for (const edge of [left, right]) { C.beginPath(); edge.forEach((p, i) => (i ? C.lineTo(p[0], p[1]) : C.moveTo(p[0], p[1]))); C.stroke(); }
      }
    }
    C.restore();
    // the counters a lab monitor prints in the corner
    C.font = '12px "JetBrains Mono", ui-monospace, Menlo, monospace'; C.textBaseline = "alphabetic"; C.fillStyle = "rgba(220,220,210,.85)"; C.textAlign = "right";
    C.fillText(`FLUORO ${fmtTime(st.fluoroSeconds)}  AK ${Math.round(st.doseMGy)} mGy`, W - 14, H - 32);
    C.fillText(`CONTRAST ${st.contrastMl} mL`, W - 14, H - 14);
    if (geom.balloon && geom.balloon.inflatedAtm > 0) { C.fillStyle = "rgba(255,235,120,.95)"; C.fillText(`INFLATED ${geom.balloon.inflatedAtm} ATM`, W - 14, 42); }
    C.textAlign = "left";
  }
}
