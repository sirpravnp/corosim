// The grammar of one expectation cell in a spec CSV. A blank cell, "-" or "?" means no opinion. Per seed, the value is compared with the
// rule; a cell passes when at least PASS_FRACTION of the seeds satisfy it. Baseline = the same seed's value before the insult.
//   60..80        absolute range                    >90  <5  >=1  <=0.3      absolute comparison
//   d+10..+30     change from baseline in the unit  d<-5  d>2                change comparison
//   x1.2..x1.5    ratio to baseline (x>1.2, x<0.8 also)
//   up | down | same    direction vs baseline (same = within 5% or 0.01 of baseline; up/down = beyond that)
//   true | false  a boolean variable                =text    exact string        ~regex   string matches (case-insensitive)
//   p0.4..0.7     share of seeds for which a boolean variable is true (e.g. lysis success); evaluated across seeds, not per seed
export const PASS_FRACTION = 0.8;
export type Rule =
  | { k: "abs" | "delta" | "ratio"; lo: number; hi: number }
  | { k: "dir"; d: -1 | 0 | 1 } | { k: "bool"; b: boolean } | { k: "eq"; s: string } | { k: "re"; re: RegExp } | { k: "rate"; lo: number; hi: number };

const NUM = "[-+]?\\d*\\.?\\d+(?:e[-+]?\\d+)?";
export function parseRule(raw: string): Rule | null | "bad" {
  const t = raw.trim();
  if (!t || t === "-" || t === "?") return null;
  if (t === "up") return { k: "dir", d: 1 }; if (t === "down") return { k: "dir", d: -1 }; if (t === "same") return { k: "dir", d: 0 };
  if (t === "true" || t === "false") return { k: "bool", b: t === "true" };
  if (t.startsWith("~")) return { k: "re", re: new RegExp(t.slice(1), "i") };
  if (t.startsWith("=")) return { k: "eq", s: t.slice(1) };
  let m = t.match(new RegExp(`^p(${NUM})\\.\\.(${NUM})$`, "i")); if (m) return { k: "rate", lo: +m[1], hi: +m[2] };
  const pre = /^d/i.test(t) ? "delta" : /^x/i.test(t) ? "ratio" : "abs", body = pre === "abs" ? t : t.slice(1);
  m = body.match(new RegExp(`^(${NUM})\\.\\.(${NUM})$`, "i")); if (m) return { k: pre, lo: +m[1], hi: +m[2] };
  m = body.match(new RegExp(`^(<=|>=|<|>)\\s*(${NUM})$`, "i"));
  if (m) { const x = +m[2]; return m[1][0] === "<" ? { k: pre, lo: -Infinity, hi: x } : { k: pre, lo: x, hi: Infinity }; }
  if (pre === "ratio" && !body.includes("..")) { const x = +body; if (Number.isFinite(x)) return { k: "ratio", lo: x * 0.95, hi: x * 1.05 }; }
  return "bad"; // unparseable: reported by the caller
}

export type Val = number | string | boolean | null;
/** Does one seed's value (and its baseline value) satisfy a per-seed rule? null = cannot tell (value missing). */
export function satisfies(r: Rule, v: Val, base: Val): boolean | null {
  if (v === null || v === undefined) return null;
  switch (r.k) {
    case "abs": return typeof v === "number" ? v >= r.lo && v <= r.hi : null;
    case "delta": return typeof v === "number" && typeof base === "number" ? v - base >= r.lo && v - base <= r.hi : null;
    case "ratio": return typeof v === "number" && typeof base === "number" && base !== 0 ? v / base >= r.lo && v / base <= r.hi : null;
    case "dir": {
      if (typeof v !== "number" || typeof base !== "number") return null;
      const tol = Math.max(0.05 * Math.abs(base), 0.01), d = v - base;
      return r.d === 0 ? Math.abs(d) <= tol : r.d > 0 ? d > tol : d < -tol;
    }
    case "bool": return typeof v === "boolean" ? v === r.b : null;
    case "eq": return String(v) === r.s;
    case "re": return r.re.test(String(v));
    case "rate": return null;
  }
}
