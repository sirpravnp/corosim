import { defineConfig, Plugin } from "vite";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

/** The game lives at /game/: the same page, served there too, so every relative file it names (the bundle, the logo, the
 *  favicon) is one level up. In development Vite's SPA fallback already does this. */
const gamePage = (): Plugin => ({
  name: "game-page",
  enforce: "post",
  closeBundle() {
    const html = readFileSync("dist/index.html", "utf8").replace(/"\.\/(assets\/|logo\.png"|favicon\.png")/g, '"../$1');
    mkdirSync("dist/game", { recursive: true });
    writeFileSync("dist/game/index.html", html);
  },
});

// Relative asset paths so the built page works when published under any URL.
export default defineConfig({ base: "./", plugins: [gamePage()] });
