# Simbook: plan

Status: plan only, nothing implemented. Scope: chapters 1 to 4 are planned. Chapter 6 (the heart cycle and the Wiggers diagram) and the concept backlog are parked for later and deliberately not planned here.

## 1. What it is

A chapter-based reader for basic cardiac physiology at `/simbook/` (working URL). Each chapter is a few short paragraphs and one sim widget. A widget is CoroSim's own simulation principles in a smaller, restricted context: most knobs are locked, one or two are exposed, and the learner sees one idea at a time.

Every chapter follows the same loop:

1. **Predict.** The learner is asked what will happen.
2. **Change one thing.** One or two sliders.
3. **Watch.** Traces and graphics update live.
4. **Reveal.** A short text ties the result back to the equation.

This reuses the "prompt, then answer" pattern in `src/cases/engine.ts`, without scoring.

The thread through the book: tissues need O₂, so blood carries it; diffusion only works over tiny distances, so a pump must push blood to the tissues; exchange at the capillary is governed by Fick and Starling; the circuit is governed by Ohm's law; and pressure is what sets how much flow each organ gets.

## 2. How it fits the codebase

| Need | Reuse | New |
|---|---|---|
| Page shell, masthead, AI button | `src/shell/`, same as `cath/` and `echo/` | `simbook/index.html`, an entry in `vite.config.ts`, a link from the homepage |
| Physics for the circuit chapters | `src/physics/core/` (`vessels.ts`, `fluids.ts`) and `src/physics/circulation.ts` for the lumped `MAP = CO × SVR` view | A `Lesson` spec per chapter: starting state, locked and exposed parameters, what to draw |
| Capillary exchange | `src/physics/core/fluids.ts` (Starling filtration, lung water) | A 1-D capillary profile helper if the existing code only gives a net number |
| Autoregulation | `src/physics/hemodynamics.ts` already has autoregulation and flow reserve for the coronary beds | Generalize the plateau curve to brain, kidney and gut with per-organ ranges |
| Drawing | `src/panels/` plotting helpers, `src/ecgStrip.ts` style for live strips | Small canvas widgets: tissue slab, capillary, organ bars, circuit schematic |
| Chapter runner | Pattern from `src/cases/engine.ts` | `src/simbook/`: chapter list, text blocks, widget mount, prediction prompts |

Principles:

- Widgets are pure functions of a few parameters wherever possible (diffusion, Starling, Ohm, Poiseuille are closed-form). Only the circuit widget needs time-stepping, and only to animate.
- Constants live in `src/config/` tagged as literature-backed or assumed, like the rest of the repo.
- No new engine is needed for chapters 1 to 4. The heart-cycle chapter is the one that needs a beat-resolved elastance engine, which is why it is parked.

## 3. The chapters

### Chapter 1: Why we have blood

**Idea**
- Cells need O₂ for respiration. Blood is an O₂-carrying fluid, so a system that pushes that fluid to the tissues is required.
- Diffusion time scales with distance squared (t ≈ x²/2D), so anything more than about 100 µm from a source starves. Bulk transport is the fix.

**Widget: tissue slab with an O₂ profile**
- A slab of tissue with a capillary at one edge and a live O₂ concentration profile across it.
- The learner drags cells farther from the capillary and watches the core go anoxic.
- The learner then turns on flow (more or closer capillaries) and the profile recovers.

**Levers**
- Distance from the capillary, capillary density, flow on or off, tissue O₂ consumption.

**Prediction prompts**
- "Where does O₂ run out?" "What happens if the tissue is twice as thick?"

**Checks (tests)**
- Anoxic radius grows as consumption rises and shrinks as capillary O₂ rises.
- Diffusion time quadruples when distance doubles.

### Chapter 2: Fick's law of diffusion and Starling's equation

Two exchange laws at the same barrier: Fick says what crosses by concentration, Starling says what fluid crosses by pressure.

**Part A: Fick's law of diffusion**
- J = D·A·ΔC / x.
- Widget: sliders for membrane area, thickness and gradient, with flux shown.
- Worked example: alveolar-capillary membrane thickening (fibrosis, edema) lowers flux, so O₂ transfer falls.

**Part B: Starling's equation**
- Jv = Kf[(Pc − Pi) − σ(πc − πi)].
- Widget: one capillary drawn from arteriolar end to venular end. Hydrostatic pressure falls along it, oncotic pressure stays roughly constant, and the net filtration or reabsorption at each point is shown as arrows and a curve. The learner sees filtration at the arterial end and reabsorption toward the venous end.
- Levers: venous pressure (heart failure), albumin (cirrhosis, nephrotic syndrome), permeability (sepsis).
- Outcome readout: net fluid leaving the capillary per minute, with an "edema" indicator when it exceeds what the lymphatics return. Lymph is left out as a lever in this chapter, as asked; it is a fixed background return.

**Prediction prompts**
- "Venous pressure doubles: what happens to filtration along the capillary?" "Albumin halves?"

**Checks (tests)**
- Net filtration rises with Pc and with falling πc, and with Kf.
- With normal values the capillary filters at the arterial end and reabsorbs at the venous end, with a small net filtration.

### Chapter 3: Pressure is the main determinant of perfusion

(The brief had this under chapter 2's bullets; I have made it its own chapter. Say if you want it folded back in.)

**Idea**
- Perfusion pressure is the pressure going in minus the pressure leaving.
- Organs are in parallel, so each sees the same MAP and uses local resistance to take its share of flow.
- Autoregulation: flow stays on a plateau across a range of pressures, then fails below the range.

**Widget: brain, kidney and gut bars**
- Three flow bars with a MAP slider.
- As MAP falls, flow holds on the plateau while local resistance falls, then collapses below each organ's lower limit.
- Each organ shows its own limit; the brain and kidney hold on the plateau, the gut is shown as less protected.
- A readout shows resistance falling (vasodilation) to keep flow up, and shows where compensation runs out.

**Bridge to the main sim**
- A one-line link to the coronary case: coronary flow is mostly in diastole, so diastolic pressure matters there. This points to `/sim/` without teaching it here.

**Prediction prompts**
- "MAP drops from 90 to 60: which organ loses flow first?"

**Checks (tests)**
- Flow is flat within the plateau and falls roughly linearly with pressure below it.
- Local resistance falls as MAP falls within the plateau.
- Organs differ in their lower limits.

### Chapter 4: The circulation as a fluid circuit and Ohm's law

**Idea**
- ΔP = Q·R, so MAP − CVP = CO × SVR.
- Series versus parallel resistance: series adds, parallel adds as reciprocals, so adding a parallel organ lowers total resistance.
- Poiseuille: R ∝ 1/r⁴, so a small change in radius is a big change in resistance.

**Widget: schematic heart as a pump and loop with organs in parallel**
- A drawn loop with the heart as a pump and several organ branches in parallel, each with its own resistor.
- The learner changes pump output or one resistor (or one vessel's radius) and watches pressures and flows redistribute, with a pressure gradient shown around the loop.
- Readouts: MAP, CVP, CO, SVR, and per-organ flow.

**Prediction prompts**
- "Halve one vessel's radius: how much does its resistance change? Does MAP change? Does flow to the other organs change?"
- "Double cardiac output with the same resistance: what happens to MAP?"

**Checks (tests)**
- MAP − CVP = CO × SVR holds in the widget at every setting.
- Halving the radius multiplies that vessel's resistance by 16.
- Branch flows sum to cardiac output.

## 4. Delivery order

1. **Skeleton.** `simbook/index.html`, the chapter runner, the prediction prompt, and one locked-parameter widget. Ship chapter 4 (Ohm's law) first; it is the simplest and the most reusable.
2. **Chapter 3.** It reuses the chapter 4 organ branches and adds autoregulation.
3. **Chapter 1.** Tissue slab and diffusion profile.
4. **Chapter 2.** Fick, then the Starling capillary.
5. **Polish.** Links in and out (homepage, masthead switch, bridges to `/sim/` and `/cases/`), mobile layout, a short intro page.

## 5. Open decisions

- **Audience level.** Pre-clinical physiology, or closer to what `/cases/` assumes? This changes how much math goes in the text.
- **URL and name.** `/simbook/` assumed.
- **Fick principle.** The earlier draft also had the Fick principle (VO₂ = CO × (CaO₂ − CvO₂)); it is out of this plan. Chapter 1 could carry a short mention, or it can go in the backlog.
- **Persistence.** Save prediction answers or progress to the account, or stay stateless?
- **Chapter 3 placement.** Its own chapter (as written here) or part of chapter 2.

## 6. Parked for later (not planned)

### Chapter 6: The heart cycle and the Wiggers diagram

- Valves are passive and pressure-driven. Open when upstream pressure exceeds downstream, close when it reverses. Every phase follows from that.
- Widget: a demonstration of the cycle (design to be decided).
- Interaction: click or scrub to any phase, and the text for that phase appears.
- A PV loop next to it with a "link" toggle.
- Underlying idea: the ventricle is a time-varying elastance, which is why pressure rises when volume stays the same (the isovolumic phases).
- Needs a beat-resolved elastance engine; check that `src/physics/core/` can run headless before starting.

### Other hemodynamic concepts (backlog)

**The pump**
- Preload, afterload, contractility, lusitropy (relaxation)
- Frank–Starling mechanism
- Stroke volume, ejection fraction, cardiac output and index, heart rate and filling time
- PV loop, ESPVR and EDPVR, Ees and Ea (arterial elastance)
- Stroke work, pressure-volume area, myocardial O₂ demand
- Laplace's law and wall stress
- Right versus left ventricle
- Ventricular interdependence
- Pericardial constraint and tamponade

**Venous side**
- Venous return, Guyton's curves and the mean systemic filling pressure
- Stressed versus unstressed volume
- Capacitance vessels
- Vascular waterfall (Starling resistor)
- Intrathoracic pressure, breathing, PEEP

**Vessels**
- Compliance and the Windkessel
- Pulse pressure, SBP/DBP/MAP, and why MAP is not the average of SBP and DBP
- Pulse wave velocity, wave reflection, augmentation
- Arterial stiffness with age
- Pressure amplification toward the periphery
- Laminar versus turbulent flow, Reynolds number
- Viscosity and hematocrit
- Wall shear stress

**Valves and shunts**
- Bernoulli and the pressure gradient across a stenosis
- Continuity equation
- Gorlin orifice area
- Regurgitation (volume load) versus stenosis (pressure load)
- Qp:Qs and shunts
- SVR versus PVR

**Regulation**
- Baroreflex, sympathetic and vagal arms
- RAAS and volume control
- Autoregulation: myogenic and metabolic
- Reactive hyperemia, flow reserve
- Bainbridge and Bezold–Jarisch reflexes
- Exercise, Valsalva, standing up
