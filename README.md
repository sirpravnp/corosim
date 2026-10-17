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
npm test           # 200+ tests
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
| Beat hemodynamics | Every ventricular beat gets its own filling, stroke volume and Windkessel pressure | `src/physics/beatHemo.ts`, `beatStream.ts` |
| Autonomic loop | Baroreceptors → fast vagal and slow sympathetic arms → rate, contractility, resistance; respiration (RSA) and Ornstein–Uhlenbeck noise make every beat different | `src/physics/autonomic.ts` |
| Simulation core | The whole model with no DOM, seeded and reproducible; the browser app, the MCP server and the tests all step this one object | `src/sim/` |
| LLM interface | MCP server (stdio and HTTP), OpenAPI, OpenAI/Anthropic tool schemas, paste-in blocks and share links | `src/mcp/`, `src/sim/llm.ts` |

All constants live in `src/config/`, tagged as literature-backed or assumed.

## Working with Claude and ChatGPT

CoroSim is a teaching layer, not a solver to compete with SimVascular: it makes the *interaction* of a lesion, volume, drugs and the autonomic reflexes visible beat by beat, and it hands the same state to an LLM to explain or change. See [docs/LLM_AND_MCP.md](docs/LLM_AND_MCP.md).

```bash
claude mcp add corosim -- npx tsx /path/to/corosim/src/mcp/main.ts    # Claude Code
npm run build:mcp && node dist-mcp/corosim-mcp.mjs                    # standalone stdio server
npm run mcp:http                                                     # MCP over HTTP + REST + /openapi.json on 127.0.0.1:8787
```

In the app, **Ask an AI → Copy for AI** puts the patient, the model's own causal account of it and the way to ask for changes on the clipboard; paste it into any assistant.

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

Coronary flow is steady (mean) with no pulsatile waveform; systemic pressure is a two-element Windkessel stepped per beat, not a ventricular pressure–volume model. Autonomic constants are teaching assumptions tuned to a resting adult and to ATLS-style hemorrhage; they are not fitted to patient data (see the model card in `src/mcp/content.ts`). No collaterals in the coronary tree. AV block only at the
AV node. Variant frequencies in the literature vary widely, so presets are teaching cases, not epidemiology.

## Third-party

three.js (MIT). Fonts: Public Sans and IBM Plex Mono (SIL Open Font License), loaded from Google Fonts.
