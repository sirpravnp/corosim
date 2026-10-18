import { readFileSync, writeFileSync } from "node:fs";
const d = readFileSync(new URL("data.json", import.meta.url), "utf8");
const hj = readFileSync(new URL("data/heart.json", import.meta.url), "utf8");
const hb = readFileSync(new URL("data/heart.bin.gz", import.meta.url)).toString("base64");
let t = readFileSync(new URL("template.html", import.meta.url), "utf8");
t = t.replace("/*DATA*/null", () => d).replace("/*HEART_JSON*/null", () => hj).replace("/*HEART_B64*/", () => hb);
writeFileSync(new URL("index.html", import.meta.url), t);
