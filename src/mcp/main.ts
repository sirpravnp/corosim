import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, startHttp } from "./server";

// stdio (default, for Claude Desktop / Claude Code / any MCP client):   corosim-mcp
// Streamable HTTP + REST + OpenAPI:                                     corosim-mcp --http 8787   (binds 127.0.0.1; COROSIM_HOST to change)
const i = process.argv.indexOf("--http");
if (i >= 0) startHttp(Number(process.argv[i + 1]) || 8787, process.env.COROSIM_HOST ?? "127.0.0.1");
else buildServer().connect(new StdioServerTransport()).then(() => console.error("CoroSim MCP ready on stdio"));
