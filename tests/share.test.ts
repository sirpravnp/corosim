import { describe, expect, it, vi } from "vitest";
import { shareUrl } from "../src/shell/share";

const URL = "https://corosim.example/sim/#s=abc";

describe("header Share", () => {
  it("copies the URL as it is at click time", async () => {
    let now = "https://corosim.example/sim/#s=one";
    const writeText = vi.fn().mockResolvedValue(undefined);
    const env = { url: () => now, clipboard: { writeText } };
    now = URL;
    expect(await shareUrl(env)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(URL);
  });
  it("asks for a manual copy when the clipboard is missing or denied", async () => {
    expect(await shareUrl({ url: () => URL })).toBe("manual");
    const denied = { writeText: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) };
    expect(await shareUrl({ url: () => URL, clipboard: denied })).toBe("manual");
  });
  it("uses the native sheet only when asked to (phones), and not the clipboard then", async () => {
    const share = vi.fn().mockResolvedValue(undefined), writeText = vi.fn();
    expect(await shareUrl({ url: () => URL, share, native: true, title: "CoroSim", clipboard: { writeText } })).toBe("shared");
    expect(share).toHaveBeenCalledWith({ url: URL, title: "CoroSim" });
    expect(writeText).not.toHaveBeenCalled();
    expect(await shareUrl({ url: () => URL, share, native: false, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })).toBe("copied");
    expect(share).toHaveBeenCalledTimes(1);
  });
  it("a dismissed sheet is a cancel; a failed one falls back to the clipboard", async () => {
    const abort = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "AbortError" }));
    expect(await shareUrl({ url: () => URL, share: abort, native: true })).toBe("cancelled");
    const broke = vi.fn().mockRejectedValue(new Error("nope")), writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareUrl({ url: () => URL, share: broke, native: true, clipboard: { writeText } })).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(URL);
  });
});
