import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The EKG page as an in-chat viewer: one self-contained HTML file, served by the MCP server as ui://corosim/ekg.html
// with corosim_ekg_show. Same page as /ekg/; it notices it is embedded and drops the masthead and library.
export default defineConfig({
  root: "ekg",
  base: "./",
  publicDir: false,
  plugins: [viteSingleFile()],
  build: { outDir: "../dist-ekg-viewer", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
