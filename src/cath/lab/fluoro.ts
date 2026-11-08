import type { V3 } from "../../anatomy/curve";
import type { Balloon, Device, LabState, Plaque, Stent, VGraph } from "../../lab/types";
import { AngioOptions, frameOf } from "../angio";
import { routeTo } from "../../lab/route";
import { zoneOf } from "../../lab/camera";

/** Where each device is, as patient-frame polylines (mm). Pure, so the tests can check it without a canvas. */
export interface DeviceGeometry {
  guide: V3[];
  wire: V3[];
  wireTip: V3 | null;
  balloon?: { from: V3; to: V3; diameterMm: number; inflatedAtm: number };
  stent?: { from: V3; to: V3; diameterMm: number; deployed: boolean };
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

/** A point `mm` along a vessel, and the one `halfLen` either side of it on the same vessel. */
function span(g: VGraph, segId: string, centerMm: number, lengthMm: number): { from: V3; to: V3 } | null {
  const seg = g.byId[segId];
  if (!seg) return null;
  const NS = seg.samples.length - 1, at = (mm: number) => seg.samples[Math.min(NS, Math.max(0, Math.round((mm / seg.length) * NS)))];
  return { from: at(centerMm - lengthMm / 2), to: at(centerMm + lengthMm / 2) };
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
      out.balloon = { ...s, diameterMm: st.balloon.inflatedAtm > 0 ? d : Math.min(1, d), inflatedAtm: st.balloon.inflatedAtm };
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
 * Draws the devices over the angiogram. It sits on a second canvas stacked on the angiogram's, and maps patient-frame points through
 * the same `frameOf` the angiogram uses, so a wire lies on its vessel and moves with the heart. Devices are radiopaque: dark, no color.
 */
export class FluoroView {
  private ctx: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement) { this.ctx = canvas.getContext("2d")!; }

  draw(now: number, centre: V3, opts: AngioOptions, geom: DeviceGeometry, st: Readonly<LabState>, roadmap: VGraph | null = null) {
    const { width: W, height: H } = this.canvas, C = this.ctx;
    C.clearRect(0, 0, W, H);
    const F = frameOf(centre, opts, now, W, H), sc = F.sc, S = (p: V3) => F.toScreen(p);
    const line = (pts: V3[], width: number, style: string) => {
      if (pts.length < 2) return;
      C.beginPath(); pts.forEach((p, i) => { const [x, y] = S(p); if (i) C.lineTo(x, y); else C.moveTo(x, y); });
      C.lineWidth = width; C.strokeStyle = style; C.lineCap = "round"; C.lineJoin = "round"; C.stroke();
    };
    if (roadmap) for (const seg of roadmap.segs) {
      if (zoneOf(seg.id, 0) === "coronary") continue; // the coronaries are the angiogram's
      for (let i = 1; i < seg.samples.length; i++) line([seg.samples[i - 1], seg.samples[i]], Math.max(2, seg.diameterMm[i] * sc), "rgba(12,12,14,.26)");
    }
    line(geom.guide, Math.max(4, 1.8 * sc * 0.9), "rgba(18,18,20,.78)");
    line(geom.guide, 1.2, "rgba(210,210,205,.35)"); // the lumen of the catheter reads lighter down its middle
    line(geom.wire, 1.7, "rgba(0,0,0,.92)");
    if (geom.balloon) {
      const b = geom.balloon, a = S(b.from), z = S(b.to), w = Math.max(3, b.diameterMm * sc);
      C.lineCap = "butt"; C.strokeStyle = b.inflatedAtm > 0 ? "rgba(235,235,225,.55)" : "rgba(235,235,225,.2)"; C.lineWidth = w;
      C.beginPath(); C.moveTo(a[0], a[1]); C.lineTo(z[0], z[1]); C.stroke();
    }
    if (geom.stent) {
      const s = geom.stent, a = S(s.from), z = S(s.to), w = Math.max(3, s.diameterMm * sc * 0.9);
      const dx = z[0] - a[0], dy = z[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, n = Math.max(3, Math.round(len / 3));
      C.strokeStyle = s.deployed ? "rgba(0,0,0,.8)" : "rgba(0,0,0,.45)"; C.lineWidth = 0.9; C.lineCap = "butt"; C.beginPath();
      for (let i = 0; i <= n; i++) {
        const u = i / n, x = a[0] + dx * u, y = a[1] + dy * u, sg = i % 2 ? 1 : -1;
        C.lineTo(x + nx * w * 0.5 * sg, y + ny * w * 0.5 * sg);
      }
      C.stroke();
    }
    for (const m of geom.markers) { const [x, y] = S(m); C.fillStyle = "rgba(0,0,0,.95)"; C.fillRect(x - 3, y - 1.5, 6, 3); }
    if (geom.wireTip) { const [x, y] = S(geom.wireTip); C.fillStyle = "rgba(0,0,0,.95)"; C.beginPath(); C.arc(x, y, 2.2, 0, 6.283); C.fill(); }
    // the counters a lab monitor prints in the corner
    C.font = '12px "JetBrains Mono", ui-monospace, Menlo, monospace'; C.textBaseline = "alphabetic"; C.fillStyle = "rgba(220,220,210,.85)"; C.textAlign = "right";
    C.fillText(`FLUORO ${fmtTime(st.fluoroSeconds)}  AK ${Math.round(st.doseMGy)} mGy`, W - 14, H - 32);
    C.fillText(`CONTRAST ${st.contrastMl} mL`, W - 14, H - 14);
    if (geom.balloon && geom.balloon.inflatedAtm > 0) { C.fillStyle = "rgba(255,235,120,.95)"; C.fillText(`INFLATED ${geom.balloon.inflatedAtm} ATM`, W - 14, 42); }
    C.textAlign = "left";
  }
}
