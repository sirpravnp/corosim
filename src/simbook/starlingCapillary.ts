import { SIMBOOK_STARLING as S } from "../config/simbook";
import { oncotic, starling } from "../physics/core/fluids";

export interface StarlingParams {
  venousPressureMmHg: number;
  /** Plasma albumin scale (1 = normal 7 g/dl). */
  albuminScale: number;
  /** Permeability scale on Kf (1 = normal; sepsis > 1). */
  kfScale: number;
}

export interface StarlingStation {
  /** Position along capillary, 0 arteriolar → 1 venular. */
  s: number;
  pcMmHg: number;
  jvMlMin: number;
}

export interface StarlingProfile {
  stations: StarlingStation[];
  netFiltrationMlMin: number;
  lymphReturnMlMin: number;
  edema: boolean;
  piCapMmHg: number;
  piInterMmHg: number;
}

export function defaultStarling(): StarlingParams {
  return { venousPressureMmHg: S.pvRest, albuminScale: 1, kfScale: 1 };
}

/** Linear hydrostatic drop along the capillary; oncotic pressures from protein (Landis–Pappenheimer via `oncotic`). */
export function starlingProfile(p: StarlingParams, n = 40): StarlingProfile {
  const albuminGdl = S.albuminRestGdl * p.albuminScale;
  const piCap = oncotic(albuminGdl);
  const piInter = oncotic(S.interstitialProteinGdl);
  const kf = S.kfBase * p.kfScale;
  const pv = p.venousPressureMmHg;
  const pcArt = S.pcArterial + (pv - S.pvRest) * 0.85;
  const pcVen = S.pcVenous + (pv - S.pvRest);
  const stations: StarlingStation[] = [];
  let net = 0;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const pc = pcArt + s * (pcVen - pcArt);
    const jv = starling(kf / n, S.sigma, pc, S.piInterstitial, piCap, piInter);
    stations.push({ s, pcMmHg: pc, jvMlMin: jv });
    net += jv;
  }
  return {
    stations,
    netFiltrationMlMin: net,
    lymphReturnMlMin: S.lymphReturnMlMin,
    edema: net > S.lymphReturnMlMin,
    piCapMmHg: piCap,
    piInterMmHg: piInter,
  };
}
