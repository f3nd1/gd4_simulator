import { describe, it, expect } from "vitest";
import {
  consistencyAgreement, consistencySummary, bandStabilityLabel, gapVariationLabel,
  ppdVerdictToStatus, countGaps, countByType, bandEstimate,
  abWinner, abVerdictLine, abOverallTally,
  type ConsistencyLine, type ABPathOutcome, type ABTestResult,
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
  it("summary flags failed runs and warns on low agreement", () => {
    const s = consistencySummary(60, [2, 2], [5, 6], [3], 3);
    expect(s).toContain("60% verdict agreement across 3 runs");
    expect(s).toContain("run 3 failed");
    expect(s).toContain("inconsistent");
    expect(consistencySummary(95, [2, 2, 2], [5, 5, 5], [], 3)).toContain("highly repeatable");
  });
});

describe("status normalisation + counts + band estimate", () => {
  it("maps Option A PPD verdicts onto the shared status scale", () => {
    expect(ppdVerdictToStatus("Adequate")).toBe("Met");
    expect(ppdVerdictToStatus("Partially documented")).toBe("Partial");
    expect(ppdVerdictToStatus("Not documented")).toBe("Not met");
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
