import "../shell/shell.css";
import "./lipids.css";
import { mountShell } from "../shell/shell";
import { LEGEND, PAIRS, svgG } from "./glyphs";
import { DRUG_TABLE } from "./drugTable";
import { LipidModel } from "./model";
import { mountStage } from "./stage";
import { mountDeck } from "./deck";

/**
 * The lipid lab: lipoprotein metabolism as a live stage (whole body plus five organ views on one model), the lipoprotein card
 * deck, the drug reference and the full glyph set.
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

mountShell({ page: "lipids", root: "../", share: false });
mountStage(new LipidModel());
mountDeck($("lp-deck"), $("lp-track"), $("lp-count"), $<HTMLButtonElement>("lp-prev"), $<HTMLButtonElement>("lp-next"));

$("lp-drugtable").innerHTML = DRUG_TABLE.map(([n, cls, tgt, mech, ldl, tg, lpa, st]) => {
  const inv = st === "inv";
  return `<tr><td${inv ? ' class="inv-name"' : ""}>${svgG(cls, "gsm")}${n}</td><td>${svgG(tgt, "gsm")}</td><td>${mech}</td><td class="num">${ldl}</td><td class="num">${tg}</td><td class="num">${lpa}</td><td>${inv ? '<span class="inv">inv</span>' : st}</td></tr>`;
}).join("");

$("lp-glyphs").innerHTML = LEGEND.map(([h, rows]) => `<div><h3>${h}</h3>${rows.map(([id, n, d]) => `<div class="gl">${svgG(id)}<div><div class="n">${n}</div><div class="d">${d}</div></div></div>`).join("")}</div>`).join("");
$("lp-pairs").innerHTML = PAIRS.map(([a, b, t]) => `<span class="pair">${svgG(a)}${svgG(b)}${t}</span>`).join("");
