/**
 * The TEE panel as a component: mount it on a canvas, pick a view and an omniplane angle, switch labels and territories, and feed it
 * the patient's Simulation. The /cath/ page mounts one of these.
 *
 *   const echo = await mountEcho(canvas, { heart });          // heart from loadHeart()/decodeHeart()
 *   echo.setView("me-4ch"); echo.setOmniplane(60);
 *   echo.update(sim);        // after the patient changes (lesion, treatment): re-reads severity per segment, EF and HR
 *   echo.frame(sim);         // each animation frame: the beat phase comes from the sim's beat stream
 */
import { echoModel, type EchoModel } from "../../sim/cath";
import type { Simulation } from "../../sim/simulation";
import { beatClockFromSim, cycleAt, DIASTOLE, motionField, type BeatClock, type MotionField } from "./motion";
import { makeTextures, paint, type Textures } from "./render";
import { sliceGrid, sliceHeart, type SliceGrid, type SliceResult } from "./slice";
import { buildViews, type View } from "./views";
import type { Heart } from "./volume";

export interface EchoOptions {
  heart: Heart;
  /** Image size in pixels; the canvas is resized to it. Default 400. */
  size?: number;
  view?: string;
  labels?: boolean;
  territories?: boolean;
  seed?: number;
}

export interface EchoPanel {
  readonly views: readonly View[];
  readonly view: View;
  readonly omniplane: number;
  /** Select a view by id or name; resets the omniplane to the view's own angle. Returns false if unknown. */
  setView(idOrName: string): boolean;
  setOmniplane(deg: number): void;
  setLabels(on: boolean): void;
  setTerritories(on: boolean): void;
  /** Re-read the patient: segment severity, EF, heart rate. */
  update(sim: Parameters<typeof echoModel>[0] & Parameters<typeof beatClockFromSim>[0]): EchoModel;
  /** Draw one frame at the sim's current beat phase (or `clock` / still diastole when no sim). Returns the slice for inspection. */
  frame(sim?: Parameters<typeof beatClockFromSim>[0] | BeatClock): SliceResult;
  /** The model behind the last update. */
  readonly model: EchoModel | null;
  onChange?: () => void;
}

export function mountEcho(canvas: HTMLCanvasElement, o: EchoOptions): EchoPanel {
  const heart = o.heart, size = o.size ?? 400, views = buildViews(heart);
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  let view = views.find((v) => v.id === o.view) ?? views[0], ang = view.ang, labels = o.labels ?? true, terr = o.territories ?? false;
  let grid: SliceGrid | null = null, gridKey = "", model: EchoModel | null = null, field: MotionField | null = null, last: SliceResult | null = null, n = 0;
  const tex: Textures = makeTextures(size, size, o.seed ?? 1);
  const territories = () => (terr && model ? Float32Array.from(model.segments, (s) => s.dysfunction) : null);

  const panel: EchoPanel = {
    views, get view() { return view; }, get omniplane() { return ang; }, get model() { return model; },
    setView(q) {
      const v = views.find((x) => x.id === q || x.name === q);
      if (!v) return false;
      view = v; ang = v.ang; panel.onChange?.(); return true;
    },
    setOmniplane(deg) { ang = Math.min(180, Math.max(0, Math.round(deg))); panel.onChange?.(); },
    setLabels(on) { labels = on; },
    setTerritories(on) { terr = on; },
    update(sim) {
      model = echoModel(sim);
      field = motionField(model.segments.map((s) => s.dysfunction), model.segments.map((s) => s.bulge), model.ef);
      return model;
    },
    frame(src) {
      const key = `${view.id}|${ang}`;
      if (!grid || key !== gridKey) { grid = sliceGrid(view, ang, size, size); gridKey = key; }
      const clock: BeatClock | null = !src ? null : "since" in src ? src : beatClockFromSim(src);
      const cycle = clock ? cycleAt(clock) : DIASTOLE;
      const pvcScale = clock?.pvc ? 0.75 : 1; // a premature beat fills less and squeezes less
      const cyc = { ...cycle, sys: cycle.sys * pvcScale };
      last = sliceHeart(heart, grid, { cycle: cyc, motion: field ?? undefined });
      const name = view.name.replace(/ \(.*\)/, "");
      paint(ctx, heart, last, tex, {
        frame: n++, territories: territories(), labels,
        title: `${name}  ${ang}°`, footer: model ? `HR ${Math.round(model.hr)}  EF ${Math.round(model.ef * 100)}%` : undefined,
      });
      return last;
    },
  };
  return panel;
}
