// Locate an exact supporting quote inside source text and return its real
// [start,end) span, or null. Whitespace-tolerant (a run of whitespace matches
// any run), straight/curly quotes interchangeable, case-insensitive — the same
// relaxations the assessment's quote verifier uses — but the words must still
// appear VERBATIM and in order, so this only ever finds a REAL occurrence, never
// an approximate or reworded one. Pure + dependency-free so it is unit-testable
// and shared by the extracted-text viewer.
//
// A paraphrased/invented quote returns null → no highlight, never a fabricated
// position. Too-short quotes are ignored to avoid spurious single-word matches.
export function findQuoteSpan(text: string, quote: string): [number, number] | null {
  const trimmed = quote.replace(/^(?:\.{3}|…)\s*/, "").replace(/\s*(?:\.{3}|…)$/, "").trim();
  if (trimmed.length < 4) return null;
  // Fast path: exact substring.
  const exact = text.indexOf(trimmed);
  if (exact >= 0) return [exact, exact + trimmed.length];
  // Tolerant path.
  const escaped = trimmed
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/['‘’]/g, "['‘’]")
    .replace(/["“”]/g, "[\"“”]")
    .replace(/\s+/g, "\\s+");
  let rx: RegExp;
  try { rx = new RegExp(escaped, "i"); } catch { return null; }
  const m = rx.exec(text);
  if (m && typeof m.index === "number") return [m.index, m.index + m[0].length];
  return null;
}

// A short, located excerpt around a quote — the "relevant passage", not the
// whole document. Returns null when the quote can't be located in `text`
// (never fabricates a position/context). `radius` bounds how much
// surrounding text is included on each side, so the caller can render a
// tight, scannable snippet instead of dumping the full source.
export type QuoteExcerpt = { before: string; match: string; after: string; clippedStart: boolean; clippedEnd: boolean };

export function excerptAround(text: string, quote: string, radius = 220): QuoteExcerpt | null {
  const span = findQuoteSpan(text, quote);
  if (!span) return null;
  const [s, e] = span;
  const start = Math.max(0, s - radius);
  const end = Math.min(text.length, e + radius);
  return {
    before: text.slice(start, s),
    match: text.slice(s, e),
    after: text.slice(e, end),
    clippedStart: start > 0,
    clippedEnd: end < text.length,
  };
}
