// Mechanical support device constants. [lit] = literature-backed, [assumed] = teaching choice that needs a source.
// Nothing here is manufacturer or published device data; device definitions (P-levels, real HQ curves) come with task D2.

/**
 * A generic rotary blood pump (task D1): head H = a·ω² − b·ω·Q − c·Q·|Q| in mmHg, ω in krpm, Q in ml/s. With these
 * numbers the shut-off head at 30 krpm is 90 mmHg and the free-flow (H = 0) is about 100 ml/s (6 L/min). All [assumed]:
 * chosen for a plausible shape (head falling with flow, flow rising with speed), not copied from any device.
 */
export const GENERIC_PUMP = {
  speed: 30, // krpm [assumed]
  a: 0.1, // mmHg/krpm², shut-off head coefficient [assumed]
  b: 0.0225, // mmHg/(krpm·ml/s), slip with flow [assumed]
  c: 0.0015, // mmHg/(ml/s)², hydraulic loss [assumed]
  L: 0.05, // mmHg·s²/ml, cannula and rotor inertance (about 100x the 3 cm aortic column) [assumed]
  /** Inflow (suction) law, see `inflowResistance` in core/devices/pump.ts. */
  R0: 0.05, // mmHg·s/ml, cannula resistance with a full inflow [assumed]
  Rmax: 60, // mmHg·s/ml, extra resistance at full collapse [assumed]
  Pth: 2, // mmHg, inflow pressure at which the pressure term of suction is half developed [assumed]
  wP: 1, // mmHg, width of that transition [assumed]
  Vc: 5, // ml, inflow node volume at which the volume term is half developed (collapse volume) [assumed]
  wV: 2, // ml, width of that transition [assumed]
  suctionAt: 0.5, // fraction of Rmax at which the `suction` tap goes true [assumed]
};

// ---- Impella (task D2) ------------------------------------------------------------------------------------------------------
// Every number below is [assumed] unless it carries [lit]. None is manufacturer data: the maximum speeds and maximum flows follow
// the order of magnitude of what the manufacturer's public material states (about 2.5, 3.5-4 and 5.5 L/min; rotor speeds of a few
// tens of thousands rpm), which is NOT verified here. The HQ coefficients are designed, not measured (see `hqDesign` below).

/** L = ρ·ℓ/A of a cannula of length `lengthCm` and inner diameter `diameterMm`, in mmHg·s²/ml (ρ = 1.06 g/ml [lit]; 1 mmHg = 1333 dyn/cm²). ℓ 13 cm, d 4 mm gives 0.082. */
export const cannulaInertance = (lengthCm: number, diameterMm: number): number => (1.06 * lengthCm) / (Math.PI * (diameterMm / 20) ** 2) / 1333;

export type ImpellaModelName = "2.5" | "CP" | "5.5";
export type ImpellaPosition = "correct" | "aortic" | "deep";

export interface ImpellaDef {
  /** Rotor speed (krpm) at P-level 0..9 (P0 = off). Linear from `speedP1` to `speedP9` for P1..P9. [assumed] */
  speeds: readonly number[];
  /** Pressure-head coefficients, H = a·ω² − b·ω·Q − c·Q·|Q| (ω krpm, Q ml/s, H mmHg). Designed so the maximum flow (P9, ΔP 60 mmHg) is in the published class. [assumed] */
  a: number; b: number; c: number;
  /** Cannula length (cm) and inner diameter (mm), which set the inertance L = ρℓ/A. [assumed] */
  lengthCm: number; diameterMm: number;
  /** Inflow cannula resistance with a full inflow, mmHg·s/ml. [assumed] */
  R0: number;
  /** Class flow at P9 against ΔP = 60 mmHg, L/min: documentation of the design target, asserted by tests within 15 %. [assumed] */
  maxFlowLpm: number;
}

const ramp = (lo: number, hi: number): number[] => [0, ...Array.from({ length: 9 }, (_, i) => +(lo + ((hi - lo) * i) / 8).toFixed(2))];

/**
 * Hq design of each model: shut-off head H0 at the top speed (Q = 0), free flow Qf (H = 0 at the top speed), and a split f = 0.4 of
 * H0 between the slip term b·ω·Q and the loss term c·Q² at Qf; a = H0/ω², b = f·H0/(ω·Qf), c = (1 − f)·H0/Qf². H0 and Qf were then
 * solved so that Q(ΔP = 60 mmHg, P9) hits the class flow. 2.5: ω 51 krpm, H0 140 mmHg, Qf 62 ml/s; CP: 46, 150, 90; 5.5: 33, 120, 161. [assumed]
 */
export const IMPELLA: Record<ImpellaModelName, ImpellaDef> = {
  "2.5": { speeds: ramp(25, 51), a: 0.0538, b: 0.01775, c: 0.02195, lengthCm: 12, diameterMm: 3.5, R0: 0.15, maxFlowLpm: 2.5 },
  CP: { speeds: ramp(22, 46), a: 0.0709, b: 0.01455, c: 0.01119, lengthCm: 13, diameterMm: 4.5, R0: 0.1, maxFlowLpm: 3.7 },
  "5.5": { speeds: ramp(16, 33), a: 0.1102, b: 0.009054, c: 0.00279, lengthCm: 10, diameterMm: 6, R0: 0.05, maxFlowLpm: 5.5 },
};

/**
 * Suction and floor law shared by the Impella models, set relative to the LV's own unloaded volume V0 (the R-D1 decision). All [assumed].
 *  - `vcMarginMl`  collapse volume Vc = V0 + margin: suction is half developed there (wV wide); the pressure term uses `Pth`, `wP`.
 *  - `floorMl`     hard floor: the flow is softly limited so the LV volume stays above V0 + floor.
 *  - `floorTau`    time constant (s) of the volume approach to the floor: Q_limit = (V − floor)/floorTau; `limitTau` how fast Q follows it, `limitBand` (ml/s) the width over which the limiter is blended in.
 */
export const IMPELLA_SUCTION = { vcMarginMl: 30, wV: 3, Pth: 0, wP: 1, Rmax: 40, suctionAt: 0.5, floorMl: 2, floorTau: 0.04, limitTau: 0.005, limitBand: 2 };

/** Position effects. `aortic`: inflow and outflow both in the aorta (no LV connection). `deep`: the inflow sits against the wall / papillary apparatus: suction develops at a higher volume and pressure. [assumed] */
export const IMPELLA_POSITION = { deep: { vcExtraMl: 15, pthExtra: 8 } };

/**
 * Console formulas. Motor current (mA) = loss + hydraulic torque term:
 *     I = i0 + i2·ω² + kI·H(ω,Q)·Q/ω      (ω krpm, Q ml/s, H mmHg; the last term clipped at 0)
 * i0 + i2·ω² is the speed-dependent loss (bearing, windage, purge flow); kI follows from shaft power = hydraulic power/η and
 * torque = shaft power/ω, I = torque/Kt:  kI = 1000 mA/A · 1.333e-4 W per mmHg·ml/s ÷ (η · 2π/60 · 1000 rad/s per krpm · Kt) = 1.82 mA per (mmHg·ml/s/krpm)
 * with η = 0.2 and Kt = 0.0035 N·m/A. All [assumed].
 */
export const IMPELLA_CONSOLE = { i0: 150, i2: 0.12, eta: 0.2, kt: 0.0035, alarmLevel: 0.2, strideS: 0.004 };

// ---- Intra-aortic balloon pump (task D5) ----------------------------------------------------------------------------------------
/**
 * IABP constants (core/devices/iabp.ts). All [assumed] teaching values, none from a console manual.
 * Gas shuttle: the balloon volume follows its target with first-order lags (inflate 40 ms, deflate 50 ms; helium through a long
 * catheter, so deflation is a little slower). The target is a smoothed on/off window (`edgeS`, half-width of the smoothstep) so
 * the RK4 steps see a continuous rate. `deflateLeadS`: with correct timing deflation starts this long before the predicted next R
 * wave, so the balloon is mostly empty when the ventricle starts contracting. Systolic-duration fallback (before the first AV
 * closure has been measured): delay from the R wave to aortic valve closure = `closeBase + closePerRr·RR`. `defaultRrS`: RR
 * assumed when no interval has been seen yet. `smooth`: weight of the newest measured closure delay in the running estimate.
 * `openFlow` / `closedFlow` (ml/s): AV flow above which the valve counts as open, and below which (after it opened) as closed.
 */
export const IABP = { volumeMl: 40, tauInflateS: 0.04, tauDeflateS: 0.05, edgeS: 0.012, deflateLeadS: 0.13, closeBase: 0.12, closePerRr: 0.2, defaultRrS: 0.83, smooth: 0.5, openFlow: 5, closedFlow: 1 };

// ---- VA-ECMO (task D6) -------------------------------------------------------------------------------------------------------------
/**
 * Centrifugal pump and circuit of the VA-ECMO model (core/devices/ecmo.ts). All [assumed] teaching values, no console data.
 * HQ design (same recipe as `IMPELLA`): shut-off head 450 mmHg and free flow 130 ml/s (7.8 L/min) at the top speed 5 krpm, split f = 0.4:
 * a = H0/ω², b = f·H0/(ω·Qf), c = (1 − f)·H0/Qf². About 3.6 krpm gives 4 L/min against 70 mmHg plus the circuit loss.
 * `L` is the inertance of about 2 m of 3/8 inch tubing (ρℓ/A). The circuit resistance R0 is cannulae plus oxygenator in series
 * (0.15 + 0.30 mmHg·s/ml: about 30 mmHg at 4 L/min); `oxygenatorR` is the oxygenator part, reported as the membrane pressure drop.
 * `speedTau`: time constant (s) of the speed controller.
 */
export const ECMO_PUMP = { speedMax: 5, a: 18, b: 0.277, c: 0.016, L: 0.22, cannulaR: 0.15, oxygenatorR: 0.3, speedTau: 0.5 };

/**
 * Venous drainage law, set relative to the drainage node's unloaded volume (R-D1): suction half developed at Vc = V0 + `vcMarginMl`,
 * Q is softly limited so the volume stays above V0 + `floorMl` (Q ≤ (V − floor)/`floorTau`, blended in over `limitBand` ml/s as for the Impella).
 * The volume is the node's volume low-pass filtered with time constant `volumeTau` (s): an atrium empties to V0 at every systole. `alarmLevel`: suction level (0-1) at which the console alarm goes. [assumed]
 */
export const ECMO_SUCTION = { volumeTau: 0.6, vcMarginMl: 5, wV: 2, Pth: -6, wP: 1.5, Rmax: 60, suctionAt: 0.5, floorMl: 2, floorTau: 0.06, limitTau: 0.01, limitBand: 3, alarmLevel: 0.2 };

/**
 * Oxygenator. The blood leaving it is brought toward `satMax(FiO₂)` by the sweep gas: s_out = s_in + (satMax − s_in)·(1 − exp(−sweep/sweepTau)),
 * satMax = satAir + (satO2 − satAir)·(FiO₂ − 0.21)/0.79. A saturating function of sweep (0 = no gas exchange: the blood returns as it came),
 * linear in FiO₂ between air and pure oxygen. [assumed]
 */
export const ECMO_OXYGENATOR = { sweepTau: 0.6, satAir: 0.96, satO2: 1.0 };
