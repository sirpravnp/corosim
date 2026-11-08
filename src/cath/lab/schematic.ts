import type { V3 } from "../../anatomy/curve";
import type { AccessSite, LabState, VGraph, VSeg } from "../../lab/types";
import { zoneOf } from "../../lab/camera";
import { smoothPath, wallLines, type P2 } from "../lumen";
import type { DeviceGeometry } from "./fluoro";
import { patientEllipsoids, spine } from "../body";

/**
 * The Overview: a schematic of the whole route from the puncture to the heart. A real C-arm cannot frame 600 mm of patient in one
 * picture, so this does not pretend to be fluoroscopy: no backdrop, no noise, a fixed front view, and it says so on the figure.
 * The layout is pure (tested); the drawing follows the site's design: bone ink and hairlines on the stage, no color.
 */

const COAST = ["LM", "LAD", "LCX", "D1", "D2", "OM1", "OM2", "RCA", "AM", "PDA_R", "PLV_R", "CONUS", "SAN", "AVN"];

/** The vessels the schematic draws for an access site: the trunk and its branches, the limb that was punctured, and the coronary tree. */
export function schematicVessels(g: VGraph, site: AccessSite | null): VSeg[] {
  const radial = site === "radial-R" || site === "radial-L";
  const trunk = ["AORTA_ABD", "AORTA_THOR", "ARCH", "AORTA_ASC", "INNOM", ...(radial ? ["RADIAL_R", "BRACH_R", "SUBCLAV_R"] : ["FEM_R", "FEM_L", "ILIAC_R", "ILIAC_L"])];
  const out: VSeg[] = [];
  for (const id of trunk) if (g.byId[id]) out.push(g.byId[id]);
  for (const b of g.branches ?? []) if (radial ? !/^(PROFUNDA|SFA|IIA)/.test(b.id) : true) out.push(b);
  for (const id of COAST) if (g.byId[id]) out.push(g.byId[id]);
  return out;
}

export interface SchematicLayout { scale: number; toScreen: (p: V3) => P2; bounds: { x0: number; x1: number; y0: number; y1: number } }

/** Fit the front view (x to the patient's left, y up) of these vessels into a W x H canvas with a margin, keeping the aspect. */
export function schematicLayout(segs: readonly VSeg[], W: number, H: number, margin = 40, rightGutter = 0): SchematicLayout {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of segs) for (const p of s.samples) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), availW = W - 2 * margin - rightGutter, availH = H - 2 * margin;
  const scale = Math.min(availW / w, availH / h), offX = margin + (availW - w * scale) / 2, offY = margin + (availH - h * scale) / 2;
  return { scale, bounds: { x0, x1, y0, y1 }, toScreen: (p) => [offX + (p[0] - x0) * scale, offY + (y1 - p[1]) * scale] };
}

/** The anatomical levels to mark, with the height (mm, patient frame) of each, in order from the access site toward the heart. */
export function schematicStations(g: VGraph, site: AccessSite | null): { name: string; y: number }[] {
  const radial = site === "radial-R" || site === "radial-L", y = (id: string, end: boolean) => { const s = g.byId[id]; return s ? s.samples[end ? s.samples.length - 1 : 0][1] : 0; };
  if (radial) return [
    { name: "Wrist", y: y("RADIAL_R", false) }, { name: "Elbow", y: y("BRACH_R", false) }, { name: "Shoulder", y: y("SUBCLAV_R", false) },
    { name: "Innominate", y: y("INNOM", false) }, { name: "Aortic root", y: y("AORTA_ASC", true) },
  ];
  return [
    { name: "Puncture", y: y("FEM_R", false) }, { name: "Groin", y: y("FEM_R", true) }, { name: "Aortic bifurcation", y: y("AORTA_ABD", false) },
    { name: "Diaphragm", y: y("AORTA_ABD", true) }, { name: "Arch", y: Math.max(...(g.byId.ARCH?.samples.map((p) => p[1]) ?? [0])) }, { name: "Aortic root", y: y("AORTA_ASC", true) },
  ];
}

const INK = "244,241,234", STEEL = "#98a0b8", HAIR = "#2b2f45";

export function drawSchematic(ctx: CanvasRenderingContext2D, W: number, H: number, g: VGraph, geom: DeviceGeometry, st: Readonly<LabState>) {
  const site = st.access ?? "femoral-R", segs = schematicVessels(g, site), L = schematicLayout(segs, W, H, 44, 110), S = L.toScreen;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  // level marks: a hairline from the label to the figure, and the label in the data face
  ctx.font = '11px "JetBrains Mono", ui-monospace, Menlo, monospace'; ctx.textBaseline = "middle"; ctx.textAlign = "right";
  for (const s of schematicStations(g, site)) {
    const y = S([0, s.y, 0])[1];
    ctx.strokeStyle = HAIR; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(W - 104, y); ctx.lineTo(W - 100, y); ctx.moveTo(40, y); ctx.lineTo(W - 104, y); ctx.setLineDash([2, 5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = STEEL; ctx.fillText(s.name, W - 12, y);
  }
  // context, in hairlines: the vertebral column and the heart's outline, so the levels read as places in a body
  ctx.strokeStyle = HAIR; ctx.lineWidth = 1;
  for (const v of spine()) { if (v.c[1] > L.bounds.y1 + 10 || v.c[1] < L.bounds.y0 - 10) continue; const a = S([v.c[0] - v.size[0] / 2, v.c[1] + v.size[2] / 2, 0]), b = S([v.c[0] + v.size[0] / 2, v.c[1] - v.size[2] / 2, 0]); ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
  const hc: V3 = g.byId.LM ? [g.byId.LM.samples[0][0] + 20, g.byId.LM.samples[0][1] - 40, 0] : [10, 0, 0];
  for (const e of patientEllipsoids(hc).filter((q) => q.group === "heart")) {
    const roll = ((e.roll ?? 0) * Math.PI) / 180, c = S(e.c); ctx.beginPath();
    ctx.ellipse(c[0], c[1], e.a[0] * L.scale, e.a[1] * L.scale, -roll, 0, 6.283); ctx.stroke();
  }
  // vessels as lumens: a faint body and two wall lines, widths from the real diameters
  for (const seg of segs) {
    const coronary = zoneOf(seg.id, 0) === "coronary", pts = seg.samples.map(S);
    const { left, right } = wallLines(pts, seg.diameterMm.map((d) => (coronary ? Math.max(1.4, d * L.scale * 1.4) : Math.max(2.2, d * L.scale))), undefined, 1.4);
    ctx.beginPath(); left.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]); ctx.closePath();
    ctx.fillStyle = `rgba(${INK},${coronary ? 0.2 : 0.07})`; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = `rgba(${INK},${coronary ? 0.45 : 0.5})`;
    for (const edge of [left, right]) { ctx.beginPath(); edge.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); }
  }
  // devices
  const draw = (v: V3[], width: number, a: number) => {
    if (v.length < 2) return;
    const pts = smoothPath(v.map(S), 2); ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.lineWidth = width; ctx.strokeStyle = `rgba(${INK},${a})`; ctx.stroke();
  };
  draw(geom.guide, 3, 0.9); draw(geom.wire, 1.4, 1);
  if (geom.balloon) draw(geom.balloon.path, 5, geom.balloon.inflatedAtm > 0 ? 0.9 : 0.5);
  if (geom.stent) draw(geom.stent.path, 5, geom.stent.deployed ? 0.9 : 0.5);
  const tip = geom.wireTip ?? geom.guide[geom.guide.length - 1];
  if (tip) { const [x, y] = S(tip); ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 6, 0, 6.283); ctx.stroke(); }
  // what the figure is, and a scale
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = STEEL;
  ctx.fillText("Schematic route, front view. Not fluoroscopy.", 14, 24);
  const bar = 100 * L.scale; ctx.strokeStyle = STEEL; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(14, H - 22); ctx.lineTo(14 + bar, H - 22); ctx.moveTo(14, H - 26); ctx.lineTo(14, H - 18); ctx.moveTo(14 + bar, H - 26); ctx.lineTo(14 + bar, H - 18); ctx.stroke();
  ctx.fillText("100 mm", 14, H - 30);
}
