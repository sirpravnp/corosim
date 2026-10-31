import type { ChapterDef } from "../runner";

export const CHAPTER_1: ChapterDef = {
  id: "why-blood",
  number: 1,
  title: "Why we have blood",
  subtitle: "Diffusion limits and bulk transport",
  ready: true,
  blocks: [
    {
      kind: "text",
      paragraphs: [
        "Cells need O₂ for aerobic metabolism. Blood is the carrier that brings O₂ from the lungs and spreads it through the tissues.",
        "Diffusion alone only works over very short distances. The characteristic time scales as t ≈ x²/(2D): double the distance and transport takes four times as long.",
        "Beyond roughly 100 µm from a capillary, diffusion cannot keep up with consumption — you need convection (flow) to shorten the path or refresh the source.",
      ],
    },
    {
      kind: "predict",
      question: "Where does O₂ run out first as you move away from the capillary edge?",
      options: [
        { label: "At the tissue core (farthest from the capillary)", note: "The profile falls toward the core." },
        { label: "Uniformly everywhere at once", note: "Concentration is highest at the capillary boundary." },
        { label: "At the capillary surface", note: "That is where O₂ enters; it is highest there." },
      ],
      reveal: [
        "O₂ enters at the capillary and is consumed while diffusing inward, so concentration falls with distance. The core is the first place to go anoxic when delivery is insufficient.",
      ],
    },
    { kind: "widget", id: "diffusion" },
    {
      kind: "predict",
      question: "What happens if the tissue is twice as thick (same consumption and capillary density)?",
      options: [
        { label: "Anoxic zone grows; diffusion time ~×4 for the same depth", note: "Distance squared in t ≈ x²/2D." },
        { label: "No change — diffusion is instant", note: "Thicker tissue lengthens the diffusion path." },
        { label: "Only flow matters; thickness is irrelevant", note: "Thickness sets the path length even with flow." },
      ],
      reveal: [
        "A thicker slab increases the effective diffusion path. The anoxic boundary moves toward the capillary when consumption wins, and the time to equilibrate scales with distance squared.",
        "Turning flow on or raising capillary density shortens the effective path (√density) and raises capillary O₂ — both push the anoxic boundary back toward the core.",
      ],
    },
    {
      kind: "reveal",
      paragraphs: [
        "This slab is a steady-state teaching model: fixed D, zero-order consumption, one capillary face. Real tissue has branching networks and pulsatile flow.",
        "The lesson: bulk transport exists because diffusion is too slow over organ-scale distances — the rest of Simbook builds the pressurized circuit that makes flow possible.",
      ],
    },
  ],
};
