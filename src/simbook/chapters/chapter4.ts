import type { ChapterDef } from "../runner";

export const CHAPTER_4: ChapterDef = {
  id: "ohm-circuit",
  number: 4,
  title: "The circulation as a fluid circuit",
  subtitle: "Ohm's law, parallel organs, and Poiseuille",
  ready: true,
  blocks: [
    {
      kind: "text",
      paragraphs: [
        "Treat the systemic circulation like an electrical circuit: pressure drives flow through resistance. The governing relation is ΔP = Q × R.",
        "For the whole body, mean arterial pressure minus central venous pressure equals cardiac output times systemic vascular resistance: MAP − CVP = CO × SVR.",
        "Organs sit in parallel on the arterial tree. Each sees roughly the same perfusion pressure and takes flow inversely proportional to its own resistance. Total resistance falls when another bed opens — more paths for the same pressure drop.",
        "Inside a bed, Poiseuille's law makes resistance extremely sensitive to radius: R ∝ 1/r⁴. Halving a vessel's radius multiplies its resistance by sixteen.",
      ],
    },
    {
      kind: "predict",
      question: "Halve the gut vessel radius (drag the Gut radius slider to 0.5). How much does gut resistance change? Does MAP change? Does flow to the other organs change?",
      options: [
        { label: "Gut resistance ×16; MAP rises; other organs get less flow", note: "You predicted a large local resistance jump with redistribution — good." },
        { label: "Gut resistance doubles; MAP unchanged", note: "Radius halving is a fourth-power effect on resistance, not a doubling." },
        { label: "Only gut flow falls; MAP and other flows stay fixed", note: "With a fixed pump output, total SVR and MAP shift when one bed constricts." },
      ],
      reveal: [
        "Halving radius multiplies that vessel's resistance by 2⁴ = 16. Total SVR rises, so at the same cardiac output MAP must rise (MAP = CVP + CO × SVR).",
        "Higher MAP with unchanged resistances elsewhere increases pressure drop across every parallel branch, so brain, kidney, and muscle flows all fall slightly while gut flow falls most.",
      ],
    },
    { kind: "widget", id: "circuit" },
    {
      kind: "predict",
      question: "Double cardiac output with the same resistances. What happens to MAP?",
      options: [
        { label: "MAP roughly doubles (linear with CO)", note: "Yes — with fixed SVR, ΔP is proportional to flow." },
        { label: "MAP stays near 90 mmHg", note: "That would require SVR to fall in proportion; nothing here dilates the vessels." },
        { label: "MAP falls because vessels steal flow", note: "Parallel beds share pressure; raising pump output raises pressure when resistance is fixed." },
      ],
      reveal: [
        "With resistances held constant, SVR is constant, so MAP − CVP = CO × SVR scales linearly with CO. Doubling output roughly doubles the pressure drop from CVP to MAP.",
        "Each organ's flow also doubles because Qᵢ = ΔP/Rᵢ and ΔP doubled while each Rᵢ is unchanged.",
      ],
    },
    {
      kind: "reveal",
      paragraphs: [
        "The schematic is a lumped teaching model: one pump, one venous pool, and four parallel organ resistances. It omits pulse pressure, arterial compliance, and autoregulation (Chapter 3).",
        "The readouts always satisfy MAP − CVP = CO × SVR, and branch flows sum to cardiac output. Try extreme radii to see how Poiseuille dominates local perfusion.",
      ],
    },
  ],
};
