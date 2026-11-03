import type { ChapterDef } from "../runner";
import { CHAPTER_1 } from "./chapter1";
import { CHAPTER_2 } from "./chapter2";
import { CHAPTER_3 } from "./chapter3";

export const CHAPTERS: ChapterDef[] = [CHAPTER_1, CHAPTER_2, CHAPTER_3];

/** Legacy hash from the first Simbook ship (chapter 4 only). */
const LEGACY_IDS: Record<string, string> = { "ohm-circuit": "perfusion-circuit" };

export const chapterById = (id: string) => {
  const resolved = LEGACY_IDS[id] ?? id;
  return CHAPTERS.find((c) => c.id === resolved);
};
