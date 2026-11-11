/**
 * Game controllers for the cath lab: an Xbox controller and an 8BitDo pad (the Micro many people use as an Anki remote), both
 * read through the browser's Gamepad API in its "standard" layout. No DOM here: the page polls `navigator.getGamepads()` each
 * frame, hands each pad to `PadReader.read`, and runs the commands it returns, so the tests can drive it with plain arrays.
 *
 * Standard layout indices: 0 A, 1 B, 2 X, 3 Y, 4 LB/L, 5 RB/R, 6 LT/L2, 7 RT/R2, 8 View/Select, 9 Menu/Start, 10 L3, 11 R3,
 * 12 up, 13 down, 14 left, 15 right. Axes: 0 left x, 1 left y (down positive), 2 right x, 3 right y.
 */
export type PadCommand =
  | { k: "advance"; mm: number }
  | { k: "torque"; deg: number }
  | { k: "carm"; dRot: number; dTilt: number }
  | { k: "press"; id: PadButton };
export type PadButton = "inject" | "inflate" | "deflate" | "deploy" | "undo" | "hint" | "viewPrev" | "viewNext" | "camera" | "skip" | "shock" | "cpr";

/** Buttons that fire once per press, by standard index. */
export const PAD_BUTTONS: Record<number, PadButton> = {
  0: "inject", 1: "deflate", 2: "inflate", 3: "deploy", 4: "undo", 5: "hint", 6: "viewPrev", 7: "viewNext", 8: "camera", 9: "skip", 10: "shock", 11: "cpr",
};

export interface PadSnapshot { id?: string; buttons: readonly (number | boolean | { pressed: boolean; value?: number })[]; axes: readonly number[] }

/** Rates: how fast a full stick or a held D-pad moves things. */
export const PAD = {
  advanceMmPerS: 24, // a held stick or D-pad feeds the wire about as fast as a steady hand
  stepMm: 4, // the same 4 mm steps as the hold-to-advance button: the engine rolls its complication dice once per step
  torqueDegPerS: 120,
  torqueStepDeg: 10, // a D-pad tap rotates this much; a stick turns continuously
  carmDegPerS: 30,
  dead: 0.22, // stick dead zone
};

const pressed = (b: PadSnapshot["buttons"][number] | undefined) => (typeof b === "object" && b !== null ? b.pressed : typeof b === "number" ? b > 0.5 : !!b);
const live = (v: number | undefined) => (v === undefined || Math.abs(v) < PAD.dead ? 0 : (v - Math.sign(v) * PAD.dead) / (1 - PAD.dead));

/** A friendly name for the pad, from the id the browser reports. */
export function padName(id: string): string {
  if (/8bitdo/i.test(id)) return /micro/i.test(id) ? "8BitDo Micro" : "8BitDo controller";
  if (/xbox|xinput|045e/i.test(id)) return "Xbox controller";
  return "Game controller";
}

/** Turns successive pad snapshots into lab commands: edges for buttons, accumulated motion for the sticks and the held D-pad. */
export class PadReader {
  private prev: boolean[] = [];
  private mm = 0; private deg = 0;
  read(pad: PadSnapshot, dt: number): PadCommand[] {
    const out: PadCommand[] = [];
    const now = Array.from({ length: Math.max(16, pad.buttons.length) }, (_, i) => pressed(pad.buttons[i]));
    const edge = (i: number) => now[i] && !this.prev[i];
    for (const [i, id] of Object.entries(PAD_BUTTONS)) if (edge(+i)) out.push({ k: "press", id });

    // advance and withdraw: left stick up/down, or the D-pad held (stick up is negative y)
    const dpadY = (now[12] ? 1 : 0) - (now[13] ? 1 : 0);
    const fwd = dpadY !== 0 ? dpadY : -live(pad.axes[1]);
    this.mm += fwd * PAD.advanceMmPerS * dt;
    while (Math.abs(this.mm) >= PAD.stepMm) { const s = Math.sign(this.mm) * PAD.stepMm; out.push({ k: "advance", mm: s }); this.mm -= s; }
    if (fwd === 0) this.mm = 0;

    // rotate: D-pad left/right taps a fixed turn; the left stick's x turns continuously
    if (edge(14)) out.push({ k: "torque", deg: -PAD.torqueStepDeg });
    if (edge(15)) out.push({ k: "torque", deg: PAD.torqueStepDeg });
    const turn = live(pad.axes[0]);
    this.deg += turn * PAD.torqueDegPerS * dt;
    if (Math.abs(this.deg) >= 5) { const d = Math.round(this.deg); out.push({ k: "torque", deg: d }); this.deg -= d; }
    if (turn === 0) this.deg = 0;

    // the C-arm on the right stick: x is LAO (right) and RAO (left), y is cranial (up) and caudal (down)
    const rx = live(pad.axes[2]), ry = live(pad.axes[3]);
    if (rx || ry) out.push({ k: "carm", dRot: rx * PAD.carmDegPerS * dt, dTilt: -ry * PAD.carmDegPerS * dt });

    this.prev = now;
    return out;
  }
}
