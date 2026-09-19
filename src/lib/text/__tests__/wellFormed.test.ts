import { describe, it, expect } from "vitest";
import { wellFormedText, wellFormedJsonText, safeCutIndex, sliceWholeChars } from "../wellFormed";

const HI = "\uD83D", LO = "\uDE00", EMOJI = "\u{1F600}";  // EMOJI === HI + LO
// String.toWellFormed is ES2024 and the project targets ES2023, so the test
// asks the question directly rather than bumping the lib for one assertion.
const wellFormed = (s: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe("wellFormedText — what goes into a prompt", () => {
  it("leaves ordinary text and VALID astral characters alone", () => {
    for (const s of ["Intervention records dated 4 May 2026.", `Reviewed ${EMOJI} at the meeting.`, "Fee protection, clause 5.4 — 60% refund", "学生名簿"]) {
      expect(wellFormedText(s)).toBe(s);
    }
  });

  it("replaces a lone surrogate rather than deleting it", () => {
    // Deleting would silently shorten quoted evidence text; U+FFFD keeps the
    // position and is visibly not a character.
    expect(wellFormedText(`Attendance ${HI} register`)).toBe("Attendance � register");
    expect(wellFormedText(`Refund ${LO} table`)).toBe("Refund � table");
  });

  it("makes a JSON body the API can decode", () => {
    const raw = `Attendance ${HI} register`;
    // Before: valid JSON syntax, but an escape that is not decodable UTF-8.
    expect(/\\u[dD][89abAB][0-9a-fA-F]{2}/.test(JSON.stringify({ c: raw }))).toBe(true);
    expect(/\\u[dD][89abAB][0-9a-fA-F]{2}/.test(JSON.stringify({ c: wellFormedText(raw) }))).toBe(false);
    expect(wellFormed(wellFormedText(raw))).toBe(true);
  });

  it("drops NUL", () => {
    expect(wellFormedText("Student list\u0000 continued.")).toBe("Student list continued.");
  });
});

describe("wellFormedJsonText — what goes into a text column", () => {
  it("removes the lone ESCAPE the previous storage rule could not see", () => {
    const json = JSON.stringify({ c: `Attendance ${HI} register` });
    // The old rules, verbatim: pairs of escapes, and RAW surrogates.
    const old = json.replace(/\\ud[89ab][0-9a-f]{2}\\ud[cdef][0-9a-f]{2}/gi, "").replace(/[\uD800-\uDFFF]/g, "");
    expect(/\\u[dD][89abAB][0-9a-fA-F]{2}/.test(old)).toBe(true);
    expect(/\\u[dD][89abAB][0-9a-fA-F]{2}/.test(wellFormedJsonText(json))).toBe(false);
  });

  it("still removes valid pairs, escaped NUL and raw surrogates, as it always has", () => {
    expect(wellFormedJsonText(JSON.stringify({ c: `a${EMOJI}b` }))).toBe('{"c":"ab"}');
    expect(wellFormedJsonText(JSON.stringify({ c: "a\u0000b" }))).toBe('{"c":"ab"}');
    expect(wellFormedJsonText(`{"c":"a${HI}b"}`)).toBe('{"c":"ab"}');
  });

  it("leaves clean JSON byte for byte", () => {
    const json = JSON.stringify({ ref: "6.3.1.DS1", verdict: "Met", note: "Clause 5.4 — reviewed" });
    expect(wellFormedJsonText(json)).toBe(json);
  });
});

describe("safeCutIndex — the slicers", () => {
  it("moves a cut off the middle of a character, and leaves every other cut alone", () => {
    const t = `ab${EMOJI}cd`;           // indices: a b HI LO c d
    expect(safeCutIndex(t, 3)).toBe(2); // between the halves
    for (const i of [0, 1, 2, 4, 5, 6]) expect(safeCutIndex(t, i)).toBe(i);
  });

  it("never splits a pair, and loses or duplicates nothing", () => {
    const t = `${"x".repeat(9)}${EMOJI}${"y".repeat(9)}`;
    for (let cut = 0; cut <= t.length; cut++) {
      const a = sliceWholeChars(t, 0, cut);
      const b = sliceWholeChars(t, cut, t.length);
      expect(wellFormed(a)).toBe(true);
      expect(wellFormed(b)).toBe(true);
      // Both sides ask the same question about the same index, so the halves
      // still reassemble into the original.
      expect(a + b).toBe(t);
    }
  });

  it("reproduces the real failure: an emoji on the 24,000 part boundary", () => {
    const MAX_PART_CHARS = 24_000;
    const u = "a".repeat(30_000).split("");
    u[MAX_PART_CHARS - 1] = HI; u[MAX_PART_CHARS] = LO;
    const body = u.join("");
    const before = [body.slice(0, MAX_PART_CHARS), body.slice(MAX_PART_CHARS, 2 * MAX_PART_CHARS)];
    expect(before.filter((p) => !wellFormed(p))).toHaveLength(2);
    const after = [sliceWholeChars(body, 0, MAX_PART_CHARS), sliceWholeChars(body, MAX_PART_CHARS, 2 * MAX_PART_CHARS)];
    expect(after.filter((p) => !wellFormed(p))).toHaveLength(0);
    expect(after.join("")).toBe(body);
  });
});
