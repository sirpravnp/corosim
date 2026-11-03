/** A measurement as dot-matrix digits followed by its unit in the data face: "72 bpm" becomes <i>72</i><em> bpm</em>. Text with no leading number is left as it is. */
export function readout(value: string): string {
  const m = /^([-−+]?\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)?)(.*)$/.exec(value);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return m ? `<i>${esc(m[1])}</i><em>${esc(m[2])}</em>` : esc(value);
}
