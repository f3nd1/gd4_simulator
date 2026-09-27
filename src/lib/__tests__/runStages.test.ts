import { describe, it, expect } from "vitest";
import { buildRunStages, passSpans } from "../runStages";
import type { AiCallRecord, EvidenceAssessmentResult, PPDReviewResult } from "../../types";

const T0 = 1_700_000_000_000;
const c = (pass: string, ms: number, seq = 1): AiCallRecord =>
  ({ seq, pass, label: "", startedAt: T0, durationMs: ms, outcome: "ok", promptChars: 0, responseChars: 0 });

// The real 5.5 shape: procedure 186.5s then records 553.2s, runAt stamped at
// the END of each pass.
const ppd = (over: Partial<PPDReviewResult> = {}): PPDReviewResult => ({
  subCriterionId: "5.5", rows: [], live: true,
  runAt: new Date(T0 + 186_500).toISOString(), durationMs: 186_500,
  stageTimings: { listingMs: 2_000, readMs: 131_700 }, aiCallLog: [c("procedure/extract", 52_800)],
  ...over,
} as PPDReviewResult);
const ev = (over: Partial<EvidenceAssessmentResult> = {}): EvidenceAssessmentResult => ({
  subCriterionId: "5.5", rows: [], live: true,
  runAt: new Date(T0 + 186_500 + 2_100 + 553_200).toISOString(), durationMs: 553_200,
  stageTimings: { listingMs: 3_000, readMs: 150_500 }, aiCallLog: [c("records/extract", 399_700)],
  ...over,
} as EvidenceAssessmentResult);

describe("runAt is the END of a pass", () => {
  it("places each pass by subtracting its duration, not by adding it", () => {
    const s = passSpans(ppd(), ev());
    expect(s.pStart).toBe(T0);
    expect(s.pEnd).toBe(T0 + 186_500);
    // The real gap here is 2.1s. Reading runAt as a start would report it as
    // 2.1s + (553.2 - 186.5) = 368.8s, which is the six-minute gap reported
    // from a real run.
    expect(s.betweenMs).toBe(2_100);
  });

  it("measures the wall clock from the first start to the last end", () => {
    expect(passSpans(ppd(), ev()).wallMs).toBe(186_500 + 2_100 + 553_200);
  });
});

describe("the rows account for the whole run", () => {
  it("sums to the wall clock exactly", () => {
    const s = buildRunStages({ ppd: ppd(), evidence: ev() });
    expect(s.rows.reduce((n, r) => n + r.ms, 0)).toBe(s.wallMs);
  });

  it("carves OCR out of the read time rather than adding it on top", () => {
    const withOcr = buildRunStages({
      ppd: ppd({ aiCallLog: [c("procedure/extract", 52_800), c("procedure/ocr", 100_000, 2)] }),
      evidence: ev(),
    });
    const reading = withOcr.rows.find((r) => r.key === "reading")!;
    const ocr = withOcr.rows.find((r) => r.key === "ocr")!;
    expect(ocr.ms).toBe(100_000);
    expect(reading.ms).toBe(131_700 - 100_000 + 150_500);
    expect(withOcr.rows.reduce((n, r) => n + r.ms, 0)).toBe(withOcr.wallMs);
  });

  it("shows a residual rather than hiding it", () => {
    // Nothing instrumented but the inter-pass gap, which is derived from the
    // timestamps and so is still known. Everything else must land in
    // Unaccounted rather than vanish.
    const s = buildRunStages({ ppd: ppd({ stageTimings: undefined, aiCallLog: undefined }), evidence: ev({ stageTimings: undefined, aiCallLog: undefined }) });
    const un = s.rows.find((r) => r.key === "unaccounted")!;
    const between = s.rows.find((r) => r.key === "between")!.ms;
    expect(un.ms).toBe(s.wallMs - between);
    expect(un.pct).toBeGreaterThan(99);
    expect(s.rows.reduce((n, r) => n + r.ms, 0)).toBe(s.wallMs);
  });

  it("still sums to the wall clock when the stages overlap, via a negative row", () => {
    // Clamping the residual at zero would leave the rows totalling more than
    // the header, which is the one thing this panel must never do.
    const s = buildRunStages({ ppd: ppd({ stageTimings: { listingMs: 999_999, readMs: 999_999 } }), evidence: ev() });
    const un = s.rows.find((r) => r.key === "unaccounted")!;
    expect(un.ms).toBeLessThan(0);
    expect(un.label).toBe("Overlap between stages");
    expect(un.detail).toMatch(/counting the same time/i);
    expect(s.rows.reduce((n, r) => n + r.ms, 0)).toBe(s.wallMs);
  });

  it("says when the total is added up rather than measured", () => {
    const s = buildRunStages({ ppd: ppd({ runAt: "not a date" }), evidence: ev({ runAt: "not a date" }) });
    expect(s.wallMeasured).toBe(false);
    expect(s.note).toMatch(/added together rather than a measured wall clock/i);
  });

  it("keeps an Unaccounted row even when it is zero, so nobody wonders", () => {
    expect(buildRunStages({ ppd: ppd(), evidence: ev() }).rows.map((r) => r.key)).toContain("unaccounted");
  });
});
