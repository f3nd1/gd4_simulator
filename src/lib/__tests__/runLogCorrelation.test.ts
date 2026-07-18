import { describe, it, expect } from "vitest";
import { aiCallsForRun } from "../runLogCorrelation";
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
