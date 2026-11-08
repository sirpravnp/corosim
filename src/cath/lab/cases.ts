import type { ForcedEvent } from "../../lab/complications";
import type { AccessVariant, Plaque } from "../../lab/types";
import type { Scenario } from "../../sim/scenario";

export interface LabCase {
  id: string;
  title: string;
  blurb: string;
  scenario: Scenario;
  access: AccessVariant;
  plaques: Plaque[];
  egfr: number;
  goals: string[];
  forced?: ForcedEvent[];
  recommended: { guide: string; wire: string; balloon?: string; stent?: string };
}

const soft = (seg: string, ds: number, mm: number): Plaque => ({
  segId: seg, centerMm: mm, lengthMm: 16, ds, referenceMm: 3,
  eccentric: 0.15, eccentricAngleDeg: 0, calcium: 0.1, lipid: 0.4, thrombus: 0, remodel: "none", stents: [],
});

export const LAB_CASES: LabCase[] = [
  {
    id: "stable-lad",
    title: "Stable angina, mid-LAD",
    blurb: "Exertional chest pain; mid-LAD 80 % soft plaque.",
    scenario: { lesions: [{ artery: "LAD", stenosis: 0.8, position: 0.45 }] },
    access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false },
    plaques: [soft("LAD", 0.8, 52)],
    egfr: 85,
    goals: ["Cross the lesion", "Predilate and deploy DES", "Final FFR ≥ 0.90"],
    recommended: { guide: "guide-jl4", wire: "wire-workhorse", balloon: "bal-semi-2.50-12", stent: "stent-des-3.00-24" },
  },
  {
    id: "inferior-stemi",
    title: "Inferior STEMI",
    blurb: "RCA occlusion with thrombus; plan for no-reflow after stent.",
    scenario: { lesions: [{ artery: "RCA", stenosis: 0.99, position: 0.35, occluded: true }] },
    access: { arch: "II", iliacTortuosity: 0.15, radialLoop: false, aorticRootMm: 36, calcifiedIliac: false },
    plaques: [{ ...soft("RCA", 0.99, 40), thrombus: 0.85, calcium: 0.15 }],
    egfr: 70,
    goals: ["Restore TIMI 3 flow", "Treat no-reflow"],
    forced: [{ complication: "no-reflow", trigger: "post-stent", once: true }],
    recommended: { guide: "guide-jr4", wire: "wire-workhorse", balloon: "bal-semi-2.50-12", stent: "stent-des-3.00-24" },
  },
  {
    id: "calc-rca",
    title: "Calcified mid-RCA",
    blurb: "Heavily calcified lesion needing high-pressure balloon.",
    scenario: { lesions: [{ artery: "RCA", stenosis: 0.85, position: 0.5 }] },
    access: { arch: "II", iliacTortuosity: 0.25, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false },
    plaques: [{ ...soft("RCA", 0.85, 48), calcium: 0.85 }],
    egfr: 80,
    goals: ["Prepare calcium", "Adequate expansion"],
    recommended: { guide: "guide-jr4", wire: "wire-stiff-cto", balloon: "bal-nc-3.00-20", stent: "stent-des-3.25-24" },
  },
  {
    id: "lad-d1",
    title: "LAD / D1 bifurcation",
    blurb: "Medina 1,1,1 — jailing versus intentional side-branch strategy.",
    scenario: { lesions: [{ artery: "LAD", stenosis: 0.7, position: 0.24 }] },
    access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 35, calcifiedIliac: false },
    plaques: [soft("LAD", 0.7, 30)],
    egfr: 75,
    goals: ["Wire both branches or jail D1 deliberately", "Avoid geographic miss"],
    recommended: { guide: "guide-ebu35", wire: "wire-workhorse", stent: "stent-des-3.00-18" },
  },
  {
    id: "rca-cto",
    title: "RCA CTO",
    blurb: "Chronic total occlusion with microchannels.",
    scenario: { lesions: [{ artery: "RCA", stenosis: 0.99, position: 0.55 }] },
    access: { arch: "II", iliacTortuosity: 0.3, radialLoop: false, aorticRootMm: 36, calcifiedIliac: false },
    plaques: [{ ...soft("RCA", 0.99, 58), cto: { ageMonths: 8, capHardness: 0.55, microchannels: true } }],
    egfr: 78,
    goals: ["Cross with appropriate wire", "Deploy stent after predilation"],
    recommended: { guide: "guide-jr4", wire: "wire-stiff-cto", balloon: "bal-scoring-2.75-15", stent: "stent-des-3.00-24" },
  },
  {
    id: "tortuous-access",
    title: "Tortuous access",
    blurb: "Arch III, calcified iliac and radial loop — access choice matters.",
    scenario: { lesions: [{ artery: "LAD", stenosis: 0.65, position: 0.5 }] },
    access: { arch: "III", iliacTortuosity: 0.85, radialLoop: true, aorticRootMm: 34, calcifiedIliac: true },
    plaques: [soft("LAD", 0.65, 50)],
    egfr: 72,
    goals: ["Choose viable access", "Engage without deep ventricularization"],
    recommended: { guide: "guide-xb35", wire: "wire-floppy", balloon: "bal-semi-2.50-12", stent: "stent-des-3.00-24" },
  },
  {
    id: "left-main-ckd",
    title: "Left main, CKD",
    blurb: "Critical left main stenosis with limited contrast budget (eGFR 35).",
    scenario: { lesions: [{ artery: "LAD", stenosis: 0.5, position: 0.1 }, { artery: "LCX", stenosis: 0.5, position: 0.15 }] },
    access: { arch: "II", iliacTortuosity: 0.2, radialLoop: false, aorticRootMm: 37, calcifiedIliac: false },
    plaques: [soft("LM", 0.9, 8)],
    egfr: 35,
    goals: ["Minimize contrast", "Treat left main safely"],
    recommended: { guide: "guide-ebu35", wire: "wire-pressure", balloon: "bal-semi-3.00-12", stent: "stent-des-3.50-18" },
  },
];

export const caseById = (id: string) => LAB_CASES.find((c) => c.id === id);
