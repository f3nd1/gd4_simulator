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
// The real runOptionAFullAuto, captured before any test's stub() replaces it —
// the cancel-gate suite below needs the genuine implementation, not the mock
// the other suites install into shared store state.
const REAL_RUN_OPTION_A_FULL_AUTO = useWorkspaceStore.getState().runOptionAFullAuto;

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

// The actual root-cause fix (2026-07-19): a Cancel mid-run bumps auditRunToken
// (cancelBusy). runOptionAFullAuto must re-check it BETWEEN passes and stop the
// chain — before this, cancelling one pass just let the next pass start a fresh
// AI call, so evidence/compile/O&R kept running and writing after Cancel.
describe("runOptionAFullAuto — cancel stops the chain, never starts the next pass", () => {
  const ppdOk = () => useWorkspaceStore.setState({ ppdReviewResults: { [SUB]: { subCriterionId: SUB, rows: [{}], runAt: "", live: true } } as never });
  const evOk = () => useWorkspaceStore.setState({ evidenceAssessments: { [SUB]: { subCriterionId: SUB, rows: [{ verdict: "Met" }], runAt: "", live: true } } as never });

  beforeEach(() => {
    useScoringConfigStore.setState({ autoScoreBands: true });
    // Restore the genuine orchestrator (an earlier suite's stub() mocked it).
    useWorkspaceStore.setState({ runOptionAFullAuto: REAL_RUN_OPTION_A_FULL_AUTO, auditRunToken: 0, ppdReviewResults: {}, evidenceAssessments: {}, outcomeReviewResults: {} });
  });

  it("cancel during PPD: evidence, compile and O&R are NEVER started", async () => {
    const runEvidenceAssessment = vi.fn().mockResolvedValue(undefined);
    const compileEvidenceFindings = vi.fn().mockReturnValue(0);
    const runOutcomeReviewPass = vi.fn().mockResolvedValue(undefined);
    // PPD writes some rows, then the user hits Cancel (cancelBusy bumps token).
    const runPPDReview = vi.fn().mockImplementation(async () => { ppdOk(); useWorkspaceStore.getState().cancelBusy(); });
    useWorkspaceStore.setState({ runPPDReview, runEvidenceAssessment, compileEvidenceFindings, runOutcomeReviewPass } as never);
    const steps = await useWorkspaceStore.getState().runOptionAFullAuto(SUB);
    expect(runPPDReview).toHaveBeenCalledOnce();
    expect(runEvidenceAssessment).not.toHaveBeenCalled();
    expect(compileEvidenceFindings).not.toHaveBeenCalled();
    expect(runOutcomeReviewPass).not.toHaveBeenCalled();
    expect(steps).toEqual({ ppdRan: false, evidenceRan: false, findingsCompiled: 0, outcomeReviewApplied: false });
  });

  it("cancel during Evidence: compile and O&R are NEVER started, no legs applied", async () => {
    const compileEvidenceFindings = vi.fn().mockReturnValue(3);
    const runOutcomeReviewPass = vi.fn().mockResolvedValue(undefined);
    const applyOutcomeReviewResult = vi.fn().mockReturnValue(2);
    const runPPDReview = vi.fn().mockImplementation(async () => { ppdOk(); });
    const runEvidenceAssessment = vi.fn().mockImplementation(async () => { evOk(); useWorkspaceStore.getState().cancelBusy(); });
    useWorkspaceStore.setState({ runPPDReview, runEvidenceAssessment, compileEvidenceFindings, runOutcomeReviewPass, applyOutcomeReviewResult } as never);
    const steps = await useWorkspaceStore.getState().runOptionAFullAuto(SUB);
    expect(runEvidenceAssessment).toHaveBeenCalledOnce();
    expect(compileEvidenceFindings).not.toHaveBeenCalled();
    expect(runOutcomeReviewPass).not.toHaveBeenCalled();
    expect(applyOutcomeReviewResult).not.toHaveBeenCalled();
    expect(steps).toEqual({ ppdRan: true, evidenceRan: false, findingsCompiled: 0, outcomeReviewApplied: false });
  });

  it("no cancel: the full chain runs (regression guard)", async () => {
    const compileEvidenceFindings = vi.fn().mockReturnValue(2);
    const runOutcomeReviewPass = vi.fn().mockImplementation(async () => { useWorkspaceStore.setState({ outcomeReviewResults: { [SUB]: {} } as never }); });
    const applyOutcomeReviewResult = vi.fn().mockReturnValue(1);
    const runPPDReview = vi.fn().mockImplementation(async () => { ppdOk(); });
    const runEvidenceAssessment = vi.fn().mockImplementation(async () => { evOk(); });
    useWorkspaceStore.setState({ runPPDReview, runEvidenceAssessment, compileEvidenceFindings, runOutcomeReviewPass, applyOutcomeReviewResult } as never);
    const steps = await useWorkspaceStore.getState().runOptionAFullAuto(SUB);
    expect(compileEvidenceFindings).toHaveBeenCalledOnce();
    expect(runOutcomeReviewPass).toHaveBeenCalledOnce();
    expect(applyOutcomeReviewResult).toHaveBeenCalledOnce();
    expect(steps).toEqual({ ppdRan: true, evidenceRan: true, findingsCompiled: 2, outcomeReviewApplied: true });
  });
});
