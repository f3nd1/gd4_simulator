import { describe, it, expect } from "vitest";
import { splitMismatchWarning } from "../selfCheck";

describe("splitMismatchWarning", () => {
  it("leaves an ordinary comment alone", () => {
    const why = "The records show the review happened and name the attendees.";
    expect(splitMismatchWarning(why)).toEqual({ why, warning: "" });
  });

  it("lifts the guard's warning out of the comment", () => {
    const why = 'Evidence was found for part of this line.\n\n⚠ Verdict/comment mismatch: the model returned verdict "Partial" but its own comment concluded "requirement is met". Re-run to get a consistent assessment.';
    const out = splitMismatchWarning(why);
    expect(out.why).toBe("Evidence was found for part of this line.");
    expect(out.warning.startsWith("Verdict/comment mismatch:")).toBe(true);
    // Nothing is dropped: both halves still carry the original wording.
    expect(`${out.why} ${out.warning}`).toContain("Re-run to get a consistent assessment.");
  });
});
