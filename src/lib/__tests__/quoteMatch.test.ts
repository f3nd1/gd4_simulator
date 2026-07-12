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

  it("locates a mid-elided quote as the real span from first to last segment (3.1 'spread across' fix)", () => {
    const span = findQuoteSpan(SOURCE, "The Board of Directors meets quarterly ... academic quality reports");
    expect(span).not.toBeNull();
    const located = SOURCE.slice(span![0], span![1]);
    expect(located.startsWith("The Board of Directors meets quarterly")).toBe(true);
    expect(located.endsWith("academic quality reports")).toBe(true);
  });

  it("returns null for an elided quote whose segments are out of order or paraphrased — elision is not licence to reword", () => {
    expect(findQuoteSpan(SOURCE, "academic quality reports ... The Board of Directors meets quarterly")).toBeNull();
    expect(findQuoteSpan(SOURCE, "The Board of Directors meets quarterly ... convenes to discuss money matters")).toBeNull();
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

// Regression: the shipped clause-by-clause matrix cut excerpts off mid-
// sentence (e.g. "...embedded through clear procedures and internal...")
// because the old fixed-radius window sliced at an exact character count
// with no regard for where the sentence actually ended.
describe("excerptAround — sentence-boundary aware (never cuts mid-sentence)", () => {
  it("extends `after` to the real end of the sentence instead of stopping at a fixed character count", () => {
    // The 6.2 screenshot's exact shape: a fixed-length cut would land inside
    // "...clear procedures and internal governance structures." — a generous
    // search radius must still stop AT the real period, not run past it.
    const text = "Roles and responsibilities are clearly embedded through clear procedures and internal governance structures. A separate section covers escalation.";
    const quote = "Roles and responsibilities are clearly embedded";
    const ex = excerptAround(text, quote, 200);
    expect(ex).not.toBeNull();
    const full = ex!.before + ex!.match + ex!.after;
    expect(full).toContain("internal governance structures.");
    expect(full.trim().endsWith("internal governance structures.")).toBe(true);
    expect(full).not.toContain("A separate section"); // next sentence not pulled in despite radius=200
  });

  it("image 2's exact case: an Irene/HR governance excerpt renders as one complete, unbroken sentence", () => {
    const text = "Minutes record that Irene (HR Officer) is responsible for ensuring HR governance is embedded through clear procedures and internal reporting lines to the Principal. The next agenda item covers budget.";
    const quote = "Irene (HR Officer) is responsible for ensuring HR governance is embedded";
    const ex = excerptAround(text, quote, 200);
    expect(ex).not.toBeNull();
    const full = (ex!.before + ex!.match + ex!.after).trim();
    expect(full.endsWith("reporting lines to the Principal.")).toBe(true);
    expect(full).not.toMatch(/internal\.\.\.$|and internal$/); // the exact cut-off shape from the screenshot
    expect(full).not.toContain("The next agenda item"); // stops at the sentence, doesn't run into the next one
  });

  it("extends `before` to the real start of the sentence, not a fixed character count either", () => {
    const text = "First unrelated sentence here. Second sentence names the specific owner and the exact process step involved.";
    const quote = "names the specific owner";
    const ex = excerptAround(text, quote, 200);
    expect(ex).not.toBeNull();
    const full = ex!.before + ex!.match + ex!.after;
    expect(full.trim().startsWith("Second sentence")).toBe(true);
    expect(full).not.toContain("First unrelated"); // previous sentence not pulled in despite radius=200
  });

  it("a match spanning MULTIPLE sentences (an elided quote) shows every sentence it touches, complete — never just the first", () => {
    const text = "Governance review. Stakeholders meet quarterly to discuss KPIs. Action owners are assigned per item. Minutes are circulated within five working days. Unrelated closing remarks follow.";
    // Elided quote whose two segments sit in DIFFERENT sentences.
    const quote = "Stakeholders meet quarterly ... circulated within five working days";
    const ex = excerptAround(text, quote, 60);
    expect(ex).not.toBeNull();
    const full = ex!.before + ex!.match + ex!.after;
    expect(full).toContain("Stakeholders meet quarterly to discuss KPIs.");
    expect(full).toContain("Action owners are assigned per item.");
    expect(full).toContain("Minutes are circulated within five working days.");
    expect(full).not.toContain("Unrelated closing remarks"); // stops at the sentence boundary, not beyond
  });

  it("a punctuation-free run-on block still gets a BOUNDED window, not the whole document (no boundary to extend to)", () => {
    const agenda = "1 Item one 2 Item two 3 Item three 4 Item four 5 Item five 6 Item six 7 Item seven 8 Item eight 9 Item nine";
    const text = `${"x".repeat(500)} ${agenda} ${"y".repeat(500)}`;
    const ex = excerptAround(text, "1 Item one 2 Item two", 50);
    expect(ex).not.toBeNull();
    // Bounded by radius on each side — no sentence terminator anywhere nearby to extend to.
    expect(ex!.before.length).toBeLessThanOrEqual(50);
    expect(ex!.after.length).toBeLessThanOrEqual(50);
  });

  it("a real paragraph break bounds the window even within the radius search distance", () => {
    const text = `Unrelated preceding paragraph with lots of detail that should not appear.\n\nThe owner is named and the deadline is set for the next cycle. Trailing sentence.`;
    const quote = "The owner is named and the deadline is set";
    const ex = excerptAround(text, quote, 200);
    expect(ex).not.toBeNull();
    expect(ex!.before).not.toContain("Unrelated preceding paragraph");
  });
});
