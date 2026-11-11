/**
 * Bake peripheral vascular centerlines into src/cath/data/peripheral.json.
 *
 * Reproducible and offline: when BodyParts3D / Commons meshes are not available
 * under scripts/cath/work/, segments are hand-defined from Gray's plates and the
 * DSA reference class (see docs/CATH_PERIPHERAL_SOURCES.md) and marked origin "assumed".
 *
 * Run: npx tsx scripts/cath/peripheral/bake.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type V3 = [number, number, number];
type Seg = {
  id: string;
  parent: string | null;
  points: V3[];
  radiusMm: number[];
  origin: string;
  checkedAgainst: string;
};

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "../../..");
const outPath = join(root, "src/cath/data/peripheral.json");

/** Patient frame (same as src/lab/access.ts BODY). */
const BODY = {
  midlineX: -10,
  puncture: [-82, -505, 16] as V3,
  inguinal: [-76, -398, -4] as V3,
  bifurcation: [-8, -255, -40] as V3,
  hiatus: [-4, -112, -50] as V3,
  sinus: [8, 44, 18] as V3,
};

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a: V3, b: V3, w: number): V3 => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w];
const mirror = (p: V3): V3 => [2 * BODY.midlineX - p[0], p[1], p[2]];
const off = (p: V3, dx: number, dy: number, dz: number): V3 => [p[0] + dx, p[1] + dy, p[2] + dz];

const resample = (ctrl: V3[], spacing = 2): V3[] => {
  if (ctrl.length < 2) return ctrl;
  const out: V3[] = [ctrl[0]!];
  let carry = 0;
  for (let i = 1; i < ctrl.length; i++) {
    const a = ctrl[i - 1]!, b = ctrl[i]!;
    const L = dist(a, b);
    let t = spacing - carry;
    while (t < L - 1e-6) {
      out.push(lerp(a, b, t / L));
      t += spacing;
    }
    carry = L - (t - spacing);
  }
  const last = ctrl[ctrl.length - 1]!;
  if (dist(out[out.length - 1]!, last) > 0.5) out.push(last);
  return out;
};

const radii = (n: number, r0: number, r1: number): number[] =>
  Array.from({ length: n }, (_, i) => r0 + (r1 - r0) * (n <= 1 ? 0 : i / (n - 1)));

const assumed = (id: string, parent: string | null, ctrl: V3[], r0: number, r1: number, checkedAgainst: string): Seg => {
  const points = resample(ctrl, 2);
  return {
    id, parent, points, radiusMm: radii(points.length, r0, r1),
    origin: "assumed",
    checkedAgainst,
  };
};

const build = (): Seg[] => {
  const { midlineX, puncture, inguinal, bifurcation, hiatus, sinus } = BODY;
  const segs: Seg[] = [];

  // Aorta: thoracic descending → abdominal → arch (separate for camera presets).
  const thorEnd: V3 = [midlineX + 21, sinus[1] + 28, -52];
  segs.push(assumed("AORTA_THOR", null,
    [[midlineX + 12, -50, -52], [midlineX + 17, 0, -54], [midlineX + 21, 40, -54], thorEnd],
    12, 11, "Gray505.png"));
  const thor = segs[segs.length - 1]!;

  segs.push(assumed("AORTA_ABD", "AORTA_THOR",
    [thor.points[thor.points.length - 1]!, [midlineX + 4, -150, -50], [midlineX + 1, -205, -44], bifurcation],
    11, 9, "Leriche-Syndrom-DSA.jpg"));
  const abd = segs[segs.length - 1]!;
  const bif = abd.points[abd.points.length - 1]!;

  segs.push(assumed("ARCH", "AORTA_THOR",
    [
      thor.points[Math.floor(thor.points.length * 0.85)]!,
      [midlineX + 20, sinus[1] + 48, -50],
      [midlineX + 8, sinus[1] + 58, -34],
      [midlineX - 2, sinus[1] + 52, -22],
      lerp(sinus, [sinus[0] - 3, sinus[1] + 40, sinus[2] - 5], 0.3),
    ],
    13, 12, "Takayasu Arteritis.jpg"));

  for (const side of [1, -1] as const) {
    const R = side === 1;
    const tag = R ? "R" : "L";
    // Build every side in right-side coordinates, then mirror the finished left segments once. Mirroring each landmark as it
    // was built mirrored points that were derived from already-mirrored ones a second time, so the left leg and arm crossed the midline.
    const m = (p: V3): V3 => p;
    const lat = 1;
    const first = segs.length;

    // Iliacs from bifurcation.
    const ciaEnd = m(lerp(bifurcation, inguinal, 0.35));
    segs.push(assumed(`CIA_${tag}`, "AORTA_ABD",
      [bif, m(off(bifurcation, 6 * lat, -20, 2)), ciaEnd],
      7, 6.2, "PSA iliaca.jpg"));
    const cia = segs[segs.length - 1]!;

    const eiaEnd = m(inguinal);
    segs.push(assumed(`EIA_${tag}`, `CIA_${tag}`,
      [cia.points[cia.points.length - 1]!, m(off(inguinal, 4 * lat, 40, 6)), eiaEnd],
      6.2, 5.5, "AAA i AAIC.jpg"));
    const eia = segs[segs.length - 1]!;

    segs.push(assumed(`IIA_${tag}`, `CIA_${tag}`,
      [
        cia.points[Math.floor(cia.points.length * 0.7)]!,
        m(off(ciaEnd, 10 * lat, -20, -20)),
        m(off(ciaEnd, 16 * lat, -50, -40)),
      ],
      4.5, 2.5, "PSA iliaca.jpg"));

    // Femoral tree.
    const cfaEnd = m(puncture);
    segs.push(assumed(`CFA_${tag}`, `EIA_${tag}`,
      [eia.points[eia.points.length - 1]!, m(lerp(inguinal, puncture, 0.5)), cfaEnd],
      4.2, 3.8, "Femoral-artery-grays-illustrations.jpg"));
    const cfa = segs[segs.length - 1]!;

    segs.push(assumed(`PFA_${tag}`, `CFA_${tag}`,
      [
        cfa.points[Math.floor(cfa.points.length * 0.4)]!,
        m(off(puncture, 10 * lat, -40, -12)),
        m(off(puncture, 14 * lat, -90, -24)),
      ],
      3.2, 2.0, "Femoral artery.svg"));

    const sfaEnd = m(off(puncture, -2 * lat, -200, -10));
    segs.push(assumed(`SFA_${tag}`, `CFA_${tag}`,
      [cfa.points[cfa.points.length - 1]!, m(off(puncture, -2 * lat, -100, -6)), sfaEnd],
      3.2, 2.8, "Multiple nearly occlusion of left superficial femoral artery and stented.jpg"));
    const sfa = segs[segs.length - 1]!;

    const popEnd = m(off(sfaEnd, 0, -80, -8));
    segs.push(assumed(`POP_${tag}`, `SFA_${tag}`,
      [sfa.points[sfa.points.length - 1]!, m(off(sfaEnd, 2 * lat, -40, -4)), popEnd],
      2.6, 2.3, "Neutral popliteal artery angiogram.png"));
    const pop = segs[segs.length - 1]!;

    segs.push(assumed(`ATA_${tag}`, `POP_${tag}`,
      [pop.points[pop.points.length - 1]!, m(off(popEnd, 8 * lat, -70, 10)), m(off(popEnd, 10 * lat, -140, 18))],
      1.6, 1.2, "Angiography of the right foot with posterior tibial arteriosclerosis.jpg"));
    segs.push(assumed(`PTA_${tag}`, `POP_${tag}`,
      [pop.points[pop.points.length - 1]!, m(off(popEnd, -4 * lat, -80, -6)), m(off(popEnd, -6 * lat, -150, -8))],
      1.6, 1.2, "Angiography of the right foot with posterior tibial arteriosclerosis.jpg"));
    segs.push(assumed(`PERONEAL_${tag}`, `POP_${tag}`,
      [pop.points[pop.points.length - 1]!, m(off(popEnd, 2 * lat, -75, -2)), m(off(popEnd, 3 * lat, -130, 0))],
      1.4, 1.0, "M.Buerger 1.JPG"));
    const ata = segs.find((s) => s.id === `ATA_${tag}`)!;
    segs.push(assumed(`DP_${tag}`, `ATA_${tag}`,
      [ata.points[ata.points.length - 1]!, m(off(ata.points[ata.points.length - 1]!, 2 * lat, -30, 8))],
      1.1, 0.9, "Angiography of the right foot with posterior tibial arteriosclerosis.jpg"));

    // Upper limb.
    const yJ = sinus[1] + 70;
    const wrist = m([-635, -62, 12] as V3);
    const elbow = m([-320, 62, 11] as V3);
    const shoulder = m([-155, yJ - 36, 5] as V3);
    const joint = m([-48, yJ, 6] as V3);

    segs.push(assumed(`SUBCLAV_${tag}`, "ARCH",
      [joint, m([-80, yJ + 4, 8] as V3), m([-118, yJ - 14, 8] as V3), shoulder],
      5.0, 4.2, "Arteriografia de troncs supra-aòrtics. IMG 2507.JPG"));
    const sub = segs[segs.length - 1]!;

    segs.push(assumed(`AXILLARY_${tag}`, `SUBCLAV_${tag}`,
      [sub.points[sub.points.length - 1]!, m(lerp(shoulder, elbow, 0.25)), m(lerp(shoulder, elbow, 0.45))],
      4.0, 3.4, "Arteriografia de troncs supra-aòrtics. IMG 2507.JPG"));
    const ax = segs[segs.length - 1]!;

    segs.push(assumed(`BRACHIAL_${tag}`, `AXILLARY_${tag}`,
      [ax.points[ax.points.length - 1]!, m(lerp(shoulder, elbow, 0.7)), elbow],
      3.2, 2.6, "Radial artery catheterization.jpg"));
    const br = segs[segs.length - 1]!;

    segs.push(assumed(`RADIAL_${tag}`, `BRACHIAL_${tag}`,
      [br.points[br.points.length - 1]!, m(lerp(elbow, wrist, 0.5)), wrist],
      1.6, 1.2, "Radial artery catheterization.jpg"));
    segs.push(assumed(`ULNAR_${tag}`, `BRACHIAL_${tag}`,
      [br.points[br.points.length - 1]!, m(off(elbow, 12 * lat, -40, 4)), m(off(wrist, 18 * lat, 0, 2))],
      1.5, 1.1, "Ensemble des voies"));
    if (!R) {
      for (const sg of segs.slice(first)) sg.points = sg.points.map(mirror);
      segs[first]!.points[0] = bif; // the left common iliac still starts at the aortic bifurcation, which sits just off the midline
    }
  }

  // Carotid and vertebral origins off the arch.
  const arch = segs.find((s) => s.id === "ARCH")!;
  const archMid = arch.points[Math.floor(arch.points.length * 0.45)]!;
  segs.push(assumed("CCA_R", "ARCH",
    [archMid, off(archMid, -18, 40, 8), off(archMid, -22, 90, 12)],
    4.0, 3.2, "Arteriografia de troncs supra-aòrtics. IMG 2507.JPG"));
  segs.push(assumed("CCA_L", "ARCH",
    [arch.points[Math.floor(arch.points.length * 0.55)]!, off(archMid, 8, 45, 6), off(archMid, 10, 95, 10)],
    4.0, 3.2, "Arteriografia de troncs supra-aòrtics. IMG 2507.JPG"));
  const vertBaseR = segs.find((s) => s.id === "SUBCLAV_R")!.points[2]!;
  const vertBaseL = segs.find((s) => s.id === "SUBCLAV_L")!.points[2]!;
  segs.push(assumed("VERT_R", "SUBCLAV_R",
    [vertBaseR, off(vertBaseR, -6, 30, -8), off(vertBaseR, -4, 70, -12)],
    1.1, 0.8, "Gray506.png"));
  segs.push(assumed("VERT_L", "SUBCLAV_L",
    [vertBaseL, off(vertBaseL, 6, 30, -8), off(vertBaseL, 4, 70, -12)],
    1.1, 0.8, "Gray506.png"));

  void hiatus;
  return segs;
};

const segs = build();
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ segments: segs, bakedAt: "assumed-2026-11-10", spacingMm: 2 }, null, 2) + "\n");
console.log(`Wrote ${segs.length} segments to ${outPath}`);
