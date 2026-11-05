import { bestWindowPose } from "../../src/echo/window";

/** Prints the window-first poses in the form `WINDOW_POSES` in src/echo/poses.ts stores them. Run: npx tsx scripts/echo/windowPoses.ts */
const r = (v: number[], d: number) => `[${v.map((x) => +x.toFixed(d)).join(", ")}]`;
for (const id of ["plax", "subcostal"] as const) {
  const b = bestWindowPose(id);
  if (!b) { console.log(`${id}: no pose inside its window`); continue; }
  console.log(`// ${id}: score ${b.score.toFixed(3)}, ${b.tried} candidates`);
  console.log(`  ${id}: { probe: ${r(b.pose.probe, 3)}, beam: ${r(b.pose.beam, 6)}, lateral: ${r(b.pose.lateral, 6)}, target: ${r(b.pose.target, 3)} },`);
}
