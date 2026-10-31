import type { ChapterDef } from "../runner";

export const CHAPTER_2: ChapterDef = {
  id: "capillary-exchange",
  number: 2,
  title: "Exchange at the capillary",
  subtitle: "Fick's law and Starling's equation",
  ready: true,
  blocks: [
    {
      kind: "text",
      paragraphs: [
        "Two laws govern what crosses the capillary wall. Fick's law sets diffusive flux by gradient, area, and membrane thickness: J = D·A·ΔC / x.",
        "Starling's equation sets fluid movement by hydrostatic and oncotic pressures: Jv = Kf[(Pc − Pi) − σ(πc − πi)]. Filtration out of the capillary is positive Jv.",
        "Along a capillary, hydrostatic pressure falls from arteriolar to venular ends while plasma oncotic pressure stays relatively constant — so you filter early and reabsorb later.",
      ],
    },
    {
      kind: "predict",
      question: "Fibrosis doubles alveolar–capillary membrane thickness. What happens to O₂ flux at the same gradient?",
      options: [
        { label: "Flux halves (J ∝ 1/x)", note: "Fick's law inversely proportional to thickness." },
        { label: "Flux doubles", note: "Thicker barrier slows diffusion." },
        { label: "Unchanged — gradient dominates", note: "x appears in the denominator too." },
      ],
      reveal: [
        "At fixed D, A, and ΔC, flux falls in proportion to 1/x. Thicker membranes are a common reason gas exchange fails in lung disease.",
      ],
    },
    { kind: "widget", id: "fick" },
    {
      kind: "predict",
      question: "Venous pressure rises in heart failure. What happens to filtration along the capillary?",
      options: [
        { label: "Pc rises → more filtration, edema if lymph cannot keep up", note: "Higher venous pressure backs up into the capillary." },
        { label: "Only reabsorption changes", note: "Hydrostatic pressure along the capillary shifts with Pv." },
        { label: "Albumin is required for any filtration", note: "Starling has both hydrostatic and oncotic arms." },
      ],
      reveal: [
        "Higher venous pressure elevates capillary hydrostatic pressure, pushing Jv toward filtration along more of the length. Net filtration above lymph return shows as edema in this model.",
      ],
    },
    { kind: "widget", id: "starling" },
    {
      kind: "predict",
      question: "Albumin halves (cirrhosis or nephrotic syndrome). What happens to πc and filtration?",
      options: [
        { label: "πc falls → less reabsorption arm → more net filtration", note: "Oncotic pull back into the capillary weakens." },
        { label: "πc rises → more reabsorption", note: "Less protein means lower oncotic pressure." },
        { label: "Only hydrostatic terms matter", note: "σ(πc − πi) is half the Starling story." },
      ],
      reveal: [
        "Plasma oncotic pressure falls with albumin, shrinking the reabsorption term. Even at the same pressures, more fluid leaves the capillary — again risking edema when lymph is fixed.",
      ],
    },
    {
      kind: "reveal",
      paragraphs: [
        "Fick and Starling apply at the same barrier for different quantities: dissolved gas vs bulk fluid. The Starling widget uses the same oncotic curve as the simulator's fluid compartments (`physics/core/fluids.ts`).",
        "Lymph is a fixed background return here — not a slider — so you can focus on pressures, protein, and permeability.",
      ],
    },
  ],
};
