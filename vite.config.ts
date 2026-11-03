import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

/** Front doors: homepage, simulator, EKG, cath, structural, echo, Simbook, the cases landing at /cases/, and a case
 *  being played at /case/ (the simulator page served there too; src/page/connect.ts reads the path). Subpages sit one
 *  level down so relative asset paths hold; in development /case/ is rewritten to the simulator's page. */
const casePage = (): Plugin => ({
  name: "case-page",
  enforce: "post",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (/^\/case\/?(index\.html)?(\?.*)?$/.test(req.url ?? "")) req.url = "/sim/index.html";
      next();
    });
  },
  closeBundle() {
    mkdirSync("dist/case", { recursive: true });
    writeFileSync("dist/case/index.html", readFileSync("dist/sim/index.html", "utf8"));
  },
});

// Relative asset paths so the built site works when published under any URL.
export default defineConfig({
  base: "./",
  plugins: [casePage()],
  // No module-preload polyfill: with two pages sharing style.css it would become a third chunk both bundles import,
  // which scripts/prepare-publish.mjs (one script beside one page) could not carry.
  build: { modulePreload: { polyfill: false }, rollupOptions: { input: { home: "index.html", sim: "sim/index.html", ekg: "ekg/index.html", cath: "cath/index.html", structural: "structural/index.html", echo: "echo/index.html", cases: "cases/index.html", simbook: "simbook/index.html" } } },
  test: { include: ["tests/**/*.test.ts"] },
});
