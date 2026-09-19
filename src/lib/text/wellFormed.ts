// The characters that cannot survive a trip out of this app, defined ONCE.
//
// A JavaScript string is UTF-16, so a character outside the basic plane (an
// emoji, some CJK extensions, various symbols) is TWO code units. Cut a string
// between those two units and each half is a LONE SURROGATE: still a legal JS
// string, but not text any more, because it maps to no character.
//
// Both places this app sends text out choke on one:
//
//   - PostgreSQL rejects lone surrogates in json/text columns, which is why
//     supabaseStorage has sanitised its uploads since the first workspace
//     loss.
//   - OpenAI rejects the request BODY. JSON.stringify turns a lone surrogate
//     into the six ASCII characters \ud83d, which is valid JSON syntax that
//     cannot be decoded to UTF-8, so a strict parser refuses the whole
//     request: "Invalid body: failed to parse JSON value". Measured: one
//     emoji landing on a slice boundary cost every requirement line in a
//     6.3 run, all reported "Not assessed".
//
// The two consumers need the same RULES and different OUTPUTS, which is why
// this module exports two thin functions over one shared definition rather
// than one function with a flag:
//
//   - storage may DELETE the offending characters: a stored blob that loses
//     an emoji is still the same audit record.
//   - a prompt may NOT. Deleting characters out of the middle of a quoted
//     document would change the evidence text the model reads and the
//     excerpts it quotes back. A lone surrogate is replaced with U+FFFD (the
//     standard replacement character), and a VALID pair is left alone.
//
// Leaf module on purpose: no imports, so supabaseStorage can use it without
// the import cycle that once left the Supabase credentials unpersisted.

// One half of a character, with no other half: a high surrogate not followed
// by a low one, or a low surrogate not preceded by a high one.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// The same thing AFTER JSON.stringify, where it is six ASCII characters. The
// negative lookarounds are what the previous storage rule was missing: it
// removed PAIRS of escapes and raw surrogates, so a lone escape went through
// untouched (verified: the rule left it in place).
const LONE_SURROGATE_ESCAPE = /\\u[dD][89abAB][0-9a-fA-F]{2}(?!\\u[dD][c-fC-F])|(?<!\\u[dD][89abAB][0-9a-fA-F]{2})\\u[dD][c-fC-F][0-9a-fA-F]{2}/g;

// NUL, raw and escaped. PostgreSQL rejects it outright; it has no place in
// document text either.
// Matched by code unit rather than by a control-character class, which the
// linter flags and which reads no more clearly.
const NUL = new RegExp(String.fromCharCode(0), "g");
const NUL_ESCAPE = /\\u0000/g;

// Text on its way into a prompt. Keeps every real character, including valid
// astral ones, and replaces only the halves that are not characters.
export function wellFormedText(s: string): string {
  return s.replace(NUL, "").replace(LONE_SURROGATE, "�");
}

// Already-stringified JSON on its way into a text column. Deletes rather than
// replaces, which is what this path has always done.
export function wellFormedJsonText(json: string): string {
  return json
    .replace(NUL_ESCAPE, "")
    .replace(NUL, "")
    // Valid pairs go too: this is storage, and the column has rejected them.
    .replace(/\\u[dD][89abAB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2}/g, "")
    .replace(LONE_SURROGATE_ESCAPE, "")
    .replace(/[\uD800-\uDFFF]/g, "");
}

// Where a slice may be cut so it never lands between the two halves of one
// character.
//
// EVERY slicer must route BOTH of its boundaries through this, because the
// end of one slice is the start of the next: they agree only if they ask the
// same question about the same index. Moving back rather than forward keeps
// the whole character in the following slice, so nothing is duplicated and
// nothing is lost.
export function safeCutIndex(text: string, i: number): number {
  if (i <= 0 || i >= text.length) return i;
  const before = text.charCodeAt(i - 1);
  const at = text.charCodeAt(i);
  const splits = before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff;
  return splits ? i - 1 : i;
}

// The slice itself, for callers that just want the text.
export function sliceWholeChars(text: string, start: number, end: number): string {
  return text.slice(safeCutIndex(text, start), safeCutIndex(text, end));
}
