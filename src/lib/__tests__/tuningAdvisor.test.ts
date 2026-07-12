import { describe, it, expect } from "vitest";
import { recommendFromConsistency, recommendFromAB, recommendFromBenchmark, AGREEMENT_TARGET } from "../tuningAdvisor";
import type { ConsistencyTestResult, ABTestResult, ABPathOutcome } from "../calibrationTesting";

function cons(over: Partial<ConsistencyTestResult> = {}): ConsistencyTestResult {
  return {
    id: "6.3-2026-07-04T00:00:00.000Z", subCriterionId: "6.3", path: "B", runs: 3, runAt: "2026-07-04T00:00:00.000Z", temperature: 0.7,
    lines: [
      { ref: "6.3.1.DS1", text: "line 1", verdicts: ["Met", "Met", "Met"] },
      { ref: "6.3.1.DS2", text: "line 2", verdicts: ["Partial", "Not met", "Partial"] },
    ],
    bands: [3, 3, 2], gapCounts: [1, 2, 1], failedRuns: [], agreementPct: 50,
    summary: "50% agreement", ...over,
  };
}
const outcome = (o: Partial<ABPathOutcome> = {}): ABPathOutcome => ({ ran: true, findingsTotal: 3, byType: { NC: 1, OFI: 2, OBS: 4 }, bandEstimate: 3, judged: true, caught: 0, partial: 0, missed: 0, ...o });
function ab(over: Partial<ABTestResult> = {}): ABTestResult {
  return { subCriterionId: "4.2", runAt: "2026-07-04T00:00:00.000Z", benchmarkCount: 4, patterns: ["not documented in PPD"], a: outcome({ caught: 3 }), b: outcome({ caught: 1 }), winner: "A", verdictLine: "", ...over };
}

describe("recommendFromConsistency", () => {
  it("below target with temp headroom → one-click lower-temperature action", () => {
    const [rec] = recommendFromConsistency(cons({ agreementPct: 40, temperature: 0.7 }));
    expect(rec.severity).toBe("action");
    expect(rec.apply).toEqual({ type: "temperature", value: 0.1 });
    expect(rec.title).toContain("lower temperature to 0.10");
    expect(rec.evidence.join(" ")).toContain("6.3.1.DS2"); // names the disagreeing line
  });
  it("below target but temperature already low → advisory ambiguity flag, no apply", () => {
    const [rec] = recommendFromConsistency(cons({ agreementPct: 40, temperature: 0.1 }));
    expect(rec.severity).toBe("advisory");
    expect(rec.apply).toBeUndefined();
    expect(rec.title).toContain("genuinely ambiguous");
    expect(rec.copyableInstruction).toContain("6.3.1.DS2");
    expect(rec.copyableInstruction).toContain("generalise");
  });
  it("at or above target → ok, no action", () => {
    const [rec] = recommendFromConsistency(cons({ agreementPct: AGREEMENT_TARGET, temperature: 0.1 }));
    expect(rec.severity).toBe("ok");
    expect(rec.apply).toBeUndefined();
  });
  it("unscorable → advisory, no fabricated recommendation", () => {
    expect(recommendFromConsistency(cons({ agreementPct: null }))[0].severity).toBe("advisory");
  });

  // Same honesty bug that consistencySummary() had: unconditionally blaming
  // "too many runs failed" even when nothing failed (gpt-5-mini investigation).
  it("unscorable because only 1 run → names the run-count cause, not failures", () => {
    const rec = recommendFromConsistency(cons({ agreementPct: null, runs: 1, failedRuns: [] }))[0];
    expect(rec.reasoning).toContain("Only 1 run");
    expect(rec.reasoning).not.toContain("Too many runs failed");
  });
  it("unscorable with genuine failed runs → keeps the failure-blaming wording", () => {
    const rec = recommendFromConsistency(cons({ agreementPct: null, runs: 3, failedRuns: [2, 3] }))[0];
    expect(rec.reasoning).toContain("Too many runs failed");
  });
  it("unscorable but every run completed ok with unassessed lines → points to diagnostics, not a false failure claim", () => {
    const rec = recommendFromConsistency(cons({ agreementPct: null, runs: 2, failedRuns: [] }))[0];
    expect(rec.reasoning).toContain("run diagnostics");
    expect(rec.reasoning).not.toContain("Too many runs failed");
  });
});

describe("recommendFromAB", () => {
  it("recommends path defaults to the accuracy winner per decided sub-criterion", () => {
    const [rec] = recommendFromAB([
      ab({ subCriterionId: "4.2", winner: "A" }),
      ab({ subCriterionId: "7.1", winner: "B", patterns: ["not implemented per PPD"] }),
      ab({ subCriterionId: "2.3", winner: "no-truth", benchmarkCount: 0 }),
    ]);
    expect(rec.severity).toBe("action");
    expect(rec.apply).toEqual({ type: "path-defaults", paths: { "4.2": "A", "7.1": "B" } });
    expect(rec.benchmarkDerived).toBe(true);
    expect(rec.reasoning).toContain("Option A won on 4.2");
    expect(rec.reasoning).toContain("Option B won on 7.1");
  });
  it("no decided comparisons → advisory only, no apply", () => {
    const [rec] = recommendFromAB([ab({ winner: "no-truth", benchmarkCount: 0 })]);
    expect(rec.severity).toBe("advisory");
    expect(rec.apply).toBeUndefined();
  });
});

describe("recommendFromBenchmark", () => {
  const afis = [
    { id: "F1", findingPattern: "not implemented per PPD", kind: "AFI" },
    { id: "F2", findingPattern: "not implemented per PPD", kind: "AFI" },
    { id: "F3", findingPattern: "not documented in PPD", kind: "AFI" },
    { id: "F4", findingPattern: "not implemented per PPD", kind: "AFI" },
    { id: "F5", findingPattern: "not implemented per PPD", kind: "AFI" },
  ];
  it("identifies the dominant missed pattern and is advisory-only (no apply), with overfitting guard", () => {
    const matches = { F1: { status: "missed" as const }, F2: { status: "missed" as const }, F4: { status: "partial" as const }, F5: { status: "missed" as const }, F3: { status: "caught" as const } };
    const [rec] = recommendFromBenchmark(matches, afis);
    expect(rec.severity).toBe("advisory");
    expect(rec.apply).toBeUndefined();
    expect(rec.title).toContain("not implemented per PPD");
    expect(rec.benchmarkDerived).toBe(true);
    expect(rec.copyableInstruction).toContain("generalise");
    expect(rec.copyableInstruction).not.toContain("F1"); // never references benchmark items verbatim
  });
  it("all caught → ok", () => {
    const [rec] = recommendFromBenchmark({ F1: { status: "caught" }, F2: { status: "caught" }, F3: { status: "caught" }, F4: { status: "caught" }, F5: { status: "caught" } }, afis);
    expect(rec.severity).toBe("ok");
  });
});
