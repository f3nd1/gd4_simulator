import { describe, it, expect } from "vitest";
import { partitionWritesByMode, stagedWriteConfidence, DEFAULT_RUN_MODE } from "../runModes";
import { buildOptionALineWrites } from "../optionAChecklistWrite";
import type { ChecklistLineWrite, EvidenceAssessmentRow, RunMode } from "../../types";

function write(over: Partial<ChecklistLineWrite>): ChecklistLineWrite {
  return {
    gd4ItemId: "1.2.1",
    existingLineId: "L1",
    status: "Met",
    evidence: { title: "t", type: "Record/Log", owner: "", date: "", approved: false, reviewed: false, sufficiency: "Present", runId: "R1" },
    ...over,
  };
}

describe("partitionWritesByMode — modes decide WHEN writes commit, not how they are computed", () => {
  const writes = [write({ existingLineId: "L1" }), write({ existingLineId: "L2", lowConfidence: true, confidenceReason: "uncited" })];

  it("full_auto commits everything, queues nothing", () => {
    const { commit, queue } = partitionWritesByMode("full_auto", writes);
    expect(commit).toHaveLength(2);
    expect(queue).toHaveLength(0);
  });

  it("confidence commits confident lines and queues only the low-confidence ones", () => {
    const { commit, queue } = partitionWritesByMode("confidence", writes);
    expect(commit.map((w) => w.existingLineId)).toEqual(["L1"]);
    expect(queue.map((w) => w.existingLineId)).toEqual(["L2"]);
  });

  it("review and hybrid commit NOTHING — everything queues for the human", () => {
    for (const mode of ["review", "hybrid"] as RunMode[]) {
      const { commit, queue } = partitionWritesByMode(mode, writes);
      expect(commit).toHaveLength(0);
      expect(queue).toHaveLength(2);
    }
  });

  it("manual neither commits nor queues — the AI decides nothing", () => {
    const { commit, queue } = partitionWritesByMode("manual", writes);
    expect(commit).toHaveLength(0);
    expect(queue).toHaveLength(0);
  });

  it("the default mode is confidence gating", () => {
    expect(DEFAULT_RUN_MODE).toBe("confidence");
  });
});

describe("confidence signals", () => {
  const apsrCited = {
    approach: { sourceChunkIds: ["C001"], note: "ok" },
    processes: { sourceChunkIds: ["C002"], note: "ok" },
    systemsOutcomes: { sourceChunkIds: [], note: "ok" },
    review: { sourceChunkIds: [], note: "ok" },
  };

  it("staged: Met with citations is confident; gaps, uncited and unverified quotes are not", () => {
    expect(stagedWriteConfidence("Met", apsrCited).lowConfidence).toBe(false);
    expect(stagedWriteConfidence("Partial", apsrCited).lowConfidence).toBe(true);
    expect(stagedWriteConfidence("Not met", apsrCited).lowConfidence).toBe(true);
    const uncited = { ...apsrCited, approach: { sourceChunkIds: [], note: "ok" }, processes: { sourceChunkIds: [], note: "ok" } };
    expect(stagedWriteConfidence("Met", uncited).lowConfidence).toBe(true);
    const unverified = { ...apsrCited, processes: { sourceChunkIds: ["C002"], note: "quote [⚠ unverified quote — not found in source]" } };
    expect(stagedWriteConfidence("Met", unverified).lowConfidence).toBe(true);
  });

  function evRow(over: Partial<EvidenceAssessmentRow>): EvidenceAssessmentRow {
    return {
      gdRef: "1.2.1.DS1", gd4ItemId: "1.2.1", requirementText: "req", ppdExtract: "", ppdVerdict: "Adequate",
      evidenceSummary: "found", evidenceFiles: [], evidenceChunkIds: ["C001"], verdict: "Met", comment: "ok (C001)",
      ...over,
    };
  }

  it("Option A writes carry confidence: Met+cited confident; Partial, uncited, and contradicted promises queue", () => {
    const writes = buildOptionALineWrites(
      [
        evRow({}),
        evRow({ gdRef: "1.2.1.DS2", verdict: "Partial" }),
        evRow({ gdRef: "1.2.1.DS3", evidenceChunkIds: [] }),
        evRow({ gdRef: "1.2.1.DS4", promiseChecks: [{ promiseText: "peer reviews", verdict: "contradicted", evidence: "record shows opposite", chunkIds: [] }] }),
      ],
      {},
      [],
      { runId: "R1" }
    );
    expect(writes[0].lowConfidence).toBeFalsy();
    expect(writes[1].lowConfidence).toBe(true);
    expect(writes[2].lowConfidence).toBe(true);
    expect(writes[2].confidenceReason).toContain("No evidence chunks cited");
    expect(writes[3].lowConfidence).toBe(true);
    expect(writes[3].confidenceReason).toContain("contradicts");
  });
});
