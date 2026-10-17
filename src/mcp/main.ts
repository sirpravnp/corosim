import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, startHttp } from "./server";

// stdio, one private patient (Claude Desktop / Claude Code / any local MCP client):   corosim-mcp
// Hosted: Streamable HTTP + live page rooms + REST/OpenAPI:                            corosim-mcp --http [port]
//   PORT, HOST (default 127.0.0.1; use 0.0.0.0 in a container), COROSIM_ALLOWED_ORIGINS (comma-separated page origins
//   allowed to open live rooms; default corosim.com and localhost), COROSIM_APP_URL (for share links),
//   COROSIM_DATA_DIR (where connector patients are saved so connectors survive restarts; unset = memory only).
const i = process.argv.indexOf("--http");
if (i >= 0) {
  const port = Number(process.argv[i + 1]) || Number(process.env.PORT) || 8787;
  const origins = process.env.COROSIM_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean);
  const srv = startHttp({ port, host: process.env.HOST ?? "127.0.0.1", allowedOrigins: origins, dataDir: process.env.COROSIM_DATA_DIR });
  const stop = () => { void srv.close().then(() => process.exit(0)); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
} else {
  buildServer().connect(new StdioServerTransport()).then(() => console.error("CoroSim MCP ready on stdio"));
}
