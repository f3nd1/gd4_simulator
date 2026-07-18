// runOptionAFullAuto chains the Outcomes & Review pass + apply for a hands-off
// sweep (Full auto OR Hybrid first draft), gated on autoScoreBands. Invariants:
//   1. autoScoreBands OFF -> O/R is NOT chained (byte-identical to before);
//      runOptionAFullAuto still compiles findings as it always did.
//   2. autoScoreBands ON  -> runOutcomeReviewPass then applyOutcomeReviewResult
//      run, AFTER compile, so the later band pass scores off complete APSR.
//   3. runOptionAFullAuto is the sweep-only path (only runFullAudit calls it),
//      so gating here never touches an individual per-row iteration re-run.
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

// Replace the heavy sub-actions with spies and seed the results the early
// guards read, so runOptionAFullAuto reaches step 3/4 without real Drive/AI.
function stub() {
  const runPPDReview = vi.fn().mockResolvedValue(undefined);
  const runEvidenceAssessment = vi.fn().mockResolvedValue(undefined);
  const compileEvidenceFindings = vi.fn().mockReturnValue(0);
  const runOutcomeReviewPass = vi.fn().mockResolvedValue(undefined);
  const applyOutcomeReviewResult = vi.fn().mockReturnValue(1);
  useWorkspaceStore.setState({
    runPPDReview,
    runEvidenceAssessment,
    compileEvidenceFindings,
    runOutcomeReviewPass,
    applyOutcomeReviewResult,
    // Guards: non-empty PPD rows, a real (not "Not assessed") evidence verdict,
    // and an O/R result present so applyOutcomeReviewResult is reached.
    ppdReviewResults: { [SUB]: { rows: [{}] } } as never,
    evidenceAssessments: { [SUB]: { rows: [{ verdict: "Met" }] } } as never,
    outcomeReviewResults: { [SUB]: { rows: [] } } as never,
  });
  return { runOutcomeReviewPass, applyOutcomeReviewResult, compileEvidenceFindings };
}

beforeEach(() => {
  useScoringConfigStore.setState({ autoScoreBands: false });
});

describe("runOptionAFullAuto — Outcomes & Review chaining (2026-07-18)", () => {
  it("does NOT chain O/R when autoScoreBands is off (byte-identical), but still compiles", async () => {
    const { runOutcomeReviewPass, applyOutcomeReviewResult, compileEvidenceFindings } = stub();
    useScoringConfigStore.setState({ autoScoreBands: false });
    await useWorkspaceStore.getState().runOptionAFullAuto(SUB);
    expect(compileEvidenceFindings).toHaveBeenCalledWith(SUB);
    expect(runOutcomeReviewPass).not.toHaveBeenCalled();
    expect(applyOutcomeReviewResult).not.toHaveBeenCalled();
  });

  it("chains O/R run + apply when autoScoreBands is on, after compile", async () => {
    const { runOutcomeReviewPass, applyOutcomeReviewResult, compileEvidenceFindings } = stub();
    useScoringConfigStore.setState({ autoScoreBands: true });
    await useWorkspaceStore.getState().runOptionAFullAuto(SUB);
    expect(compileEvidenceFindings).toHaveBeenCalledWith(SUB);
    expect(runOutcomeReviewPass).toHaveBeenCalledWith(SUB);
    expect(applyOutcomeReviewResult).toHaveBeenCalledWith(SUB);
    // Compile before O/R (findings settle before the legs the band reads).
    expect(compileEvidenceFindings.mock.invocationCallOrder[0])
      .toBeLessThan(runOutcomeReviewPass.mock.invocationCallOrder[0]);
  });

  it("skips the O/R apply when the pass produced no result (graceful, no throw)", async () => {
    const { runOutcomeReviewPass, applyOutcomeReviewResult } = stub();
    useWorkspaceStore.setState({ outcomeReviewResults: {} as never }); // no result
    useScoringConfigStore.setState({ autoScoreBands: true });
    await useWorkspaceStore.getState().runOptionAFullAuto(SUB);
    expect(runOutcomeReviewPass).toHaveBeenCalledWith(SUB);
    expect(applyOutcomeReviewResult).not.toHaveBeenCalled();
  });
});
