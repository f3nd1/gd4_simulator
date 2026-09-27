import { describe, it, expect } from "vitest";
import { contentKey } from "../contentKey";

describe("contentKey", () => {
  it("matches identical text", () => {
    expect(contentKey("Board minutes 12 March 2026")).toBe(contentKey("Board minutes 12 March 2026"));
  });

  it("separates two files that share a NAME but not content", () => {
    // The real case: two "United Ceres College Mail - Assessment Results for
    // DBM001.pdf" in one run, 1,433 and 2,828 characters.
    const a = "x".repeat(1_433);
    const b = "x".repeat(2_828);
    expect(contentKey(a)).not.toBe(contentKey(b));
  });

  it("separates same-length text that differs", () => {
    expect(contentKey("Examination Board 27")).not.toBe(contentKey("Examination Board 25"));
  });

  it("carries the length, so a mismatch is visible without trusting the hash", () => {
    expect(contentKey("abcd").startsWith("4:")).toBe(true);
  });

  it("is stable across calls and cheap on a large document", () => {
    const big = "Assessment Plan ".repeat(20_000);
    expect(contentKey(big)).toBe(contentKey(big));
  });

  it("does not collide on the single-character difference a duplicate check must catch", () => {
    expect(contentKey("Read 20,006 chars")).not.toBe(contentKey("Read 20,007 chars"));
  });
});
