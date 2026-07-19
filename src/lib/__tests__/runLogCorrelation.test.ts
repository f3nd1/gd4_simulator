import { describe, it, expect } from "vitest";
import { aiCallsForRun, typicalRunDurationSec, formatRoughDuration, estimateAuditSeconds, SECONDS_PER_FILE } from "../runLogCorrelation";
import type { AIReviewLogEntry, RunLogEntry } from "../../types";

function logEntry(over: Partial<AIReviewLogEntry> & { subjectId: string; createdAt: string }): AIReviewLogEntry {
  return {
    id: `LOG-${over.subjectId}-${over.createdAt}`,
    auditCycleId: "c1",
    agent: "Evidence Assessor",
    reviewType: "Evidence",
    verdict: "ok",
    confidence: "Medium",
    keyConcerns: [],
    recommendedAction: "",
    live: true,
    ...over,
  };
}

const run: RunLogEntry = {
  id: "RUN-1", mode: "hybrid-item", subCriterionIds: ["6.2"],
  startedAt: "2026-07-18T10:00:00.000Z", endedAt: "2026-07-18T10:05:00.000Z",
  status: "complete", perSub: [], bandsSet: [], bandsSkipped: [], summary: "",
};

describe("aiCallsForRun — time-window + sub correlation", () => {
  it("matches sub-criterion AND item-level (band) calls inside the window, in time order", () => {
    const log = [
      logEntry({ subjectId: "6.2", createdAt: "2026-07-18T10:01:00.000Z", agent: "PPD Requirements Reviewer" }),
      logEntry({ subjectId: "6.2.1", createdAt: "2026-07-18T10:04:00.000Z", agent: "Holistic Band Assessor" }), // item-level band call
      logEntry({ subjectId: "6.2", createdAt: "2026-07-18T10:02:00.000Z", agent: "Evidence Assessor" }),
    ];
    const out = aiCallsForRun(log, run);
    expect(out.map((e) => e.agent)).toEqual(["PPD Requirements Reviewer", "Evidence Assessor", "Holistic Band Assessor"]);
  });

  it("excludes calls outside the window and calls for a different sub-criterion", () => {
    const log = [
      logEntry({ subjectId: "6.2", createdAt: "2026-07-18T09:59:59.000Z" }),  // before start
      logEntry({ subjectId: "6.2", createdAt: "2026-07-18T10:05:01.000Z" }),  // after end
      logEntry({ subjectId: "6.3", createdAt: "2026-07-18T10:02:00.000Z" }),  // different sub
      logEntry({ subjectId: "6.20.1", createdAt: "2026-07-18T10:02:00.000Z" }), // NOT under 6.2 (prefix trap)
    ];
    expect(aiCallsForRun(log, run)).toEqual([]);
  });
});

function runEntry(over: Partial<RunLogEntry> & { startedAt: string; endedAt: string }): RunLogEntry {
  return {
    id: `RUN-${over.startedAt}`, mode: "hybrid-item", subCriterionIds: ["6.2"],
    status: "complete", perSub: [], bandsSet: [], bandsSkipped: [], summary: "",
    ...over,
  };
}

describe("typicalRunDurationSec — whole-run median from real history", () => {
  it("returns null when there is no matching complete history", () => {
    expect(typicalRunDurationSec([], "hybrid-item")).toBeNull();
    // only a cancelled run of this mode, and a complete run of the OTHER mode
    const log = [
      runEntry({ startedAt: "2026-07-18T10:00:00Z", endedAt: "2026-07-18T10:03:00Z", status: "cancelled" }),
      runEntry({ startedAt: "2026-07-18T11:00:00Z", endedAt: "2026-07-18T11:10:00Z", mode: "full-auto" }),
    ];
    expect(typicalRunDurationSec(log, "hybrid-item")).toBeNull();
  });

  it("medians the durations of complete runs of the SAME mode only", () => {
    const log = [
      runEntry({ startedAt: "2026-07-18T10:00:00Z", endedAt: "2026-07-18T10:02:00Z" }), // 120s
      runEntry({ startedAt: "2026-07-18T11:00:00Z", endedAt: "2026-07-18T11:04:00Z" }), // 240s
      runEntry({ startedAt: "2026-07-18T12:00:00Z", endedAt: "2026-07-18T12:15:05Z" }), // 905s outlier
      runEntry({ startedAt: "2026-07-18T13:00:00Z", endedAt: "2026-07-18T13:05:00Z", status: "cancelled" }), // excluded
      runEntry({ startedAt: "2026-07-18T14:00:00Z", endedAt: "2026-07-18T14:20:00Z", mode: "full-auto" }),    // excluded (mode)
    ];
    // median of [120, 240, 905] = 240 — the 905s outlier does not pull it up
    expect(typicalRunDurationSec(log, "hybrid-item")).toEqual({ medianSec: 240, sampleCount: 3 });
  });

  it("averages the two middle values for an even sample", () => {
    const log = [
      runEntry({ startedAt: "2026-07-18T10:00:00Z", endedAt: "2026-07-18T10:02:00Z" }), // 120s
      runEntry({ startedAt: "2026-07-18T11:00:00Z", endedAt: "2026-07-18T11:04:00Z" }), // 240s
    ];
    expect(typicalRunDurationSec(log, "hybrid-item")).toEqual({ medianSec: 180, sampleCount: 2 });
  });
});

describe("estimateAuditSeconds — live file count drives the estimate", () => {
  it("scales linearly with the file count (count x SECONDS_PER_FILE)", () => {
    expect(estimateAuditSeconds(0)).toBe(0);
    expect(estimateAuditSeconds(1)).toBe(SECONDS_PER_FILE);
    expect(estimateAuditSeconds(10)).toBe(10 * SECONDS_PER_FILE);
  });
  it("rounds and floors negatives to zero", () => {
    expect(estimateAuditSeconds(2.4)).toBe(2 * SECONDS_PER_FILE);
    expect(estimateAuditSeconds(-5)).toBe(0);
  });
});

describe("formatRoughDuration — spoken, never a precise countdown", () => {
  it("seconds under 90s, minutes above, hours+minutes for long runs", () => {
    expect(formatRoughDuration(45)).toBe("about 45s");
    expect(formatRoughDuration(240)).toBe("about 4m");
    expect(formatRoughDuration(3900)).toBe("about 1h 5m");
    expect(formatRoughDuration(3600)).toBe("about 1h");
  });
});
