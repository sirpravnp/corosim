import type { ChapterDef } from "../runner";
import { CHAPTER_3 } from "./chapter3";

const PLACEHOLDER = (n: number, title: string, subtitle: string): ChapterDef => ({
  id: `ch${n}-placeholder`,
  number: n,
  title,
  subtitle,
  ready: false,
  blocks: [{ kind: "text", paragraphs: ["This chapter is not written yet. Start with Chapter 3 — perfusion and the circuit."] }],
});

export const CHAPTERS: ChapterDef[] = [
  PLACEHOLDER(1, "Why we have blood", "Diffusion limits and bulk transport"),
  PLACEHOLDER(2, "Exchange at the capillary", "Fick's law and Starling's equation"),
  CHAPTER_3,
];

/** Legacy hash from the first Simbook ship (chapter 4 only). */
const LEGACY_IDS: Record<string, string> = { "ohm-circuit": "perfusion-circuit" };

export const chapterById = (id: string) => {
  const resolved = LEGACY_IDS[id] ?? id;
  return CHAPTERS.find((c) => c.id === resolved);
};
