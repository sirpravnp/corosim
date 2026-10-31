---
name: corosim-design
description: Strip generic AI-looking UI from CoroSim and keep pages on the site's own type and frames. Use when adding or restyling any page, especially Simbook, or when a layout grows pills, extra fonts, gradients, or card chrome.
---

# CoroSim design

The site is an instrument console. Before changing a page, read the comment at the top of `src/style.css` and the header rules in `src/shell/shell.css`. Match those. Do not invent a second visual system.

## Type

- UI text is Helvetica Neue, Helvetica, Arial (`--font-ui` in `src/style.css`). Do not load Inter, Geist, IBM Plex Sans, or any other display face.
- Numbers and traces use IBM Plex Mono (`--font-data`). That is the only extra face.
- Sentence case. Letter-spacing stays 0 on labels and buttons. Do not track out section titles.

## Frames

- Reuse the tokens in `src/style.css`: scan-room black, bone ink, hairline `--sh-line`, brick `--accent` with white ink, blue `--down` only for physiology.
- Square hairline frames. Controls may use the existing 8px radius. Do not add 16px cards, glass, blur, radial glows, or drop shadows.
- One primary action uses the accent fill. Everything else is a hairline button on `--panel`.

## What to remove

If a page has pill steppers, numbered badges, radio-card answers, "Live model" labels, a gradient page background, or a font that is not Helvetica or Plex Mono, take them out and match the cath lab and the simulator console.
