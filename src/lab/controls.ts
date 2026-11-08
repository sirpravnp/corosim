import { LAB } from "../config/lab";
import type { Action } from "./types";

/** Keyboard distances and timing for cath-lab device movement. [assumed] */
export interface LabControlBindings {
  advanceMm: number;
  withdrawMm: number;
  fineMm: number;
  burstMm: number;
  torqueDeg: number;
  bendDeg: number;
  repeatMs: number;
}
export type LabControlOverrides = Partial<LabControlBindings>;

const editable = (el: EventTarget | null) => {
  if (!el || typeof el !== "object") return false;
  const h = el as HTMLElement;
  return typeof h.closest === "function" && !!h.closest("input,select,textarea,[contenteditable=true]");
};

const normKey = (key: string) => key.length === 1 ? key.toLowerCase() : key;

/** Map one key event to a lab action, or null when the key is not bound or the target is a form field. */
const merged = (o?: LabControlOverrides): LabControlBindings => ({ ...LAB.controls, ...o });

export function labKeyAction(e: KeyboardEvent, overrides?: LabControlOverrides): Action | null {
  const bindings = merged(overrides);
  if (e.altKey || editable(e.target)) return null;
  const k = normKey(e.key);
  const shift = e.shiftKey;
  const fine = e.ctrlKey || e.metaKey;
  if (k === "w" || k === "ArrowUp") {
    const mm = shift ? bindings.burstMm : fine ? bindings.fineMm : bindings.advanceMm;
    return { t: "advance", mm };
  }
  if (k === "s" || k === "ArrowDown") {
    const mm = shift ? bindings.burstMm : fine ? bindings.fineMm : bindings.withdrawMm;
    return { t: "advance", mm: -mm };
  }
  if (k === "a" || k === "ArrowLeft") return { t: "torque", deg: -bindings.torqueDeg };
  if (k === "d" || k === "ArrowRight") return { t: "torque", deg: bindings.torqueDeg };
  if (k === "[") return { t: "shape", tipBendDeg: -bindings.bendDeg };
  if (k === "]") return { t: "shape", tipBendDeg: bindings.bendDeg };
  return null;
}

const holdKeys = new Set(["w", "s", "arrowup", "arrowdown"]);

export const labKeyIsHold = (e: KeyboardEvent) => holdKeys.has(normKey(e.key).toLowerCase());

export interface LabKeyboardOptions {
  bindings?: LabControlOverrides;
  /** Called after each applied action (including hold repeats). */
  onEvents?: (events: ReturnType<LabKeyboardTarget["apply"]>) => void;
}

export interface LabKeyboardTarget {
  apply(action: Action): unknown;
}

export interface LabKeyboardRoot {
  addEventListener(type: string, listener: (ev: KeyboardEvent) => void, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (ev: KeyboardEvent) => void, options?: boolean | EventListenerOptions): void;
}

/**
 * Video-game style holder: W/S or arrows advance and withdraw the active device (guide, wire, balloon);
 * A/D torques the wire; hold a movement key for repeat steps. Returns a detach function.
 */
export function attachLabKeyboard(
  root: LabKeyboardRoot,
  target: LabKeyboardTarget,
  opts: LabKeyboardOptions = {},
): () => void {
  const bindings = merged(opts.bindings);
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  const fire = (e: KeyboardEvent) => {
    const a = labKeyAction(e, bindings);
    if (!a) return;
    const ev = target.apply(a);
    opts.onEvents?.(ev as never);
  };

  const onDown = (e: KeyboardEvent) => {
    const a = labKeyAction(e, bindings);
    if (!a) return;
    e.preventDefault();
    if (!labKeyIsHold(e)) {
      fire(e);
      return;
    }
    const code = e.code;
    if (timers.has(code)) return;
    fire(e);
    timers.set(code, setInterval(() => fire(e), bindings.repeatMs));
  };

  const onUp = (e: KeyboardEvent) => {
    const t = timers.get(e.code);
    if (t !== undefined) {
      clearInterval(t);
      timers.delete(e.code);
    }
  };

  const onBlur = () => { for (const t of timers.values()) clearInterval(t); timers.clear(); };

  root.addEventListener("keydown", onDown);
  root.addEventListener("keyup", onUp);
  root.addEventListener("blur", onBlur);
  return () => {
    onBlur();
    root.removeEventListener("keydown", onDown);
    root.removeEventListener("keyup", onUp);
    root.removeEventListener("blur", onBlur);
  };
}
