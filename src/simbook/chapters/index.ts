import type { ChapterDef } from "../runner";
import { CHAPTER_4 } from "./chapter4";

/** Chapters 1–3 are listed but not yet built; chapter 4 ships with the skeleton. */
const PLACEHOLDER = (n: number, title: string, subtitle: string): ChapterDef => ({
  id: `ch${n}-placeholder`,
  number: n,
  title,
  subtitle,
  ready: false,
  blocks: [{ kind: "text", paragraphs: ["This chapter is not written yet. Start with Chapter 4 — the circuit — in the list."] }],
});

export const CHAPTERS: ChapterDef[] = [
  PLACEHOLDER(1, "Why we have blood", "Diffusion limits and bulk transport"),
  PLACEHOLDER(2, "Exchange at the capillary", "Fick's law and Starling's equation"),
  PLACEHOLDER(3, "Pressure and perfusion", "Parallel organs and autoregulation"),
  CHAPTER_4,
];

export const chapterById = (id: string) => CHAPTERS.find((c) => c.id === id);
