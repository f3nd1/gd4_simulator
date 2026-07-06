import { describe, it, expect } from "vitest";
import { findQuoteSpan, excerptAround } from "../../components/ui/quoteMatch";

const SOURCE = `--- Slide 2 ---
Governance Framework v1.3

The Board of Directors meets quarterly and reviews the financial
statements, risk register and academic quality reports. All auditors
must be independent of the area they audit.`;

describe("findQuoteSpan — highlight only a real, verbatim occurrence", () => {
  it("finds an exact verbatim quote and returns its real span", () => {
    const span = findQuoteSpan(SOURCE, "All auditors\nmust be independent of the area they audit.");
    expect(span).not.toBeNull();
    const [s, e] = span!;
    // The span maps back to the true text (whitespace-tolerant across the newline).
    expect(SOURCE.slice(s, e).replace(/\s+/g, " ")).toBe("All auditors must be independent of the area they audit.");
  });

  it("matches despite odd extraction whitespace (a run of spaces/newlines)", () => {
    const span = findQuoteSpan(SOURCE, "meets quarterly and reviews the financial statements");
    expect(span).not.toBeNull();
    expect(SOURCE.slice(span![0], span![1])).toContain("financial");
  });

  it("is case-insensitive and tolerant of curly vs straight quotes", () => {
    const span = findQuoteSpan(`He said "the board meets quarterly".`, "The board meets quarterly");
    expect(span).not.toBeNull();
  });

  it("returns null for a paraphrase that is NOT a verbatim substring (never fabricates)", () => {
    expect(findQuoteSpan(SOURCE, "The board convenes every three months to look at finances")).toBeNull();
  });

  it("returns null for an invented quote absent from the source", () => {
    expect(findQuoteSpan(SOURCE, "A conflict-of-interest policy applies to all directors.")).toBeNull();
  });

  it("ignores too-short quotes to avoid spurious single-word highlights", () => {
    expect(findQuoteSpan(SOURCE, "the")).toBeNull();
  });

  it("strips surrounding ellipses the model sometimes adds", () => {
    const span = findQuoteSpan(SOURCE, "…risk register and academic quality reports…");
    expect(span).not.toBeNull();
    expect(SOURCE.slice(span![0], span![1])).toContain("risk register");
  });
});

describe("excerptAround — a short, located excerpt, never the whole document", () => {
  it("returns the match plus bounded context on each side, not the whole source", () => {
    const long = `${"x".repeat(2000)}\nAll auditors must be independent of the area they audit.\n${"y".repeat(2000)}`;
    const ex = excerptAround(long, "All auditors must be independent of the area they audit.", 50);
    expect(ex).not.toBeNull();
    expect(ex!.match).toBe("All auditors must be independent of the area they audit.");
    // Context is bounded — nowhere near the full 4000+ char document.
    expect(ex!.before.length).toBeLessThanOrEqual(50);
    expect(ex!.after.length).toBeLessThanOrEqual(50);
    expect(ex!.clippedStart).toBe(true);
    expect(ex!.clippedEnd).toBe(true);
  });

  it("does not mark clipped when the match sits at the very start/end of the source", () => {
    const ex = excerptAround("All auditors must be independent.", "All auditors must be independent.", 50);
    expect(ex).not.toBeNull();
    expect(ex!.before).toBe("");
    expect(ex!.after).toBe("");
    expect(ex!.clippedStart).toBe(false);
    expect(ex!.clippedEnd).toBe(false);
  });

  it("returns null for a quote that cannot be located — never fabricates a position", () => {
    expect(excerptAround(SOURCE, "A conflict-of-interest policy applies to all directors.")).toBeNull();
  });
});
