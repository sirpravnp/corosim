import { ctHeartFromBytes } from "../anatomy/ctHeart";
import heartMeta from "../cath/data/heart.json";
import { ctMesh, useCtHeart } from "./ctEcho";
import { LANDMARKS_HEART_FRAME as L, Pose, buildPoses, toHeart } from "./poses";
import { TeeControls, teePose, teeViews } from "./tee";
import { CASE_BY_ID } from "./cases";
import { EchoBeat, beatOf, frameAt } from "./beat";
import { frameFor, pxPerMm, rasterize } from "./paint";
import { structureLabels } from "./labels";
import { acquire, scanConvertRGBA, EchoWindow, grayMap } from "./scan";
import { jetsAt, JetOptions } from "./flow";
import { spectrum, standardDoppler, SpectralMode } from "./doppler";
import { mLineFor, mmode, mmodeMeasures, simpsonBiplane } from "./measure";
import { aimAt } from "./doppler";
import { ctHeart, ctGeom, ctLandmarksHeart } from "./ctEcho";
import { ctToHeart } from "../anatomy/ctHeart";
import { SECTOR, toPatient } from "./poses";
import type { V3 } from "../anatomy/curve";

/**
 * The echo page's engine, off the main thread: it loads the CT heart (about a second to build its distance fields), holds the current
 * patient's beat, and renders on request: B-mode and color frames, M-mode and spectral strips, and the measurement report. Messages
 * are plain data (poses are arrays); pixels come back as transferred RGBA buffers.
 */
export type ViewRef = { approach: "tte"; pose: Pose; window: EchoWindow } | { approach: "tee"; controls: TeeControls };

/** A structure label: its short name and a point inside its cavity, mm from the probe (depth along the beam, lateral to the right). */
export interface Label { text: string; depth: number; lateral: number }

export type Request =
  | { type: "init" }
  | { type: "case"; id: string }
  | { type: "frame"; key: number; view: ViewRef; w: number; h: number; t: number; frameNo: number; draft: boolean; gain: number; color: null | { nyquist: number }; labels?: boolean }
  | { type: "strip"; key: number; view: ViewRef; w: number; h: number; mode: "mmode" | SpectralMode; lineAngle: number; gateDepth: number; scale?: number; baseline?: number }
  | { type: "measure" }
  | { type: "aim"; key: number; view: ViewRef; viewId: string; mode: "mmode" | SpectralMode };

export type Reply =
  | { type: "ready"; tte: Record<string, Pose>; tee: Record<string, TeeControls>; teeProbe: Record<string, V3>; mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; parts: Uint8Array } }
  | { type: "case"; id: string; hr: number; period: number; frames: number; ed: number; es: number; engine: { ef: number; edv: number; esv: number; sv: number; avMean: number; mvMean: number; rvSys: number } }
  | { type: "frame"; key: number; w: number; h: number; rgba: ArrayBuffer; pose: Pose; depth: number; pxPerMm: number; t: number; labels?: Label[] }
  | { type: "strip"; key: number; w: number; h: number; rgba: ArrayBuffer; top: number; bottom: number; seconds: number; nyquist: number; depth: number }
  | { type: "measure"; report: Record<string, number | null> }
  | { type: "aim"; key: number; lineAngle: number; gateDepth: number; target: string }
  | { type: "error"; message: string };

/** The worker's own scope, typed here so the project's DOM types are not mixed with the worker library's. */
const scope = self as unknown as { postMessage(m: unknown, transfer: Transferable[]): void; onmessage: ((ev: MessageEvent<Request>) => void) | null };
const post = (r: Reply, transfer: Transferable[] = []) => scope.postMessage(r, transfer);

let beat: EchoBeat | null = null;
let tte: Record<string, Pose> = {};

async function loadHeart() {
  const res = await fetch(new URL("../cath/data/heart.bin.gz", import.meta.url));
  let buf = new Uint8Array(await res.arrayBuffer());
  // a server may already have decoded the gzip (Content-Encoding); decompress only if the gzip magic is still there
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  const h = ctHeartFromBytes(buf, heartMeta);
  useCtHeart(h, { apex: L.apex, mv: L.mitral, av: L.aortic, tv: L.tricuspid }, toHeart);
}

const jetOptions = (b: EchoBeat): JetOptions => ({ asdOpen: b.heart.asdMm > 0, stenotic: { AV: b.heart.valves.av.openMax < 0.8, MV: b.heart.valves.mv.openMax < 0.8 } });
const smokeOf = (b: EchoBeat) => Math.max(0, Math.min(1, (0.45 - b.lvEf) / 0.25));

function resolve(v: ViewRef): { pose: Pose; window: EchoWindow } {
  if (v.approach === "tte") return { pose: v.pose, window: v.window };
  return { pose: teePose(v.controls, 140), window: "tee" };
}

let valves: { av: V3; pv: V3 } | null = null;
const valvesFor = () => (valves ??= { av: toPatient(ctLandmarksHeart().av), pv: toPatient(ctLandmarksHeart().pv) });

function frame(r: Extract<Request, { type: "frame" }>) {
  const b = beat!, { pose, window } = resolve(r.view), fr = frameFor(pose, r.w / r.h), px = pxPerMm(fr, r.h);
  const t = r.t, f = frameAt(b, t);
  const color = r.color ? { jets: jetsAt(b.wave, t, jetOptions(b)), box: { a0: -0.38, a1: 0.38, r0: 8, r1: fr.depth }, nyquist: r.color.nyquist } : undefined;
  const pol = acquire(pose, fr.depth, { heart: b.heart, frame: f }, { window, frameNo: r.frameNo, gain: r.gain, smoke: smokeOf(b), lines: r.draft ? 64 : 160, dr: r.draft ? 0.55 : 0.33, color });
  const rgba = scanConvertRGBA(pol, r.w, r.h, px);
  // labels: the chambers and the aorta found on a coarse raster of the same frame, each anchored in its own cavity
  const labels = r.labels ? structureLabels(rasterize(pose, 160, Math.round((160 * r.h) / r.w), fr, { heart: b.heart, frame: f }), { pose, ...valvesFor() })
    .map((l) => ({ text: l.text, depth: l.depth, lateral: l.lateral })) : undefined;
  post({ type: "frame", key: r.key, w: r.w, h: r.h, rgba: rgba.buffer as ArrayBuffer, pose, depth: fr.depth, pxPerMm: px, t, labels }, [rgba.buffer]);
}

function strip(r: Extract<Request, { type: "strip" }>) {
  const b = beat!, { pose, window } = resolve(r.view), out = new Uint8ClampedArray(r.w * r.h * 4);
  if (r.mode === "mmode") {
    const fr = frameFor(pose, 0.9), m = mmode(b, pose, r.lineAngle, fr.depth, { beats: 2, perBeat: 150, window });
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const j = Math.min(m.samples - 1, Math.floor((y / r.h) * m.samples)), c = Math.min(m.columns - 1, Math.floor((x / r.w) * m.columns));
      const g = grayMap(m.img[j * m.columns + c]), o = (y * r.w + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255;
    }
    post({ type: "strip", key: r.key, w: r.w, h: r.h, rgba: out.buffer, top: 0, bottom: fr.depth, seconds: 2 * b.period, nyquist: Infinity, depth: fr.depth }, [out.buffer]);
    return;
  }
  const s = spectrum(b, { pose, mode: r.mode, lineAngle: r.lineAngle, gateDepth: r.gateDepth, beats: 2, columns: 180, scale: r.scale, baseline: r.baseline }, jetOptions(b));
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const k = Math.min(s.bins - 1, Math.floor((y / r.h) * s.bins)), c = Math.min(s.columns - 1, Math.floor((x / r.w) * s.columns));
    const g = Math.round(255 * Math.pow(s.img[k * s.columns + c], 1.2)), o = (y * r.w + x) * 4;
    out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255;
  }
  post({ type: "strip", key: r.key, w: r.w, h: r.h, rgba: out.buffer, top: s.top, bottom: s.bottom, seconds: 2 * b.period, nyquist: s.nyquist, depth: 0 }, [out.buffer]);
}

/**
 * Where a sonographer would first put the cursor in this view and mode: the M-mode line through the LV at the chordal level; PW at the
 * mitral leaflet tips, or in the LV outflow tract in the views that show it; CW through the aortic valve where it is in line with the beam,
 * else through the tricuspid valve for the regurgitant jet, else the mitral valve; TDI on the septal mitral annulus. A target outside the
 * sector falls back to the sector's center line.
 */
const OUTFLOW_VIEWS = new Set(["a5c", "a3c", "me-lax", "me-av-lax", "deep-tg"]);
const TRICUSPID_VIEWS = new Set(["rv-inflow", "psax-av", "me-rv-io", "subcostal"]);
function aim(r: Extract<Request, { type: "aim" }>) {
  const { pose } = resolve(r.view), h = ctHeart()!, V = h.meta.valves;
  // the valves ride on the base, which descends toward the apex in systole: aim at a valve where it is when its flow peaks (as
  // standardDoppler does), or a narrow stenotic jet slips past the cursor; the base's descent runs along the CT z axis
  const w = beat!.wave, g = ctGeom()!, peak = (q: Float32Array, sign: number) => { let bi = 0; for (let i = 0; i < w.n; i++) if (sign * q[i] > sign * q[bi]) bi = i; return bi; };
  const drop = (valve: "AV" | "MV" | "TV") => w.long[valve === "AV" ? peak(w.q.AV, 1) : valve === "MV" ? peak(w.q.MV, 1) : peak(w.q.TV, -1)] * g.length;
  let dz = 0;
  const cm = (v: number[], n?: number[], k = 0): V3 => [v[0] * 10 + (n ? n[0] * k : 0), v[1] * 10 + (n ? n[1] * k : 0), v[2] * 10 + (n ? n[2] * k : 0) - dz];
  const P = (c: V3) => toPatient(ctToHeart(h, c));
  let target = "the sector's center", p: V3 | null = null, line: { lineAngle: number; gateDepth: number } | null = null;
  const vv = r.mode === "tdi" || r.mode === "mmode" ? null : OUTFLOW_VIEWS.has(r.viewId) ? "AV" : TRICUSPID_VIEWS.has(r.viewId) || (r.mode === "cw" && r.viewId === "a4c") ? "TV" : "MV";
  if (vv) dz = drop(vv);
  if (r.mode === "mmode") { line = mLineFor(pose); target = "the LV at the chordal level"; }
  else if (r.mode === "pw") {
    if (OUTFLOW_VIEWS.has(r.viewId)) { p = P(cm(V.AV.c, V.AV.n, -8)); target = "the LV outflow tract"; }
    else if (TRICUSPID_VIEWS.has(r.viewId)) { p = P(cm(V.TV.c, V.TV.n, 6)); target = "the tricuspid leaflet tips"; }
    else { p = P(cm(V.MV.c, V.MV.n, 8)); target = "the mitral leaflet tips"; }
  } else if (r.mode === "cw") {
    if (OUTFLOW_VIEWS.has(r.viewId)) { p = P(cm(V.AV.c)); target = "the aortic valve"; }
    else if (TRICUSPID_VIEWS.has(r.viewId) || r.viewId === "a4c") { p = P(cm(V.TV.c)); target = "the tricuspid valve"; }
    else { p = P(cm(V.MV.c)); target = "the mitral valve"; }
  } else { const R = 0.86 * V.MV.R * 10; p = P([V.MV.c[0] * 10 - R, V.MV.c[1] * 10, V.MV.c[2] * 10 - 2]); target = "the septal mitral annulus"; }
  if (!line && p) line = aimAt(pose, p);
  if (!line || Math.abs(line.lineAngle) > SECTOR.halfAngle * 0.95 || line.gateDepth > pose.depth * 1.6 || line.gateDepth < 5) { line = { lineAngle: 0, gateDepth: 0.5 * pose.depth }; target = "the sector's center"; }
  post({ type: "aim", key: r.key, lineAngle: line.lineAngle, gateDepth: line.gateDepth, target });
}

function measure() {
  const b = beat!, s = simpsonBiplane(b, tte), m = mmodeMeasures(b, tte.plax, mLineFor(tte.plax).lineAngle), d = standardDoppler(b, tte, jetOptions(b));
  post({ type: "measure", report: {
    simpsonEf: s.ef, simpsonEdv: s.edv, simpsonEsv: s.esv,
    ivsd: m.diastole.ivs, lvidd: m.diastole.lvid, lvpwd: m.diastole.lvpw, lvids: m.systole.lvid, fs: m.fs, teichEf: m.ef,
    e: d.mitral.e, a: d.mitral.a, ea: d.mitral.ea, dt: d.mitral.dtMs, ePrime: (d.annulus.septalE + d.annulus.lateralE) / 2, eOverEprime: d.annulus.eOverEprime,
    lvotVti: d.lvot.vti, sv: d.lvot.strokeVolume, avVmax: d.aortic.vmax, avMean: d.aortic.meanGradient, avPeak: d.aortic.peakGradient, ava: d.aortic.ava,
    mvMean: d.mitral.meanGradient, trVmax: d.tricuspid.vmax || null, rvsp: d.tricuspid.rvsp,
  } });
}

scope.onmessage = async (ev: MessageEvent<Request>) => {
  const r = ev.data;
  try {
    if (r.type === "init") {
      await loadHeart();
      tte = buildPoses();
      const m = ctMesh(1.6);
      const tee = teeViews(), teeProbe = Object.fromEntries(Object.entries(tee).map(([k, c]) => [k, teePose(c).probe]));
      post({ type: "ready", tte, tee, teeProbe, mesh: m }, [m.positions.buffer, m.normals.buffer, m.indices.buffer, m.parts.buffer]);
    } else if (r.type === "case") {
      beat = beatOf(CASE_BY_ID[r.id]!);
      const rep = beat.report;
      post({ type: "case", id: r.id, hr: beat.hr, period: beat.period, frames: beat.frames.length, ed: beat.ed, es: beat.es,
        engine: { ef: 100 * beat.lvEf, edv: beat.lvEdv, esv: beat.lvEsv, sv: rep.lvForwardMl, avMean: rep.valves.AV.meanGradient, mvMean: rep.valves.MV.meanGradient, rvSys: rep.pressure.RV.max } });
    } else if (r.type === "frame") { if (beat) frame(r); }
    else if (r.type === "strip") { if (beat) strip(r); }
    else if (r.type === "measure") { if (beat) measure(); }
    else if (r.type === "aim") aim(r);
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
