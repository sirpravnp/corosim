import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

/** Three front doors from two pages: the homepage at /, the simulator at /sim/, and the game at /game/, which is the
 *  simulator's page served there too (src/app.ts reads the path). Both subpages sit one level down, so the page's
 *  relative asset paths hold as it is; in development the game is rewritten to the simulator's page. */
const gamePage = (): Plugin => ({
  name: "game-page",
  enforce: "post",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (/^\/game\/?(index\.html)?(\?.*)?$/.test(req.url ?? "")) req.url = "/sim/index.html";
      next();
    });
  },
  closeBundle() {
    mkdirSync("dist/game", { recursive: true });
    writeFileSync("dist/game/index.html", readFileSync("dist/sim/index.html", "utf8"));
  },
});

// Relative asset paths so the built site works when published under any URL.
export default defineConfig({
  base: "./",
  plugins: [gamePage()],
  // No module-preload polyfill: with two pages sharing style.css it would become a third chunk both bundles import,
  // which scripts/prepare-publish.mjs (one script beside one page) could not carry.
  build: { modulePreload: { polyfill: false }, rollupOptions: { input: { home: "index.html", sim: "sim/index.html" } } },
  test: { include: ["tests/**/*.test.ts"] },
});
