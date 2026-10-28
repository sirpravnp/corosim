# CoroSim

A 3D coronary vasculature simulator. Block or narrow any coronary artery and watch myocardial
perfusion, the 12-lead ECG, rhythm and AV conduction, and blood pressure respond, across nine
anatomic variants (dominance, left main pattern, LAD course, nodal artery origin).

**For education only. Not for clinical decisions.** The anatomy is schematic and many model constants
are assumptions, marked as such in the code. It has not been compared with patient data.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (homepage), /sim/ (simulator), /cases/ (the cases)
npm test           # 280+ tests
npm run build      # static site in dist/: index.html, sim/index.html, cases/index.html
```

## How it works

| Layer | What it does | Where |
|---|---|---|
| Anatomy | Coronary tree on a procedural heart; diameters follow flow (Huo–Kassab 7/3 law), Finet's law holds at the left main | `src/anatomy/` |
| Perfusion | Pressure and flow through the tree; Poiseuille plus expansion losses at stenoses; autoregulation and flow reserve | `src/physics/network.ts`, `hemodynamics.ts` |
| Ischemia | Supply versus demand per myocardial bed, about 20 s to develop, τ about 8 s to recover | `src/physics/ischemia.ts` |
| ECG | Dipole heart; each ischemic bed adds an injury current along its wall's outward normal; 12 leads plus posterior V7–V9; right and left bundle branch block with their discordant ST-T | `src/physics/ecg.ts`, `ecgLink.ts` |
| Rhythm | Sympathetic/vagal balance, SA- and AV-node arteries, Wenckebach, complete heart block; atrial fibrillation as an existing rhythm | `src/physics/rhythm.ts` |
| Circulation | Cardiac output × vascular resistance; pressure feeds back on coronary perfusion | `src/physics/circulation.ts` |
| Beat hemodynamics | Every ventricular beat gets its own filling, stroke volume and Windkessel pressure; the ECG and the pressure trace show the same beats | `src/physics/beatHemo.ts`, `beatStream.ts` |
| Autonomic loop | Baroreceptors → fast vagal and slow sympathetic arms → rate, contractility, resistance; breathing (RSA) and Ornstein–Uhlenbeck noise make every beat different; CNS-ischemic and volume reflexes. Not displayed: it shows up only as the rate and pressure | `src/physics/autonomic.ts` |
| Support | Fluids, norepinephrine, dobutamine, nitroglycerin, atropine, pacing, balloon pump, Impella: each changes the circulation, rhythm and myocardial oxygen demand | `src/physics/support.ts` |
| Infarct | Muscle that stays ischemic dies at a rate rising steeply with severity (τ 150 clinical min at full ischemia); reperfusion stops it but does not undo it | `src/physics/infarct.ts` |
| Revascularization | Primary PCI, fibrinolytic (55% success), CABG (a graft that feeds the vessel beyond the lesion at aortic pressure less its own loss); each takes clinical minutes to arrive | `src/physics/revasc.ts`, `network.ts` |
| Advice | Reads the live state and lists what is wrong and what guidelines would do next, in order | `src/physics/advice.ts` |
| Simulation core | The whole model with no DOM, seeded and reproducible; the app, the MCP server and the tests all step this one object | `src/sim/` |
| Cath lab page | Angiogram with contrast filling at each vessel's solved flow (TIMI grade and frame count), pressure-wire pullback at rest and hyperemia with FFR, wall motion by AHA segment; treatment before and after | `src/sim/cath.ts`, `src/cath/`, `cath/index.html` |
| EKG page | Over fifty rhythm, block, ischemia and mimic presets on the same dipole heart; 3D lead axes and heart vector | `src/ekg/`, `ekg/index.html` |
| AI connection | MCP server (Streamable HTTP and stdio); accounts (Google/GitHub) and OAuth for connectors; each account's patient runs on its open page or is saved in SQLite; REST/OpenAPI; `#s=` share links | `src/mcp/`, `src/live.ts` |

All constants live in `src/config/`, tagged as literature-backed or assumed.

## Management: what to do next

The **Management** panel turns the lesion into a decision: block an artery, then treat the patient while the muscle is
dying. It has three tabs (support, opening the artery, assessment) so the rail stays short; the patient, anatomy and
display sections fold away with their state in the header.

- **Hemodynamic support.** Norepinephrine raises MAP but adds afterload to a failing ventricle. Dobutamine raises output
  and oxygen demand and provokes ectopy. Fluid fills a right ventricle that depends on preload and congests the lungs
  of a failing left one. Nitroglycerin collapses the pressure of a right-ventricular infarct. Atropine lifts vagal
  slowing and tone-mediated block but does nothing for an infarcted AV node. Pacing holds the rate (atrial for a slow
  sinus rhythm, ventricular with its left-bundle pattern in heart block). A balloon pump augments coronary perfusion
  pressure by about 10 mmHg; an Impella adds up to 3 L/min and unloads the ventricle, but moves less when the right
  ventricle fails. Anything that changes demand or perfusion pressure re-solves the coronary network.
- **Revascularization.** Primary PCI (60 clinical min to the artery) stents the lesion. A fibrinolytic (40 min) opens an
  occlusion in about 55% of patients, leaving a 50% stenosis, and does nothing for a stenosis. CABG (4 h) sews a graft
  just beyond the lesion; the native lesion stays, and branches that leave before the anastomosis stay cut off.
- **Time is muscle.** About 2 clinical minutes pass per second at 1×. Ischemic beds infarct, steeply faster the more
  severe the ischemia, and the infarct shows as a percentage of the left ventricle and a lower estimated ejection
  fraction that outlasts reperfusion.
- **Where things stand.** Live problems (shock, RV infarct, heart block, congestion, infarct size), warnings when what
  the team is doing is hurting (nitrate in an RV infarct, a pressor in pump failure, dobutamine in ischemic muscle),
  and a button for the guideline order of steps, so a learner can decide first and check after.

Choices are the teaching points of STEMI and infarct shock care (ACC/AHA; SHOCK, IABP-SHOCK II), not a decision aid.

## Three pages

One build, a few front doors. `corosim.com` is the homepage: the title, a heart as a stippled thermogram, a fact about
it, and the links. `corosim.com/sim` is the simulator alone; `corosim.com/cases` is the cases: the simulator with a scripted patient, a case panel at the top of the right-hand rail,
and questions that stop the clock. The switch in the masthead moves between the two, and the logo goes
home. The homepage is `index.html` (`src/home.ts`, `src/stipple.ts`); the simulator is `sim/index.html`, and the build
writes the same page to `dist/cases/index.html` (see `vite.config.ts`), which the dev server serves at `/cases/` by a
rewrite. Older share links of the form `corosim.com/#s=…` are forwarded by the homepage to `/sim/#s=…`.

### The heart of the day

The homepage shows a different heart each day, with a "Did you know" fact: an animal's heart, or a variation of the
human coronary tree. `src/specimens.ts` is the list (animals and human anatomy alternate, the cycle repeats) and the
day's pick, from the visitor's local date; add a heart by appending to it and, for an animal, drawing it in
`src/specimenArt.ts`. `/?heart=octopus` or `/?day=2026-10-21` shows a chosen heart.

Every heart goes through the same stippling (`src/stipple.ts`): a weighted Voronoi stipple, points sampled by density
and relaxed with Lloyd's algorithm on a Delaunay triangulation, colored by heat (black, red, orange, yellow, white)
where heat is nearness to a vessel. Each heart is fitted to the same stage by its own bounding box, and gets the same
dot spacing, whatever its shape. An animal's heart is a short list of ellipses, tubes and blobs. A human variant is
drawn from the simulator's own coronary tree (`buildTree`, read only), seen from the front through the heart's
outline, with the arteries that make the variant what it is hottest. That outline is baked
(`src/heartOutline.ts`, by `scripts/bake-home-outline.ts`: run it after changing `src/anatomy/heartSurface.ts`;
a test fails when it is out of date). The textbook heart is the logo.

## Cases

`corosim.com/cases` replaces the old "Find the culprit" game. A case is the simulator with a patient already in trouble:
the page opens on a list, each case has a short card (what the patient came in with, a brief history, a line or two of
other facts), and Begin starts the simulator from a fixed starting patient. Everything on the page is live: the
Support, Patient and arrest panels work as they do in the simulator, and the lesion is kept off the displays until the
team has found it.

At the points that matter the case stops and asks a question. **A prompt holds the clock** (the simulation does not
advance until you answer). Answers branch: a choice can reveal a finding, change the patient (a device goes in, a rhythm
returns, a complication begins), set a flag that a later question depends on, order a procedure, or end the case.
Checkpoints are gated by outcomes: the question about the artery only comes once support is running, a complication of
ECMO alone brings its own question about venting the left ventricle, and so on.

Grading keeps the old treatment scoring's spirit: a case ends in success, death or time-out, and the score is survival,
the share of the time the patient was held stable (pressure at 60 or more and not in arrest), points for each choice,
and a deduction for time spent doing harm. The debrief lists each choice with its teaching point and anything the case
expected that was not done. Best scores are kept in the browser.

The cases so far, easy to hard: Pressure in the chest (anterior STEMI), Racing heart (AF with RVR in a stable patient: rate control, then the anticoagulation question), Slow and low (inferior STEMI with right-ventricular infarct and heart block), Short of breath and racing (fast AF in a failing ventricle: diltiazem is the trap, cardioversion the route), Cold and wet (left main shock) and Collapse at home (VF, quick ROSC, STEMI: cath lab, then ECPELLA before PCI). Harms are scored by a shared list in `src/cases/harms.ts` (a drug given into a physiology it makes worse); a case adds its own or skips a generic one.

The engine is `src/cases/engine.ts` (pure: a `CaseRunner` fed a `Probe` of the patient each frame; tests in
`tests/cases.test.ts`), the cases are one file each in `src/cases/` (list them in `src/cases/index.ts`), and the page is
`src/page/cases.ts`. A case is a `PatientSpec` to start from, a card, an optional opening (rhythm, CPR, drugs already
given), and a list of checkpoints (`atS`, `when`/`forS`, `requires`/`forbids`, a `prompt` with options or a bare
`outcome`). Devices a case will place are built into the starting patient switched off, so placing them is a live change.

## EKG: simulated 12-leads

`corosim.com/ekg` is a page for reading tracings: over fifty presets across sinus rhythms, atrial fibrillation and
flutter, junctional and re-entrant rhythms (SVT, WPW), AV blocks, bundle branch and fascicular blocks, ventricular
rhythms (PVCs, AIVR, monomorphic and polymorphic VT, torsades, VF, asystole, pacing), acute coronary patterns (anterior,
inferior, lateral and posterior STEMI, hyperacute T, de Winter, Wellens, NSTEMI, aVR elevation, Sgarbossa) and STEMI
mimics (pericarditis, early repolarization, LVH, Brugada, Takotsubo, PE, LV aneurysm, effusion, hyperkalemia,
hypothermia). The 12-lead writes itself with a 10 s rhythm strip, and beside it the 3D heart is drawn see-through, with
every lead as an axis through it (limb leads on the frontal plane, chest leads on the horizontal) and the heart's
electrical vector moving with its loop, so a learner can see why each lead goes up or down. Click a lead to follow it.
Rate, gain, posterior leads and artifact are adjustable; "Quiz me" hides the name and offers four choices.

It uses the same dipole heart as the simulator's ECG (same lead axes, waves and bundle-branch vectors) through its own
generator for rhythms the simulator does not make (`src/ekg/engine.ts`), and the acute coronary presets take their ST
vector from the coronary model with a real lesion, settled (`src/ekg/presets.ts`). Rates, intervals, axis and ST levels
on the page are measured from the waveform, not copied from labels. An AI draws the same page in the chat with
`corosim_ekg_show` (below), and can build tracings the library does not have from a description ("sinus at 110 with
LBBB and an inferior STEMI", "AF with a delta wave"): rhythm, conduction and territory-level ST/T changes in clinical
terms (`src/ekg/custom.ts`), measured back so the AI can check what it drew, and shareable as `/ekg/#c=…` links.
"Ask Claude" opens Claude with the tracing.

## Cath lab

`corosim.com/cath` is a virtual cath lab on the simulator's own patient. It opens a small library of cases (normal,
mid-LAD 50% and 75%, proximal LAD, RCA and circumflex occlusions, left main) or the patient in a simulator link (`/cath/#s=…`,
which the simulator's **Cath lab** link builds). The angiogram is drawn from a C-arm angle you choose (LAO/RAO, cranial/caudal);
the contrast front travels at each vessel's solved blood velocity, so a tight lesion fills late (TIMI 2), an occlusion stops
the dye (TIMI 0), and overlap and foreshortening come out of the geometry. The pressure wire pulls back along any vessel at rest
and at adenosine hyperemia and reads Pd/Pa and FFR; PCI, fibrinolytic and CABG run the same `Simulation.revascularize` as the
simulator, so the lab shows before and after. What the lab reads is DOM-free in `src/sim/cath.ts` (`angioModel`, `timi`,
`wireModel`, `echoModel`, `cathReport`); the page only draws it. The coronary tree is the simulator's procedural one, thinner and
smoother than a real patient's, and the display has not yet been reviewed by a cardiologist.

The echo panel (phase 2) will draw from a real CT-derived heart. The baked anatomy is `src/cath/data/heart.bin.gz` with
`heart.json`, made by `scripts/cath/` (`npm run build:heart`, which downloads the 58 MB source mesh and needs python3 with numpy and scipy).
**Credit (CC BY 4.0):** Rodero C, Strocchi M, Marciniak M, et al. *Linking statistical shape models and simulated function in the
healthy adult human heart.* PLoS Comput Biol 17(4): e1008851 (2021); data: "Virtual cohort of extreme and average four-chamber heart
meshes from statistical shape model", Zenodo, doi:10.5281/zenodo.4593739. It is the average shape of healthy adult CT hearts, not a patient.

## Connecting an AI

CoroSim is a teaching layer beside image-based solvers such as SimVascular, not a competitor to them. An assistant
connects to it over MCP: click **Connect AI** at the top, sign in with Google or GitHub, and add
`https://mcp.corosim.com/mcp` as a connector in Claude, ChatGPT or Claude Code (it asks you to sign in and allow
access). The AI then works on your account's patient: on your screen while CoroSim is open, saved otherwise. The
simulator itself needs no account. Details, hosting, limits and privacy: [docs/LLM_AND_MCP.md](docs/LLM_AND_MCP.md).

```bash
COROSIM_DEV_LOGIN=1 COROSIM_DATA_DIR=.data npm run mcp:http   # the server, with a development sign-in, on :8787
npm run build:mcp                                             # one-file server for hosting; or: docker build .
```

## Deploy

The build is a static site with relative paths, so it works at any URL.

**GitHub Pages (configured):** `.github/workflows/deploy.yml` runs the tests, builds the site and publishes `dist/` on every push to `main`.
In the repository settings, set Pages → Source to "GitHub Actions". `public/CNAME` already names `corosim.com`.
Free GitHub Pages requires a public repository.

**Other hosts:** `vercel.json` and `netlify.toml` are included; Cloudflare Pages uses build command `npm run build`, output directory `dist`.

### Pointing corosim.com at it (GitHub Pages)
1. In the domain's DNS settings (Squarespace Domains), remove the records that point at Squarespace hosting and, if the domain is
   attached to a Squarespace website, disconnect it.
2. Add the four `A` records for the apex domain and a `CNAME` for `www`, using the values in GitHub's current documentation
   ("Managing a custom domain for your GitHub Pages site"); `www` points to `<your-github-username>.github.io`.
3. In Pages settings, enter `corosim.com` as the custom domain and enable "Enforce HTTPS" once the certificate is issued.

## Limits

Coronary flow is steady (mean), with no pulsatile waveform; systemic pressure is a two-element Windkessel stepped per
beat, not a ventricular pressure–volume model. Autonomic constants are teaching assumptions tuned to a resting adult and to
ATLS-style hemorrhage, not fitted to patient data (model card: `src/mcp/content.ts`). No collaterals in the coronary tree.
The app edits one lesion at a time (scenarios and the MCP server can carry several, one per artery), so the PCI-versus-CABG
choice that multivessel disease raises is not modeled; a graft is a single conduit, with no
competitive-flow failure or patency over time. Drug and device effects are single-number teaching assumptions, with no
dose titration curves, bleeding, vascular or reperfusion complications. Infarct size does not feed back on the ECG (no
Q waves) or on the rhythm. AV block only at the
AV node. Bundle branch blocks are fixed patterns, not rate-dependent; atrial fibrillation is a rhythm only,
with no atrial ischemia or thrombus. Variant frequencies in the literature vary widely, so presets are teaching cases, not epidemiology.

## Third-party

three.js (MIT). Cath-lab heart anatomy: Rodero et al. 2021, CC BY 4.0 (see Cath lab above). Fonts: Public Sans and IBM Plex Mono (SIL Open Font License), loaded from Google Fonts.
