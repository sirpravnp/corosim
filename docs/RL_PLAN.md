# RL development plan: treating acute MI with cardiogenic shock in CoroSim

Status: plan, nothing built yet. Educational and research use only; never a clinical decision aid. A policy learned here
describes how **the model** behaves, not how patients do (the README says the anatomy is schematic and many constants are assumed).

## 1. Goal

Train and evaluate a policy that manages a simulated acute MI with shock: pressors and inotropes, Impella, IABP, ECMO,
fluids, pacing, and the timing of revascularization, while handling complications that branch the course.

Why this use case, and not STEMI alone: for an occluded artery the best action is a fixed rule (order PCI now), so RL adds
nothing. The real decisions are in the shock phenotypes (LV, RV, biventricular, bleeding, tamponade), where drugs and devices
trade off against each other and against time.

**Question the project answers:** does a learned policy beat the best fixed protocol *per phenotype*, and how sensitive is that
answer to the model's assumed constants? If one fixed protocol wins everywhere, the problem is too easy and we stop early.

## 2. What exists (verified in the repo)

- Headless seeded `Simulation` (`src/sim/simulation.ts`): `reset`, `step`, `apply(patch)`, `revascularize`, `shock`, `giveDrug`,
  `setCpr`, `state`, `ecg`, `assessment`. One object drives the app, the MCP server and the tests.
- `PatientSpec` is a serialisable patient (anatomy, lesions, bleed, rhythm, electrolytes, tendencies, support, devices,
  pericardium, valves, VSD).
- Reward-relevant outputs: MAP, cardiac output, EF, LV infarct fraction, `dead`/`deathCause`, `ischemicMinutes`, advisor
  `warnings` (harmful choices), case scoring (`src/cases/*`, `harms.ts`).
- Existing baselines: the advisor's `steps` (guideline order) and six scripted cases (`lmShock`, `inferiorRv`, `ecpella` ...).
- Measured once on 4 vCPU (core engine, anterior STEMI): reset (settled, warm-up) about 2.6 s; 30 agent steps of 10 simulated
  seconds including `state`/`ecg`/`assessment` about 27 s, so about 0.9 s per step per core. Not yet profiled per call.

**Gaps that block good RL:**

1. `revascularize("pci")` is deterministic and always perfect (`applyProcedure` returns `lesion: null`). Nothing branches after
   treatment. Only fibrinolysis (55%) and arrhythmia hazards are random.
2. Device and drug harms are unaudited. If devices are free in the reward, the agent learns "everything, immediately".
3. No Python, Gymnasium or RL code, and no fast reset path.

## 3. Architecture

```
Python: Gymnasium env + MaskablePPO  <-- JSON lines over stdio -->  Node worker: rl/env-server.ts  (one Simulation per env)
```

- Keep the model in TypeScript so the RL environment cannot drift from the app. The worker is a persistent process, the same
  pattern as `src/mcp/main.ts` stdio mode.
- Protocol: `reset(seed, spec) -> obs`, `step(action) -> obs, reward, done, info`, `snapshot()/restore()` if feasible.
- Layout: `rl/` (TypeScript: `env-server.ts`, `env.ts`, `reward.ts`, `sampler.ts`) and `rl/python/corosim_gym/`.
- Stack: Gymnasium, Stable-Baselines3 and sb3-contrib `MaskablePPO`. No custom RL infrastructure.

## 4. Environment specification (v1)

**Decision step.** 10 simulated seconds. While the patient is critical the clinical clock runs in real time (`criticalTime`),
so define the step in clinical time and cap episodes at 24 clinical hours or death.

**Observation: only what a clinician could realistically know.** Rule: the policy sees what a bedside team would have, when
they would have it, with the noise and delay it comes with. The sim's internal state is never an input. An observation layer
(`rl/observe.ts`) maps `Simulation` state to this clinician's view; a test asserts the observation keys are a whitelist.

| Tier | What the policy gets | How it is limited |
|---|---|---|
| Continuous monitor | Heart rate; rhythm class (sinus, AF, VT, VF, paced, block); PVC rate; SpO2 if the model supports it | Rounded to monitor precision |
| Blood pressure | Cuff pressure every few minutes; continuous arterial-line pressure only after an arterial line is placed (an action) | Cuff is intermittent and noisier; MAP is derived, not read from the engine |
| 12-lead ECG | ST elevation or depression by lead group, rhythm, QRS width | Only when ordered, plus a repeat on a schedule; a snapshot, not continuous |
| Bedside exam | Coarse findings: cool or warm, JVP high or normal, crackles, new murmur | Few ordinal levels, derived from congestion, JVP and perfusion; no exact numbers |
| Echo (ordered) | EF band (severe, moderate, preserved), RV size or function, effusion present, severity of MR, VSD | Costs time; noisy bands, not exact values |
| Invasive hemodynamics | Cardiac output, wedge pressure, right atrial and PA pressures, mixed venous saturation | Only after a right heart cath is placed (an action, with a delay and a complication risk) |
| Cath lab | Angiographic flow grade and culprit location | Only during or after a cath |
| Device console | Impella level and flow estimate, ECMO flow and RPM; IABP ratio | Only for devices that are in |
| History | Minutes since symptom onset (given at the start, with uncertainty), time since each intervention, drugs and fluids given | Known to the team |

**Not exposed as inputs** because a clinician cannot measure them in real time: LV and RV ischemia fractions, infarct size,
coronary perfusion pressure, exact stroke volume, EF on every step, the true lesion (artery, position, stenosis), the seed,
tendencies for ectopy and arrhythmia, scheduled or pending complications, `deathCause`, and the advisor's `steps` and
`warnings` (a guideline oracle the agent would copy). **Not modelled in CoroSim, so unavailable:** lactate, troponin, labs,
urine output, age and comorbidities. The report must say the agent had no lactate or troponin, since clinicians lean on both.

Rules for the layer:
- Information is an action: ordering an ECG, echo, arterial line or right heart cath takes time and carries a cost or risk, so
  the agent faces real choices about what to find out.
- Hidden complications must surface through this clinician's view (falling pressure, new murmur, effusion on echo) before the
  agent can respond to them.
- Observations carry realistic noise, rounding and delay; ordinal bands rather than exact values for exam and echo.
- Partial observability, so use a recurrent policy or frame stacking over the last several observations.
- **Privileged information is allowed only for the learning signal and evaluation**, never as a policy input: the reward and an
  asymmetric critic (value function) may use the true state (infarct fraction, true lesion, `dead`), while the actor sees only
  the clinician's view. This keeps training fast without leaking.

Open check (phase 0): confirm which of the echo, exam and invasive findings the simulator can already produce
(`src/sim/leftHeartCath.ts`, `rightHeartCath.ts`, `cath.ts`, `src/physics/jvp.ts`, the echo atlas) and which need new code.

**Actions.** Off/low/high for norepinephrine, epinephrine, dobutamine, milrinone, vasopressin, nitroglycerin, diuretic; fluid
bolus; pacing (with a rate); IABP; Impella (level, with removal); ECMO (flow, with removal); order PCI, lysis or CABG; wait.
Arrest actions (CPR, shock, epinephrine, amiodarone) are masked unless in arrest and are phase 6, not v1.

**Action masking.** No repeat of a one-time procedure, no device twice, no removal of a device that is not in, no arrest actions
outside arrest.

**Reward** (all weights in one config file, reviewed with a clinician):
- terminal: survival; final LV infarct fraction; final EF
- running: minutes with MAP < 65 or cardiac index < 2.2; door-to-reperfusion time
- costs: per device-hour, larger for ECMO and Impella; per advisor warning raised; a tiny per-intervention cost against thrashing
- not the advisor's `steps` as a reward (the agent would just copy it); use it only as an evaluation baseline

**Patient sampler.** Anatomy variant, culprit artery, position and occlusion, shock stage (SCAI B to E by starting MAP and
output), RV infarct, bleed, electrolytes, `ectopyTendency`, `arrhythmiaTendency`, exertion, baseline rhythm and BBB.
**Splits:** disjoint train, validation and test seeds; whole archetypes held out (for example LM shock and ECPELLA) to test
generalisation. The six `src/cases/*` patients are the final benchmark.

## 5. Phases

Each phase has a deliverable and an exit criterion. Do not start the next until the exit criterion holds.

**Phase 0: audit and profile (about 1 day, free).**
- Audit what the model charges for each device and drug in `src/config/devices.ts`, `drugs.ts` and `src/physics/support.ts`
  (afterload, demand, hemolysis, limb ischemia, RV effects). List what is missing.
- Profile per-call cost of `step`, `state`, `ecg`, `assessment`. Decide the cheapest observation set and the step length.
- Exit: a written table of modelled versus missing harms, and a measured cost per agent step.

**Phase 1: complication layer (about 3 to 5 days).**
- Seeded event scheduler on top of `Simulation.apply()`, with one RNG stream per `(seed, event id)` so complications are
  counterfactually stable across different actions. Hazards depend on decisions (heparin, device size, ischemic time).
- Start with: no-reflow after PCI, stent thrombosis, access or retroperitoneal bleed, device malposition. Later: mechanical
  rupture (MR, VSD, free wall with tamponade), mapped to the existing valve, VSD and pericardium fields.
- `complicationTendency` multiplier (0 = off) in `PatientSpec` and `src/sim/registry.ts`.
- Literature check for each hazard in a table like `docs/ARREST.md`, marking each verified or assumed.
- Exit: tests for determinism, counterfactual stability and each event's physical effect; fast suite green.

**Phase 2: Gym environment and baselines (about 3 to 5 days).**
- `rl/env-server.ts`, the Gymnasium wrapper and a vectorised wrapper; cache settled start states to avoid the 2.6 s reset.
- Conformance test (`gymnasium.utils.env_checker`) and a determinism test (same seed and actions give the same trajectory).
- Baselines: do nothing, PCI plus norepinephrine, Impella before PCI, advisor order, random.
- Exit: all baselines run end to end on the sampler; throughput recorded.

**Phase 3: rollout-search ceiling (about 1 to 2 days, a few core-hours).**
- Per phenotype, enumerate or beam-search short action sequences by simulating from the same seed. This gives the best fixed
  protocol and an upper bound.
- Exit: a per-phenotype table. If no phenotype-dependent winner exists, stop here and report that finding.

**Phase 4: PPO training (about 1 week, rented compute).**
- `MaskablePPO` with a curriculum: STEMI sanity (should learn "PCI at step 1" within about 50k steps; if not, the environment or
  reward is broken), then shock, RV infarct, bleed and tamponade, then complications on.
- Run on one 32-vCPU spot machine with checkpoints. Expect roughly 0.5 to 2 million agent steps, about 5 to 17 hours.
- Exit: a policy that beats the best fixed protocol on validation seeds in at least one phenotype, or a clear negative result.

**Phase 5: evaluation and robustness (about 3 to 5 days).**
- Held-out seeds and archetypes; the six scripted cases. Metrics: death rate, infarct size, time to reperfusion, harm-flag rate,
  device-hours; per-phenotype and with confidence intervals over many seeds.
- Reward-hacking audit: inspect action timelines for exploits of simulator quirks.
- Sensitivity: re-evaluate under perturbed assumed constants (`src/config/*`) and across reward weights. Check agreement with
  trial directions (early unloading helps LV shock, ECMO adds afterload, IABP adds little); disagreements are model findings.
- Exit: a short report with per-phenotype tables and the sensitivity analysis.

**Phase 6 (optional).** Arrest and ROSC as a second environment; expose the policy as a labelled teaching hint in the app or
over MCP.

## 6. Cost summary

| Item | Estimate |
|---|---|
| Phases 0, 2 and 3 compute | essentially free (this container) |
| Phase 4 compute | about $10 to 40 on a 32-vCPU spot instance |
| Engineering | about 3 to 4 weeks one person; most of it is phase 1 (events), reward design and evaluation |
| Cheapest path to an answer | phases 0, 1 (three events), 2 and 3; the search ceiling may answer the question without PPO |

## 7. Risks

- **Sim-to-real gap:** report results as model behaviour only. Keep the "not for clinical decisions" notice on every output.
- **Reward weights decide the policy:** review them with a clinician and report sensitivity.
- **Unverified hazard rates:** every number is tagged verified or assumed; directions matter more than levels for RL.
- **Throughput:** about 1 step per second per core; mitigated by cached starts, coarser steps and more workers.
- **Critical-time slowdown:** profound shock runs at real time and is expensive; budget for it.
- **Reproducibility:** confirm `apply` and `step` are fully deterministic from `reset` before relying on counterfactuals.

## 8. Decisions needed

1. Approve phase 0 and 1 as the first work (audit, then the complication layer).
2. Where the project lives: `rl/` in this repo (recommended) or a separate repo.
3. Who reviews the reward weights and hazard sources clinically.
