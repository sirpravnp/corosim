import { INFARCT } from "../config/management";
import { BedSite } from "./ecgLink";
import { isRightVentricular } from "./circulation";

/**
 * Irreversible injury. Ischemia that is relieved in time leaves the muscle stunned but alive; ischemia that goes on
 * kills it, from the inside out, at a rate that climbs steeply with how little blood arrives:
 *   dN/dt = (1 − N) · severity^k / τ      (t in clinical minutes; the caller converts its own clock)
 * Reperfusion stops the clock but does not bring dead muscle back.
 */
export function stepNecrosis(n: number, severity: number, minutes: number): number {
  return n + (1 - n) * (1 - Math.exp((-minutes * Math.pow(severity, INFARCT.severityPower)) / INFARCT.tauMinutes));
}

/** Fraction of the left ventricle (by mass) that has infarcted. */
export function lvInfarctSize(sites: BedSite[], scar: Record<string, number>): number {
  let m = 0, d = 0;
  for (const s of sites) {
    if (/^(SAN|AVN)#/.test(s.key) || isRightVentricular(s.key)) continue;
    m += s.mass; d += (scar[s.key] ?? 0) * s.mass;
  }
  return m ? d / m : 0;
}

/** Clinical minutes as "2 h 05 min". */
export function clinicalTime(minutes: number): string {
  const m = Math.floor(minutes);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
