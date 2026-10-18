import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The in-chat viewer: one self-contained HTML file (scripts and styles inlined), because MCP App hosts render it in a
// sandbox with no network access. The MCP server serves dist-viewer/index.html as ui://corosim/viewer.html.
export default defineConfig({
  root: "src/viewer",
  base: "./",
  plugins: [viteSingleFile()],
  build: { outDir: "../../dist-viewer", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
