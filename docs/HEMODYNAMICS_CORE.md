# Hemodynamics core: plan

Status: plan only, nothing implemented. Scope: make a beat-resolved, closed-loop hemodynamic engine the core of CoroSim,
then build dynamic mechanical support, a pericardium, fluids as a real concept, more nuanced physiology, and a path to
Navier–Stokes on top of it.

## 1. What Harvi does (and what we could not verify)

Sources were search summaries; harvi.org, harvi.academy and the journals were not reachable from this environment, so
nothing below comes from Harvi's own manual. Items marked *unverified* need checking against harvi.online before we
claim parity.

- **Chambers:** all four are time-varying elastances (Suga–Sunagawa). Users set contractility (Ees), lusitropy
  (relaxation), diastolic compliance (end-diastolic curve), heart rate. Contractility depends on the heart cycle.
- **Vasculature:** Guyton-style resistances and capacitances for the systemic and pulmonary circuits; blood volume and
  preload are user inputs.
- **Pericardium:** included. Ventricular interaction: Burkhoff co-authored the model analyses of it (Santamore &
  Burkhoff 1991; interaction during LV support, 1989), so it is very likely in the model.
- **Coronary vasculature** and **myocardial work–O₂ consumption** (PVA → MVO₂) are included.
- **Simple cardiovascular drugs.**
- **Devices:** IABP, ECMO and Impella CP / 5.0 appear in published Harvi case simulations (a VSD case report).
  TandemHeart, LVAD and pump-curve detail: *unverified*.
- **Outputs:** PV loops of all four chambers, pressure/flow/volume traces, BP, PA pressures, CVP, wedge, CO; a catheter
  position control.
- **Not in Harvi** (as far as anything says): ECG and rhythm coupling, baroreflex and autonomic control, a lesion-level
  coronary tree, congenital lesions and oxygen saturations, imaging. These are where we already go beyond it.

## 2. Where CoroSim stands

| Piece | File | What it is |
|---|---|---|
| ACS / cath circulation | `src/physics/circulation.ts` | Algebraic: MAP = CO × SVR, stroke volume a product of tuned multipliers |
| Beat pressure | `src/physics/beatHemo.ts` | 2-element Windkessel stepped per beat, Frank–Starling from the RR interval |
| Support | `src/physics/support.ts`, `src/config/management.ts` | Drugs and devices as multipliers (Impella = 3.0 L/min constant) |
| Autonomic | `src/physics/autonomic.ts` | Real closed loop: baroreflex arms, Mayer waves, RSA, CNS ischemic and volume reflexes |
| Structural | `src/physics/structural.ts` | Real closed loop: 10 nodes, four elastance chambers, Gorlin orifices, O₂ solve; solved to a periodic steady state; no reflexes, devices, pericardium or inertance |
| Coronary lesion | `src/physics/hemodynamics.ts` | Steady lesion physics (Poiseuille + Young–Tsai), collaterals, autoregulation, FFR |

The ACS game runs on the weakest model, and the strongest one (structural) is used only by the structural tab.

## 3. Target architecture

One engine, `src/physics/core/`, stepped continuously in time and used by everything:

```
core/
  engine.ts        state vector + integrator; step(dt) for live play, periodic() for steady-state reports
  graph.ts         nodes (chambers, compliances) and edges (valves, orifices, resistors, inertances, pumps)
  chamber.ts       elastance chamber: ESPVR, EDPVR, activation, relaxation, regional segments
  pericardium.ts   pericardial sac, septal interaction, intrathoracic pressure
  vessels.ts       3-element Windkessel, venous capacitance with stressed/unstressed volume
  valves.ts        Bernoulli + inertance valve with opening dynamics
  fluids.ts        blood volume, interstitium, Starling filtration, lung water
  oxygen.ts        transport in time (generalises structural's steady solve), DO₂/VO₂/SvO₂/lactate
  coronary.ts      coupling to hemodynamics.ts: perfusion pressure, intramyocardial pressure, supply/demand
  drugs.ts         receptor-level effects with onset/offset kinetics
  devices/         pump.ts (generic rotary), impella.ts, ecmo.ts, iabp.ts, (lvad.ts, tandem.ts later)
  outputs.ts       catheter numbers, PV-loop metrics, device consoles
```

Principles carried over from the existing code:

- **Designed around the patient, edited by the lesion.** The baseline sets the parameters; a lesion, drug or device changes
  only its own parameter and the circulation answers (as `structural.ts` does now).
- **Constants tagged `[lit]` or `[assumed]`** in `src/config/`, as now.
- **The ECG drives activation.** Each ventricular beat from `rhythm.ts`/`ecg.ts` starts the ventricular activation curve,
  and each P wave starts the atrial one. PVCs, AV block, AF and loss of atrial kick then fall out of the chamber model and
  replace the fill factors in `beatHemo.ts`.
- **The autonomic loop drives the engine:** HR, Ees, arterial resistance, unstressed venous volume (venoconstriction),
  relaxation time.
- **Steady-state reports stay.** `analyze()` (structural tab, MCP tools) becomes "run the engine to a periodic state",
  so `tests/structural*.test.ts` remain the regression suite for the migration.

Numerics: about 25–40 states (volumes, inertial flows, pump flows, balloon volume, fluid compartments). Fixed-step RK4
at 0.25–0.5 ms costs roughly 100k derivative evaluations per simulated second, which is cheap in a Web Worker. Valves
and inflow suction are stiff; give them inertance and a smooth law (as `ORIFICE_EPS` does now), and keep a semi-implicit
fallback if RK4 needs a smaller step.

## 4. Workstreams

### A. Core engine (do first; the rest depends on it)

1. Generalise `structural.ts`'s graph and solver into `core/`: add an inertial edge type, external pressure on nodes,
   event-driven activation, and a live `step(dt)`.
2. Chamber upgrades:
   - activation with a separate relaxation time τ (lusitropy) after peak, so impaired relaxation (HFpEF) differs from
     a stiff end-diastolic curve;
   - **regional segments:** split the LV into segments mapped to the coronary beds (`ecgLink.ts` sites). An ischemic segment
     loses active elastance and bulges, which adds dead volume and regional dyskinesis instead of a global Ees cut;
   - force–interval effects (rest potentiation, post-extrasystolic potentiation) from a one-state calcium proxy.
3. Vessels: 3-element Windkessel (characteristic impedance, resistance, compliance) on systemic and pulmonary sides;
   split the systemic veins into splanchnic (large, controllable unstressed volume) and peripheral reservoirs.
4. Swap the ACS sim (`src/sim/simulation.ts`) from `circulation()` + `BeatHemodynamics` onto the engine, with the old
   path kept behind a flag until the scenario tests pass on the new one.

Done when: a normal adult gives MAP 90, CO ≈ 5 L/min, CVP 4, PCWP 8, LVEF ≈ 58% live and steady; all existing tests pass;
ACS scenarios reproduce their teaching direction (anterior STEMI → lower SV, higher LVEDP; RV infarct → high RA, low PCWP).

### B. Pericardium and ventricular interaction

- **Pericardial sac:** P_peri = f(V_heart + V_effusion), exponential; each chamber's pressure becomes transmural +
  P_peri.
- **Septum:** an interventricular-septum volume solved each step so septal transmural pressure balances P_LV − P_RV
  (free-wall/septum formulation in the Santamore–Burkhoff / Smith–Chase line). RV dilation then compresses LV filling.
- **Intrathoracic pressure** P_th from breathing (phase already in `autonomic.ts`), applied to the pericardium, pulmonary
  vessels, thoracic aorta and SVC; spontaneous vs positive-pressure ventilation, and PEEP.
- **Scenarios and actions:** effusion volume and how fast it builds (acute vs chronic stretch), tamponade,
  pericardiocentesis (drain ml), constrictive pericarditis (stiff sac, no effusion), RV infarct with septal shift, open
  pericardium after surgery.
- **What should emerge (tests):** equalised diastolic pressures within ~5 mmHg in tamponade; pulsus paradoxus over 10 mmHg;
  RA y descent loss in tamponade vs steep y descent in constriction; Kussmaul sign; respiratory discordance of LV/RV
  systolic pressure; ECG electrical alternans from the existing preset tied to effusion size.

### C. Fluids as a concept

- **Stressed and unstressed volume.** Mean systemic filling pressure = stressed volume / venous compliance, so Guyton venous
  return comes from the model. Venoconstriction (sympathetic, norepinephrine α₁) moves unstressed to stressed volume; this
  is the nuance the current model misses.
- **Compartments:** intravascular, interstitial, lung interstitium. Starling filtration from capillary and oncotic
  pressure:
  - crystalloid: most leaves the vessels over about 30 min;
  - colloid and albumin: stays in;
  - blood: restores volume and Hb, and so oxygen content;
  - hemorrhage (rate), diuresis (furosemide: venodilation first, then natriuresis), capillary leak (sepsis).
- **Lung water:** pulmonary capillary pressure above ~18–25 mmHg fills lung interstitium, which lowers `satLung` (the
  structural O₂ solve already uses it) and stiffens the lung. That replaces `congestionGain`.
- **Fluid responsiveness as an output:**
  - the patient's position on their own Starling curve;
  - pulse-pressure and stroke-volume variation from P_th (only valid under positive-pressure ventilation, as clinically);
  - passive leg raise (moves about 300 ml unstressed → stressed, reversibly);
  - a mini-bolus test.
- **Views:** Guyton cardiac-function / venous-return plot with the operating point moving live; CVP and PCWP trend.

### D. Mechanical circulatory support, dynamic

One **generic rotary pump element** between two nodes:

```
L_p · dQ/dt = H(ω, Q) − (P_out − P_in) − R_inflow(P_in, V_in) · Q
H(ω, Q) = a·ω² − b·ω·Q − c·Q·|Q|          (fitted per device to published HQ curves)
```

- **Suction:** R_inflow rises steeply as inflow-chamber pressure or volume collapses. This gives suction events, flow
  drops and alarms, and makes the pump depend on preload and RV function (`impellaRvSuction` becomes physics).
- **Device console outputs:** flow, motor current (∝ hydraulic load, so its waveform carries the LV–aortic gradient, the
  "placement signal"), pulsatility index, suction alarms.
- **Hemolysis proxy** (optional): shear × exposure time, rising with speed and suction.

Devices:

1. **Impella 2.5 / CP / 5.5** (LV→ascending aorta). P-levels P1–P9 map to speed.
   - Teaches flow vs afterload, LV unloading on the PV loop, loss of aortic valve opening at high support, suction with
     hypovolemia or RV failure, and the oxygen-cost reduction (PVA falls).
   - Malposition scenario: inflow in the aorta, so the pump recirculates and does not unload. Placement-signal and motor
     current change accordingly.
2. **Impella RP** (IVC→PA) for RV failure; BiPella.
3. **VA-ECMO** (RA/IVC drainage → femoral return into the descending-aorta node).
   - Oxygenator: return saturation from sweep and FiO₂, plus a resistance.
   - What emerges: afterload rise, LV distension and pulmonary edema without a vent, aortic valve closure and stasis,
     drainage chatter when the RA collapses (ties to fluids).
   - Differential hypoxemia: native lung blood fills the arch, ECMO blood fills the descending aorta. The existing
     AO/DAO split shows it already; Workstream F makes the mixing point move.
   - Venting options: Impella (ECPELLA), IABP, and atrial septostomy using the existing ASD edge.
4. **IABP:** 40 ml balloon as a time-varying volume in the descending aorta.
   - Triggered from the ECG (beats already exist), with timing from the dicrotic notch and the R wave.
   - 1:1 / 1:2 / 1:3 ratios. Diastolic augmentation and assisted end-diastolic dip emerge from the physics, as do the
     classic timing-error waveforms (early or late inflation and deflation).
   - Coronary benefit through the diastolic pressure–time integral (Workstream E) instead of `iabpCoronaryAug`.
5. **Later:** TandemHeart (LA→femoral artery), durable LVAD with ramp study and artificial pulse.

Dynamic behaviour, not static numbers:

- start-up and speed changes play out over beats;
- the device–native-heart interaction depends on the current state;
- weaning trials (step speed down, watch LVEDP, MAP, pulsatility);
- arrhythmias during support (VF on Impella keeps some flow if RV preload holds, on ECMO it does not matter);
- the cath tab shows device artefacts on pressure traces.

### E. More nuanced hemodynamics

- **Myocardial oxygen balance from the model.** Demand: MVO₂ = a·PVA + b·Ees + basal (Suga) from the live LV loop.
  Supply: coronary flow from `hemodynamics.ts`, driven by diastolic aortic pressure, diastolic time, LVEDP (subendocardial
  back-pressure) and intramyocardial pressure (systolic compression). Supply/demand per bed feeds ischemia severity, which
  feeds segment elastance (A.2). Hypotension → ischemia → weaker pump becomes a loop the model produces. This replaces
  `demandFactor()`.
- **Drugs at receptor level** with onset and offset kinetics:
  - norepinephrine: α₁ arterial and venous (unstressed volume), some β₁;
  - epinephrine; dobutamine (β₁ > β₂); milrinone (Ees, τ, vasodilation); vasopressin (arterial only);
  - nitroglycerin (venous before arterial); nitroprusside (arterial); β-blockers (link to `betaBlock`); furosemide.

  Each maps to engine parameters, replacing the `SUPPORT` multipliers.
- **Dynamic valves:** functional MR from LV dilation (annulus scales with EDV); ischemic MR from inferoposterior segment
  dysfunction (papillary muscle); optional dynamic LVOT obstruction.
- **Lungs:** hypoxic pulmonary vasoconstriction; alveolar pressure and PEEP on pulmonary resistance; RV afterload under
  ventilation.
- **Oxygen in time:** DO₂, VO₂, SvO₂, lactate accumulation below critical DO₂; SCAI shock stage computed from the state
  rather than set by hand.
- **Clinician outputs:** PA-catheter waveforms (CVP a/v, wedge v waves), thermodilution CO, cardiac power output, PAPi,
  SvO₂, Ea/Ees coupling, dP/dt max, τ, PVA, stroke work; PV loops for all four chambers on the ACS screen.

### F. Navier–Stokes: what is feasible

Full 3D Navier–Stokes of the heart in real time in a browser is not feasible, and research-grade FSI would not run there.
A tiered plan:

1. **1D Navier–Stokes arterial network (recommended, real physics, real time).** Area-averaged mass and momentum with a
   tube law, on the aorta and major branches (about 30–60 segments). The 0D heart drives the inlet; 3-element Windkessel
   outlets follow Alastruey et al. (2008), and energy-consistent heart coupling follows Manganotti et al. (2021).
   It gives:
   - pulse-wave propagation and reflection, central vs radial pressure, augmentation index, aortic stiffness effects;
   - an IABP that physically displaces blood in a 1D aorta;
   - VA-ECMO retrograde flow meeting antegrade flow at a mixing point that moves with native output. Carrying saturation
     along the aorta makes differential hypoxemia spatial and lets the "where does the watershed sit" question be taught.

   Extension: 1D coronaries on the existing tree geometry (`src/anatomy/tree.ts`) with intramyocardial pressure, which
   gives systolic flow impediment and diastolic-dominant flow. Cost: MacCormack or DG at dt ≈ 0.1 ms on ~50 segments
   should run faster than real time in a worker; benchmark early.
2. **Offline CFD to calibrate reduced models.** Run 3D simulations (SimVascular/svFSI, OpenFOAM or FEniCS) on stenosis
   shapes, Impella outflow and ECMO return to fit the loss coefficients we use (`STENOSIS.Kt`, pump inflow losses), and
   POD reduced-order fields for visuals. Results ship as tables, not solvers.
3. **In-browser 2D lattice Boltzmann on WebGPU (visual, optional).** Live flow fields for a stenosis jet, an LV filling
   vortex in echo views, or the Impella jet, with boundary flows from the 0D/1D engine. For teaching visuals, not
   quantitative output.

### G. The simulator as a full playground

Goal: the Simulator page (`sim/`, `src/app.ts`) can show and control everything the site models, on one patient, at the
same time. Today the structural graphs live only on the structural tab, the cath data only on the cath tab, and the
simulator has a monitor, ECG and the coronary 3D view.

**One patient, one spec.** Merge the ACS `Scenario` (`src/sim/scenario.ts`), `StructuralSpec` and the new support,
fluid and pericardium settings into one `PatientSpec`. It is URL-encodable (extending `src/sim/llm.ts`, still decoding
old links) and read the same way by every page and by the MCP tools. Any page can open the current patient
("open in cath lab / echo / structural").

**One source for every panel.** Panels read from a `HemoSource` interface, not from an engine: traces per node, loops,
saturations, cath readings, device consoles, beat events. The first implementation is an adapter over today's engines,
so UI work can start in parallel with Phase A:

- the structural engine is solved to a steady state with the ACS state applied: ischemic fraction scales Ees, heart rate
  comes from the rhythm;
- its waveform is replayed beat by beat, re-solved every few seconds or when something changes.

Once `LiveHeart` (A6) lands, the source switches to it and the adapter is deleted.

**Panels** (each one can be switched on or off, in a grid workspace on desktop and as tabs on phones):

| Panel | Shows | Notes |
|---|---|---|
| Monitor (existing) | HR, BP, SpO₂, rhythm | Add arterial line, SpO₂ pleth, CVP and PA waveforms |
| Hemodynamic traces | Left- and right-heart pressure traces as on the structural tab, scrolling live | Reuse `src/structural/traces.ts` |
| PV loops | LV, RV, LA, RA loops; end-systolic and end-diastolic lines; ghost of a saved loop for comparison | |
| JVP | RA/jugular waveform with a, c, x, v and y labelled; height in cm above the sternal angle; a neck illustration that pulses | Cannon a waves in complete heart block need event-driven atria (A4). Giant v in TR; no a wave in AF; steep y and Kussmaul in constriction; raised and flat in tamponade |
| Right-heart cath | RA → RV → PA → wedge pullback with waveforms; oximetry run (SVC, IVC, RA, RV, PA) with step-up detection; Fick and thermodilution CO; PVR, SVR, Qp:Qs, PAPi, cardiac power output | Pure functions in `src/sim/cath.ts` beside angio and wire |
| Left-heart cath | LV → aorta pullback; LVEDP; peak-to-peak, mean and peak instantaneous gradients; Gorlin and Hakki areas; simultaneous LV–wedge for mitral stenosis | Same module |
| O₂ | SpO₂, SaO₂ (pre- and post-ductal), SvO₂, DO₂, VO₂, Qp:Qs; lactate once E6 lands; ECMO return saturation | |
| 3D view: **O₂ sat mode** | New mode beside Anatomic / Territory / Pressure / Velocity / Wall shear. Vessels coloured by arterial saturation; myocardium by tissue oxygenation (coronary venous saturation per bed); chambers by blood saturation using the structural colour scale | v1 tissue value is derived from ischemia severity and labelled as such; v2 comes from the supply/demand loop (E2/E3) |
| Structural props in the 3D heart | Valves opening, septal defects, jets (`src/structural/props.ts`) | Toggle |
| Devices, fluids, pericardium | Device consoles (D8), Guyton plot and fluid controls (C5), effusion and pericardiocentesis (B4) | Arrive with their phases |

**Playground mode.** A sandbox that unlocks every control on one patient: coronary lesions, structural lesions, rhythm,
drugs, fluids, devices, pericardium, patient kind. It has presets that combine them (e.g. "anterior STEMI + ischemic
MR + Impella CP"), time controls (pause, slow motion, step one beat), saved snapshots to overlay and compare, CSV export
of traces, and a share link. The coronary tree is adult anatomy, so neonatal patients get the structural and
hemodynamic panels without the coronary view.

**Performance.** The engine runs in a worker. Panels subscribe to the taps they draw, and traces are decimated to the
pixels shown; hold 60 fps with all panels open on a mid-range laptop.

## 5. Order and milestones

| # | Milestone | Depends on | Notes |
|---|---|---|---|
| 1 | Core engine (A.1, A.3), structural tab on it, tests green | none | Biggest single step |
| 2 | ACS sim on the engine, ECG-driven activation, autonomic → engine (A.4) | 1 | Old path behind a flag |
| 3 | Fluids: stressed/unstressed volume, compartments, PLR (C) | 1 | Small once 1 exists |
| 4 | Generic pump + Impella CP/5.5 with suction and console (D.1) | 1, 3 | First visible win over the static model |
| 5 | Pericardium, septum, intrathoracic pressure, tamponade (B) | 1 | Gives PPV/SVV for 3 |
| 6 | Regional segments + O₂ supply/demand loop (A.2, E) | 2 | Makes the shock spiral emerge |
| 7 | IABP, VA-ECMO, ECPELLA, Impella RP (D.2–4) | 4, 6 | |
| 8 | Receptor-level drugs, dynamic valves, lung/O₂ in time (E) | 2, 3 | Retires the `SUPPORT` multipliers |
| 9 | 1D aorta (F.1), then 1D coronaries | 1 | Benchmark first |
| 10 | Offline CFD calibration; WebGPU LBM visuals (F.2–3) | 9 | Optional |
| P | Playground (G): unified spec and `HemoSource` adapter first, then panels; switch to `LiveHeart` after 2 | none to start | Runs in parallel with 1–2 |

## 6. Validation

- **Anchors:** normal adult and neonate numbers already in `src/config/structural.ts`; add published ranges for each new
  output (tagged `[lit]`).
- **Direction tests per feature**, written before the feature, as in the existing suite:
  - Impella: higher MAP and CO, lower LVEDP and PVA, narrower pulse pressure; flow falls as afterload rises.
  - ECMO: LVEDP rises without a vent and falls with one.
  - IABP: diastolic augmentation, about 5–10% systolic unloading.
  - Crystalloid: about a quarter stays in the vessels at 30 min.
  - Norepinephrine: raises mean systemic filling pressure.
  - Tamponade: the signs in B.
- **Conservation:** total blood plus interstitial water are conserved except for explicit inputs and losses (extends the
  existing `bloodVolume` checks).
- **Performance budget:** the engine plus ECG plus rendering hold 60 fps on a mid-range laptop; the engine runs in a worker.

## 7. Risks and open questions

- **Stiffness:** suction, valve closure and the pericardium are stiff. Mitigate with inertance, smooth laws and a
  semi-implicit fallback; test with dt halving.
- **Recalibration of teaching scenarios:** ACS scenario thresholds are tuned to `circulation()`. Plan a calibration pass per
  scenario; keep the old model behind a flag until done.
- **MCP / LLM tool schemas** (`src/mcp/tools.ts`, `src/sim/explain.ts`) change when support becomes devices with settings.
  Version the tool outputs.
- **Explainability:** the "why" text (`advice.ts`, `explain.ts`) must read from engine quantities (PVA, filling pressure,
  pump flow), not from removed multipliers.
- **Harvi parity claims** need a check against harvi.online itself (section 1).
- **Decisions for the owner:** which devices ship first beyond Impella; whether the 1D aorta is part of v1 or a follow-up;
  whether to keep the algebraic model as a "fast mode".

## References found while planning

- Bronicki, Tume, Burkhoff, Penny, *Simulation in Cardiovascular Critical Care Medicine* (Springer, 2024): describes
  Harvi's model.
- Santamore & Burkhoff, "Hemodynamic consequences of ventricular interaction as assessed by model analysis" (1991).
- Burkhoff & Sagawa, "Ventricular efficiency predicted by an analytical model" (1986): PVA and oxygen use.
- Alastruey et al., Commun. Comput. Phys. 4:317–336 (2008): 1D–0D outflow coupling.
- Manganotti et al., Adv. Model. Simul. Eng. Sci. (2021), doi 10.1186/s40323-021-00206-4: energy-consistent 1D–0D heart
  coupling.
- ECPELLA biventricular failure simulation, Intensive Care Med. Exp. (2024), doi 10.1186/s40635-024-00599-7.
- CARDIOSIM© (Bioengineering 2022, 9:383): another simulator with VAD, IABP and ECMO modules.
