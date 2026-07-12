import { describe, it, expect } from "vitest";
import {
  consistencyAgreement, consistencySummary, bandStabilityLabel, gapVariationLabel,
  ppdVerdictToStatus, countGaps, countByType, bandEstimate,
  spliceRetryIntoConsistencyResult,
  abWinner, abVerdictLine, abOverallTally,
  type ConsistencyLine, type ABPathOutcome, type ABTestResult, type ConsistencyTestResult, type RetryRunOutput,
} from "../calibrationTesting";

const line = (ref: string, verdicts: (string | null)[]): ConsistencyLine => ({ ref, text: ref, verdicts });

const outcome = (over: Partial<ABPathOutcome> = {}): ABPathOutcome => ({
  ran: true, findingsTotal: 3, byType: { NC: 1, OFI: 2, OBS: 4 }, bandEstimate: 3,
  judged: true, caught: 0, partial: 0, missed: 0, ...over,
});

describe("consistencyAgreement", () => {
  it("all runs identical on every line → 100%", () => {
    const { agreementPct, agreedLines, scorableLines } = consistencyAgreement([
      line("r1", ["Met", "Met", "Met"]),
      line("r2", ["Not met", "Not met", "Not met"]),
    ]);
    expect(agreementPct).toBe(100);
    expect(agreedLines).toBe(2);
    expect(scorableLines).toBe(2);
  });

  it("one line differing lowers the score", () => {
    const { agreementPct } = consistencyAgreement([
      line("r1", ["Met", "Met", "Met"]),
      line("r2", ["Met", "Partial", "Met"]), // disagreement
      line("r3", ["Not met", "Not met", "Not met"]),
      line("r4", ["Partial", "Partial", "Partial"]),
    ]);
    expect(agreementPct).toBe(75); // 3 of 4 agree
  });

  it("a failed run's nulls shrink scorability, never count as agreement or disagreement", () => {
    const { agreementPct, scorableLines } = consistencyAgreement([
      line("r1", ["Met", null, "Met"]),      // 2 real verdicts, agree
      line("r2", ["Met", null, "Partial"]),  // 2 real verdicts, differ
      line("r3", [null, null, "Met"]),       // 1 real verdict — unscorable
    ]);
    expect(scorableLines).toBe(2);
    expect(agreementPct).toBe(50);
  });

  it("no scorable lines → null (never a fabricated 100%)", () => {
    expect(consistencyAgreement([line("r1", [null, null, "Met"])]).agreementPct).toBeNull();
    expect(consistencyAgreement([]).agreementPct).toBeNull();
  });
});

describe("consistency labels + summary", () => {
  it("band stability and gap variation label failed runs as ✗", () => {
    expect(bandStabilityLabel([2, 2, 2])).toBe("band stable (2, 2, 2)");
    expect(bandStabilityLabel([2, null, 3])).toBe("band varied (2, ✗, 3)");
    expect(gapVariationLabel([6, 6, 6])).toBe("findings stable (6, 6, 6)");
    expect(gapVariationLabel([6, 6, 7])).toBe("findings varied by 1 (6, 6, 7)");
  });
  it("summary counts only COMPLETED runs — 2-of-5 completed must never read as 'across 5 runs'", () => {
    const s = consistencySummary(60, [2, 2], [5, 6], [3], 3);
    expect(s).toContain("60% verdict agreement across 2 completed runs (of 3)");
    expect(s).toContain("run 3 failed");
    expect(s).toContain("inconsistent");
    expect(consistencySummary(95, [2, 2, 2], [5, 5, 5], [], 3)).toContain("across 3 completed runs (of 3)");
    expect(consistencySummary(95, [2, 2, 2], [5, 5, 5], [], 3)).toContain("highly repeatable");
    // The reported 6.1 case: 3 of 5 failed → the number rests on 2 runs.
    expect(consistencySummary(71, [3, 3, null, null, null], [2, 3, null, null, null], [3, 4, 5], 5)).toContain("71% verdict agreement across 2 completed runs (of 5)");
  });
});

describe("status normalisation + counts + band estimate", () => {
  it("maps Option A PPD verdicts onto the shared status scale — 'Not assessed' is NULL, never a fabricated gap", () => {
    expect(ppdVerdictToStatus("Adequate")).toBe("Met");
    expect(ppdVerdictToStatus("Partially documented")).toBe("Partial");
    expect(ppdVerdictToStatus("Not documented")).toBe("Not met");
    // A failed AI call used to map to "Not met" here — folding call
    // failures into the measurement as if they were real gaps.
    expect(ppdVerdictToStatus("Not assessed")).toBeNull();
  });
  it("counts and band estimate exclude unassessed (null) lines", () => {
    expect(countGaps(["Met", null, "Not met"])).toBe(1);
    expect(countByType(["Met", null, "Partial"])).toEqual({ NC: 0, OFI: 1, OBS: 1 });
    expect(bandEstimate([null, null])).toBeNull();
    expect(bandEstimate(["Met", null])).toBe(bandEstimate(["Met"])); // null ignored, not counted as a miss
  });
  it("gaps = non-Met lines; byType follows the app's status→type rule", () => {
    const statuses = ["Met", "Partial", "Not met", "Not met"] as const;
    expect(countGaps([...statuses])).toBe(3);
    expect(countByType([...statuses])).toEqual({ NC: 2, OFI: 1, OBS: 1 });
  });
  it("band estimate reuses the real coverageCap thresholds", () => {
    expect(bandEstimate(["Met", "Met", "Met", "Met"])).toBe(5);      // 100%
    expect(bandEstimate(["Met", "Met", "Partial", "Not met"])).toBe(3); // 62.5%
    expect(bandEstimate(["Not met", "Not met"])).toBe(2);            // 0% → floor cap
    expect(bandEstimate([])).toBeNull();
  });
});

describe("spliceRetryIntoConsistencyResult", () => {
  // A 3-run test shaped like the reported 6.1 failure: run 3 failed outright.
  const baseResult = (): ConsistencyTestResult => ({
    subCriterionId: "6.1", path: "A", runs: 3, runAt: "2026-07-10T00:00:00.000Z",
    temperature: 0.1, effectiveTemperature: null, pipelineParity: true,
    lines: [
      { ref: "6.1.1.DS1", text: "req 1", verdicts: ["Met", "Met", null], details: [{ note: "n1", evidence: ["C001"] }, { note: "n1b", evidence: [] }, null] },
      { ref: "6.1.1.DS2", text: "req 2", verdicts: ["Partial", "Not met", null], details: [{ note: "n2", evidence: [] }, { note: "n2b", evidence: [] }, null] },
    ],
    bands: [3, 3, null], gapCounts: [1, 2, null],
    failedRuns: [3], failedRunErrors: { 3: "Google Drive session expired and could not be refreshed" },
    agreementPct: 50, summary: "old summary",
  });
  const okRetry = (over: Partial<RetryRunOutput> = {}): RetryRunOutput => ({
    ok: true,
    lines: [
      { ref: "6.1.1.DS1", text: "req 1", status: "Met", note: "retry note 1", evidence: ["C002"] },
      { ref: "6.1.1.DS2", text: "req 2", status: "Partial", note: "retry note 2", evidence: [] },
    ],
    gapCount: 1, bandEstimate: 4, ...over,
  });

  it("a successful retry fills the failed run's column and clears its failed-run bookkeeping", () => {
    const r = spliceRetryIntoConsistencyResult(baseResult(), 3, okRetry());
    expect(r.lines[0].verdicts).toEqual(["Met", "Met", "Met"]);
    expect(r.lines[1].verdicts).toEqual(["Partial", "Not met", "Partial"]);
    expect(r.lines[0].details?.[2]).toEqual({ note: "retry note 1", evidence: ["C002"] });
    expect(r.bands).toEqual([3, 3, 4]);
    expect(r.gapCounts).toEqual([1, 2, 1]);
    expect(r.failedRuns).toEqual([]);
    expect(r.failedRunErrors).toBeUndefined();
    // Agreement recomputed over the now-3 real verdicts per line: line 1
    // agrees (Met×3), line 2 does not (Partial/Not met/Partial) → 50%.
    expect(r.agreementPct).toBe(50);
    expect(r.summary).toContain("50% verdict agreement across 3 completed runs (of 3)");
    expect(r.summary).not.toContain("failed");
  });

  it("a retry that itself fails keeps the run marked failed and updates the stored error", () => {
    const r = spliceRetryIntoConsistencyResult(baseResult(), 3, { ok: false, error: "429 rate limit", lines: [], gapCount: 0, bandEstimate: null });
    expect(r.failedRuns).toEqual([3]);
    expect(r.failedRunErrors).toEqual({ 3: "429 rate limit" });
    expect(r.lines[0].verdicts).toEqual(["Met", "Met", null]);
    expect(r.bands[2]).toBeNull();
    expect(r.summary).toContain("run 3 failed");
  });

  it("new refs the retry found are appended with nulls in every other run's column", () => {
    const r = spliceRetryIntoConsistencyResult(baseResult(), 3, okRetry({
      lines: [...okRetry().lines, { ref: "6.1.2.DS1", text: "new req", status: "Not met", note: "only the retry saw this", evidence: [] }],
    }));
    const added = r.lines.find((l) => l.ref === "6.1.2.DS1");
    expect(added?.verdicts).toEqual([null, null, "Not met"]);
    expect(added?.details).toEqual([null, null, { note: "only the retry saw this", evidence: [] }]);
    // A single-verdict line is unscorable — it must not distort the agreement %.
    expect(r.agreementPct).toBe(50);
  });

  it("retrying a run that previously SUCCEEDED replaces its column (and can newly fail it)", () => {
    const r = spliceRetryIntoConsistencyResult(baseResult(), 2, { ok: false, error: "cancelled", lines: [], gapCount: 0, bandEstimate: null });
    expect(r.failedRuns).toEqual([2, 3]); // sorted, no duplicates
    expect(r.failedRunErrors).toEqual({ 2: "cancelled", 3: "Google Drive session expired and could not be refreshed" });
    expect(r.lines[1].verdicts).toEqual(["Partial", null, null]);
    // Only run 1 has verdicts now → no line has 2+ verdicts → unscorable.
    expect(r.agreementPct).toBeNull();
  });

  it("leaves record-level provenance fields (temperature/parity/runAt) untouched and rejects out-of-range run numbers", () => {
    const base = baseResult();
    const r = spliceRetryIntoConsistencyResult(base, 3, okRetry());
    expect(r.temperature).toBe(0.1);
    expect(r.effectiveTemperature).toBeNull();
    expect(r.pipelineParity).toBe(true);
    expect(r.runAt).toBe("2026-07-10T00:00:00.000Z");
    expect(spliceRetryIntoConsistencyResult(base, 0, okRetry())).toBe(base);
    expect(spliceRetryIntoConsistencyResult(base, 4, okRetry())).toBe(base);
  });

  it("a legacy record without details arrays gets them built during the splice", () => {
    const base = baseResult();
    base.lines = base.lines.map(({ details: _d, ...rest }) => rest);
    const r = spliceRetryIntoConsistencyResult(base, 3, okRetry());
    expect(r.lines[0].details).toEqual([null, null, { note: "retry note 1", evidence: ["C002"] }]);
  });
});

describe("abWinner — accuracy beats raw counts", () => {
  it("more caught real findings wins, regardless of raw finding volume", () => {
    const a = outcome({ caught: 3, partial: 0, findingsTotal: 4 });
    const b = outcome({ caught: 2, partial: 2, findingsTotal: 9 }); // more findings, fewer catches
    expect(abWinner(a, b, 4)).toBe("A");
  });
  it("partial catches break a caught tie; full tie → tie", () => {
    expect(abWinner(outcome({ caught: 2, partial: 1 }), outcome({ caught: 2, partial: 0 }), 4)).toBe("A");
    expect(abWinner(outcome({ caught: 2, partial: 1 }), outcome({ caught: 2, partial: 1 }), 4)).toBe("tie");
  });
  it("no benchmark truth or failed judge → no-truth (raw counts never decide)", () => {
    expect(abWinner(outcome({ caught: 3 }), outcome(), 0)).toBe("no-truth");
    expect(abWinner(outcome({ judged: false }), outcome(), 4)).toBe("no-truth");
  });
});

describe("abVerdictLine", () => {
  it("states accuracy first and names the winner with the accuracy rationale", () => {
    const s = abVerdictLine("4.2", outcome({ caught: 3, partial: 1, findingsTotal: 5, byType: { NC: 3, OFI: 2, OBS: 2 }, bandEstimate: 2 }), outcome({ caught: 2, findingsTotal: 4, bandEstimate: 1 }), 4);
    expect(s).toContain("Option A caught 3 of 4 real findings");
    expect(s).toContain("Option B caught 2");
    expect(s).toContain("A raised 5 findings");
    expect(s).toContain("Option A performed better here (accuracy");
  });
  it("without truth, says raw counts cannot decide 'better'", () => {
    const s = abVerdictLine("2.3", outcome(), outcome(), 0);
    expect(s).toContain("no benchmark truth");
    expect(s).toContain("cannot say which path is BETTER");
  });
});

describe("abOverallTally", () => {
  const test = (winner: ABTestResult["winner"], patterns: string[]): ABTestResult => ({
    subCriterionId: "x", runAt: "2026-07-04T00:00:00.000Z", benchmarkCount: 2, patterns,
    a: outcome(), b: outcome(), winner, verdictLine: "",
  });
  it("tallies wins/ties/no-truth and groups decided wins by finding pattern", () => {
    const tally = abOverallTally([
      test("A", ["not documented in PPD"]),
      test("A", ["not documented in PPD", "no timeline/monitoring"]),
      test("B", ["not implemented per PPD"]),
      test("tie", ["other"]),
      test("no-truth", []),
    ]);
    expect(tally).toMatchObject({ aWins: 2, bWins: 1, ties: 1, noTruth: 1 });
    expect(tally.byPattern["not documented in PPD"]).toEqual({ a: 2, b: 0 });
    expect(tally.byPattern["not implemented per PPD"]).toEqual({ a: 0, b: 1 });
    expect(tally.patternNote).toContain('A stronger on "not documented in PPD"');
    expect(tally.patternNote).toContain('B stronger on "not implemented per PPD"');
  });
});
