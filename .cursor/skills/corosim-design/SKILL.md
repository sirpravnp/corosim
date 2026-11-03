---
name: corosim-design
description: Strip generic AI-looking UI from CoroSim and keep pages on the site's own type and frames. Use when adding or restyling any page, especially Simbook, or when a layout grows pills, extra fonts, gradients, or card chrome.
---

# CoroSim design

The site is an instrument console. Before changing a page, read `DESIGN.md`, `CLAUDE.md`, the comment at the top of `src/style.css`, and the header rules in `src/shell/shell.css`. Match those. Do not invent a second visual system.

## Type

- UI text is Hanken Grotesk (`--font-ui`). Do not load Inter, Geist, IBM Plex Sans, or any other display face.
- Numbers and traces use JetBrains Mono (`--font-data`). Live measurement digits use Doto (`--font-readout`) via `src/readout.ts`.
- Sentence case. Letter-spacing stays 0 on labels and buttons. Tracked uppercase is for one role only.

## Frames

- Reuse the tokens in `src/style.css`: scan-room black, bone ink, hairline `--sh-line`, brick `--accent` with white ink, blue `--down` and amber `--warn` only for physiology.
- Square hairline frames on new work (radius ≤ 2px / `--sh-radius`). Do not add 8–16px cards, glass, blur, radial page glows, or drop shadows.
- One primary action uses the accent fill. Everything else is a hairline button on `--panel`.
- Caption every figure and table ("Figure N.", "Table N.").

## What to remove

If a page has pill steppers, numbered badges, radio-card answers, "Live model" labels, a gradient page background, tinted callout boxes, or a font that is not Hanken Grotesk, JetBrains Mono, or Doto, take them out and match the cath lab and the simulator console.
