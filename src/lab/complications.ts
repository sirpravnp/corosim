/** Complication risk helpers (Task 9 fills the draws; Task 6–8 call these). */

export const accessBleedRisk = (_ultrasound: boolean): number => 0;
export const spasmRisk = (_radial: boolean, _nitro: boolean): number => 0;
export const thrombusRisk = (act: number): number => (act < 250 ? 0.4 : 0);
