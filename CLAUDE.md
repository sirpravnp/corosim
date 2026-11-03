# CoroSim

Educational cardiovascular simulator. Visual system: see [DESIGN.md](DESIGN.md). Read it before changing any UI.

## UI rules (apply to new and edited UI)

- Square hairline frames. No `border-radius` above 2px on new frames, cards or buttons.
- No `backdrop-filter`, glass or blurred surfaces. Solid surfaces only.
- No tinted callout boxes (colored background plus colored border). Use an inline label and a hairline rule.
- No card around every region. One dominant stage per screen; other content is unboxed and divided by hairlines.
- Tracked uppercase labels are for one role only. Use sentence case elsewhere.
- No fonts outside the design system's pairing. No new accent hues; draw data graphics from the thermal ramp.
- Color means physiology. Red, blue and amber are for abnormal, cold and caution states only.
- No gradient text, glow shadows, emoji or icon bullets.
- The ECG stays on pink paper in both themes.
- Caption every figure and table ("Figure N.", "Table N.").

## Language

- American English everywhere: UI copy, docs, comments and commit messages (color, center, liters, maneuver, favors, gray, ischemia, hemodynamics, labeled, visualize).

## Direction

- The home page's thermogram is the visual theme for the whole site. The working tabs move toward it; nothing new should drift toward a generic dark dashboard.

The Impeccable design hook is on for this project (`.impeccable/config.json`). Treat its findings as real unless you can name why they are a false positive.
