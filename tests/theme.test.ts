import { describe, expect, it, beforeEach } from "vitest";
import { applyTheme, resolvedTheme, savedTheme, SHARE_PAGES, toggleTheme } from "../src/shell/theme";

describe("theme preference", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      },
    });
  });

  it("remembers light and dark", () => {
    applyTheme("light");
    expect(savedTheme()).toBe("light");
    applyTheme("dark");
    expect(savedTheme()).toBe("dark");
    expect(resolvedTheme()).toBe("dark");
  });

  it("toggle flips the resolved theme", () => {
    applyTheme("dark");
    expect(toggleTheme()).toBe("light");
    expect(resolvedTheme()).toBe("light");
    expect(toggleTheme()).toBe("dark");
  });

  it("Share is only for pages with a shareable view or patient", () => {
    expect([...SHARE_PAGES].sort()).toEqual(["cath", "echo", "ekg", "sim", "structural"]);
    expect(SHARE_PAGES.has("cases")).toBe(false);
  });
});
