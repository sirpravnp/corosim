/**
 * Adopting existing page elements into a panel. The Simulator page's monitor table and ECG strip are written by
 * app.ts by element id (and shared with the game, which has no workspace), so the panels do not rebuild them: they move
 * the existing element into the panel's body, and park it out of sight when the panel closes. The page keeps writing
 * to it either way, so what it shows and how it updates are unchanged.
 */
export interface Slot { append(node: Node): void }

export interface Adopter {
  /** Move the element into `into`. False when the page has no such element. */
  attach(into: Slot): boolean;
  /** Take it out of the panel and park it (hidden, still in the document). */
  release(): void;
}

let parking: HTMLElement | null = null;
/** A hidden holder in the document for adopted elements whose panel is closed. */
export function parkingLot(): Slot {
  if (!parking) {
    parking = document.createElement("div");
    parking.hidden = true;
    document.body.append(parking);
  }
  return parking;
}

export function createAdopter(find: () => Node | null, park: () => Slot = parkingLot): Adopter {
  let node: Node | null = null;
  return {
    attach(into) {
      node ??= find();
      if (node) into.append(node);
      return node !== null;
    },
    release() { if (node) park().append(node); },
  };
}
