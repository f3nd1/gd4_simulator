import { describe, it, expect } from "vitest";
import { resolvePpdSelection, mostRecentlyRunSubCriterion, ppdResultSummary } from "../ppdSelection";
import type { PPDReviewResult, PPDReviewRow } from "../../types";

function result(subId: string, runAt: string, rows: Partial<PPDReviewRow>[] = []): PPDReviewResult {
  return {
    subCriterionId: subId, runAt, live: true,
    rows: rows.map((r, i) => ({ ref: `${subId}.1.DS${i + 1}`, gd4ItemId: `${subId}.1`, requirementText: "x", verdict: "Adequate", shortComment: "", fullComment: "", chunkIds: [], ...r })) as PPDReviewRow[],
  };
}

describe("resolvePpdSelection — PPD page shows saved work, not a blank slate", () => {
  const results = {
    "6.3": result("6.3", "2026-07-01T10:00:00Z"),
    "1.2": result("1.2", "2026-07-03T09:00:00Z"),
  };
  it("URL ?item= always wins", () => {
    expect(resolvePpdSelection("4.2", "6.3", results)).toBe("4.2");
  });
  it("falls back to the last-viewed sub-criterion when no param (the bare sidebar-link case)", () => {
    expect(resolvePpdSelection(null, "6.3", results)).toBe("6.3");
    expect(resolvePpdSelection("", "6.3", results)).toBe("6.3");
  });
  it("falls back to the MOST RECENTLY RUN result when there's no param and nothing viewed", () => {
    expect(resolvePpdSelection(null, null, results)).toBe("1.2"); // 07-03 newer than 07-01
  });
  it("returns empty only when nothing was ever reviewed and no param", () => {
    expect(resolvePpdSelection(null, null, {})).toBe("");
  });
});

describe("mostRecentlyRunSubCriterion", () => {
  it("picks the newest runAt, empty for none", () => {
    expect(mostRecentlyRunSubCriterion({ a: result("a", "2026-01-01T00:00:00Z"), b: result("b", "2026-02-01T00:00:00Z") })).toBe("b");
    expect(mostRecentlyRunSubCriterion({})).toBe("");
  });
});

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
