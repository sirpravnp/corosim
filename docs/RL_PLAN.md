# RL development plan: managing acute MI with cardiogenic shock in CoroSim

Status: final plan, ready for execution. Nothing is built yet. Written to be executed by several coding models working in
parallel, so every work package (WP) is self-contained: files, interfaces, acceptance checks, dependencies.

**Educational and research use only. Never a clinical decision aid.** A policy learned here describes how **the model** behaves,
not how patients do. The README states the anatomy is schematic and many constants are assumed; every report from this project
must repeat that.

---

## 0. Rules for every executing model

1. **Do not change existing simulator behaviour.** With the new complication layer off (`complicationTendency: 0`, the
   default), all existing tests and fixtures must pass unchanged, byte for byte (`tests/regression.test.ts`, `tests/fixtures`).
2. Before any commit: `npm run typecheck` and `npm run test:fast` pass. Tests that take more than a few seconds go in
   `tests/slow.json` (see `scripts/test-groups.mjs`). RL tests live in `tests/rl/`.
3. **Every new number is tagged** `[assumed]` unless it carries a verified source (a PMID you actually looked up). Never invent a
   citation or a rate. Constants go in `src/config/` (model) or `rl/config/` (RL), never inline.
4. **No model or tool identifiers** in commit messages, code comments or docs.
5. **Do not open a pull request** unless the user asks. Commit small and often; push only to your assigned branch.
6. Observation purity (section 5) is a hard rule: the policy never receives simulator internals. WP1 enforces it with a test.
7. If a work package's assumption turns out false, stop and record the finding in `docs/RL_FINDINGS.md`; do not paper over it.
8. Add RL files under `rl/` (TypeScript) and `rl/python/` (Python). The only edits outside `rl/` and `tests/rl/` allowed are
   those listed in WP2 (complications) and WP8 (cases).

## 1. Goal and the question it answers

Train and evaluate a policy that manages a simulated acute MI with cardiogenic shock: pressors and inotropes, Impella, IABP,
ECMO, fluids, pacing, diagnostics, and the timing of revascularization, while handling complications that branch the course.

**Why not STEMI alone:** for an occluded artery the best action is a fixed rule (order PCI now), so RL adds nothing. The real
decisions are in the shock phenotypes, where drugs and devices trade off against each other and against time.

**The question:** does a learned policy beat the best fixed protocol **per phenotype** on held-out patients, and how sensitive
is that answer to the model's assumed constants and to the reward weights? If one fixed protocol wins everywhere, report that
and stop; it is a valid result.

## 2. What exists in the repo (verified)

| Need | Already there | Where |
|---|---|---|
| Headless seeded simulation | `Simulation`: `reset(spec,{settled,warmup})`, `step(dt,{minutes})`, `apply(patch)`, `revascularize`, `shock`, `giveDrug`, `setCpr`, `state`, `ecg`, `assessment` | `src/sim/simulation.ts` |
| Serialisable patient | `PatientSpec` (anatomy, lesions, bleed, rhythm, electrolytes, tendencies, support, devices, pericardium, valves, VSD, fluids, septum) | `src/sim/patient.ts`, `scenario.ts` |
| Starting presets (RV infarct, tamponade, ...) | presets | `src/sim/presets.ts` |
| Echo findings | `echoModel(sim)`: wall motion by AHA segment, EF, score index; `cathReport` (TIMI, FFR, echo) | `src/sim/cath.ts` |
| Invasive hemodynamics | right heart cath: wedge, saturations, cardiac output, derived values | `src/sim/rightHeartCath.ts`, `leftHeartCath.ts` |
| Exam proxies | JVP height and waveform classes; pulmonary congestion; pericardial effusion; SpO2 and mixed venous saturation | `src/physics/jvp.ts`, `sim.state()`, `sim.pericardium()`, `src/sim/oxygenReadout.ts` |
| Device state | Impella (model, P-level, position), IABP, ECMO flow | `sim.devices()`, `src/config/devices.ts` |
| Harm detection | advisor warnings (nitrate in RV infarct, pressor in pump failure, dobutamine in ischemic muscle) | `src/physics/advice.ts` |
| Cases and scoring | six scripted cases with checkpoints and harms | `src/cases/*`, `harms.ts` |
| Randomness | seeded; arrhythmia and reperfusion hazards, ectopy, arrest outcomes, lysis (55%) | `src/physics/arrhythmia.ts`, `ectopy.ts`, `revasc.ts` |
| Death | rules by no-flow, refractory shock, pulselessness | `docs/ARREST.md` |

**Verified gaps:**

1. **PCI is deterministic and always perfect** (`applyProcedure` returns `lesion: null`). Nothing branches after treatment.
2. **No device or drug harms are modelled** beyond physics (afterload, demand, malposition, suction). Hemolysis, limb ischemia,
   access-site bleeding, stroke and contrast injury do not exist. Without costs the agent will stack every device.
3. No echo bands for RV function, MR severity, VSD or effusion as a clinician would report them (the raw state exists, the
   clinician's view does not).
4. No Python, Gymnasium or RL code; no fast reset path. Measured once on 4 vCPU: reset (settled, with warm-up) about 2.6 s;
   about 0.9 s per agent step of 10 simulated seconds including `state`, `ecg` and `assessment`.
5. Clinical clock: about 2 clinical minutes per simulated second, but **real time while the patient is critical**
   (`docs/ARREST.md`). Episodes must be capped in simulated seconds as well as clinical time.

## 3. Architecture

```
Python: Gymnasium env + MaskablePPO  <-- JSON lines over stdio -->  Node worker rl/env-server.ts  (one Simulation per env)
```

- Model stays in TypeScript so the RL environment cannot drift from the app. The worker is a persistent process (same pattern
  as `src/mcp/main.ts` stdio mode); run with `npx tsx`.
- Protocol (one JSON object per line): `reset {seed, archetype, split} -> {obs, info}`, `step {action} -> {obs, reward, terminated,
  truncated, info}`, `close`. `info` carries privileged fields (true state, events) for evaluation and the critic, never for the
  actor.
- Python: Gymnasium, Stable-Baselines3 and sb3-contrib `MaskablePPO` (recurrent variant or frame stacking over the last 4
  observations). A subprocess vector env with N workers. No custom RL infrastructure.
- Layout:

```
rl/                     TypeScript
  env-server.ts         the stdio worker
  env.ts                RlEnv: reset/step around one Simulation
  observe.ts            the clinician's view (WP1)
  actions.ts            action table, masks, applying an action to the Simulation
  reward.ts             reward terms and weights (config object)
  sampler.ts            archetypes, seeded patient sampler, splits (WP3)
  baselines.ts          scripted policies (WP5)
  search.ts             rollout search (WP5)
  config/rl.ts          every RL constant, tagged [assumed]
rl/python/corosim_gym/  Gymnasium wrapper, vec env, train.py, eval.py
tests/rl/               tests
docs/RL_FINDINGS.md     running log of surprises and negative results
```

## 4. Environment specification

**Episode.** Decision step: 10 simulated seconds (about 20 clinical minutes at 1x). Ends at death, or at the horizon of 24
clinical hours, or at a simulated-seconds cap (default 1,200 s; WP0 sets it from measured cost). Truncation at the cap is
`truncated`, death is `terminated`. Horizon is a per-archetype setting.

**Reset.** Settled start state: `reset(spec, {settled: true, warmup: 5})`. Cache and clone settled states per spec to avoid the
2.6 s rebuild if the simulator supports it (WP0 checks; if not, pre-build a pool of settled patients in the worker at start-up).

**Actions** (one `Discrete` index into a table in `rl/actions.ts`; each maps to `apply`, `revascularize` or a diagnostic):

| Group | Actions |
|---|---|
| Wait | no-op (step the clock) |
| Vasoactive drugs | norepinephrine, epinephrine, dobutamine, milrinone, vasopressin, nitroglycerin, furosemide: each set to off, low (0.3) or high (0.7); atropine on/off |
| Fluids | bolus 250 ml, bolus 500 ml |
| Rhythm | pacing on/off with rate 60, 80, 100 |
| Devices | IABP on/off; Impella on at P-level 2, 5, 8, change level, off; ECMO on at 2.5, 4.0 L/min, off |
| Revascularization | order PCI, order fibrinolysis, order CABG (each at most once) |
| Information | order 12-lead ECG, order echo, place arterial line, place right heart cath |
| Arrest (phase 2, masked in v1) | CPR on/off, shock 200 J, epinephrine 1 mg, amiodarone 300 mg |

**Action masks** (`MaskablePPO`): a one-time procedure once done; PCI or lysis with no lesion; fibrinolysis for a non-occluded
lesion; a device already in, removal of a device not in; arrest actions outside arrest; information actions already satisfied
and still valid.

**Interventions take clinical time.** Procedures keep the existing delays (`PROCEDURE` in `src/config/management.ts`). Line
and catheter placements get an `[assumed]` delay and complication risk in `rl/config/rl.ts` and (with WP2) in the complication
layer.

## 5. Observation: only what a clinician could realistically know

Rule: the policy sees what a bedside team would have, when they would have it, with the noise and delay it comes with. The
sim's internal state is never an input. `rl/observe.ts` maps `Simulation` state to this clinician's view.

| Tier | What the policy gets | How it is limited |
|---|---|---|
| Continuous monitor | Heart rate; rhythm class (sinus, AF, VT, VF, paced, block); PVC rate; SpO2 | Rounded to monitor precision |
| Blood pressure | Cuff pressure every 5 clinical minutes; continuous arterial-line pressure only after an arterial line is placed | Cuff is intermittent and noisier; MAP is derived from the pressure trace, not read from the engine |
| 12-lead ECG | ST elevation or depression by lead group, rhythm, QRS width | Only when ordered, plus a repeat every 60 clinical minutes; a snapshot |
| Bedside exam | Perfusion (warm or cool), JVP (normal, raised), lung crackles (none, some, diffuse), new murmur (none, systolic) | Ordinal levels from `analyzeJvp`, congestion, perfusion; refreshed each step, no exact numbers |
| Echo (ordered) | EF band (severe, moderate, mild, normal), RV function (normal, reduced), effusion (none, small, large), MR (none, mild, severe), VSD (yes, no), regional wall motion by territory | Bands with `[assumed]` misclassification noise; costs time |
| Invasive hemodynamics | Cardiac output and index, wedge, right atrial, PA pressures, mixed venous saturation | Only after a right heart cath is placed |
| Cath lab | Culprit artery and TIMI flow | Only during or after a cath or PCI |
| Device console | Impella level and flow estimate; ECMO flow and RPM; IABP ratio | Only for devices that are in |
| History | Minutes since symptom onset (given at start, with `[assumed]` uncertainty); time since each intervention; drugs and fluids given | Known to the team |

**Never given to the actor:** LV and RV ischemia fractions, infarct size, coronary perfusion pressure, exact stroke volume or EF
on every step, the true lesion (artery, position, stenosis), the seed, ectopy or arrhythmia tendencies, scheduled or pending
complications, `deathCause`, and the advisor's `steps` and `warnings` (a guideline oracle the agent would copy).

**Not modelled in CoroSim, so unavailable:** lactate, troponin, labs, urine output, age, comorbidities. Every report must say
the agent had none of these, since clinicians lean on them heavily.

Rules:
- Information is an action: ordering a test or placing a line takes time and carries a cost or risk.
- Hidden complications must surface through this view (falling pressure, new murmur, effusion on echo) before the agent can
  respond.
- Partial observability: frame stacking over the last 4 observations, or a recurrent policy.
- **Privileged information is allowed only for the learning signal and evaluation.** The reward and an asymmetric critic may
  use true state (infarct fraction, true lesion, `dead`); the actor sees only the clinician's view.

## 6. Reward

All terms and weights in one object in `rl/reward.ts`, loaded from `rl/config/rl.ts`. **Starting weights are `[assumed]`** and
must be reviewed by a clinician; WP7 sweeps them x0.5 and x2.

| Term | When | Starting weight |
|---|---|---|
| Survive to horizon | terminal | +1.0 |
| Death | terminal | -1.0, plus -0.5 x fraction of horizon remaining (earlier death is worse) |
| Final LV infarct fraction (privileged) | terminal | -2.0 x fraction |
| Hypoperfusion | each step with MAP < 65 or cardiac index < 2.2 (true values) | -0.01 |
| New advisor warning raised | on the step it first appears | -0.05 |
| Device in place | each step: IABP -0.002, Impella -0.005, ECMO -0.01 | per left |
| Line or catheter | once: arterial line -0.005, right heart cath -0.02 | per left |
| Intervention thrash | any non-wait action | -0.001 |

Do not use the advisor's `steps` as reward (the agent would copy it). Time to reperfusion needs no separate term: it acts
through the infarct fraction.

## 7. Archetypes and cases

An **archetype** is a phenotype family with its own seeded sampler. A **case** is one sampled patient (a `PatientSpec` plus
seed). Archetype definitions below are teaching-level sketches; **a clinician must review them** (owner: the user). Exact
field names come from `src/sim/patient.ts`, `scenario.ts` and `registry.ts`; start from `src/sim/presets.ts` where a preset
exists.

| # | Archetype | Spec sketch (varied by the sampler) | What the decision hinges on | Branch points |
|---|---|---|---|---|
| A1 | Anterior STEMI, LV shock | LAD proximal or mid occlusion, shock stage B to D, EF falling | Pressor versus inotrope; unload (Impella, IABP) before or after PCI | no-reflow; access bleed; stent thrombosis |
| A2 | Inferior STEMI with RV infarct | RCA proximal occlusion, `septum: true`, RV ischemia | Fluids and avoid nitrates; when to add support | bradyblock; RV failure; bleed |
| A3 | Left main shock | LM occlusion or critical, severe LV failure, MAP < 60 | Early mechanical support; ECMO versus Impella | VT or VF; no-reflow; malposition |
| A4 | Shock with bleeding | Any culprit plus `hemorrhageMlMin` or `bloodLoss` | Volume and blood versus pressors; anticoagulation trade-off | access bleed worsens |
| A5 | Tamponade or free-wall rupture | Culprit plus fast `effusionRateMlMin` | Recognise and drain; do not push pressors | effusion accumulates fast |
| A6 | AMI with heart block | Inferior or anterior lesion, AV block, slow rate | Atropine, then pacing; not for infarcted AV node | escape failure |
| A7 | Late presenter, large infarct | Late start (high `ischemicMinutes`), low EF | Revascularize now or not; support intensity | mechanical rupture; arrhythmia |
| A8 | Demand ischemia, borderline shock | Stenosis, no occlusion, exertion, MAP near 70 | Do not over-treat | harm flags |
| A9 | Biventricular failure | LV and RV ischemia, low output, congestion | Combined support (Impella plus RV support or ECMO) | RV failure after LV unload |
| A10 | Acute MR (papillary) | Culprit plus severe mitral regurgitation (`heart.valves`) | Unload, then surgery path | worsening MR |
| A11 | VT storm after reperfusion | `arrhythmiaTendency` high, electrolytes abnormal | Correct K and Mg; antiarrhythmic and shock | VT or VF; arrest |
| A12 | Arrest after MI | Starts in VF or PEA | Arrest algorithm (phase 2; masked in v1) | ROSC or not |

**Held out of training entirely (generalisation test): A9, A10, A11.** A9 tests composing skills learned separately from A1 and
A2; A10 and A11 test structural and rhythm problems the agent never saw. This is a design choice; the user may change it.

**Training set:** A1 to A8. A12 is deferred. **Stage-1 sanity set:** A1, A2, A4, A5 (four archetypes needing four different
policies).

**Splits (fixed by seed range, never regenerated):**

| Split | Seeds per archetype | Total (11 archetypes in v1: A1 to A11) |
|---|---|---|
| Train | drawn on the fly from seeds 0 to 99,999 | about 14,000 episodes per 1M steps |
| Validation | 50 (seeds 100,000 to 100,049) | 550 |
| Test | 200 (seeds 200,000 to 200,199), expand to 500 only where results are borderline | 2,200 |

Paired design: every policy is evaluated on the same test seeds, so differences are paired and need fewer patients. These
sizes are starting figures; WP7 runs a bootstrap power check on the validation set before locking the test size.

**Hand-authored benchmark cases** (`src/cases`): the six existing (`anteriorStemi`, `inferiorRv`, `lmShock`, `ecpella`,
`afHeartFailure`, `afRvr`) plus six new, one per archetype not already covered (A4, A5, A6, A9, A10, A11). They are used for
regression and demos and as the final sanity check, not for training.

## 8. Work packages

Dependency graph: **WP0** first. **WP1, WP2, WP3 in parallel** after WP0. **WP4** needs WP1 and WP3 (WP2 optional, switchable).
**WP5** needs WP4. **WP6** needs WP5. **WP7** needs WP6. **WP8** is independent of WP4 onward. **WP9** last.

### WP0: profile and confirm assumptions (about 1 day)
- Files: `rl/profile.ts`, `docs/RL_FINDINGS.md`.
- Measure separately: `reset`, `step(10)`, `state()`, `ecg()`, `assessment()`, `echoModel`, a right heart cath snapshot, with
  warm-up and without, on anterior STEMI, RV infarct, LM shock and a critical patient (MAP < 40, real-time clock).
- Find out whether `Simulation` state can be cloned (structuredClone or re-`reset` with a cached spec).
- Measure wall time per episode on each archetype's worst case; set the simulated-seconds cap.
- Check which of the section 5 echo, exam and invasive outputs can be built from existing functions; list new code needed.
- Done when: `docs/RL_FINDINGS.md` holds a table of per-call cost, the chosen step length and cap, the clone answer, and the
  list of derivations WP1 must write.

### WP1: clinician observation layer
- Files: `rl/observe.ts`, `rl/config/rl.ts` (noise, intervals), `tests/rl/observe.test.ts`.
- Implement section 5 exactly. Tiers behind actions (ECG, echo, arterial line, right heart cath) return `unavailable` until
  ordered. Cuff and echo values carry seeded noise.
- Tests: (a) the observation object's keys equal a fixed whitelist (a new field fails the test); (b) two simulations that differ
  only in a hidden variable (lesion position, tendencies) with identical visible vitals give identical observations until a
  clinician-visible signal appears; (c) tiers are `unavailable` before the order action and populated after.
- Done when: tests pass and `npm run test:fast` stays green.

### WP2: complication layer (about 3 to 5 days; the largest WP)
- Files: `src/physics/complications.ts`, `src/config/complications.ts`; edits: `src/sim/simulation.ts` (call the scheduler in
  `step` and `revascularize`), `src/sim/scenario.ts` and `patient.ts`, `src/sim/registry.ts`, `src/mcp/tools.ts` as needed;
  `tests/complications.test.ts`.
- Add `complicationTendency` (0 to 3, default 1 in RL, **0 in the app**) by mirroring `ectopyTendency` end to end (grep it).
  `tests/specRegistry.test.ts` enforces parity of registry, schema and controls; it must pass.
- Scheduler: events with `eligible(ctx)`, `hazardPerHour(ctx)` and `effect` that returns a `PatientSpec` patch for
  `Simulation.apply`. **One RNG stream per `(seed, event id)`** so complications are counterfactually stable across different
  action sequences. Log every draw and event; expose the log in `state()` for evaluation only.
- Events v1: no-reflow after PCI (partial residual stenosis instead of `lesion: null`), stent thrombosis (re-occlusion),
  access or retroperitoneal bleed (raises `hemorrhageMlMin`; hazard up with large-bore device and anticoagulation),
  device malposition. Events v2: mechanical rupture (MR via `heart.valves`, VSD via `heart.vsd`, free wall via
  `pericardium.effusionRateMlMin`), Impella hemolysis and limb ischemia (reward and event only if no physics exists).
- Each hazard depends on decisions (ischemic time, device size, anticoagulation) and carries a source or `[assumed]`. Put the
  evidence table in `docs/COMPLICATIONS.md` in the style of `docs/ARREST.md`. If you can search PubMed, verify rates and record
  PMIDs; otherwise mark all `[assumed]`.
- Done when: with `complicationTendency: 0` all existing tests and fixtures pass unchanged; with it on, tests show
  determinism (same seed and actions give the same events), counterfactual stability (changing an unrelated action does not
  move another event's draw), and each event's physical effect.

### WP3: archetypes and sampler
- Files: `rl/sampler.ts`, `tests/rl/sampler.test.ts`.
- One generator function per archetype A1 to A11 (section 7) returning `{spec, horizon, label}` from a seed; shock stage (SCAI
  B to E) mapped to starting MAP and output through lesion severity, bleed and exertion; document the mapping.
- Splits as in section 7, as pure functions of seed range; a test asserts the splits are disjoint and the held-out archetypes
  never appear in the train sampler.
- Done when: every archetype builds a valid settled `Simulation`, the sampler is deterministic, and the distribution of
  starting MAP and rhythm per archetype is printed in `docs/RL_FINDINGS.md`.

### WP4: environment, actions, reward, server, Gym wrapper
- Files: `rl/env.ts`, `rl/actions.ts`, `rl/reward.ts`, `rl/env-server.ts`, `rl/python/corosim_gym/*`, `tests/rl/env.test.ts`,
  `rl/python/tests/`.
- Implement sections 4 to 6. Python env passes `gymnasium.utils.env_checker`.
- Tests: determinism (same seed and action list give identical observations and rewards); masks are valid in every state of a
  random-policy rollout; privileged `info` never appears in `obs`; a random policy finishes 100 episodes without hanging.
- Done when: a 1,000-episode random-policy run completes and logs steps per second; throughput recorded.

### WP5: baselines and rollout-search ceiling
- Files: `rl/baselines.ts`, `rl/search.ts`, `rl/python/corosim_gym/eval.py`, `rl/results/` (git-ignored except summaries).
- Baselines: do nothing; PCI plus norepinephrine; Impella before PCI; PCI plus Impella; the advisor's `steps` order; random.
- Search: per archetype, from the same seed, enumerate or beam-search short protocols (a sequence of up to 4 chosen actions with
  timings) by simulating each from the start state; report the best fixed protocol per archetype and its outcome. Uses
  privileged state (it is an upper bound, not a deployable policy).
- Done when: a per-archetype table (death rate, infarct, device-hours) with confidence intervals for every baseline and the
  search ceiling, on validation seeds. **Gate:** if no archetype shows a different best protocol per phenotype, stop and write
  that result; do not proceed to WP6.

### WP6: PPO training
- Files: `rl/python/corosim_gym/train.py`, configs in `rl/python/configs/`.
- `MaskablePPO` with frame stacking (or recurrent), asymmetric critic using privileged `info`, curriculum: stage 1 sanity set
  (should learn PCI at step 1 within about 50k steps; if not, the environment or reward is wrong; fix before going on), then
  A1 to A8 with complications on. 8 to 32 workers; checkpoint every 50k steps; log to disk.
- Budget: 0.5 to 2 million steps, about 5 to 17 hours on one 32-vCPU machine; stop early if validation stops improving.
- Done when: a checkpoint beating the best baseline on validation in at least one archetype, or a documented negative result.

### WP7: evaluation and robustness
- Files: `rl/python/corosim_gym/eval.py`, `docs/RL_REPORT.md`.
- Evaluate on held-out test seeds per archetype and on the held-out archetypes A9 to A11; metrics: death rate, final infarct
  fraction, time to reperfusion, harm-flag rate, device-hours, information actions used; paired bootstrap confidence intervals.
- Reward-hacking audit: print action timelines for the top and bottom episodes; flag exploits of simulator quirks.
- Sensitivity: reward weights x0.5 and x2; perturb assumed constants in `src/config/` (drug effect sizes, device afterload,
  complication hazards) in evaluation only; does the policy ranking survive?
- Direction checks against trials (early unloading helps LV shock; ECMO adds afterload; IABP adds little); disagreements are
  model findings, listed as such.
- Done when: `docs/RL_REPORT.md` has per-archetype tables, held-out results, the sensitivity analysis, and the limits
  (including the missing lactate and troponin).

### WP8: benchmark cases
- Files: `src/cases/*` (six new `CaseDef`s, registered in `src/cases/index.ts`), `tests/cases.test.ts` additions.
- One per A4, A5, A6, A9, A10, A11, in the existing style (card, checkpoints, harms); needs clinician review of the text.
- Done when: all cases load, run to completion, and pass the existing case tests.

### WP9: handover docs
- Files: `docs/RL_PLAN.md` kept current, `rl/README.md` (how to run the worker, train, evaluate).
- Done when: a new developer can run a 100-episode evaluation from the README alone.

## 9. Compute and effort

| Item | Estimate |
|---|---|
| WP0 to WP5 compute | this container; effectively free |
| Training (WP6) | 0.5 to 2 million steps; about 5 to 17 hours on 32 vCPU; about $10 to 40 |
| Evaluation (WP5 and WP7) | about 2,200 test episodes x about 70 steps = about 154,000 steps, about 40 core-hours per policy; about 6 policies; about 250 core-hours; about $10 to 20 |
| Total compute | about $25 to 60 |
| Engineering | about 3 to 4 weeks for one person; the complication layer, reward review and evaluation dominate; WP1, WP2, WP3 can run in parallel |

Cost figures are estimates from one timing run (about 0.9 s per agent step per core); WP0 replaces them with measurements.

## 10. Risks

- **Sim-to-real gap.** Results describe model behaviour only. The notice at the top goes in every output.
- **Reward weights decide the policy.** Clinician review and the x0.5 and x2 sweep are mandatory.
- **Unverified hazards.** Every rate is tagged verified or assumed; for RL the direction of each dependency matters more than
  the level. The horizon is 24 clinical hours, so day-scale complications (rupture) use hazards concentrated in the horizon, an
  assumption that must be stated.
- **Throughput.** Mitigated by cached starts, a coarser step and more workers; the critical-time clock makes the sickest
  episodes the most expensive.
- **Determinism.** WP4 must prove same seed and actions give the same trajectory before counterfactual comparisons are trusted.
- **Leakage.** WP1's whitelist test is the guard; any new observation field needs a clinical justification in the PR.
- **Negative result.** If the WP5 gate stops the project, that is a finding, not a failure.

## 11. Decisions already made, and what still needs a human

Made (defaults, change on request): use case is AMI with shock; stack is Gymnasium with `MaskablePPO`; code lives in `rl/` in
this repo; held-out archetypes are A9 to A11; arrest (A12) deferred.

Needs a human before WP6 and WP8 ship:
1. A clinician to review the archetype definitions (section 7), the reward weights (section 6) and the case text (WP8).
2. Approval of the complication hazards, or access to literature search to verify them (WP2).
