// Deleting one self-check run. The risky part is not the removal, it is the
// two invariants around it: the two passes are paired BY POSITION, and
// "current" is what the Evidence Folder and PPD Review pages read.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { useWorkspaceStore } = await import("../useWorkspaceStore");

const SUB = "6.1";
const ppd = (tag: string) => ({ subCriterionId: SUB, runAt: `2026-0${tag}-01T00:00:00.000Z`, live: true, rows: [{ ref: `P${tag}` }] } as never);
const ev = (tag: string) => ({ subCriterionId: SUB, runAt: `2026-0${tag}-01T00:00:00.000Z`, live: true, rows: [{ gdRef: `E${tag}` }] } as never);

// current = 3, then 2, then 1 archived newest-first.
function seed() {
  useWorkspaceStore.setState({
    ppdReviewResults: { [SUB]: ppd("3") },
    evidenceAssessments: { [SUB]: ev("3") },
    ppdReviewHistory: { [SUB]: [ppd("2"), ppd("1")] },
    evidenceAssessmentHistory: { [SUB]: [ev("2"), ev("1")] },
  } as never);
}
const shape = () => {
  const s = useWorkspaceStore.getState();
  return {
    current: [s.ppdReviewResults[SUB]?.runAt, s.evidenceAssessments[SUB]?.runAt],
    history: (s.evidenceAssessmentHistory[SUB] ?? []).map((h) => h.runAt),
    ppdHistory: (s.ppdReviewHistory[SUB] ?? []).map((h) => h.runAt),
  };
};

beforeEach(seed);

describe("deleting one run", () => {
  it("removes an archived run from BOTH passes, keeping them paired", () => {
    useWorkspaceStore.getState().deleteSelfCheckRun(SUB, 1);
    const s = shape();
    expect(s.current).toEqual(["2026-03-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"]);
    expect(s.history).toEqual(["2026-01-01T00:00:00.000Z"]);
    // Both arrays, or an earlier run would render one pass from one date
    // beside the other pass from another.
    expect(s.ppdHistory).toEqual(s.history);
  });

  // "Current" is what the Evidence Folder and PPD Review pages read. Leaving a
  // hole there would silently empty the audit lead's view.
  it("promotes the next run when the latest is deleted, rather than leaving a hole", () => {
    useWorkspaceStore.getState().deleteSelfCheckRun(SUB, 0);
    const s = shape();
    expect(s.current).toEqual(["2026-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"]);
    expect(s.history).toEqual(["2026-01-01T00:00:00.000Z"]);
    expect(s.ppdHistory).toEqual(["2026-01-01T00:00:00.000Z"]);
  });

  it("leaves the area with no result when the only run is deleted, and says nothing else", () => {
    useWorkspaceStore.setState({
      ppdReviewResults: { [SUB]: ppd("3") }, evidenceAssessments: { [SUB]: ev("3") },
      ppdReviewHistory: { [SUB]: [] }, evidenceAssessmentHistory: { [SUB]: [] },
    } as never);
    useWorkspaceStore.getState().deleteSelfCheckRun(SUB, 0);
    const s = useWorkspaceStore.getState();
    expect(s.evidenceAssessments[SUB]).toBeUndefined();
    expect(s.ppdReviewResults[SUB]).toBeUndefined();
  });

  it("touches no other sub-criterion", () => {
    useWorkspaceStore.setState({
      evidenceAssessments: { [SUB]: ev("3"), "4.1": ev("9") },
      evidenceAssessmentHistory: { [SUB]: [ev("2")], "4.1": [ev("8")] },
    } as never);
    useWorkspaceStore.getState().deleteSelfCheckRun(SUB, 0);
    const s = useWorkspaceStore.getState();
    expect(s.evidenceAssessments["4.1"]?.runAt).toBe("2026-09-01T00:00:00.000Z");
    expect(s.evidenceAssessmentHistory["4.1"]).toHaveLength(1);
  });

  it("is a no-op on an index that does not exist, rather than corrupting the pairing", () => {
    useWorkspaceStore.getState().deleteSelfCheckRun(SUB, 99);
    expect(shape().history).toEqual(["2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
    useWorkspaceStore.getState().deleteSelfCheckRun(SUB, -1);
    expect(shape().history).toEqual(["2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
  });
});

describe("clearing an area's history", () => {
  it("drops every archived run and keeps the current one exactly as it was", () => {
    useWorkspaceStore.getState().clearSelfCheckHistory(SUB);
    const s = shape();
    expect(s.current).toEqual(["2026-03-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"]);
    expect(s.history).toEqual([]);
    expect(s.ppdHistory).toEqual([]);
  });

  it("touches no other sub-criterion", () => {
    useWorkspaceStore.setState({ evidenceAssessmentHistory: { [SUB]: [ev("2")], "4.1": [ev("8")] } } as never);
    useWorkspaceStore.getState().clearSelfCheckHistory(SUB);
    expect(useWorkspaceStore.getState().evidenceAssessmentHistory["4.1"]).toHaveLength(1);
  });
});
