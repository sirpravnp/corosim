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
npm test           # 157 tests
npm run build      # static site in dist/
```

## How it works

| Layer | What it does | Where |
|---|---|---|
| Anatomy | Coronary tree on a procedural heart; diameters follow flow (Huo–Kassab 7/3 law), Finet's law holds at the left main | `src/anatomy/` |
| Perfusion | Pressure and flow through the tree; Poiseuille plus expansion losses at stenoses; autoregulation and flow reserve | `src/physics/network.ts`, `hemodynamics.ts` |
| Ischemia | Supply versus demand per myocardial bed, about 20 s to develop, τ about 8 s to recover | `src/physics/ischemia.ts` |
| ECG | Dipole heart; each ischemic bed adds an injury current along its wall's outward normal | `src/physics/ecg.ts`, `ecgLink.ts` |
| Rhythm | Sympathetic/vagal balance, SA- and AV-node arteries, Wenckebach, complete heart block | `src/physics/rhythm.ts` |
| Circulation | Cardiac output × vascular resistance; pressure feeds back on coronary perfusion | `src/physics/circulation.ts` |

All constants live in `src/config/`, tagged as literature-backed or assumed.

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
with a complete occlusion or a tight stenosis under exertion. You read the 12-lead, press the spot on the vessel where
you think the lesion is, and lock in.

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

Steady (mean) flow only, with no pulsatile waveform. No collaterals in the coronary tree. AV block only at the
AV node. Variant frequencies in the literature vary widely, so presets are teaching cases, not epidemiology.

## Third-party

three.js (MIT). Fonts: Public Sans and IBM Plex Mono (SIL Open Font License), loaded from Google Fonts.
