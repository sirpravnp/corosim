# CoroSim

A 3D coronary vasculature simulator. Block or narrow any coronary artery and watch myocardial
perfusion, the 12-lead ECG, rhythm and AV conduction, and blood pressure respond, across nine
anatomic variants (dominance, left main pattern, LAD course, nodal artery origin).

**For education only. Not for clinical decisions.** The anatomy is schematic and many model constants
are assumptions, marked as such in the code. It has not been compared with patient data.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 234 tests
npm run build      # static site in dist/
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
| Support | Fluids, norepinephrine, dobutamine, nitroglycerin, atropine, pacing, balloon pump, Impella: each changes the circulation, rhythm and myocardial oxygen demand | `src/physics/support.ts` |
| Infarct | Muscle that stays ischemic dies at a rate rising steeply with severity (τ 150 clinical min at full ischemia); reperfusion stops it but does not undo it | `src/physics/infarct.ts` |
| Revascularization | Primary PCI, fibrinolytic (55% success), CABG (a graft that feeds the vessel beyond the lesion at aortic pressure less its own loss); each takes clinical minutes to arrive | `src/physics/revasc.ts`, `network.ts` |
| Advice | Reads the live state and lists what is wrong and what guidelines would do next, in order | `src/physics/advice.ts` |

All constants live in `src/config/`, tagged as literature-backed or assumed.

## Management: what to do next

The **Management** panel (simulator only; the daily game keeps its own physiology) turns the lesion into a decision.
Block an artery, then treat the patient while the muscle is dying.

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

## Two versions

One build, two front doors. `corosim.com` is the simulator alone; `corosim.com/game` is "Find the culprit", the
simulator with the game panel at the top of the right-hand rail. The switch in the masthead moves between them. The
build writes the same page to `dist/game/index.html` (see `vite.config.ts`); in development Vite serves it at `/game`
by its usual fallback.

## Game mode: find the culprit

The simulator run backwards, one case a day. "Find the culprit" draws the day's lesion from the date (so everyone
gets the same case) and hides it: the vessel lumen, vessel shading, lesion marker, perfusion table and the pressure,
velocity, wall-shear and flow displays all keep the secret, the heart does not darken, and the monitor shows only rate,
cardiac output and blood pressure. The case can be any anatomic variant and any vessel, the nodal arteries included,
with a complete occlusion or a tight stenosis under exertion, on a patient who may already be in atrial fibrillation
or have a bundle branch block. Posterior leads V7–V9 are on. You read the tracing, press the spot on the vessel where
you think the lesion is, and lock in.

Then a second question: is the right ventricle involved? Yes or no, 10 points either way, judged by the circulation
model's own right-ventricular ischemia (the monitor's "RV involvement" line), so a case is out of 110. The card at
`/game` keeps a streak of days played on their own day, with the last seven as bars; `/game?day=YYYY-MM-DD` opens an
earlier case from the archive, scored but outside the streak.

Every case is solvable. The draw is checked against the physics: at full ischemia some lead must reach 1 mm of ST
shift, or the AV node must block, or the sinus rate must move by 12 bpm; a draw that does none of these (a conus
branch, or the SA-node artery in a patient in fibrillation) is thrown away and the next from the same seed taken, so
the day's case is still the same for everyone.

Up to 100 points: the location score is full anywhere on the lesion (within 7 mm, its own half-length) and falls off as
a Gaussian (σ 20 mm) with distance from it *along the vessels*, so a call just distal to a branch is far from one just
proximal, as the physiology is, but never below 25 while the call is in the culprit's own system (LAD, circumflex or
RCA); that score is then multiplied by exp(−t/150 s), t being the patient's time since the occlusion. The clock runs at
3× during a case so scores compare. The reveal shows the lesion, your call, and a short debrief: what the lesion did to
the tracing and why. The day's result is kept in the browser, so a day is played once and can be looked at again,
and "Share your score" copies a spoiler-free line (the case number, the score, how close and how soon) to paste anywhere.

Case drawing, scoring and the debrief live in `src/game.ts`; the display logic is in `src/app.ts`.

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

Steady (mean) flow only, with no pulsatile waveform. No collaterals in the coronary tree. One lesion at a time, so
multivessel disease and the PCI-versus-CABG choice it raises are not modeled; a graft is a single conduit, with no
competitive-flow failure or patency over time. Drug and device effects are single-number teaching assumptions, with no
dose titration curves, bleeding, vascular or reperfusion complications. Infarct size does not feed back on the ECG (no
Q waves) or on the rhythm. AV block only at the
AV node. Bundle branch blocks are fixed patterns, not rate-dependent; atrial fibrillation is a rhythm only,
with no atrial ischemia or thrombus. Variant frequencies in the literature vary widely, so presets are teaching cases, not epidemiology.

## Third-party

three.js (MIT). Fonts: Public Sans and IBM Plex Mono (SIL Open Font License), loaded from Google Fonts.
