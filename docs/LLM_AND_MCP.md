# Connecting an AI to CoroSim

CoroSim speaks the Model Context Protocol (MCP). An assistant connected to it can build a patient, change it, run
the clock and read back what the model computed, all through tools. Using it from an AI needs a CoroSim account
(sign in with Google or GitHub); the simulator itself never does.

## For people using it

1. In CoroSim, click **Connect AI** at the top and sign in with Google or GitHub.
2. Add the connector URL `https://mcp.corosim.com/mcp` to your assistant once:
   - **Claude** (claude.ai or Desktop): Settings → Connectors → Add custom connector, paste the URL, then
     **Connect**. A CoroSim page opens: sign in and choose **Allow**.
   - **ChatGPT**: Settings → Apps & Connectors → Advanced → Developer mode, then Create, paste the URL, and sign in.
   - **Claude Code**: `claude mcp add --transport http corosim https://mcp.corosim.com/mcp`, then `/mcp` to sign in.
3. Ask: "What's going on with this patient?", "Occlude the proximal RCA and tell me what happens to the rhythm".

The AI works on **your account's patient**. With CoroSim open, that is the patient on your screen and you watch every
change. With it closed, the AI works on your saved patient, and CoroSim picks it up next time you open it, on any
device you sign in on. While a Find the culprit case is running the AI is paused, since it could read the lesion.

**Connect AI** also lists which AIs are connected, **Disconnect AIs** revokes them all, and **Delete my account**
removes the account, the saved patient and every connection at once.

## How it works

| Piece | |
|---|---|
| `POST /mcp` | MCP over Streamable HTTP, stateless. Requires an OAuth bearer token; without one it answers 401 with `WWW-Authenticate: Bearer resource_metadata=…`, which is how a client finds the sign-in. |
| `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server` | Discovery (RFC 9728, RFC 8414). |
| `/oauth/register` | Dynamic client registration (RFC 7591). Redirect URIs must be https, or http on localhost. |
| `/oauth/authorize` → `/auth/signin` → Google/GitHub → `/oauth/consent` | Sign in, then an Allow/Cancel screen naming the app and where it returns to. PKCE S256 required. |
| `/oauth/token` | Authorization code (single use, 5 min) for an access token (1 h) and a refresh token (90 days, rotated on every use). |
| `/auth/login`, `/auth/exchange`, `/auth/me`, `/auth/logout`, `/auth/disconnect`, `DELETE /auth/account` | The site's own sign-in: back to corosim.com with a one-time code in the URL fragment, exchanged for a page token. |
| `wss://…/live` | A signed-in page's line. The first message carries its page token; tool calls for that account are forwarded to it. |

Everything lives in one SQLite file (`src/mcp/db.ts`): accounts, sessions, OAuth clients, codes and tokens (stored
as SHA-256 hashes only), one patient per account, and daily usage. Code: `src/mcp/accounts.ts` (sign-in and OAuth),
`src/mcp/server.ts` (MCP, live lines, limits), `src/live.ts` (the page's end), `src/mcp/protocol.ts` (page ↔ server
messages).

Limits: 60 tool calls a minute and 2000 a day per account (`COROSIM_CALLS_PER_DAY`), 600 requests a minute per
address, a 20 s answer deadline for pages, pings every 25 s that drop dead pages.

### Tools

| Tool | Use |
|---|---|
| `corosim_get_state` | What is happening now: vitals, rhythm, ventricle, support, ischemic beds, FFR. Read first. |
| `corosim_get_schema` | Scenario format, valid arteries for the current anatomy, what each knob does. |
| `corosim_set_scenario` | Replace the patient; returns the state, a grounded explanation and **warnings** (anything clamped or dropped). |
| `corosim_adjust` | Change the running patient (lesion, drug, bleed, support, rhythm); returns the response over time. |
| `corosim_run` | Advance time; beat statistics, a bounded time course, optional beat table. The infarct clock runs. |
| `corosim_explain` | The model's own causal account of the state, to quote rather than improvise. |
| `corosim_compare` | Counterfactuals from the same seed in separate simulations; the patient is untouched. |
| `corosim_open_link` | A URL that opens this patient in the app. |
| `corosim_ekg_list` | The EKG page's presets by category (rhythms, blocks, STEMI and its mimics). Does not touch the patient. |
| `corosim_ekg_show` | Draws a simulated 12-lead in the chat with the leads through a 3D heart; returns measurements and teaching notes. `quiz: true` hides the answer on screen and returns it as `answerKey`. |

The EKG tools need no patient, so they run on the server even while the user's page is open and never change it.
`corosim_ekg_show` has its own MCP App, `ui://corosim/ekg.html` (the `/ekg/` page built as one file by
`npm run build:ekg-viewer`; `build:mcp` and the Dockerfile include it). The `ekg_quiz` prompt runs a reading round.

Resources `corosim://model-card`, `corosim://scenario-reference`; prompts `rounds`, `build_patient`, `manage`,
`baroreflex_demo`, `hemorrhage_ladder`, `explain_current_state`, `ekg_quiz`. The autonomic loop is not shown in the app, but an AI can read it
(`state.autonomic`, HRV in run metrics) and set it (`autonomic.baroreflexGain`, `respRate`, `noise`) for what-ifs.

## Hosting mcp.corosim.com

One Fly.io machine that **sleeps when unused** and wakes on the next request (a second or two), with a 1 GB volume
for the database. At Fly's prices (October 2026): the volume is $0.15 a month, the machine $3.69 a month if it never
slept and proportionally less as it does, certificates and shared addresses are free. Nothing is lost while it
sleeps: connectors hold no session, and everything is on the volume.

**You do (accounts and money):**

1. Fly.io: `fly auth login` (sign up and add a card if new; Fly has no free tier for new accounts).
2. GitHub sign-in: github.com → Settings → Developer settings → OAuth Apps → New OAuth App.
   Homepage `https://corosim.com`, callback `https://mcp.corosim.com/auth/callback/github`.
   Generate a client secret.
3. Google sign-in: console.cloud.google.com → APIs & Services → OAuth consent screen (External; app name CoroSim;
   scopes `openid`, `email`, `profile`; publish it), then Credentials → Create credentials → OAuth client ID → Web
   application, authorized redirect URI `https://mcp.corosim.com/auth/callback/google`.
4. Put the four values in Fly yourself (they are secrets; do not paste them into chats or files):
   `fly secrets set GITHUB_CLIENT_ID=… GITHUB_CLIENT_SECRET=… GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=…`
5. DNS at your registrar: a CNAME `mcp` → `corosim-mcp.fly.dev` (`fly certs add` prints the exact value).

**From the repository (the deploy):**

1. `fly launch --no-deploy --copy-config` (if the name `corosim-mcp` is taken, pick another; it goes into `fly.toml`).
2. `fly volumes create corosim_data --size 1 --region iad`, then `fly deploy --ha=false`.
   `https://<app>.fly.dev/health` should say `"persistent": true` and list the sign-in methods.
3. `fly certs add mcp.corosim.com`; when `fly certs show mcp.corosim.com` says issued, the domain is live.
4. Optional automatic deploys: `fly tokens create deploy`, saved as the GitHub repository secret `FLY_API_TOKEN`.

Keep it to **one machine**: a page's live line is held by one process. Scale up if needed, not out.

| Setting | Default | |
|---|---|---|
| `COROSIM_PUBLIC_URL` | `http://localhost:<port>` | The public base and OAuth issuer (`https://mcp.corosim.com` in `fly.toml`). |
| `COROSIM_DATA_DIR` / `COROSIM_DB` | memory only | SQLite location (`/data/corosim.db` in the image). |
| `GITHUB_CLIENT_ID/_SECRET`, `GOOGLE_CLIENT_ID/_SECRET` | none | Sign-in providers; each optional. |
| `COROSIM_ALLOWED_ORIGINS` | corosim.com, www.corosim.com, localhost | Sites that may open a line and receive sign-ins. |
| `COROSIM_CALLS_PER_DAY` | 2000 | Per-account daily allowance. |
| `COROSIM_TRUST_PROXY` | off (`1` in `fly.toml`) | Take client addresses from the proxy's header. |
| `COROSIM_DEV_LOGIN` | off | A sign-in without Google/GitHub for development; refused unless the public URL is localhost. |

### Development

```bash
COROSIM_DEV_LOGIN=1 COROSIM_DATA_DIR=.data npm run mcp:http    # server on http://localhost:8787
npm run dev                                                    # the site; Connect AI offers a development account
npm run mcp                                                    # stdio, one local patient, no account (local clients)
```

## Privacy

The site's privacy page is `public/privacy.html` (a draft to review before launch). In short: name, email and
provider account ID; the synthetic patient; connected AI apps; 30 days of daily call counts; hashed tokens. No
analytics or trackers. Deleting the account removes all of it.

## REST and OpenAPI

For clients without MCP: `POST /api/<tool>` with a bearer token, `/openapi.json` (declares the OAuth flow), and
tool definitions at `/tools.openai.json` and `/tools.anthropic.json` (`npm run export:tools` writes them to
`dist-mcp/`).
