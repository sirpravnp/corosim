// Pure helpers of the rhythm picker (no DOM, so tests can import them).

/** The picker value for the patient's rhythm: the coronary model's own sinus is the library's "nsr" (AF is "af" in both). */
export const pickerValue = (rhythm: string) => (rhythm === "sinus" ? "nsr" : rhythm);

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Every word of the (normalised) search text appears in the rhythm's name, id or category. */
export const matches = (p: { name: string; id: string; category: string }, q: string) => !q || q.split(/\s+/).every((w) => norm(`${p.name} ${p.id} ${p.category}`).includes(w));
