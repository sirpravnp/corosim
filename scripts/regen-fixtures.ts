// Regenerates the regression fixtures from the CURRENT engines. Run only when a change to the numbers is intended and reviewed:
//   npx tsx scripts/regen-fixtures.ts
// Never edit tests/fixtures/*.json by hand.
import { mkdirSync, writeFileSync } from "node:fs";
import { structuralFixtures, acsFixtures } from "../tests/fixtures/compute";

mkdirSync("tests/fixtures", { recursive: true });
const s = structuralFixtures(), a = acsFixtures();
writeFileSync("tests/fixtures/structural.json", JSON.stringify(s, null, 1) + "\n");
writeFileSync("tests/fixtures/acs.json", JSON.stringify(a) .replace(/\{"t":/g, "\n{\"t\":") + "\n");
console.log(`wrote tests/fixtures/structural.json (${Object.keys(s).length} lesions) and acs.json (${Object.keys(a.scenarios).length} scenarios)`);
