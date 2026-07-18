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
  // Matches runOptionAFullAuto's real return shape (2026-07-18, the Run Log
  // build) — a caller (like runHybridItemDraft) reads steps.ppdRan etc. from
  // the resolved value now, so the mock must resolve the same shape.
  const runOptionAFullAuto = vi.fn().mockResolvedValue({ ppdRan: true, evidenceRan: true, findingsCompiled: 0, outcomeReviewApplied: false });
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
    // Second arg is the live-progress onStep callback (drives HybridDraftOverlay).
    expect(runOptionAFullAuto).toHaveBeenCalledWith(SUB, expect.any(Function));
    expect(autoScoreAssessedItems).toHaveBeenCalledWith([SUB]); // scoped, no cascade
    // Band pass runs AFTER the audit chain (findings + O/R settled first).
    expect(runOptionAFullAuto.mock.invocationCallOrder[0])
      .toBeLessThan(autoScoreAssessedItems.mock.invocationCallOrder[0]);
  });
});

describe("runHybridItemDraft — Run Log entry (2026-07-18)", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ runLog: [] });
  });

  it("writes no Run Log entry when autoScoreBands is off (matches the strict no-op)", async () => {
    stub();
    useScoringConfigStore.setState({ autoScoreBands: false });
    await useWorkspaceStore.getState().runHybridItemDraft(SUB);
    expect(useWorkspaceStore.getState().runLog).toEqual([]);
  });

  it("writes one mode:hybrid-item entry scoped to this sub, with real step outcome and no invented band data", async () => {
    const { autoScoreAssessedItems } = stub();
    autoScoreAssessedItems.mockResolvedValue({ set: [], skipped: [{ itemId: "6.2.1", reason: "AI band suggestion unavailable" }] });
    useScoringConfigStore.setState({ autoScoreBands: true });
    await useWorkspaceStore.getState().runHybridItemDraft(SUB);
    const [entry] = useWorkspaceStore.getState().runLog;
    expect(entry.mode).toBe("hybrid-item");
    expect(entry.subCriterionIds).toEqual([SUB]);
    expect(entry.status).toBe("complete");
    expect(entry.perSub).toEqual([{ subCriterionId: SUB, path: "A", status: "done", steps: { ppdRan: true, evidenceRan: true, findingsCompiled: 0, outcomeReviewApplied: false } }]);
    expect(entry.bandsSet).toEqual([]); // nothing to invent — the mock set no band
    expect(entry.bandsSkipped).toEqual([{ itemId: "6.2.1", reason: "AI band suggestion unavailable" }]);
    expect(entry.summary).toContain(SUB);
  });

  it("caps the Run Log at 50 entries, newest first", async () => {
    stub();
    useScoringConfigStore.setState({ autoScoreBands: true });
    const filler = Array.from({ length: 50 }, (_, i) => ({
      id: `OLD-${i}`, mode: "hybrid-item" as const, subCriterionIds: ["x"], startedAt: "", endedAt: "",
      status: "complete" as const, perSub: [], bandsSet: [], bandsSkipped: [], summary: "old",
    }));
    useWorkspaceStore.setState({ runLog: filler });
    await useWorkspaceStore.getState().runHybridItemDraft(SUB);
    const log = useWorkspaceStore.getState().runLog;
    expect(log.length).toBe(50);
    expect(log[0].subCriterionIds).toEqual([SUB]); // the new entry, newest first
    expect(log[49].id).toBe("OLD-48"); // oldest filler entry dropped off the cap
  });
});
