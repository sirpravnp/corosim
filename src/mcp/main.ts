import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join } from "node:path";
import { buildServer, startHttp } from "./server";

// Local, no account (Claude Desktop / Claude Code / any local MCP client), one patient:   corosim-mcp
// Hosted, with accounts:                                                                  corosim-mcp --http [port]
//   PORT, HOST                     listen address (HOST=0.0.0.0 in a container)
//   COROSIM_PUBLIC_URL             public base, the OAuth issuer, e.g. https://mcp.corosim.com
//   COROSIM_APP_URL                the simulator page that share links open (default https://corosim.com/sim/)
//   COROSIM_DATA_DIR / COROSIM_DB  where the SQLite database lives (default $COROSIM_DATA_DIR/corosim.db)
//   GITHUB_CLIENT_ID/_SECRET, GOOGLE_CLIENT_ID/_SECRET   sign-in providers (each optional)
//   COROSIM_DEV_LOGIN=1            development sign-in, honoured only when the public URL is localhost
//   COROSIM_ALLOWED_ORIGINS        comma-separated site origins (default corosim.com, www.corosim.com, localhost)
//   COROSIM_CALLS_PER_DAY          per-account daily allowance (default 2000)
//   COROSIM_TRUST_PROXY=1          take client addresses from the proxy's header (set on Fly)
const env = process.env;
const i = process.argv.indexOf("--http");
if (i >= 0) {
  const port = Number(process.argv[i + 1]) || Number(env.PORT) || 8787;
  const keys = (p: string) => (env[`${p}_CLIENT_ID`] && env[`${p}_CLIENT_SECRET`] ? { clientId: env[`${p}_CLIENT_ID`]!, clientSecret: env[`${p}_CLIENT_SECRET`]! } : undefined);
  const srv = startHttp({
    port, host: env.HOST ?? "127.0.0.1",
    publicUrl: env.COROSIM_PUBLIC_URL,
    dbFile: env.COROSIM_DB ?? (env.COROSIM_DATA_DIR ? join(env.COROSIM_DATA_DIR, "corosim.db") : undefined),
    github: keys("GITHUB"), google: keys("GOOGLE"), devLogin: env.COROSIM_DEV_LOGIN === "1",
    allowedOrigins: env.COROSIM_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean),
    callsPerDay: Number(env.COROSIM_CALLS_PER_DAY) || undefined,
    trustProxy: env.COROSIM_TRUST_PROXY === "1",
  });
  const stop = () => { void srv.close().then(() => process.exit(0)); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
} else {
  buildServer().connect(new StdioServerTransport()).then(() => console.error("CoroSim MCP ready on stdio"));
}
