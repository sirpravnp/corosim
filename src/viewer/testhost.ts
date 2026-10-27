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
    const call = (name: string, args: Record<string, unknown>) => TOOLS.find((t) => t.name === name)!.run({ sim, appUrl: "https://corosim.com/sim/" }, args) as Record<string, unknown>;
    // ?case=vf (arrest with CPR), valve (lesions and a prosthesis, display options) or the default RCA occlusion
    const which = new URLSearchParams(location.search).get("case");
    let result: Record<string, unknown>;
    if (which === "vf") {
      call("corosim_set_scenario", { engine: "core", scenario: {}, warmupSeconds: 8 });
      call("corosim_adjust", { patch: { patient: { rhythm: "vf-coarse" } }, runSeconds: 20 });
      call("corosim_arrest", { action: "cpr", on: true, runSeconds: 15 });
      result = call("corosim_show", { display: { labels: true, mode: "anat" } });
    } else if (which === "valve") {
      call("corosim_set_scenario", { engine: "core", scenario: { heart: { valves: { av: { open: 0.3 }, mv: { prosthesis: { kind: "mechanical", sizeMm: 29 } } } } }, warmupSeconds: 15 });
      result = call("corosim_show", { display: { mode: "isch", heart: "ghost", valves: true } });
    } else {
      result = call("corosim_set_scenario", { scenario: { lesions: [{ artery: "RCA", occluded: true, position: 0.1 }] }, warmupSeconds: 20 });
    }
    await bridge.sendToolResult({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
    log(`host: sent the ${which ?? "RCA occlusion"} result`);
    (window as unknown as { hostDone: boolean }).hostDone = true;
  };
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  log("host: bridge connected");
});
