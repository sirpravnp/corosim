import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { TOOLS } from "../mcp/tools";

// Development only: plays the part of Claude for the EKG viewer. Embeds the page, completes the MCP Apps handshake,
// then sends a real corosim_ekg_show result (?preset=…&quiz=1 to choose) computed by the server's own tool code.
const log = (m: string) => { document.getElementById("log")!.textContent += `\n${m}`; };
const q = new URLSearchParams(location.search);
const iframe = document.getElementById("view") as HTMLIFrameElement;
iframe.addEventListener("load", async () => {
  const bridge = new AppBridge(null, { name: "test-host", version: "1" }, { openLinks: {} });
  bridge.setHostContext({ theme: "dark", displayMode: "inline", availableDisplayModes: ["inline"] });
  bridge.oninitialized = async () => {
    log("host: view initialized");
    const tool = TOOLS.find((t) => t.name === "corosim_ekg_show")!;
    const result = tool.run({ sim: undefined as never, appUrl: "https://corosim.com" }, { preset: q.get("preset") ?? "de winter", quiz: q.has("quiz") }) as Record<string, unknown>;
    await bridge.sendToolResult({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    log(`host: sent corosim_ekg_show (${JSON.stringify(result.ekg)})`);
    (window as unknown as { hostDone: boolean }).hostDone = true;
  };
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  log("host: bridge connected");
});
