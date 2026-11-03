import { describe, expect, it } from "vitest";
import { crossLinks, ekgPresetFor, EKG_PRESET_LABEL, joinPatient, lesionForHeart, PageId, patientFromHash } from "../src/sim/crossLinks";
import { decodePatient } from "../src/sim/llm";
import { defaults, LESIONS, lesionHash, patientFromLesionHash } from "../src/sim/structural";
import { PRESET_BY_ID } from "../src/ekg/presets";
import { normalizePatient, PatientSpec } from "../src/sim/patient";

const hashOf = (href: string) => href.slice(href.indexOf("#"));
const link = (from: PageId, p: PatientSpec, to: string) => crossLinks(from, p, "../").find((l) => l.page === to);

describe("structural <-> simulator and cath lab for every adult lesion", () => {
  // newborn lessons have no Simulator or cath-lab patient: the Structural page leaves those two links out
  for (const l of LESIONS.filter((x) => x.patient === "adult")) {
    it(l.id, () => {
      const hash = lesionHash(l.id, defaults(l));
      const spec = patientFromHash("structural", hash)!;
      expect(spec).toEqual(patientFromLesionHash(hash));
      for (const to of ["sim", "cath"] as const) {
        const href = link("structural", spec, to)!.href;
        expect(href.startsWith(`../${to}/#s=`)).toBe(true);
        const back = patientFromHash(to, hashOf(href))!;
        expect(back).toEqual(spec);
        // and back to structural: the same lesion and sliders
        const s = link(to, back, "structural")!;
        expect(s, `${l.id} from ${to}`).toBeDefined();
        expect(hashOf(s.href)).toBe(hash);
        expect(patientFromHash("structural", hashOf(s.href))).toEqual(spec);
      }
    });
  }
  it("non-default sliders survive the trip", () => {
    for (const hash of ["#lesion=as&severity=0.5", "#lesion=asd&diameter=7"]) {
      const spec = patientFromLesionHash(hash);
      expect(hashOf(link("sim", spec, "structural")!.href), hash).toBe(hash);
    }
  });
});

describe("hash round trips", () => {
  const scenario = { lesions: [{ artery: "LAD", stenosis: 0.7 }, { artery: "RCA", occluded: true }], patient: { rhythm: "af" as const, bbb: "lbbb" as const }, exertion: true };
  it("sim -> cath -> sim keeps the whole patient, structural sections included", () => {
    const p = joinPatient(scenario, { heart: patientFromLesionHash("#lesion=asd&diameter=12").heart });
    const toCath = patientFromHash("cath", hashOf(link("sim", p, "cath")!.href))!;
    expect(toCath).toEqual(p);
    expect(patientFromHash("sim", hashOf(link("cath", toCath, "sim")!.href))).toEqual(p);
  });
  it("a Scenario-only patient stays a Scenario", () => {
    expect(patientFromHash("sim", hashOf(link("cath", scenario, "sim")!.href))).toEqual(scenario);
  });
  it("the spec in a link is still valid after normalising, and says nothing about a newborn", () => {
    for (const l of LESIONS.filter((x) => x.patient === "adult")) {
      const spec = patientFromLesionHash(`#lesion=${l.id}`);
      const n = normalizePatient(decodePatient(hashOf(link("structural", spec, "sim")!.href).slice(3)));
      expect(n.spec).not.toHaveProperty("kind");
      expect(n.warnings.filter((w) => /kind|neonate/.test(w))).toEqual([]);
    }
  });
  it("pages without a patient hash give none", () => {
    expect(patientFromHash("ekg", "#p=nsr")).toBeNull();
    expect(patientFromHash("echo", "#plax")).toBeNull();
    expect(patientFromHash("cath", "#case=x")).toBeNull();
    expect(patientFromHash("sim", "#s=!!!")).toBeNull();
  });
});

describe("which links appear", () => {
  it("echo and ekg offer none; structural offers sim, cath, echo", () => {
    const p = patientFromLesionHash("#lesion=asd");
    expect(crossLinks("echo", p, "../")).toEqual([]);
    expect(crossLinks("ekg", p, "../")).toEqual([]);
    expect(crossLinks("structural", p, "../").map((l) => l.page)).toEqual(["sim", "cath", "echo"]);
  });
  it("sim offers cath, structural (with a heart), ekg, echo; without a heart section there is no structural link", () => {
    expect(crossLinks("sim", { heart: {} }, "../").map((l) => l.page)).toEqual(["cath", "structural", "ekg", "echo"]);
    expect(crossLinks("sim", {}, "../").map((l) => l.page)).toEqual(["cath", "ekg", "echo"]);
  });
  it("a heart that is no library lesion, or only a newborn's, gets no structural link", () => {
    expect(lesionForHeart({ heart: { vsd: { diameterMm: 5 }, pvri: 2 } })).toBeNull(); // the VSD lesson is a neonate's, and the Simulator has none
    expect(lesionForHeart({ heart: { vsd: { diameterMm: 5.3 }, pvri: 2, rvContractility: 3 } })).toBeNull();
    expect(link("sim", { heart: { satLung: 0.5, lvSize: 2 } }, "structural")).toBeUndefined();
  });
  it("echo is a plain link and the ekg link is a preset, neither carrying the patient", () => {
    const p = { lesions: [{ artery: "RCA", occluded: true }] };
    const e = link("cath", p, "echo")!, k = link("cath", p, "ekg")!;
    expect(e.href).toBe("../echo/"); expect(e.carries).toBe(false);
    expect(k.href).toBe("../ekg/#p=stemi-inferior"); expect(k.carries).toBe(false);
  });
});

describe("closest EKG preset", () => {
  it("every preset the links can choose exists", () => { for (const id of Object.keys(EKG_PRESET_LABEL)) expect(PRESET_BY_ID[id], id).toBeDefined(); });
  it("occlusion territory, then rhythm, then conduction, else normal", () => {
    expect(ekgPresetFor({ lesions: [{ artery: "LAD", occluded: true }] })).toBe("stemi-anterior");
    expect(ekgPresetFor({ lesions: [{ artery: "D1", occluded: true }] })).toBe("stemi-lateral");
    expect(ekgPresetFor({ lesions: [{ artery: "LCX", occluded: true }] })).toBe("stemi-posterior");
    expect(ekgPresetFor({ lesions: [{ artery: "RCA", occluded: true }] })).toBe("stemi-inferior");
    expect(ekgPresetFor({ lesions: [{ artery: "LAD", stenosis: 0.6 }], patient: { rhythm: "af" } })).toBe("af");
    expect(ekgPresetFor({ patient: { bbb: "rbbb" } })).toBe("rbbb");
    expect(ekgPresetFor({})).toBe("nsr");
  });
});
