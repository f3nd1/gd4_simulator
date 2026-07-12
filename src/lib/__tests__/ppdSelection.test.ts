import { describe, it, expect } from "vitest";
import { ppdResultSummary } from "../ppdSelection";
import type { PPDReviewRow } from "../../types";

describe("ppdResultSummary — the 'Last reviewed …' counts", () => {
  it("counts verdicts by bucket", () => {
    const s = ppdResultSummary([
      { verdict: "Adequate" }, { verdict: "Adequate" }, { verdict: "Partial" },
      { verdict: "Not documented" }, { verdict: "Not assessed" },
    ] as PPDReviewRow[]);
    expect(s).toMatchObject({ adequate: 2, partial: 1, gaps: 1, notAssessed: 1, total: 5 });
  });
  it("handles undefined rows", () => {
    expect(ppdResultSummary(undefined)).toMatchObject({ adequate: 0, total: 0 });
  });
});
