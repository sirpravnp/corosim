import { Impella } from "../physics/core/devices/impella";
import type { Ctx, Rates } from "../physics/core/types";

/**
 * The Impella of D2 with an on/off gate, for the ACS simulation (task D3). The engine's element list is fixed when the heart is
 * built, so a pump that the team can switch on and off live is always present and gated: switched off, the flow state decays to
 * zero in `OFF_TAU` seconds (the volume it still carries is accounted, so blood is conserved) and nothing else changes. A stopped
 * Impella left in place would regurgitate through the rotor (H < the aortic-LV pressure difference); "off" here means "not inserted".
 */
export class SwitchableImpella extends Impella {
  static readonly OFF_TAU = 0.02;
  enabled = true;
  flow(ctx: Ctx, out: Rates) {
    if (this.enabled) { super.flow(ctx, out); return; }
    const q = ctx.y[this.idx];
    out.flow(this.from, this.to, q);
    out.rate(this.idx, -q / SwitchableImpella.OFF_TAU);
  }
}

/**
 * Impella console as `Simulation.devices()` reports it (plain numbers, documented keys). Beat statistics come from the `ImpellaConsole`
 * (the last completed beat); `speedKrpm` and `level` are the present setting.
 *  - on: the pump is inserted and running (support.impella on and P-level above 0).
 *  - model "2.5" | "CP" | "5.5", position "correct" | "aortic" | "deep", level 0..9 (P-level).
 *  - flowLpm: mean flow over the last beat (L/min); flowMinLpm, flowMaxLpm: its range within the beat.
 *  - motorCurrentMa: mean motor current over the last beat (mA); currentPulsatilityMa: max - min of it (mA).
 *  - placementMmHg: mean of aortic minus LV pressure over the beat (the placement signal); placementAmplitudeMmHg: its max - min.
 *    Large when correctly placed; near zero when the inflow sits in the aorta.
 *  - suctionLevel: highest suction level (0-1) in the beat; suctionFraction: fraction of the beat in suction; suctionAlarm: the console alarm.
 */
export interface ImpellaReadout {
  on: boolean; model: string; position: string; level: number; speedKrpm: number;
  flowLpm: number; flowMinLpm: number; flowMaxLpm: number;
  motorCurrentMa: number; currentPulsatilityMa: number;
  placementMmHg: number; placementAmplitudeMmHg: number;
  suctionLevel: number; suctionFraction: number; suctionAlarm: boolean;
}

/**
 * IABP console as `Simulation.devices()` reports it. Settings: ratio 1..3, inflateMs / deflateMs (offsets from correct timing, negative
 * early), volumeMl. Readings are smoothed over beats (time constant 2 s):
 *  - on: the pump is running (support.iabp on).
 *  - balloonVolumeMl: the balloon's volume now; fill 0..1; assisted: the present beat is an assisted one.
 *  - balloonPressureMmHg: peak static pressure the balloon adds to the descending aorta in the beat (Vb / C).
 *  - peakDiastolicMmHg: the highest aortic pressure with the aortic valve closed (the augmented diastolic peak).
 *  - diastolicMeanMmHg: mean aortic pressure with the valve closed (the coronary perfusion pressure's driver).
 *  - endDiastolicMmHg: aortic pressure at the R wave (end of diastole); systolicMmHg: the ejection peak of the aortic pressure (before the
 *    valve closes; the augmented diastolic peak can exceed it, so the monitor's maximum is not this).
 *  - coronaryAugmentationMmHg: measured rise of the diastolic mean pressure against the unassisted ratio diastolic-mean / MAP, in
 *    MAP terms (what `circ.coronaryPressure` adds to MAP); 0 when off or on unassisted beats.
 */
export interface IabpReadout {
  on: boolean; ratio: number; inflateMs: number; deflateMs: number; volumeMl: number;
  balloonVolumeMl: number; fill: number; assisted: boolean;
  balloonPressureMmHg: number; peakDiastolicMmHg: number; diastolicMeanMmHg: number; endDiastolicMmHg: number; systolicMmHg: number;
  coronaryAugmentationMmHg: number;
}

export interface DevicesReadout { impella: ImpellaReadout | null; iabp: IabpReadout | null }
