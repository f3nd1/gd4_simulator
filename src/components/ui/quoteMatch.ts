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
  // Elided quote ("start ... end"): the assessment engine accepts a quote
  // whose ellipsis-separated segments ALL appear verbatim, in order (see
  // quoteExistsInSource) — locate the same real span here, from the first
  // segment's start to the last segment's end, so an accepted elided quote
  // still highlights its actual source region instead of silently losing
  // its context. Same rules: every segment ≥8 chars, verbatim, in order —
  // otherwise null (never a fabricated position).
  const segments = trimmed.split(/\s*(?:\.{3}|…)\s*/).map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return null;
  let spanStart = -1;
  let pos = 0;
  for (const seg of segments) {
    if (seg.length < 8) return null;
    const span = findQuoteSpanFrom(text, seg, pos);
    if (!span) return null;
    if (spanStart < 0) spanStart = span[0];
    pos = span[1];
  }
  return spanStart >= 0 ? [spanStart, pos] : null;
}

// Locate one plain (non-elided) segment at or after `from`, with the same
// exact-then-whitespace/curly-tolerant matching the main path uses.
function findQuoteSpanFrom(text: string, segment: string, from: number): [number, number] | null {
  const exact = text.indexOf(segment, from);
  if (exact >= 0) return [exact, exact + segment.length];
  const escaped = segment
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/['‘’]/g, "['‘’]")
    .replace(/["“”]/g, "[\"“”]")
    .replace(/\s+/g, "\\s+");
  let rx: RegExp;
  try { rx = new RegExp(escaped, "ig"); } catch { return null; }
  rx.lastIndex = from;
  const m = rx.exec(text);
  if (m && typeof m.index === "number") return [m.index, m.index + m[0].length];
  return null;
}

// A sentence terminator: .!? optionally followed by a closing quote/paren,
// followed by whitespace or end-of-string — deliberately conservative (never
// treats a mid-sentence period like "Mr." or "e.g." specially; a slightly
// early real boundary is fine, a fabricated one is not).
const SENTENCE_END = /[.!?]["'”’)]*(?=\s|$)/g;

// The REAL sentence-start boundary at or before `pos`: the position right
// after the nearest preceding terminator (or paragraph break) within
// `maxBack` characters of `pos`. Never fabricated — only ever a position
// findable in `text`. Falls back to `pos - maxBack` (clamped to 0) when no
// boundary exists in range, so a punctuation-free block still gets a BOUNDED
// window rather than growing unboundedly (the exact failure mode a run-on,
// no-punctuation source produced before this existed).
function sentenceStart(text: string, pos: number, maxBack: number): number {
  const floor = Math.max(0, pos - maxBack);
  SENTENCE_END.lastIndex = floor;
  let best = floor;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END.exec(text))) {
    const after = m.index + m[0].length;
    if (after > pos) break;
    best = after;
  }
  const para = text.lastIndexOf("\n\n", pos - 1);
  if (para >= floor && para + 2 > best) best = para + 2;
  while (best < pos && /\s/.test(text[best])) best++; // don't start on a stray space/newline
  return best;
}

// The REAL sentence-end boundary at or after `pos`: the position right after
// the nearest following terminator (or paragraph break) within `maxForward`
// characters. Same bounded-fallback rule as sentenceStart.
function sentenceEnd(text: string, pos: number, maxForward: number): number {
  const ceil = Math.min(text.length, pos + maxForward);
  SENTENCE_END.lastIndex = pos;
  const m = SENTENCE_END.exec(text);
  let best = ceil;
  if (m && m.index + m[0].length <= ceil) best = m.index + m[0].length;
  const para = text.indexOf("\n\n", pos);
  if (para >= 0 && para < ceil && para < best) best = para;
  return best;
}

// A short, located excerpt around a quote — the "relevant passage", not the
// whole document. Returns null when the quote can't be located in `text`
// (never fabricates a position/context). SENTENCE-BOUNDARY AWARE: `before`
// extends back to the start of the sentence CONTAINING the match, and
// `after` extends forward to the end of the sentence containing the match —
// real boundaries in the source text, never a fixed character cut that can
// land mid-sentence (the excerpt-cutoff regression this fixed). `radius` is
// now the MAX distance the search may look for a boundary, not the exact
// window size: a well-punctuated match typically ends up shorter than
// radius (stopping at the real sentence end); a punctuation-free run of text
// with no boundary in range is still capped at radius, so a single run-on
// chunk can't balloon to "almost the whole document" (the extraction-quality
// case investigated separately — this is a legitimate, honest cap, not a
// truncation of a real sentence). When the match itself spans more than one
// sentence (an elided "start … end" quote, or a quote that simply runs
// across a period), the window naturally covers every sentence it touches,
// start to end — never fragments to "just the first".
export type QuoteExcerpt = { before: string; match: string; after: string; clippedStart: boolean; clippedEnd: boolean };

export function excerptAround(text: string, quote: string, radius = 220): QuoteExcerpt | null {
  const span = findQuoteSpan(text, quote);
  if (!span) return null;
  const [s, e] = span;
  const start = sentenceStart(text, s, radius);
  const end = sentenceEnd(text, e, radius);
  return {
    before: text.slice(start, s),
    match: text.slice(s, e),
    after: text.slice(e, end),
    clippedStart: start > 0,
    clippedEnd: end < text.length,
  };
}
