# Connecting an AI to CoroSim

CoroSim speaks the Model Context Protocol (MCP). An assistant connected to it can build a patient, change it, run the
clock and read back what the model computed. All of it goes through tools, with no pasted text. There are two kinds of
connection, served by the same server.

| Connector URL | What the AI drives |
|---|---|
| `https://<server>/mcp/<room>` | **The patient on your screen.** The CoroSim page holds the room open; every tool call runs on that page and you watch the result. |
| `https://<server>/mcp` | A private patient for that AI session, with no page involved. |

## Live: connect your AI to the page you are looking at

1. In CoroSim, open **Connect your AI → Open a connection**. The page shows a connector URL.
2. Add that URL to your assistant once:
   - **Claude** (claude.ai or Desktop): Settings → Connectors → Add custom connector, paste the URL.
   - **ChatGPT**: Settings → Apps & Connectors → Advanced → Developer mode, then Create, paste the URL.
   - **Claude Code**: `claude mcp add --transport http corosim <url>`
   - Any other MCP client: Streamable HTTP transport, no authentication.
3. Ask: "What's going on with this patient?", "Occlude the proximal RCA and tell me what happens to the rhythm", "Give
   a litre of fluid and explain the pressure."

The URL is kept in this browser, so the connector keeps working on later visits; the page reopens the line by itself
if it was open last time. **New URL** retires the old one. While a Find the culprit case is running, the line is
paused: an AI on the line could read the lesion.

How it works: the page opens a WebSocket to `wss://<server>/live/<room>`. When an AI calls a tool on
`/mcp/<room>`, the server forwards the call over that socket. The page runs it on its own simulation (the same
`src/mcp/tools.ts` code a private session runs), brings its controls into line with what changed, and sends the result
back. If the page is closed, the AI gets a plain error asking the user to open it. If a second tab opens the same
room, it takes over and the first tab is told. The protocol is in `src/mcp/protocol.ts`.

## Tools

| Tool | Use |
|---|---|
| `corosim_get_state` | What is happening now: rolling vitals, rhythm, ventricle, support, ischemic beds, FFR. Read first in a live session. |
| `corosim_get_schema` | Scenario format, valid arteries for the current anatomy, what each knob does. |
| `corosim_set_scenario` | Replace the patient; settles the reflexes first; returns the state, a grounded explanation and **warnings** (anything clamped or dropped). |
| `corosim_adjust` | Change the running patient (lesion, drug, bleed, support, rhythm); returns the response over time. |
| `corosim_run` | Advance time; beat statistics, a bounded time course, optional beat table. The infarct clock runs (2 clinical min per s). |
| `corosim_explain` | The model's own causal account of the state, to quote rather than improvise. |
| `corosim_compare` | Counterfactuals from the same seed in separate simulations; the current patient is untouched. |
| `corosim_open_link` | A URL that opens this patient in the app. |

Resources: `corosim://model-card`, `corosim://scenario-reference`. Prompts: `build_patient`, `baroreflex_demo`,
`hemorrhage_ladder`, `explain_current_state`. Results come back as text and as `structuredContent`.

The autonomic loop (baroreflex, respiratory gating, physiological noise) is not shown in the app; it is the
physiology, and shows up in the rate and pressure. An AI can still read it (`state.autonomic`, HRV in run metrics) and
set it (`autonomic.baroreflexGain`, `respRate`, `noise`) to answer what-if questions.

## Running the server

```bash
npm run mcp:http                       # development: http://127.0.0.1:8787, which the dev page uses
npm run build:mcp                      # dist-mcp/corosim-mcp.mjs, a single file with no dependencies
PORT=8787 HOST=0.0.0.0 node dist-mcp/corosim-mcp.mjs --http
docker build -t corosim-mcp . && docker run -p 8787:8787 corosim-mcp
npm run mcp                            # stdio, one private patient, for local clients
```

Claude and ChatGPT connectors need a public **https** URL, so in production the server sits behind TLS (Fly.io,
Render, Railway, Cloud Run and similar terminate it for you). The site finds the server through
`VITE_COROSIM_MCP_URL` at build time, defaulting to `https://mcp.corosim.com` (and `http://localhost:8787` on
localhost).

| Setting | Default | |
|---|---|---|
| `PORT`, `HOST` | 8787, 127.0.0.1 | Use `HOST=0.0.0.0` in a container. |
| `COROSIM_ALLOWED_ORIGINS` | corosim.com, www.corosim.com, localhost | Page origins allowed to open live rooms. |
| `COROSIM_APP_URL` | https://corosim.com | Base of share links. |

Built-in limits: 120 tool calls per minute per caller, sessions expire after 30 idle minutes, 1000 sessions and 2000
live rooms at most, 1 MB request bodies, a 20 s answer deadline for pages, and pings every 25 s that drop dead pages.

**Security model.** No accounts: a live connector URL is a 128-bit capability, and whoever holds it can drive that
tab's patient while the line is open. Nothing personal is stored or sent; the patient is synthetic. Rotate the URL
with **New URL**. If you need per-user access control, put OAuth in front of `/mcp` (the MCP authorization spec) and
keep `/live` behind the same origin check.

## REST and OpenAPI

For clients without MCP (custom GPT actions, scripts): `POST /api/<tool>` with the tool's arguments as JSON and an
`x-session-id` header to keep a patient; the schema is at `/openapi.json`, and OpenAI/Anthropic tool definitions at
`/tools.openai.json` and `/tools.anthropic.json` (`npm run export:tools` writes them to `dist-mcp/`).

## What an assistant should do with it

- Quote numbers from `corosim_get_state` and `corosim_explain`; say plainly what the model does not compute.
- Read `warnings`: scenarios are clamped, and lesions on arteries absent from the chosen anatomy are dropped.
- In a live session, prefer `corosim_adjust`; `corosim_set_scenario` replaces what the user is looking at.
- Say that it is an educational model with teaching constants and no patient validation.
