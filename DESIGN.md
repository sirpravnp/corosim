---
name: CoroSim
description: The future of cardiac simulation. A scan-room instrument console for learning the heart, with a thermogram front door.
colors:
  room: "#05060a"
  console: "#0b0d14"
  stage: "#000000"
  bone: "#f4f1ea"
  muted-steel: "#98a0b8"
  hairline: "#2b2f45"
  brick: "#b8372e"
  amber-warn: "#e0a447"
  flare-bad: "#ff6b5e"
  cold-down: "#3d8bff"
  light-bone: "#eeece6"
  light-console: "#f7f5f0"
  light-ink: "#05060a"
typography:
  display:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(48px, 9vw, 104px)"
    fontWeight: 700
    lineHeight: 0.92
    letterSpacing: "-0.045em"
  body:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Hanken Grotesk, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.12em"
  data:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
  readout:
    fontFamily: "Doto, JetBrains Mono, ui-monospace, monospace"
    fontSize: "26px"
    fontWeight: 700
rounded:
  none: "0"
  tool: "8px"
  shell: "10px"
spacing:
  xs: "8px"
  sm: "14px"
  md: "20px"
  lg: "24px"
components:
  door:
    backgroundColor: "rgba(0,0,0,0.62)"
    textColor: "{colors.bone}"
    rounded: "{rounded.none}"
    padding: "15px 16px"
  door-hover:
    backgroundColor: "{colors.bone}"
    textColor: "{colors.room}"
  tool-panel:
    backgroundColor: "{colors.console}"
    textColor: "{colors.bone}"
    rounded: "{rounded.tool}"
    padding: "14px"
  button-fill:
    backgroundColor: "{colors.brick}"
    textColor: "#ffffff"
    rounded: "{rounded.tool}"
---

# Design System: CoroSim

## Overview

**Creative North Star: "The Scan Room"**

The room is dark so the display can be bright. CoroSim is a working instrument first and a website second: black and bone, one hot-spot color, and a heart drawn the way a thermal camera sees it. The name comes from the project's own opening comment in `style.css` ("scan-room black and bone"), and this document keeps that thesis rather than inventing a new one.

The system has two registers that must stay in one family. The **front door** (home) is the thermogram: a full-bleed stippled heart on black, a 104px wordmark, hairline frames, and the thermal ramp as the only color. The **workbench** (/sim, /cath, /structural, /echo, /lipids) is a console: a stage for the 3D heart or the probe view, with readouts and controls beside it. Everything on screen should look like it belongs to equipment, not to a SaaS dashboard. The ECG is always drawn on real pink paper, in dark and light themes alike.

**Decision (confirmed by the owner):** the home page's thermogram theme is the theme for the whole site. The workbench tabs are to be brought into it, not the other way round. All copy is American English.

**Key Characteristics:**
- Black room, bone ink, one earned accent. Red and blue appear only where physiology goes wrong or cold.
- Square hairline frames on the front door. The workbench currently uses 8–10px radii (see Known drift).
- Hanken Grotesk for what people read, JetBrains Mono for units and data, Doto for live numbers.
- Figures are captioned like a textbook ("Figure 1.", "Table 1.").
- Dark is the default theme; light is bone paper, not white.

## Colors

A near-monochrome palette. Color carries physiology, not decoration.

### Primary
- **Brick** (#b8372e): the one UI accent. Fills only (primary buttons, selected states), always with white text. Never text on dark.

### Secondary
- **Amber Warn** (#e0a447; light theme #8a5a00): caution states and warnings.
- **Flare** (#ff6b5e; light theme #d1121b): abnormal and dangerous values.
- **Cold Down** (#3d8bff; light theme #1b3fd8): ST depression and downward deviations.

### Neutral
- **Room** (#05060a): page background.
- **Console** (#0b0d14): panel and card surfaces.
- **Stage** (#000000): behind the 3D heart; also the full home background.
- **Bone** (#f4f1ea): primary ink on dark.
- **Muted Steel** (#98a0b8): secondary text and labels.
- **Hairline** (#2b2f45): 1px borders and dividers.
- **Light Bone** (#eeece6) / **Light Console** (#f7f5f0) / **Light Ink** (#05060a): the light theme.

### Named Rules
**The Physiology-Only Color Rule.** Red, blue and amber mean something clinical. If a color appears for decoration, remove it.

**The Thermal Ramp Rule.** The home page's heat ramp (cool muscle to hot vessels) is the product's signature palette. New data visualization should be drawn from it before any new hue is introduced.

## Typography

**Display and Body Font:** Hanken Grotesk (Helvetica Neue, Helvetica, Arial fallback), light weights for headings
**Data Font:** JetBrains Mono (ui-monospace, Menlo fallback)
**Readout Font:** Doto, a dot-matrix face, for live numbers only

**Character:** A quiet neo-grotesque, a technical mono, and a dot-matrix screen face. This is the pairing used by hardware makers: a plain text face plus the product's own display font. The Doto digits echo the stippled heart. The fonts load from Google Fonts for now; self-host before launch.

### Hierarchy
- **Display** (700, clamp(48px, 9vw, 104px), 0.92, -0.045em): the CoroSim wordmark only.
- **Body** (400, 15px, 1.5): descriptions and teaching copy. Keep lines to 65–75ch.
- **Label** (700, 11px, 0.12em, uppercase): section tags, door buttons, "Did you know". Currently used on too many roles.
- **Data** (400/500 JetBrains Mono, 12–13px): units, legends, axis labels, table values.
- **Readout** (700 Doto, 22–26px): the number in a measurement tile (heart rate, pressure, saturation). Units go beside it in the data face. Never use Doto for text or for numbers under 20px.

### Named Rules
**The One Label Voice Rule.** Tracked uppercase belongs to one role. Where it is used for everything, it stops meaning anything.

## Layout

Home is a full-viewport overlay on a fixed canvas: header top-left, fact card top-right, doors bottom-left, legend bottom-right on desktop; a single stacked column on phones. The workbench is a two-column grid: a flexible left column (3D heart, 12-lead) and a 360px right rail of readouts and controls, collapsing to one column at 980px. Every page's content shell (simulator body, EKG/cath/structural/echo/lipids `.app`, home header gutters) is capped at 1680px with 20px side gutters so wide screens are not empty margins around a squeezed stage. Spacing rhythm is 8 / 14 / 20 / 24px.

## Elevation & Depth

Flat. Depth comes from tonal layering (room, console, stage) and 1px hairlines, not shadows. The only blur is `backdrop-filter: blur(6px)` on home cards, which is the one place the system leaves flat and the first thing to remove.

## Shapes

Home is square: doors, fact card and legend have no radius. The workbench is soft: figures, buttons, side sections and the viewport use 8px; the shell header uses 10px. This split is the system's central inconsistency (see Known drift).

## Components

### Doors (home)
- **Shape:** square, 1px hairline (0)
- **Style:** dark glass (rgba(0,0,0,0.62)) with bone text, uppercase 12–13px bold, a trailing arrow.
- **Hover:** full inversion to bone fill with room-black text.

### Panels and figures (workbench)
- **Corner Style:** 8px
- **Background:** Console (#0b0d14), 1px hairline border
- **Captions:** "Figure N." in a quiet caption voice. Keep this; it is the best teaching device in the product.

### Buttons
- **Primary:** Brick fill, white text, 8px radius.
- **Secondary:** hairline outline, bone text.

### ECG paper
- Always real pink paper, in both themes. Never restyle it to match the UI.

### Connect AI control (shell header)
- A pill with a status dot, shared by every page.

## Do's and Don'ts

### Do:
- **Do** keep the heart or probe view as the dominant element of every working screen.
- **Do** draw new data graphics from the thermal ramp first.
- **Do** set measurement values in Doto with the unit in the mono face beside them.
- **Do** keep light theme as bone paper (#eeece6), never pure white.
- **Do** caption every figure and table.

### Don't:
- **Don't** add card chrome around everything. One stage, then quiet hairline-divided sections.
- **Don't** use `backdrop-filter` or glass. Use solid surfaces.
- **Don't** add tinted callout boxes (`#warn`, auscultation notes, tooltips with accent borders). Use an inline label and a rule.
- **Don't** add rounded corners above 2px to new frames. The system's stated thesis is square hairline frames.
- **Don't** introduce a font outside Hanken Grotesk, JetBrains Mono and Doto, or a new accent hue.
- **Don't** use uppercase tracked labels as the default text style.

## Known drift (to resolve in the redesign)

- `style.css` says "square hairline frames", but figures, buttons, sections and the viewport use 8px radii, and the shell uses 10px.
- Home uses uppercase tracking and square frames; the tools use sentence case and rounded frames.
- Fonts load from Google Fonts at runtime, not self-hosted, and canvas text falls back to system fonts until they load.
