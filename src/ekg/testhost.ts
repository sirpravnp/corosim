import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { TOOLS } from "../mcp/tools";

// Development only: plays the part of Claude for the EKG viewer. Embeds the page, completes the MCP Apps handshake,
// then sends a real corosim_ekg_show result (?preset=… or ?custom={json}, &quiz=1) computed by the server's own tool code.
const log = (m: string) => { document.getElementById("log")!.textContent += `\n${m}`; };
const q = new URLSearchParams(location.search);
const iframe = document.getElementById("view") as HTMLIFrameElement;
iframe.addEventListener("load", async () => {
  const bridge = new AppBridge(null, { name: "test-host", version: "1" }, { openLinks: {} });
  bridge.oninitialized = async () => {
    log("host: view initialized");
    const tool = TOOLS.find((t) => t.name === "corosim_ekg_show")!;
    const result = tool.run({ sim: undefined as never, appUrl: "https://corosim.com" }, q.has("custom") ? { custom: JSON.parse(q.get("custom")!), quiz: q.has("quiz") } : { preset: q.get("preset") ?? "de winter", quiz: q.has("quiz") }) as Record<string, unknown>;
    await bridge.sendToolResult({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    log(`host: sent corosim_ekg_show (${JSON.stringify(result.ekg)})`);
    (window as unknown as { hostDone: boolean }).hostDone = true;
  };
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  bridge.setHostContext({ theme: "dark", displayMode: "inline", availableDisplayModes: ["inline"] }); // only once connected
  log("host: bridge connected");
});
