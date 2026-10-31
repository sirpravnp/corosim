/**
 * Chapter runner for Simbook: the same predict-then-reveal rhythm as `cases/engine.ts`, without scoring or simulation patches.
 */
export type PredictOption = { label: string; /** Shown after the learner continues, if they picked this. */ note?: string };

export type Block =
  | { kind: "text"; paragraphs: string[] }
  | { kind: "predict"; question: string; options: PredictOption[]; /** Teaching text after the widget step. */ reveal: string[] }
  | { kind: "widget"; id: string }
  | { kind: "reveal"; paragraphs: string[] };

export interface ChapterDef {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  /** When false, the chapter appears in the list but cannot be opened yet. */
  ready: boolean;
  blocks: Block[];
}

export interface ChapterView {
  chapter: ChapterDef;
  index: number;
  block: Block;
  /** Blocks of kind `predict` that have been passed. */
  predictIndex: number;
  /** Learner's last choice index per predict block index. */
  choices: Map<number, number>;
  finished: boolean;
}

export function initChapter(ch: ChapterDef): ChapterView {
  return { chapter: ch, index: 0, block: ch.blocks[0]!, predictIndex: -1, choices: new Map(), finished: ch.blocks.length === 0 };
}

export function canAdvance(v: ChapterView): boolean {
  if (v.finished) return false;
  const b = v.block;
  if (b.kind === "widget") return true;
  if (b.kind === "predict") return v.choices.has(v.index);
  return true;
}

export function advance(v: ChapterView): ChapterView {
  if (v.finished || !canAdvance(v)) return v;
  const next = v.index + 1;
  if (next >= v.chapter.blocks.length) return { ...v, finished: true };
  const block = v.chapter.blocks[next]!;
  return { ...v, index: next, block, predictIndex: block.kind === "predict" ? next : v.predictIndex };
}

export function recordPredictChoice(v: ChapterView, optionIndex: number): ChapterView {
  if (v.block.kind !== "predict") return v;
  const choices = new Map(v.choices);
  choices.set(v.index, optionIndex);
  return { ...v, choices };
}

export function predictRevealFor(v: ChapterView, blockIndex: number): string[] {
  const b = v.chapter.blocks[blockIndex];
  if (b?.kind !== "predict") return [];
  const out = [...b.reveal];
  const pick = v.choices.get(blockIndex);
  if (pick != null && b.options[pick]?.note) out.unshift(b.options[pick].note!);
  return out;
}
