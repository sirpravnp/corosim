# From teaching to research to the clinic: an honest path for CoroSim

Written October 2026 against the code at commit `7d7d5e5`. It answers two questions:

1. Could CoroSim ever be a clinical tool?
2. What stands in the way of using it as a research tool now, with clinical use as the long-term goal?

Regulatory statements are a reading of public guidance, not legal advice. Check the current text of every guidance
cited before relying on it; several were revised in 2025 and 2026.

## Short answers

**1. Clinical use: possible in principle, but not CoroSim as it is.** A clinical CoroSim would be a different product
from the one in this repository. It would need image-based patient geometry, constants calibrated to each patient
with stated uncertainty, validation against invasive measurements in a prospective cohort, a quality-managed
development process, and FDA or EU marketing authorization. What exists today could become the *interactive,
whole-physiology front end* of such a product (perfusion, ECG, rhythm, pressure and treatment response in one
model). The coronary physics it would need already exists elsewhere: SimVascular for geometry, svZeroDSolver for
reduced-order flow. For orientation, the one cleared product in this space, HeartFlow FFRCT, got De Novo
authorization as a Class II "coronary vascular physiologic simulation software device" (21 CFR 870.1415). The
pivotal evidence was a 254-patient, 10-site trial against invasive FFR (NXT), on top of years of image-based CFD
work. [1][2] That is roughly the bar for one output (FFR). CoroSim makes a dozen.

**2. Research use: realistic now for education research and as an in-silico teaching and hypothesis tool. Not yet
for any claim about real patients.** The obstacles, roughly in order:

- the model has never been compared with patient data;
- most of its constants are assumptions, some of them outside `src/config/`;
- it has no uncertainty quantification;
- it has no versioned model identity, so a published result cannot be tied to the exact model that produced it;
- it exports no data in a standard format;
- the anatomy is procedural, not measured.

None of these needs a regulator. All of them need work, and the work is listed in the roadmap at the end.

## 1. What the model is today (the concrete gaps)

The gaps below come from the code, not from the README's summary of it.

| Layer | What the code does | Why it matters for research or clinical use |
|---|---|---|
| Anatomy (`src/anatomy/`, `src/config/tree.ts`) | A procedural ellipsoid heart (`HEART.radii` 45/65/32 mm, `[assumed schematic]`) with 9 anatomic variants. Diameters follow Huo–Kassab Q ∝ d^7/3 `[lit]` and Finet's law `[lit]`. Myocardial mass per bed comes from a fixed table (`MASS`, `[assumed]`), and small branches are "taps" spread along each segment (`TAPS`). | No image-based geometry. Territory size is the single largest driver of ischemic burden, ST amplitude and stroke-volume loss, and it is assumed. |
| Coronary flow (`src/physics/network.ts`, `hemodynamics.ts`) | A steady (mean-flow) network. Each bed takes min(demand, (Pd − Pzf)/Rmin). Poiseuille loss along vessels plus a Young–Tsai expansion loss at the lesion (`STENOSIS.Kt` 1.52 `[lit]`, `waveformFactor` `[assumed]`). FFR is hyperemic distal pressure over aortic pressure. No collaterals (`collateralConductanceFrac` 0). | This is a lumped, 0D-style model, the same class as svZeroDSolver but without its compliance, inertance or intramyocardial pressure. With no phasic flow, the systolic impediment that matters most in the LV subendocardium is missing. FFR depends on `Pzf`, `restingFlow` and `maxCoronaryFlowReserve`, all `[assumed]`. |
| Ischemia and infarct (`ischemia.ts`, `infarct.ts`, `config/ecg.ts`, `config/management.ts`) | Severity rises linearly to its target over 20 s and recovers with τ 8 s. Necrosis follows dN/dt = (1 − N)·severity²/τ with τ 150 clinical min (`[assumed]`). | Time constants are plausible but not fitted. The infarct clock is a single exponential with no wavefront, no collaterals and no reperfusion injury. |
| ECG (`ecg.ts`, `ecgLink.ts`, `config/ecg.ts`) | A single-dipole heart. Each wave (P, Q, R, S, T) is a Gaussian with a fixed 3D vector, projected on idealized lead axes. Each ischemic bed adds an injury vector along its epicardial normal, with a gain calibrated so that a proximal LAD occlusion gives 3–4 mm ST elevation in V2 (`ECG_LINK.gainMv`, `[assumed]`). The subendocardial pattern is one fixed vector toward aVR. BBB patterns are fixed vectors. | Morphology is schematic. There is no torso, no lead field, no QRS change with infarction (no Q waves) and no individual variation in axis or voltage. The output is good for "which leads, which direction". It is not good for amplitude, timing or a classifier test set without saying so. |
| Rhythm (`rhythm.ts`) | Rule-based: thresholds on nodal-artery ischemia give first-degree block, Wenckebach, then complete block. Bezold–Jarisch and sympathetic effects are gains on burden. | Thresholds are teaching assumptions (`CONDUCTION`, which is in `physics/`, not `config/`). There are no arrhythmias beyond PVCs, AF as a preset, and AV block. |
| Circulation and beats (`circulation.ts`, `beatHemo.ts`) | MAP = CO × SVR. SV falls with LV and RV ischemic fraction (`CIRC.lvContractileLoss` 0.8, `rvPreloadLoss` 0.45). Each beat gets Frank–Starling filling and a two-element Windkessel. | No pressure–volume loop, valves or separate right heart, so it cannot yet be compared with invasive LV pressure, PCWP or a PA catheter. |
| Autonomic loop (`autonomic.ts`) | A baroreceptor sigmoid drives a fast vagal arm and a slow sympathetic arm. Ornstein–Uhlenbeck noise on sympathetic, vagal and resistance tone, white noise on contractility, and sinus jitter. Tuned to SDNN ≈ 50 ms and a Mayer peak at 0.13 Hz (people: ~0.1 Hz). All seeded. | The stochasticity is a strength for research (it gives distributions, not single numbers), but the noise amplitudes are tuned by eye, not fitted to HRV or BRS data. |
| Support and revascularization (`support.ts`, `revasc.ts`, `config/management.ts`) | Single-number effects per drug and device. Lysis succeeds in 55% (`[assumed]`, from trial TIMI-3 rates). | No dose–response, pharmacokinetics or complications. Fine for direction of effect. Not usable for dosing questions. |
| Advice (`advice.ts`) | Rule-based guideline next steps (ACC/AHA STEMI and shock teaching points). | Harmless on a synthetic patient. On a real patient it would be clinical decision support (section 4). |
| Simulation core (`src/sim/`) | DOM-free, seeded, reproducible. Used by the app, the MCP server and 280+ tests. `metrics.ts` computes HRV (SDNN, RMSSD, LF/HF) and sequence-method BRS. | A real strength: the same object can be run headless in batch, which is what research needs. |

Two cross-cutting facts:

- **The constant registry is incomplete.** `src/config/` tags constants as `[lit]` or `[assumed]`: 7 tagged
  `[lit]` against about 24 `[assumed]`. But large blocks of constants live in `physics/` (`AUTONOMIC`, `CIRC`,
  `CONDUCTION`, `SUPPORT` re-exports), mostly untagged and with no source, range or distribution. A sensitivity
  analysis or calibration needs one registry.
- **Validation status is zero, and the repo says so.** The README states the model "has not been compared with
  patient data". That honesty is right, and it should stay until a validation report replaces it.

## 2. Could it ever be a clinical tool?

### What "clinical tool" would mean

Three plausible clinical uses, in rising order of difficulty:

| Use | Example | What it needs |
|---|---|---|
| A. Physiology explanation beside the chart | "Show the team why this inferior STEMI is bradycardic and hypotensive" | Patient inputs but no prediction claim. Still likely a device if it takes ECG signals or images (below). |
| B. Functional assessment | Simulated FFR or ischemic territory from a CT, like FFRCT | Image-based geometry, validated FFR, Class II in the US |
| C. Treatment planning or prediction | "PCI vs CABG", "will this patient tolerate nitrates", infarct size if reperfused now | A calibrated patient-specific twin, prospective outcome validation, probably the highest class |

Use C is where "digital twin" work points: a mechanistic model personalized to a patient's data and updated over
time. [3] It is a research frontier for the whole field, not a CoroSim milestone.

### Where it would sit in regulation

**United States.** Software intended to diagnose, treat, mitigate or prevent disease meets the device definition
regardless of platform. Intended use decides, not code. [4] Section 520(o)(1)(E) of the FD&C Act (added by the 21st
Century Cures Act) excludes some clinical decision support (CDS) software, but only if it meets **all four**
criteria. [5] FDA revised its CDS guidance in January 2026. [5] CoroSim would fail them for any patient-specific use:

1. *Does not acquire, process or analyze a medical image or a signal or pattern from a signal acquisition system.*
   An image-based CoroSim processes CT. A CoroSim that reads a patient's 12-lead ECG processes a signal pattern.
   Either fails criterion 1 outright. [5][6]
2. *Displays or analyzes medical information.* Could pass with discrete inputs only (vitals, a reported stenosis
   grade).
3. *Supports or makes a recommendation to a health care professional.* The 2026 revision relaxed this to allow a
   single recommendation in some cases. [7]
4. *Lets the professional independently review the basis for the recommendation.* A simulated FFR or infarct
   prediction from a nonlinear coupled model is hard to review independently. That is the point of a model. A
   clinician cannot check by hand that the network solved correctly.

So any patient-specific CoroSim is device software: in IMDRF terms, *Software as a Medical Device* (SaMD). Its
category depends on how much the output drives decisions and how serious the condition is. Acute coronary syndromes
are "critical" situations, which pushes toward the higher categories. [8] FDA has a direct precedent: the FFRCT De
Novo created a Class II product code with special controls for coronary physiologic simulation software. [1]

**Education use is a different intended use.** Software that only teaches, with no specific patient, falls on the
"not a device" side of FDA's examples, by the same reasoning that excludes reference texts and training material.
[9] That is why CoroSim's current intended use is safe, and why the README's "for education only" line is not
boilerplate. It *is* the regulatory status. Two features need care to keep it that way:

- `advice.ts` and `corosim_explain` give guideline-ordered next steps. On a synthetic patient that is a teaching
  answer key. If a user enters a real patient's numbers, the same output is CDS for that patient.
- The `build_patient` MCP prompt turns a free-text case into a scenario. Nothing stops someone pasting a real
  patient's history. The tool would then be used for a real patient, outside its intended use. The data question
  is in section 5.

**European Union.** Under MDR Rule 11, software that provides information used for diagnostic or therapeutic
decisions is at least Class IIa. It is IIb if a wrong decision could cause serious deterioration or surgery, and
Class III if it could cause death or irreversible deterioration. MDCG 2019-11 (Rev.1, June 2025) explains how to
apply this. [10] A coronary physiology tool whose error could send a patient to (or away from) revascularization
would likely be IIb, and Class III for C-type uses. That means a notified body, a quality management system and
clinical evaluation.

**Process standards any clinical version would need:**

- **IEC 62304** (software life cycle). Safety classes A/B/C by worst-case harm. A coronary decision tool would be
  Class C unless external risk controls lower it, and that drives documentation, unit-level verification and change
  control. A revised edition is in draft. [11]
- **ISO 14971:2019** (risk management): hazard analysis, risk controls and residual-risk evaluation across the life
  cycle. [12]
- **ISO 13485** (quality management system), required for EU CE marking and aligned with FDA's QMSR.
- **The FDA guidance on assessing credibility of computational modeling and simulation** (final November 2023). It
  builds on **ASME V&V 40-2018** and covers mechanistic models. Data-driven ML models are explicitly out of its
  scope. [13][14] It is the most useful single document for CoroSim even before any clinical ambition (section 3).

### What would make clinical use realistic

The most plausible route is not "certify CoroSim". It is to split the system:

- an **image-to-model pipeline** (segmentation → centerlines → labeled tree → territories), as proposed in
  [OPEN_SOURCE_LANDSCAPE.md](OPEN_SOURCE_LANDSCAPE.md);
- a **validated reduced-order solver**: svZeroDSolver, already shown to run in the browser in
  [spikes/zerod-wasm.md](spikes/zerod-wasm.md), matching `pysvzerod` to ~1e-11 at ~11 ms per beat [15];
- **CoroSim's whole-physiology layer** (ECG, rhythm, autonomic loop, treatment) as an explanatory display. Its
  outputs would be clearly separated from the validated quantity, and kept out of the claim.

Even then, the first claim would be narrow: "simulated FFR agrees with invasive FFR within X in population Y". The
twelve other outputs would carry no claim at all until each had its own evidence. Expect a multi-year, funded
programme with clinical partners, not a solo project.

## 3. The scientific gaps and the validation pathway

The FDA credibility guidance and ASME V&V 40 give the frame: define the **question of interest** and **context of
use**, assess **model risk** (how much the output influences the decision, and what a wrong decision costs), then
gather verification and validation evidence in proportion to that risk. [13][14] For CoroSim, start with
research-grade contexts of use. For example: "the model reproduces the lead distribution of ST shift for an
occlusion of a given artery in a population". Don't start with clinical ones.

### Step 1. Verification (does the code solve the model correctly?)

Most of this is cheap, and some of it exists already.

- **Code verification.** Compare against analytic answers: Poiseuille loss in a uniform tube, Young–Tsai loss for
  a known area ratio, mass conservation at every junction, Finet and Huo–Kassab scaling of generated trees. Several
  tests in `tests/physics.test.ts` and `tests/tree.test.ts` already do part of this. Collect them into a labeled
  verification suite.
- **Solution verification.** Halve `Simulation.DT` (0.02 s) and the bisection tolerance and show the outputs
  converge. Show the ensemble statistics (HRV, BRS, MAP SD) are stable across seeds and run lengths.
- **Code-to-code comparison with svZeroDSolver.** Export a CoroSim tree as an svZeroD JSON (vessels as R, junctions,
  beds as coronary BCs), run both at steady state, and compare pressures, flows and FFR. The WASM spike already
  provides the harness. This is the cleanest bridge to SimVascular. It checks CoroSim's network against an
  independently written and published solver [16], and it sets up a later switch to svZeroD's
  compliance/inertance/intramyocardial-pressure blocks for phasic flow.

### Step 2. Sensitivity analysis (which assumptions matter?)

Before calibrating anything, rank the ~60 constants by influence. Global variance-based (Sobol) indices over
plausible ranges, computed headless on `Simulation`. Outputs: FFR, ST in the culprit leads, MAP, HR, infarct size at
90 min, SDNN. This tells you which assumed constants need data and which can stay assumed. It needs the single
constant registry first.

### Step 3. Validation against data, sub-model by sub-model

There is no public dataset that tests the whole coupled model. Validate each sub-model against the best public data
for it, then test a few emergent behaviors.

| Sub-model | Dataset | What to compare | Access |
|---|---|---|---|
| Ischemic ECG time course and lead pattern | **STAFF III** (PhysioNet): 104 patients, 152 prolonged balloon occlusions of LAD/RCA/LCx (mean ~4.4 min) with continuous 12-lead ECG before, during and after [17] | ST shift per lead vs time for a known occluded artery. Directly tests `ISCHEMIA.riseSeconds` (20 s), recovery τ, `TERRITORY`/`bedSites` directions and `ECG_LINK.gainMv`. The single best validation set for this model. | Open |
| ECG patterns at population scale | **PTB-XL**: 21,799 12-lead, 10 s ECGs from 18,869 patients, 71 SCP-ECG statements including MI by location [18] | Distribution of ST and T findings per MI location vs CoroSim's per-artery output across the 9 anatomic variants. Also a realism check on the synthetic ECG (amplitudes, intervals). | Open |
| ECG with clinical context | **MIMIC-IV-ECG**: ~800,000 diagnostic ECGs from ~160,000 patients, linkable to MIMIC-IV records [19] | STEMI ECGs linked to troponin, catheterization or PCI codes, heart block, and shock vitals: tests rhythm rules (inferior MI → bradycardia/AV block) and the circulation's shock response | Credentialed (CITI training + DUA) [20] |
| Arterial pressure and autonomic variability | **VitalDB**: 6,388 surgical cases with arterial waveforms and drug infusions [21]; **MIMIC-IV Waveform DB** [20]; **EuroBaVar** for BRS methods [22] | SBP/MAP variability, HRV spectra, BRS, pressor responses (phenylephrine, norepinephrine) vs `autonomic.ts` and `support.ts` | Open / credentialed / published |
| Stenosis physiology and FFR | No good open CTA + invasive FFR set exists. ICADD (70 patients with CCTA, angiography and FFR) is the closest candidate; check its access terms [23]. Otherwise: published FFR-vs-stenosis data from trials, bench phantom data, and 3D SimVascular runs on ASOCA/ImageCAS geometries with virtual stenoses. | ΔP–Q curves and FFR vs diameter stenosis, lesion length and territory size | Mixed; this is the gap |
| Infarct kinetics | Published experimental wavefront data and clinical infarct-size vs reperfusion-time curves (CMR cohorts) | Shape and scale of `stepNecrosis` and `INFARCT.tauMinutes` | Literature |
| Hemorrhage response | ATLS classes (qualitative), published animal and volunteer lower-body-negative-pressure studies | HR, pulse pressure, MAP vs volume deficit | Literature |

Validation in V&V 40 terms means stating, before looking, what agreement is good enough for the context of use, and
reporting comparator uncertainty (inter-observer ST measurement, FFR repeatability) next to model error. [14]

### Step 4. Calibration and uncertainty quantification

- **Population calibration** first: fit the assumed constants so the model's *distributions* match the dataset's
  distributions (for example ST in V2 for LAD occlusions in STAFF III, SDNN in healthy resting adults). The
  stochastic autonomic loop helps here. It already produces distributions, so compare against distributions, not
  means.
- **Bayesian calibration** gives posteriors, not point values, and those propagate to predictive intervals. The
  coronary field has a worked template: personalized Bayesian estimation with multi-fidelity UQ on SimVascular
  models. [24]
- **Separate the two kinds of randomness.** The OU noise and seeds are *aleatory* (beat-to-beat physiology).
  Unknown constants are *epistemic*. A research-grade output reports both: "ST in V2 = 3.1 mm (95% interval across
  physiology 2.6–3.6; across parameter uncertainty 1.8–4.5)". Today CoroSim reports one number per seed.
- **Held-out validation**: calibrate on one dataset or split, validate on another. Never report fit-to-training
  as validation.

### Where SimVascular, svZeroDSolver and digital twins fit

- **SimVascular** (3D CFD on image-based geometry) is the reference for coronary flow. CoroSim should use it as the
  *comparator* for its stenosis and network physics, not compete with it. This matches the positioning already in
  the README.
- **svZeroDSolver** is the natural replacement for `network.ts` when phasic coronary flow matters. Its blocks
  (`OpenLoopCoronaryBC` with intramyocardial pressure, compliant vessels) are what CoroSim lacks, it is BSD-3, it
  has a published description [16], and it already runs in the browser fast enough. [15] Adopting it also moves
  part of the credibility burden onto a solver with its own verification history.
- **Digital twins** combine mechanistic models with patient data. [3] CoroSim's open architecture (DOM-free core,
  seeded, headless) is the right shape to become the *physiology-integration and visualization layer* of a twin.
  But the twin's credibility would rest on the image pipeline and the calibrated solver, not on CoroSim's current
  constants.

## 4. Research uses: realistic now vs later

### Realistic now (no patient data, no device questions)

1. **Education research.** Randomized or crossover trials of learning outcomes: CoroSim vs static ECG atlas or
   lecture for ECG localization, STEMI recognition, or shock-management reasoning. Measure delayed retention and
   transfer, not only immediate scores. The evidence base for simulation is strong overall [25][26], so a new study
   must be specific. For example: "does seeing the beds that cause the ST change improve localization of
   circumflex and posterior MI, the classic misses?" Classroom studies of normal educational practice are usually
   **exempt under 45 CFR 46.104(d)(1)**, but the institution's IRB decides, not the investigator. [27]
2. **Simulation-based assessment.** "Find the culprit" already produces structured, timed, scored decisions (location,
   RV involvement, treatment phase with harm and muscle-saved scores). That is an assessment instrument. Research
   questions: reliability (generalizability theory across cases), validity evidence (do residents outscore students;
   do scores correlate with ECG-reading exams), and item difficulty by artery and variant. It needs a research
   export of anonymous game logs with consent, and versioned case definitions.
3. **In-silico hypothesis generation and teaching experiments.** For example: how far do anatomic variants (left
   dominance, wrap-around LAD) move the ST pattern of the same named artery? Which lesions give "electrically silent"
   ischemia (the game's solvability check already finds them)? How does baroreflex gain change the hemodynamic
   signature of RV infarction? These are honest uses *if* framed as properties of the model, which generate
   hypotheses to test in data, not findings about patients.
4. **A labelled synthetic ECG and hemodynamics dataset.** CoroSim can generate unlimited, perfectly labelled 15-lead
   ECGs with beat-matched pressure, across variants, lesion sites, BBB, AF and autonomic states. Use cases:
   stress-testing ECG algorithms for robustness to known physiology, data augmentation research, or a teaching
   benchmark. The precedent is ECGSYN, built to test signal-processing methods. [28] The caveat must travel with the
   data: the morphology is a Gaussian-wave dipole, so a classifier trained on it will learn CoroSim, not patients. A
   synthetic-vs-real comparison against PTB-XL should be part of the release, and the dataset card should say what
   it is not for.

### Later (needs the validation pathway, and eventually a regulator)

5. **Population in-silico studies with quantitative claims** (for example, how sensitive FFR is to territory mass
   across anatomies). This needs at least steps 1–4 of section 3 for the sub-models involved.
6. **Patient-specific twins for research** on retrospective, de-identified data under an IRB: CT → tree → simulated
   FFR and ECG, compared with measured values. Research use under an IRB is not marketing, but if outputs reach
   clinical care during the study, an investigational device exemption (IDE) question arises.
7. **Decision support** (A, B or C in section 2). A device, with everything that implies.

## 5. Data and privacy

- **Today the system holds no health data by design.** The privacy notice lists name, email, provider ID, the
  *synthetic* patient, connected apps, call counts and hashed tokens (`docs/LLM_AND_MCP.md`). Keep it that way for
  the public service.
- **HIPAA** applies to covered entities and their business associates, not to CoroSim as such. But a research
  partnership with a hospital would bring PHI under a data use agreement or business associate agreement. Use
  de-identified data (Safe Harbor's 18 identifiers removed, or expert determination) wherever possible. [29] Never
  route identifiable data through the public `mcp.corosim.com` server or the static site. The same rule is already in
  OPEN_SOURCE_LANDSCAPE.md for CT.
- **Credentialed datasets** (MIMIC-IV, MIMIC-IV-ECG, MIMIC-IV Waveform) require CITI training and a signed DUA per
  researcher. The DUA forbids sharing the data and restricts sending it to third-party services. [20] In practice:
  validation code runs locally or in an approved cloud environment, and **no credentialed data goes through an LLM
  connector**. Results are released as aggregates.
- **Game and education-research data.** Scores are kept in the browser today. A study would need an opt-in
  research mode with consent text approved by an IRB, a pseudonymous ID, a stated retention period, and a way to
  withdraw. Learners are often the investigator's own students, so watch for coercion. The exemption limits in
  [27] apply.
- **Free text is the leak.** The likeliest PHI path is a clinician pasting a real case into Claude or ChatGPT with
  the `build_patient` prompt. The CoroSim server stores only the structured scenario, but the text has already gone
  to the AI provider. Keep the warning in the connector description and the prompts: synthetic cases only, no
  identifiers.

## 6. The LLM and MCP layer's own risks

The MCP server is a teaching strength and a research and clinical liability. Each risk below has a concrete
mitigation, some already in place.

| Risk | Example | Mitigation |
|---|---|---|
| Misreporting the model | The assistant says "FFR 0.72" when `get_state` returned 0.82, or invents a mechanism | Already partly handled: `corosim_explain` gives the model's own causal account "to quote rather than improvise". For research, log every tool call and response and score transcripts against the tool output. |
| Laundering a teaching model into clinical advice | "My patient has an inferior STEMI and BP 80/50, what should I give?" The assistant builds a scenario and answers with authority. | Keep the intended-use statement in the model card, tool descriptions and every `set_scenario` response. Have prompts decline real-patient framing. Do not add features that ingest real ECGs or notes through MCP. |
| Translation errors from free text | `build_patient` maps "tight LAD lesion" to 0.7 when the case meant 0.9, silently | `set_scenario` already returns **warnings** for clamped or dropped fields. For research, record the scenario JSON next to the source text and measure translation agreement. |
| Unvalidated outputs look validated | A chat answer quoting precise numbers from an uncalibrated model | Return uncertainty or "teaching estimate" labels with numeric outputs once UQ exists. Until then, keep the model card's limits one call away (`corosim://model-card`). |
| Non-determinism | The same prompt gives different analyses on different days or models | The simulation is seeded and deterministic. The LLM is not. Any LLM-mediated research outcome must record the model ID, the prompt and the full transcript, and report variance across runs. |
| Regulatory | An LLM front end on a patient-facing or clinician-facing physiology tool is a generative-AI-enabled device question. FDA's Digital Health Advisory Committee first met on it in November 2024, and FDA had not then authorized any GenAI-enabled device. [30] | For any clinical path, keep the LLM outside the regulated function, or expect the hardest review. A change-control plan (PCCP) is the FDA mechanism for planned model updates in AI-enabled devices. [31] |

For education research, the LLM layer is itself a research object. Does AI-led "rounds" on a simulated patient
teach as well as a human facilitator? Do learners over-trust it? Both can be studied with the existing prompts
(`rounds`, `manage`) and full logging.

## 7. Staged roadmap

Effort is in focused person-weeks for one developer comfortable with this codebase, plus a clinical or scientific
collaborator where noted. Stages 0–2 can start now. Stage 3 needs collaborators. Stages 4–5 need institutional
support and funding.

### Stage 0. Research hygiene (2–3 weeks)

Make every result traceable to an exact model.

| Milestone | Code touched | Effort |
|---|---|---|
| **One parameter registry**: move every constant (including `AUTONOMIC`, `CIRC`, `CONDUCTION`, `SUPPORT`) into `src/config/` with value, units, `[lit]`/`[assumed]`, source, and a plausible range or prior. Add a test that fails on an untagged constant. | `src/config/*`, `src/physics/autonomic.ts`, `circulation.ts`, `rhythm.ts`, `support.ts`; new test | 1–1.5 wk |
| **Model version and run manifest**: a `MODEL_VERSION` (semver, bumped when physics changes), and a manifest (version, git SHA, scenario, seed, parameter overrides) returned with every headless run and MCP response | `src/sim/simulation.ts`, `src/sim/scenario.ts`, `src/mcp/tools.ts`, `src/mcp/content.ts` | 3–4 d |
| **Headless batch runner**: a Node CLI that runs a scenario grid over seeds and parameter sets and writes CSV/Parquet | new `scripts/` or `src/research/` (DOM-free, uses `src/sim/`) | 3–4 d |
| **Standard export**: ECG in WFDB format (PhysioNet's), beat tables as CSV, so existing tools (WFDB, NeuroKit2) can read CoroSim output | `src/physics/ecg.ts` (sampling), new exporter, `src/sim/metrics.ts` | 3–4 d |

### Stage 1. Verification and sensitivity (3–5 weeks)

| Milestone | Code touched | Effort |
|---|---|---|
| **Verification suite**: analytic cases, convergence in `DT` and solver tolerances, seed-ensemble stability. Labelled as verification in `tests/`, plus a generated report. | `tests/physics.test.ts`, `tests/tree.test.ts`, `tests/simulation.test.ts`, new `tests/verification/` | 1–1.5 wk |
| **svZeroDSolver comparison**: export a CoroSim tree to svZeroD JSON, compare steady pressures, flows and FFR across the 9 variants and a lesion grid | new exporter beside `src/physics/network.ts`; reuse `spikes/zerod-wasm/` | 1–1.5 wk |
| **Global sensitivity analysis** (Sobol/Morris) over the registry for 6–8 key outputs; publish the ranking | `src/research/`, registry from Stage 0 | 1–2 wk |

### Stage 2. Education research and a synthetic dataset (6–12 weeks; can run beside Stage 1)

| Milestone | Code touched | Effort |
|---|---|---|
| **Research mode for the game**: opt-in consent screen, pseudonymous ID, versioned case definitions, structured event log (calls, timings, treatments, harms) exported for analysis. Off by default. Kept out of the public score flow. | `src/game.ts`, `src/app.ts`, `src/mcp/db.ts` (if server-side storage is chosen), `public/privacy.html` | 2–3 wk |
| **Study protocol** with an education collaborator: an RCT or crossover of ECG localization or STEMI management, IRB submission (likely exempt 1), pre-registration | docs only | 2–4 wk of collaborator time |
| **Synthetic ECG and hemodynamics dataset v0**: grid over variants × arteries × positions × stenosis × BBB/AF × seeds, WFDB plus labels, dataset card with limits, and a PTB-XL realism comparison | Stage 0 runner and exporter; `src/physics/ecg.ts` unchanged | 2–3 wk |
| **LLM-tutor logging**: per-session transcripts of tool calls and responses (opt-in), to study accuracy and learning with AI-led rounds | `src/mcp/server.ts`, `src/mcp/db.ts` | 1 wk |

### Stage 3. Sub-model validation against public data (3–6 months; needs a cardiology/physiology collaborator)

| Milestone | Code touched | Effort |
|---|---|---|
| **STAFF III validation** of ischemic ST time course and lead pattern; calibrate `ISCHEMIA.riseSeconds`, `recoveryTau`, `ECG_LINK.gainMv` and the `TERRITORY` and bed directions on a training split, report on a held-out split | `src/config/ecg.ts`, `src/config/tree.ts`, `src/physics/ecgLink.ts`; new `validation/` (Python or Node, outside the app) | 4–6 wk |
| **PTB-XL population comparison** of ST/T findings by MI location; realism metrics for morphology | `validation/` | 2–3 wk |
| **Autonomic and pressure validation** against VitalDB and EuroBaVar: HRV spectra, BRS, pressor responses; calibrate `AUTONOMIC` noise and gains with a Bayesian fit | `src/physics/autonomic.ts` (via the registry), `src/physics/support.ts`; `validation/` | 4–6 wk |
| **MIMIC-IV-ECG / MIMIC-IV** checks of rhythm rules and shock physiology (credentialed; local only) | `src/physics/rhythm.ts`, `circulation.ts` via the registry | 4–8 wk incl. access |
| **UQ in outputs**: report physiological (seed) and parameter (posterior) intervals in `get_state` and run metrics | `src/sim/metrics.ts`, `src/sim/simulation.ts`, `src/mcp/tools.ts` | 2 wk |
| **Validation report** in V&V 40 structure: context of use, model risk, credibility factors, results, limits. Replaces the README's "not compared with patient data" with what *has* been compared. | docs | 1–2 wk |

### Stage 4. Image-based geometry and phasic flow (6–12 months; research-grade)

| Milestone | Code touched | Effort |
|---|---|---|
| Patient-tree JSON schema and loader (Phase 0–3 of OPEN_SOURCE_LANDSCAPE.md): CT → TotalSegmentator/nnU-Net → VMTK centerlines → labelled tree → territories from the LV mask | `src/anatomy/tree.ts` (loader beside the procedural builder), `src/physics/ecgLink.ts` (bed normals from real geometry); offline Python pipeline | 3–5 months |
| svZeroDSolver as an optional coronary backend (WASM, per-beat controller from the spike) for phasic flow and intramyocardial pressure | `src/physics/network.ts` behind an interface, `src/sim/simulation.ts` | 1–2 months |
| FFR validation against SimVascular 3D on public CTA geometries, and against invasive FFR if a cohort can be obtained (ICADD or a partner hospital under IRB/DUA) | `validation/` | 2–4 months + data access |
| Optional: a torso/heart lead field from the segmented geometry instead of fixed lead axes | `src/physics/ecg.ts`, `src/config/ecg.ts` | 2–3 months |

### Stage 5. Toward a clinical product (multi-year; institutional)

Only after Stage 4 shows agreement that matters for a defined question.

- Define one intended use and claim (for example, a simulated FFR or ischemic-territory display alongside CTA).
- Stand up an ISO 13485 QMS and IEC 62304 process (likely Class C). Run ISO 14971 risk management. Do a
  cybersecurity and SBOM review of the dependency tree, including the MCP server if any of it ships.
- Split the code base: a locked, versioned clinical core (image pipeline + validated solver), and the teaching
  layer (current app, game, MCP), which stays outside the claim.
- Pre-submission (Q-Sub) meeting with FDA. Credibility plan per the 2023 guidance and V&V 40. Prospective
  multi-centre validation against invasive measurements. De Novo or 510(k) against the FFRCT product code, or a
  notified body under MDR Rule 11.
- Plan the LLM out of the regulated function, or budget for a GenAI-device review and a PCCP.

### What to do first

Stage 0 and the STAFF III validation give the most credibility per hour. STAFF III tests exactly what CoroSim is
best at (which leads change, how fast, for which artery), and it is open. Stage 2's education study is the fastest
route to a publishable result, because it needs no claim about patients, only about learners.

## Sources

1. FDA De Novo DEN130045, HeartFlow FFRCT, granted 26 Nov 2014, Class II, 21 CFR 870.1415 — [RegDataLab record](https://www.regdatalab.com/510k/DEN130045); [HeartFlow release](https://ir.heartflow.com/news-releases/news-release-details/heartflow-secures-de-novo-clearance-us-food-and-drug); [MassDevice](https://www.massdevice.com/heartflow-wins-fda-ok-non-invasive-ffr-system/)
2. Nørgaard BL et al. Diagnostic performance of noninvasive FFR derived from coronary CT angiography (NXT trial). *JACC* 2014;63(12):1145–55 — [PubMed 24486266](https://pubmed.ncbi.nlm.nih.gov/24486266/)
3. Corral-Acero J et al. The 'Digital Twin' to enable the vision of precision cardiology. *Eur Heart J* 2020;41(48):4556–64, doi:10.1093/eurheartj/ehaa159 — [ORA](https://ora.ox.ac.uk/objects/uuid:dfc3c392-19f9-4428-a685-2956cfb9e78e)
4. FDA, Policy for Device Software Functions and Mobile Medical Applications; examples of regulated functions — [FDA](https://www.fda.gov/medical-devices/device-software-functions-including-mobile-medical-applications/examples-device-software-functions-fda-regulates)
5. FDA, Clinical Decision Support Software, final guidance (January 2026; supersedes September 2022), docket FDA-2017-D-6569 — [FDA guidance page](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/clinical-decision-support-software); 2022 text: [HHS mirror](https://www.hhs.gov/guidance/sites/default/files/hhs-guidance-documents/FDA/Guidance-Clinical-Decision-Software.pdf)
6. Criterion 1 (images, signals, patterns) explained — [Innolitics, 2026 CDS guidance](https://innolitics.com/articles/fda-guidance-clinical-decision-support-software-2026/)
7. 2026 CDS revision, single recommendation and transparency changes — [Faegre Drinker](https://faegredrinker.com/en/insights/publications/2026/1/key-updates-in-fdas-2026-general-wellness-and-clinical-decision-support-software-guidance); [Snell & Wilmer](https://www.swlaw.com/publication/fda-issues-key-updates-to-cds-software-guidance/)
8. IMDRF SaMD WG/N12, Software as a Medical Device: Possible Framework for Risk Categorization (2014) — [IMDRF](https://imdrf.org/sites/default/files/docs/imdrf/final/technical/imdrf-tech-140918-samd-framework-risk-categorization-141013.pdf)
9. FDA, Examples of software functions that are not medical devices — [FDA](https://www.fda.gov/medical-devices/device-software-functions-including-mobile-medical-applications/examples-mobile-apps-are-not-medical-devices)
10. MDCG 2019-11 Rev.1 (June 2025), qualification and classification of software under MDR/IVDR — [OpenRegulatory summary](https://openregulatory.com/mdcg/mdcg-2019-11); [GMP Insiders on Rev.1](https://gmpinsiders.com/mdcg-2019-11-rev1-mdr-ivdr/)
11. IEC 62304 safety classes and FDA recognition — [Johner Institute](https://blog.johner-institute.com/iec-62304-medical-software/safety-class-iec-62304/); [IntuitionLabs overview](https://intuitionlabs.ai/articles/iec-62304-medical-device-software-guide)
12. ISO 14971:2019, application of risk management to medical devices — [ISO](https://www.iso.org/standard/72704.html)
13. FDA, Assessing the Credibility of Computational Modeling and Simulation in Medical Device Submissions, final guidance, November 2023 — [FDA guidance page](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/assessing-credibility-computational-modeling-and-simulation-medical-device-submissions); [Exponent summary](https://www.exponent.com/article/fda-issues-final-guidance-silico-device-model-credibility)
14. ASME V&V 40-2018, Assessing Credibility of Computational Modeling through Verification and Validation: Application to Medical Devices — [ASME](https://www.asme.org/codes-standards/find-codes-standards/assessing-credibility-of-computational-modeling-through-verification-and-validation-application-to-medical-devices); [FDA OSEL credibility program](https://www.fda.gov/medical-devices/medical-device-regulatory-science-research-programs-conducted-osel/credibility-computational-models-program-research-computational-models-and-simulation-associated)
15. This repository: [docs/spikes/zerod-wasm.md](spikes/zerod-wasm.md)
16. Menon K et al. svZeroDSolver: a modular package for lumped-parameter cardiovascular simulations. *JOSS* 2025;10(109):7595 — [JOSS](https://joss.theoj.org/papers/10.21105/joss.07595)
17. STAFF III Database, PhysioNet — [PhysioNet](https://www.physionet.org/content/staffiii/)
18. Wagner P et al. PTB-XL, a large publicly available electrocardiography dataset. *Sci Data* 2020; v1.0.3 — [PhysioNet](https://physionet.org/content/ptb-xl/)
19. MIMIC-IV-ECG: Diagnostic Electrocardiogram Matched Subset v1.0 — [AWS Open Data registry](https://registry.opendata.aws/mimic-iv-ecg/)
20. MIMIC access: PhysioNet credentialing, CITI training, DUA — [MIMIC FAQ](https://mimic.mit.edu/docs/faq/how-to-get-access.html); MIMIC-IV Waveform DB — [PhysioNet](https://physionet.org/content/mimic4wdb/0.1.0/)
21. Lee HC et al. VitalDB, a high-fidelity multi-parameter vital signs database in surgical patients. *Sci Data* 2022;9:279 — [PMC9178032](https://pmc.ncbi.nlm.nih.gov/articles/PMC9178032/)
22. Laude D et al. Comparison of various techniques used to estimate spontaneous baroreflex sensitivity (the EuroBaVar study). *Am J Physiol* 2004 — [HAL](https://hal.archives-ouvertes.fr/hal-00069355)
23. ICADD: a comprehensive Indian clinical and imaging coronary artery disease dataset (medRxiv 2023) — [medRxiv](https://www.medrxiv.org/content/10.1101/2023.05.13.23289934)
24. Personalized and uncertainty-aware coronary hemodynamics simulations: from Bayesian estimation to improved multi-fidelity UQ (2024) — [arXiv:2409.02247](https://arxiv.org/pdf/2409.02247)
25. Cook DA et al. Technology-enhanced simulation for health professions education: systematic review and meta-analysis. *JAMA* 2011;306(9):978–88 — [AHRQ PSNet](https://psnet.ahrq.gov/issue/technology-enhanced-simulation-health-professions-education-systematic-review-and-meta)
26. Mitchell & Ivimey-Cook. Digital technology-enhanced simulation in RCTs 2011–2021. *Front Med* 2023 — [PMC10150956](https://pmc.ncbi.nlm.nih.gov/articles/PMC10150956)
27. 45 CFR 46.104(d)(1) exempt educational research, with institutional interpretation — [Pitt HRPO](https://www.hrpo.pitt.edu/node/901); [Michigan tips](https://hrpp.umich.edu/wp-content/uploads/sites/4/2024/10/exemption_1_-_tips_and_examples.pdf)
28. McSharry PE et al. A dynamical model for generating synthetic electrocardiogram signals. *IEEE TBME* 2003;50(3):289–94 — [PhysioNet ECGSYN](https://physionet.org/content/ecgsyn/1.0.0/paper/index.shtml)
29. HHS, Guidance on de-identification of PHI under the HIPAA Privacy Rule — [HHS](https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html)
30. FDA Digital Health Advisory Committee, 20–21 Nov 2024, generative AI-enabled devices — [FDA announcement](https://www.fda.gov/advisory-committees/advisory-committee-calendar/november-20-21-2024-digital-health-advisory-committee-meeting-announcement-11202024); [Jones Day summary](https://www.jonesday.com/zh-hant/insights/2024/12/fda-digital-health-advisory-committee-discusses-genaienabled-devices)
31. FDA, Predetermined Change Control Plans for AI-Enabled Device Software Functions, final guidance, December 2024 — [Ropes & Gray](https://ropesgray.com/en/insights/alerts/2024/12/fda-finalizes-guidance-on-predetermined-change-control-plans-for-ai-enabled-device)
