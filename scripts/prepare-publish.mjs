// Turns the Vite build into the shape the Artifact host expects:
// page content without <html>/<head>/<body> (the host adds its own skeleton), the stylesheet inlined,
// and the bundled app shipped beside the page as assets/app.js.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync } from "node:fs";

// The app is the simulator page, dist/sim/index.html (dist/index.html is the homepage); take the stylesheet and
// the script that page names, not everything in dist/assets, which the homepage shares.
const dist = "dist", out = "publish";
const html = readFileSync(`${dist}/sim/index.html`, "utf8");
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const named = (re) => [...html.matchAll(re)].map((m) => m[1].replace(/^(\.\.\/|\.\/)?assets\//, ""));
const assets = readdirSync(`${dist}/assets`);
const css = named(/<link[^>]+rel="stylesheet"[^>]+href="([^"]*assets\/[^"]+\.css)"/g).filter((f) => assets.includes(f)).map((f) => readFileSync(`${dist}/assets/${f}`, "utf8")).join("\n");
const js = named(/<script[^>]+src="([^"]*assets\/[^"]+\.js)"/g).filter((f) => assets.includes(f));
if (js.length !== 1) throw new Error(`expected one bundled script on the simulator page, found ${js.length}`);
const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
const fontLinks = (head.match(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g) ?? []).join("\n");

const page = [
  title,
  fontLinks,
  `<style>\n${css}\n</style>`,
  body.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "").trim(),
  `<script type="module" src="assets/app.js"></script>`,
].join("\n");

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/assets`, { recursive: true });
writeFileSync(`${out}/index.html`, page + "\n");
copyFileSync(`${dist}/assets/${js[0]}`, `${out}/assets/app.js`);
console.log(`publish/index.html ${(page.length / 1024).toFixed(1)} kB, assets/app.js ${(readFileSync(`${out}/assets/app.js`).length / 1024).toFixed(0)} kB`);
