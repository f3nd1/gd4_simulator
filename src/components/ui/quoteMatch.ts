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
