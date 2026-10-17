// Writes the tool definitions in the formats other assistants consume, from the same source as the MCP server.
//   npm run export:tools   →  dist-mcp/tools.openai.json, tools.anthropic.json, openapi.json
import { mkdirSync, writeFileSync } from "node:fs";
import { openAiTools, anthropicTools } from "../src/mcp/tools";
import { openApi } from "../src/mcp/server";

mkdirSync("dist-mcp", { recursive: true });
writeFileSync("dist-mcp/tools.openai.json", JSON.stringify(openAiTools(), null, 2));
writeFileSync("dist-mcp/tools.anthropic.json", JSON.stringify(anthropicTools(), null, 2));
writeFileSync("dist-mcp/openapi.json", JSON.stringify(openApi("https://YOUR-HOST"), null, 2));
console.log("wrote dist-mcp/{tools.openai,tools.anthropic,openapi}.json");
