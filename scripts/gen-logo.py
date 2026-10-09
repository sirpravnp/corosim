"""Generate the engraving-style anatomical heart logo. Usage: python3 scripts/gen-logo.py public/logo.svg"""
import math, random, sys

INK = "#2b4480"
CREAM = "#f3e9d6"
random.seed(7)

out = []
def tree(x, y, ang, length, width, depth, spread=32, jitter=12):
    """Recursive branching vessel. ang in degrees, 0 = right, 90 = down."""
    if depth == 0 or width < 1.1:
        return
    a = math.radians(ang)
    # slight curve: control point offset perpendicular to direction
    ex, ey = x + math.cos(a) * length, y + math.sin(a) * length
    cx = (x + ex) / 2 - math.sin(a) * length * random.uniform(-0.18, 0.18)
    cy = (y + ey) / 2 + math.cos(a) * length * random.uniform(-0.18, 0.18)
    out.append(f'<path d="M{x:.1f} {y:.1f} Q{cx:.1f} {cy:.1f} {ex:.1f} {ey:.1f}" stroke-width="{width:.1f}"/>')
    n = 2 if depth > 1 else 1
    for i in range(n):
        s = spread * (1 if i == 0 else -1) + random.uniform(-jitter, jitter)
        tree(ex, ey, ang + s, length * random.uniform(0.6, 0.78), width * 0.66, depth - 1, spread, jitter)
    if depth > 2 and random.random() < 0.5:  # extra side twig
        s = random.choice([-1, 1]) * random.uniform(45, 70)
        tree(x + (ex - x) * 0.55, y + (ey - y) * 0.55, ang + s, length * 0.45, width * 0.5, depth - 2, spread, jitter)

def vessel(d, w):
    """A tube shaded like an engraved cylinder: ink outline, soft dark rim, light core, faint hatch."""
    return (f'<path d="{d}" stroke="{INK}" stroke-width="{w+5}"/>'
            f'<path d="{d}" stroke="{CREAM}" stroke-width="{w}"/>'
            f'<path d="{d}" stroke="{INK}" stroke-width="{w}" opacity="0.38"/>'
            f'<path d="{d}" stroke="{CREAM}" stroke-width="{w-7}"/>'
            f'<path d="{d}" stroke="url(#hatchInk)" stroke-width="{w-7}" opacity="0.5"/>')

body = ("M192 246 C150 272 142 346 190 402 C222 440 276 466 326 456 "
        "C362 446 386 406 392 350 C398 302 390 266 370 248 C352 232 326 232 306 240 "
        "C288 228 256 222 232 228 C212 232 200 240 192 246 Z")

svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="CoroSim anatomical heart logo">',
 '<defs>',
 f'<pattern id="hatchInk" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><line x1="0" y1="0" x2="0" y2="6" stroke="{INK}" stroke-width="1.1" opacity="0.75"/></pattern>',
 f'<pattern id="hatchCream" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-40)"><line x1="0" y1="0" x2="0" y2="5" stroke="{CREAM}" stroke-width="1.3"/></pattern>',
 '<linearGradient id="shade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="0.55" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#000"/></linearGradient>',
 f'<mask id="highlight"><path d="{body}" fill="url(#shade)"/></mask>',
 f'<clipPath id="bodyClip"><path d="{body}"/></clipPath>',
 '</defs>',
 f'<rect width="512" height="512" fill="{CREAM}"/>',
 ]

# --- pulmonary artery trees (behind everything) ---
out.clear()
tree(168, 202, 188, 50, 11, 5, spread=38)   # right PA (viewer's left)
tree(372, 222, -6, 48, 10, 5, spread=38)    # left PA (viewer's right)
svg.append(f'<g fill="none" stroke="{INK}" stroke-linecap="round">{"".join(out)}</g>')

svg.append('<g fill="none" stroke-linecap="butt">')
# pulmonary arteries run behind the SVC and the aorta
svg.append(vessel("M232 194 C290 186 340 206 374 222", 20))   # left PA
svg.append(vessel("M232 194 C212 196 190 200 166 202", 20))   # right PA
# superior vena cava: solid dark tube with cream hatch
svc = "M204 246 L204 150"
svg.append(f'<path d="{svc}" stroke="{INK}" stroke-width="34" stroke-linecap="round"/>')
svg.append(f'<path d="{svc}" stroke="url(#hatchCream)" stroke-width="22" stroke-linecap="round"/>')
# aorta: ascending, wide arch, descending behind the heart
svg.append(vessel("M300 246 C298 196 318 146 354 142 C384 140 398 172 388 226", 32))
# arch branches
for x, dx in ((338, -8), (356, -2), (374, 6)):
    svg.append(vessel(f"M{x} 150 L{x+dx} 106", 12))
# pulmonary trunk in front of the aortic root
svg.append(vessel("M256 250 C254 226 246 206 232 194", 30))
svg.append('</g>')

# --- heart body: solid ink, highlight hatching masked toward the upper left ---
svg.append(f'<path d="{body}" fill="{INK}"/>')
svg.append(f'<path d="{body}" fill="url(#hatchCream)" mask="url(#highlight)"/>')
svg.append(f'<path d="{body}" fill="none" stroke="{INK}" stroke-width="3"/>')

# --- coronary arteries in cream on the body ---
out.clear()
tree(292, 262, 98, 46, 4.5, 6, spread=22, jitter=8)    # LAD
tree(238, 256, 116, 40, 3.5, 5, spread=26, jitter=8)   # RCA
tree(330, 256, 48, 34, 3.2, 4, spread=26, jitter=8)    # circumflex
svg.append(f'<g fill="none" stroke="{CREAM}" stroke-linecap="round" clip-path="url(#bodyClip)">{"".join(out)}</g>')

svg.append('</svg>')
open(sys.argv[1], "w").write("\n".join(svg) + "\n")
