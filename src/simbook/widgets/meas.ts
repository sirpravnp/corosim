import { readout } from "../../readout";

/** One measurement tile in the Simbook monitor strip (label + Doto digits). */
export function tile(label: string, value: string, cls = ""): string {
  return `<div><b>${label}</b><span class="${cls}">${readout(value)}</span></div>`;
}

/** Wrap tiles in the shared measurement grid. */
export function meas(...tiles: string[]): string {
  return `<div class="sb-meas">${tiles.join("")}</div>`;
}
