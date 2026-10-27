// ---------------------------------------------------------------- the rhythm picker (C3): every D4 rhythm, grouped and searchable
import { SIM_RHYTHMS, SIM_RHYTHM_CATEGORIES, libraryVentricularRate, libraryRhythm } from "../physics/rhythmSource";
import { $, S } from "./state";
import { pickerValue, norm, matches } from "./rhythmChoices";



/** Rebuild the grouped option list for a search text; the current rhythm always stays in it. */
function fill(q: string) {
  const sel = $<HTMLSelectElement>("rhythmsel"), cur = pickerValue(S.rhythm), want = norm(q.trim());
  sel.innerHTML = "";
  let n = 0;
  for (const cat of SIM_RHYTHM_CATEGORIES) {
    const ps = SIM_RHYTHMS.filter((p) => p.category === cat && (p.id === cur || matches(p, want)));
    if (!ps.length) continue;
    const g = document.createElement("optgroup"); g.label = cat;
    for (const p of ps) { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; g.append(o); n++; }
    sel.append(g);
  }
  sel.value = cur;
  $("rhythmcount").textContent = want ? `${n} match${n === 1 ? "" : "es"}` : `${SIM_RHYTHMS.length} rhythms`;
}

/** Fill the picker and wire it: choosing a rhythm sets the patient's rhythm; the strip and numbers follow on the next frame. */
export function wireRhythmPicker(onPick: () => void) {
  const sel = $<HTMLSelectElement>("rhythmsel"), q = $<HTMLInputElement>("rhythmq");
  fill("");
  sel.addEventListener("change", () => {
    sel.value = sel.value; // re-render the styled list (a programmatic change does not)
    S.rhythm = sel.value === "nsr" ? "sinus" : sel.value;
    onPick();
  });
  q.addEventListener("input", () => fill(q.value));
}

/** Keep the picker on the patient's rhythm (a shared link or an AI may have changed it) and describe it. */
export function rhythmPickerUi() {
  const sel = $<HTMLSelectElement>("rhythmsel"), cur = pickerValue(S.rhythm);
  if (sel.value !== cur) fill($<HTMLInputElement>("rhythmq").value);
  const p = libraryRhythm(S.rhythm) ?? SIM_RHYTHMS.find((x) => x.id === cur);
  if (!p) { $("rhythminfo").textContent = S.rhythm; return; }
  const own = S.rhythm === "sinus" || S.rhythm === "af";
  let rate = " · rate follows the coronary model and the reflexes";
  if (!own) { const r = libraryVentricularRate(p.id); rate = r > 0 ? ` · ventricular rate about ${Math.round(r)}/min` : " · no ventricular rate"; }
  $("rhythminfo").textContent = `${p.name}${rate}. ${p.summary}`;
}
