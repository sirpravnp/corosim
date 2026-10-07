import { defineConfig, Plugin } from "vite";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

/** The game lives at /game/: the same page, served there too. In development Vite's SPA fallback already does this. */
const gamePage = (): Plugin => ({
  name: "game-page",
  enforce: "post",
  closeBundle() {
    const html = readFileSync("dist/index.html", "utf8").replaceAll('"./assets/', '"../assets/');
    mkdirSync("dist/game", { recursive: true });
    writeFileSync("dist/game/index.html", html);
  },
});

// Relative asset paths so the built page works when published under any URL.
export default defineConfig({ base: "./", plugins: [gamePage()] });
