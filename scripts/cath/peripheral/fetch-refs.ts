/**
 * Download Wikimedia Commons reference images into untracked scripts/cath/work/refs/.
 * Never commit the pixels; only the manifest may be committed if desired (this script
 * writes the manifest next to the images, under the gitignored work/ folder).
 *
 * Run: npx tsx scripts/cath/peripheral/fetch-refs.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REFS: { filename: string; title: string; author: string; license: string; url: string; informs: string }[] = [
  {
    filename: "Leriche-Syndrom-DSA.jpg",
    title: "Leriche syndrome DSA",
    author: "Hellerhoff",
    license: "CC BY-SA 3.0",
    url: "https://commons.wikimedia.org/wiki/File:Leriche-Syndrom-DSA.jpg",
    informs: "abdominal aorta caliber and bifurcation; DSA aortogram look",
  },
  {
    filename: "Takayasu Arteritis.jpg",
    title: "Takayasu arteritis LAO arch",
    author: "Justin Ly, MedPix",
    license: "public domain",
    url: "https://commons.wikimedia.org/wiki/File:Takayasu_Arteritis.jpg",
    informs: "arch shape and supra-aortic origins in LAO",
  },
  {
    filename: "Neutral popliteal artery angiogram.png",
    title: "Neutral popliteal angiogram",
    author: "Minhle90",
    license: "CC BY-SA 4.0",
    url: "https://commons.wikimedia.org/wiki/File:Neutral_popliteal_artery_angiogram.png",
    informs: "popliteal course and caliber",
  },
  {
    filename: "Gray505.png",
    title: "Gray's thoracic aorta",
    author: "Henry Gray (public domain)",
    license: "public domain",
    url: "https://commons.wikimedia.org/wiki/File:Gray505.png",
    informs: "arch and root cross-check",
  },
  {
    filename: "Gray506.png",
    title: "Gray's arch branches",
    author: "Henry Gray (public domain)",
    license: "public domain",
    url: "https://commons.wikimedia.org/wiki/File:Gray506.png",
    informs: "carotid and vertebral origins",
  },
];

const __dir = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dir, "../work/refs");
mkdirSync(outDir, { recursive: true });

const files: { filename: string; title: string; author: string; license: string; url: string; informs: string; sha256?: string; fetched?: boolean }[] = [];

for (const ref of REFS) {
  const dest = join(outDir, ref.filename);
  let sha256: string | undefined;
  let fetched = false;
  // Prefer Commons Special:FilePath when online; skip quietly when offline.
  try {
    const fileUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(ref.filename)}`;
    const res = await fetch(fileUrl, { redirect: "follow" });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(dest, buf);
      sha256 = createHash("sha256").update(buf).digest("hex");
      fetched = true;
      console.log("fetched", ref.filename, sha256.slice(0, 12));
    } else {
      console.warn("skip", ref.filename, res.status);
    }
  } catch (e) {
    console.warn("skip", ref.filename, (e as Error).message);
  }
  if (!fetched && existsSync(dest)) {
    // Already present from a prior run.
    fetched = true;
  }
  files.push({ ...ref, sha256, fetched });
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ downloadedAt: new Date().toISOString(), files }, null, 2) + "\n");
console.log("manifest →", join(outDir, "manifest.json"));
