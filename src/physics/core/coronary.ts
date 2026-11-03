import { COUPLING } from "../../config/coronary";

/**
 * Coronary supply of one beat (E2). `endo` / `epi` are the driving pressures of the subendocardial and subepicardial layer, mmHg: the
 * zero-flow pressure plus the time-mean over the beat of max(0, Pao - w * Plv - Pzf) (a vascular waterfall: no flow while the pressure
 * is below the critical closing pressure plus the wall pressure), where w * Plv is the layer's intramyocardial pressure. In systole it is the squeeze
 * of the contracting wall (flow impediment, large at the endocardium), in diastole it is the LV pressure (the LVEDP-level back-pressure)
 * the layer is perfused against, so the same expression carries diastolic aortic pressure, diastolic time, LVEDP and systolic
 * impediment, and a balloon pump's diastolic augmentation enters through Pao itself.
 */
export interface BeatSupply {
  endo: number;
  epi: number;
  /** Subendocardial / subepicardial driving pressure, a transmural supply index (below ~0.85 is the endocardium running short). */
  transmural: number;
  /** Diastolic pressure-time integral per beat, mmHg*s: the integral of Pao - Plv over the diastole (aortic valve closed). */
  dpti: number;
  /** Tension-time index per beat, mmHg*s: the integral of Plv over the ejection (valve open); DPTI / TTI is the endocardial viability ratio. */
  tti: number;
  /** Aortic valve closed time as a fraction of the beat (shortens with tachycardia). */
  diastolicFraction: number;
  /** LV pressure at the end of the beat, mmHg. */
  lvedp: number;
  /** Mean LV pressure while the valve is open, mmHg (the intramyocardial pressure term of the systole). */
  lvSystolic: number;
  /** Time-mean aortic pressure while the valve is closed, mmHg. */
  aoDiastolic: number;
}

/** Fed with the aortic and LV pressure of every engine sample; `endBeat` closes the beat and returns its supply. */
export class CoronaryCoupling {
  private endo = 0; private epi = 0; private T = 0;
  private dT = 0; private dpti = 0; private tti = 0; private sysT = 0; private sysP = 0; private aoD = 0;
  private lv = NaN;
  /** The supply of the last few seconds (the beats averaged by their length with the time constant `COUPLING.beatAvgS`, so one short or ectopic beat does not swing it); null before the first beat. */
  last: BeatSupply | null = null;
  /** The last beat on its own. */
  beat: BeatSupply | null = null;

  /** `h` is the time since the previous sample (s), `diastole` whether the aortic valve has closed after opening in this beat. */
  sample(h: number, pAo: number, pLv: number, diastole: boolean) {
    this.lv = pLv;
    if (!(h > 0)) return;
    this.T += h;
    this.endo += Math.max(0, pAo - COUPLING.wEndo * pLv - COUPLING.zeroFlow) * h;
    this.epi += Math.max(0, pAo - COUPLING.wEpi * pLv - COUPLING.zeroFlow) * h;
    if (diastole) { this.dT += h; this.dpti += Math.max(0, pAo - pLv) * h; this.aoD += pAo * h; }
    else { this.sysT += h; this.sysP += pLv * h; this.tti += pLv * h; }
  }

  /** Close the beat (the next ventricular event) and start the next one. A beat with no measured time leaves the previous supply. */
  endBeat(): BeatSupply | null {
    if (this.T > 0.05) {
      const endo = COUPLING.zeroFlow + this.endo / this.T, epi = COUPLING.zeroFlow + this.epi / this.T;
      const b: BeatSupply = {
        endo, epi, transmural: endo / Math.max(1e-6, epi), dpti: this.dpti, tti: this.tti, diastolicFraction: this.dT / this.T, lvedp: this.lv,
        lvSystolic: this.sysT > 0 ? this.sysP / this.sysT : 0, aoDiastolic: this.dT > 0 ? this.aoD / this.dT : 0,
      };
      this.beat = b;
      const k = 1 - Math.exp(-this.T / COUPLING.beatAvgS), o = this.last;
      if (!o) this.last = b;
      else {
        const m = (a: number, c: number) => a + (c - a) * k;
        this.last = {
          endo: m(o.endo, b.endo), epi: m(o.epi, b.epi), transmural: 0, dpti: m(o.dpti, b.dpti), tti: m(o.tti, b.tti), diastolicFraction: m(o.diastolicFraction, b.diastolicFraction),
          lvedp: m(o.lvedp, b.lvedp), lvSystolic: m(o.lvSystolic, b.lvSystolic), aoDiastolic: m(o.aoDiastolic, b.aoDiastolic),
        };
        this.last.transmural = this.last.endo / Math.max(1e-6, this.last.epi);
      }
    }
    this.endo = this.epi = this.T = this.dT = this.dpti = this.tti = this.sysT = this.sysP = this.aoD = 0;
    return this.last;
  }

  reset() { this.last = this.beat = null; this.lv = NaN; this.endBeat(); this.last = this.beat = null; }
}

/** Supply index of a layer: its driving pressure over the default patient's (1 = normal). */
export const supplyIndex = (layerPressure: number, layer: "endo" | "epi") => layerPressure / (layer === "endo" ? COUPLING.endoRef : COUPLING.epiRef);
