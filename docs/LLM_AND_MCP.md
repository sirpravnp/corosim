# CoroSim with Claude, ChatGPT and other assistants

Three ways in, from least to most capable. All of them use the same `Scenario` JSON and the same simulation core
(`src/sim/simulation.ts`), so what an assistant computes is what the app shows.

## 1. Paste (any assistant, no setup)

In the app: **Ask an AI → Copy for AI**. The text contains the scenario JSON, the last 60 s of beat statistics, the
model's own causal explanation, a compact scenario reference and the limits. Paste it into Claude or ChatGPT and ask
"explain this", or "make it a 30 % hemorrhage on a beta blocker and tell me what changes". The assistant replies with
edited JSON; **Paste scenario** loads it. **Copy link** gives a URL (`#s=…`) that opens the exact patient.

## 2. MCP (Claude Desktop, Claude Code, Cursor, ChatGPT developer mode…)

```jsonc
// Claude Desktop: claude_desktop_config.json
{ "mcpServers": { "corosim": { "command": "node", "args": ["/path/to/corosim/dist-mcp/corosim-mcp.mjs"] } } }
```
```bash
npm run build:mcp                                                       # makes dist-mcp/corosim-mcp.mjs (Node ≥ 18)
claude mcp add corosim -- node /path/to/corosim/dist-mcp/corosim-mcp.mjs
npm run mcp:http        # Streamable HTTP at http://127.0.0.1:8787/mcp for remote-connector clients
```

| Tool | Use |
|---|---|
| `corosim_get_schema` | Scenario format, valid arteries for the current anatomy, what each knob does. Read first. |
| `corosim_set_scenario` | Build a patient; runs a warm-up so the reflex has settled; returns state, grounded explanation and **warnings** (anything clamped or dropped). |
| `corosim_adjust` | Give a drug, start a bleed, occlude an artery on the running patient; returns the response time course. |
| `corosim_run` | Advance time; beat statistics (HR, BP, SV, HRV SDNN/RMSSD/LF/HF, baroreflex sensitivity, RSA), time course, optional beat table. |
| `corosim_get_state`, `corosim_explain` | Current state; the model's causal account (quote it, do not improvise). |
| `corosim_compare` | Counterfactuals from the same seed: with/without baroreflex, 15 % vs 30 % bleed. The current patient is untouched. |
| `corosim_open_link` | URL that opens this patient in the 3D app, plus a paste block. |

Resources: `corosim://model-card`, `corosim://scenario-reference`. Prompts: `build_patient`, `baroreflex_demo`,
`hemorrhage_ladder`, `explain_current_state`.

Example: "62-year-old, RCA occluded proximally, then give atropine" →
`corosim_set_scenario {lesions:[{artery:"RCA",occluded:true,position:0.1}]}` then `corosim_adjust {patch:{drugs:{atropine:1}}}`.

## 3. REST / OpenAPI (custom GPTs, Gemini, anything with HTTP tools)

`npm run mcp:http` also serves `POST /api/<tool>` (JSON body = tool arguments; send `x-session-id` to keep a patient
between calls), `/openapi.json`, `/tools.openai.json` and `/tools.anthropic.json`. `npm run export:tools` writes the same
files to `dist-mcp/`. The server binds to 127.0.0.1 with **no authentication**: to expose it, put it behind a reverse
proxy that adds auth and rate limits (a 900 s run costs a few hundred ms of CPU).

## What an assistant should and should not do with it

- Quote numbers from `corosim_explain` / `state`; say plainly what the model does not compute.
- Always read `warnings`: the scenario is clamped, and lesions on arteries that do not exist in the chosen anatomy are dropped.
- Say that it is an educational model with teaching constants and no patient validation.

## Scenario fields

See `src/sim/scenario.ts` (types and normalisation) and `corosim_get_schema` (JSON Schema with ranges).
`seed` makes a run reproducible; `autonomic.noise: 0` makes the loop deterministic.
