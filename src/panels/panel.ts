import type { HemoSource } from "../sim/hemoSource";

/**
 * A panel on the Simulator page's workspace (docs/HEMODYNAMICS_CORE.md §4G): traces, loops, JVP, cath, O₂, consoles.
 * Panels draw; they compute nothing a test would want to check (that lives in src/physics or src/sim). The workspace
 * (task P3) owns layout, the render loop and visibility; a hidden panel is not drawn.
 */
export interface Panel {
  readonly id: string; // stable, used in saved layouts
  readonly title: string;
  /** Build the panel's DOM inside `el`. Called once. */
  mount(el: HTMLElement, source: HemoSource): void;
  /** The source changed (a new patient, or the switch from bridge to live engine). */
  setSource?(source: HemoSource): void;
  /** Container size changed. */
  resize?(): void;
  /** Draw a frame. `now` is the source's clock. Called only while visible, at most once per animation frame. */
  draw(now: number): void;
  dispose(): void;
}

export interface PanelDef {
  id: string;
  title: string;
  /** Shown by default on a first visit. */
  defaultOn: boolean;
  /** Spans the full width of the grid on wide screens (a twelve-lead strip needs the room). */
  wide?: boolean;
  create(): Panel;
}
