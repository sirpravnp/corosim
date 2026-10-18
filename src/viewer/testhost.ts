import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Simulation } from "../sim/simulation";
import { TOOLS } from "../mcp/tools";

// Development only: plays the part of Claude. Embeds the viewer, completes the MCP Apps handshake, then sends it a
// real corosim_set_scenario result computed by the server's own tool code.
const log = (m: string) => { document.getElementById("log")!.textContent += `\n${m}`; };
const iframe = document.getElementById("view") as HTMLIFrameElement;
iframe.addEventListener("load", async () => {
  const bridge = new AppBridge(null, { name: "test-host", version: "1" }, { openLinks: {} });
  bridge.setHostContext({ theme: "dark", displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] });
  bridge.oninitialized = async () => {
    log("host: view initialized");
    const sim = new Simulation();
    const tool = TOOLS.find((t) => t.name === "corosim_set_scenario")!;
    const result = tool.run({ sim, appUrl: "https://corosim.com" }, { scenario: { lesions: [{ artery: "RCA", occluded: true, position: 0.1 }] }, warmupSeconds: 20 }) as Record<string, unknown>;
    await bridge.sendToolResult({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    log("host: sent corosim_set_scenario result (proximal RCA occlusion)");
    (window as unknown as { hostDone: boolean }).hostDone = true;
  };
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  log("host: bridge connected");
});
