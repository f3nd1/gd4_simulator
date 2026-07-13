// Task 2: past Option A runs are archived into ppdReviewHistory /
// evidenceAssessmentHistory (additive — the current run stays exactly at
// ppdReviewResults / evidenceAssessments) instead of being overwritten.
// Deleting a finding must sweep its savedFindingId / contradiction
// back-pointer from BOTH the current result and every archived history
// entry, so no archived row keeps a dead "View finding" link either.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { useWorkspaceStore } = await import("../useWorkspaceStore");

const SUB = "4.4";

function ppdRow(ref: string) {
  return {
    ref, gd4ItemId: "4.4.1", requirementText: "Req", verdict: "Not documented" as const,
    shortComment: "", fullComment: "", chunkIds: [],
  };
}

beforeEach(() => {
  useWorkspaceStore.setState({
    customFindings: [],
    ppdReviewResults: {},
    ppdReviewHistory: {},
    evidenceAssessments: {},
    evidenceAssessmentHistory: {},
  });
});

describe("Task 2 — Option A run history back-pointer sweep", () => {
  it("removeCustomFinding clears a PPD contradiction back-pointer from BOTH the current result and archived history entries", () => {
    useWorkspaceStore.setState({
      ppdReviewResults: {
        [SUB]: {
          subCriterionId: SUB, rows: [ppdRow("4.4.1.DS1")], runAt: "2026-02-01T00:00:00.000Z", live: true,
          contradictions: [{ description: "d", quoteA: "a", chunkA: "C001", quoteB: "b", chunkB: "C002", savedFindingId: "FND-1" }],
        },
      },
      ppdReviewHistory: {
        [SUB]: [{
          subCriterionId: SUB, rows: [ppdRow("4.4.1.DS1")], runAt: "2026-01-01T00:00:00.000Z", live: true,
          contradictions: [{ description: "d", quoteA: "a", chunkA: "C001", quoteB: "b", chunkB: "C002", savedFindingId: "FND-1" }],
        }],
      },
    });

    useWorkspaceStore.getState().removeCustomFinding("FND-1");

    expect(useWorkspaceStore.getState().ppdReviewResults[SUB].contradictions?.[0].savedFindingId).toBeUndefined();
    expect(useWorkspaceStore.getState().ppdReviewHistory[SUB][0].contradictions?.[0].savedFindingId).toBeUndefined();
  });

  it("removeCustomFinding clears an evidence-row back-pointer from BOTH the current result and archived history entries, leaving unrelated ids untouched", () => {
    const rowWithFinding = { gdRef: "4.4.1.DS1", gd4ItemId: "4.4.1", requirementText: "Req", ppdExtract: "", ppdVerdict: "Adequate" as const, evidenceSummary: "", evidenceFiles: [], evidenceChunkIds: [], verdict: "Met" as const, comment: "", savedFindingId: "FND-9" };
    const rowUnrelated = { ...rowWithFinding, gdRef: "4.4.1.DS2", savedFindingId: "FND-OTHER" };
    useWorkspaceStore.setState({
      evidenceAssessments: { [SUB]: { subCriterionId: SUB, rows: [rowWithFinding, rowUnrelated], runAt: "2026-02-01T00:00:00.000Z", live: true } },
      evidenceAssessmentHistory: { [SUB]: [{ subCriterionId: SUB, rows: [rowWithFinding, rowUnrelated], runAt: "2026-01-01T00:00:00.000Z", live: true }] },
    });

    useWorkspaceStore.getState().removeCustomFinding("FND-9");

    const current = useWorkspaceStore.getState().evidenceAssessments[SUB].rows;
    const archived = useWorkspaceStore.getState().evidenceAssessmentHistory[SUB][0].rows;
    expect(current.find((r) => r.gdRef === "4.4.1.DS1")?.savedFindingId).toBeUndefined();
    expect(archived.find((r) => r.gdRef === "4.4.1.DS1")?.savedFindingId).toBeUndefined();
    // Unrelated back-pointer (different finding id) survives untouched.
    expect(current.find((r) => r.gdRef === "4.4.1.DS2")?.savedFindingId).toBe("FND-OTHER");
    expect(archived.find((r) => r.gdRef === "4.4.1.DS2")?.savedFindingId).toBe("FND-OTHER");
  });
});
