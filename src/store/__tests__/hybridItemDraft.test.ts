// runHybridItemDraft — the Hybrid per-item hands-off draft. Invariants:
//   1. OFF: strict no-op (neither the run chain nor the band pass fire), so a
//      per-item run stays exactly as today.
//   2. ON: runs runOptionAFullAuto (verdicts -> compile -> Outcomes/Review)
//      THEN autoScoreAssessedItems, in that order, so the band scores only
//      after that item's findings + O/R legs have settled.
//   3. Scoped to the ONE sub-criterion passed in - the band pass is called
//      with exactly [that sub], never a cascade.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { useWorkspaceStore } = await import("../useWorkspaceStore");
const { useScoringConfigStore } = await import("../useScoringConfigStore");

const SUB = "6.2";

function stub() {
  const runOptionAFullAuto = vi.fn().mockResolvedValue(undefined);
  const autoScoreAssessedItems = vi.fn().mockResolvedValue({ set: [], skipped: [] });
  useWorkspaceStore.setState({ runOptionAFullAuto, autoScoreAssessedItems });
  return { runOptionAFullAuto, autoScoreAssessedItems };
}

beforeEach(() => {
  useScoringConfigStore.setState({ autoScoreBands: false });
});

describe("runHybridItemDraft — per-item hands-off draft (2026-07-18)", () => {
  it("is a strict no-op when autoScoreBands is off", async () => {
    const { runOptionAFullAuto, autoScoreAssessedItems } = stub();
    useScoringConfigStore.setState({ autoScoreBands: false });
    await useWorkspaceStore.getState().runHybridItemDraft(SUB);
    expect(runOptionAFullAuto).not.toHaveBeenCalled();
    expect(autoScoreAssessedItems).not.toHaveBeenCalled();
  });

  it("runs the audit chain then bands THIS sub only, in order, when on", async () => {
    const { runOptionAFullAuto, autoScoreAssessedItems } = stub();
    useScoringConfigStore.setState({ autoScoreBands: true });
    await useWorkspaceStore.getState().runHybridItemDraft(SUB);
    expect(runOptionAFullAuto).toHaveBeenCalledWith(SUB);
    expect(autoScoreAssessedItems).toHaveBeenCalledWith([SUB]); // scoped, no cascade
    // Band pass runs AFTER the audit chain (findings + O/R settled first).
    expect(runOptionAFullAuto.mock.invocationCallOrder[0])
      .toBeLessThan(autoScoreAssessedItems.mock.invocationCallOrder[0]);
  });
});
