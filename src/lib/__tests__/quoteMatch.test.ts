import { describe, it, expect } from "vitest";
import { findQuoteSpan } from "../../components/ui/quoteMatch";

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
