import type { ChapterDef } from "../runner";

/** Former chapters 3 (perfusion / autoregulation) and 4 (Ohm / Poiseuille), merged. */
export const CHAPTER_3: ChapterDef = {
  id: "perfusion-circuit",
  number: 3,
  title: "Perfusion, pressure, and the circuit",
  subtitle: "Autoregulation, Ohm's law, parallel organs, and Poiseuille",
  ready: true,
  blocks: [
    {
      kind: "text",
      paragraphs: [
        "Perfusion pressure is what the organ sees: roughly MAP minus CVP. Organs are wired in parallel on the arterial tree, so each faces the same driving pressure and draws flow according to its local resistance.",
        "Autoregulation keeps flow steady across a range of pressures: arterioles dilate when pressure falls and constrict when it rises. The brain and kidney defend flow aggressively; the gut is less protected and gives way earlier.",
        "The whole circulation also obeys Ohm's law: ΔP = Q × R, so MAP − CVP = CO × SVR. Poiseuille's law makes local resistance explode when radius shrinks: R ∝ 1/r⁴.",
      ],
    },
    {
      kind: "predict",
      question: "MAP drops from 90 to 60 mmHg. Which organ loses perfusion first — brain, kidney, or gut?",
      options: [
        { label: "Gut first; brain and kidney stay on the plateau longer", note: "That matches weaker splanchnic autoregulation." },
        { label: "All three fall equally because MAP changed", note: "Parallel beds share pressure, but autoregulation differs by organ." },
        { label: "Brain first because it is highest in the tree", note: "Height is not the model here — local autoregulation is." },
      ],
      reveal: [
        "In the MAP-driven view, brain and kidney hold their target flows while MAP stays on their autoregulatory plateau; effective local resistance falls as MAP falls.",
        "The gut's plateau ends at a higher MAP, so at 60 mmHg its flow is already sliding down the linear limb while brain and kidney are still defended.",
      ],
    },
    { kind: "widget", id: "circuit", mode: "autoreg" },
    {
      kind: "predict",
      question: "Halve the gut vessel radius (Gut radius → 0.5×) with the pump setting cardiac output. How much does gut resistance change? Does MAP change?",
      options: [
        { label: "Gut resistance ×16; MAP rises at the same CO", note: "Poiseuille and a higher total SVR — exactly." },
        { label: "Gut resistance doubles; MAP unchanged", note: "Radius halving is a fourth-power effect, not doubling." },
        { label: "Only gut flow falls; MAP and other flows stay fixed", note: "Fixed CO with higher SVR requires higher MAP." },
      ],
      reveal: [
        "Halving radius multiplies resistance by 2⁴ = 16. Total SVR rises, so MAP = CVP + CO × SVR increases at fixed cardiac output.",
        "Higher MAP raises ΔP across every parallel branch, so other organ flows dip slightly while gut flow drops most.",
      ],
    },
    { kind: "widget", id: "circuit", mode: "pump" },
    {
      kind: "predict",
      question: "Double cardiac output with the same vessel radii. What happens to MAP?",
      options: [
        { label: "MAP roughly doubles (linear with CO)", note: "Fixed SVR ⇒ ΔP scales with flow." },
        { label: "MAP stays near 90 mmHg", note: "That would need vasodilation; radii are fixed here." },
        { label: "MAP falls because organs steal flow", note: "Parallel beds share ΔP; more pump output raises pressure when R is fixed." },
      ],
      reveal: [
        "With fixed resistances, MAP − CVP = CO × SVR scales linearly with CO. Doubling output roughly doubles the pressure drop from CVP to MAP, and each organ flow doubles with it.",
      ],
    },
    {
      kind: "reveal",
      paragraphs: [
        "The first simulation holds MAP and lets autoregulation set local resistances; the second fixes pump output and solves MAP from total SVR. Both are parallel-resistance stories with different levers.",
        "Coronary perfusion in the main simulator is mostly diastolic and lesion-specific — see Cases and /sim/ when you are ready; this chapter is the systemic lumped picture.",
        "Readouts in pump mode always satisfy MAP − CVP = CO × SVR; branch flows sum to cardiac output.",
      ],
    },
  ],
};
