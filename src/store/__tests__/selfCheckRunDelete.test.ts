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

  // The CURRENT result is what the Evidence Folder and PPD Review pages read,
  // so deleting it must never leave those pages pointing at nothing by
  // accident: the check behind it is promoted in the same write, and BOTH
  // passes move together.
  it("deletes the current result and promotes the check behind it", () => {
    useWorkspaceStore.getState().deleteSelfCheckRun(SUB, 0);
    const s = shape();
    expect(s.current).toEqual(["2026-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"]);
    expect(s.history).toEqual(["2026-01-01T00:00:00.000Z"]);
    expect(s.ppdHistory).toEqual(s.history);
  });

  // The pass belongs to the run that produced it. Promoting an older run must
  // not hand it the deleted run's results-and-review pass.
  it("drops the results-and-review pass with the run it belonged to", () => {
    useWorkspaceStore.setState({ outcomeReviewResults: { [SUB]: { subCriterionId: SUB, rows: [], runAt: "x", runId: "OR-1", chunkFileNames: {} } } } as never);
    useWorkspaceStore.getState().deleteSelfCheckRun(SUB, 0);
    expect(useWorkspaceStore.getState().outcomeReviewResults[SUB]).toBeUndefined();
  });

  it("leaves the area unchecked when the only run there is goes", () => {
    useWorkspaceStore.setState({
      ppdReviewResults: { [SUB]: ppd("3") }, evidenceAssessments: { [SUB]: ev("3") },
      ppdReviewHistory: { [SUB]: [] }, evidenceAssessmentHistory: { [SUB]: [] },
    } as never);
    useWorkspaceStore.getState().deleteSelfCheckRun(SUB, 0);
    expect(useWorkspaceStore.getState().evidenceAssessments[SUB]).toBeUndefined();
    expect(useWorkspaceStore.getState().ppdReviewResults[SUB]).toBeUndefined();
  });

  it("touches no other sub-criterion", () => {
    useWorkspaceStore.setState({
      evidenceAssessments: { [SUB]: ev("3"), "4.1": ev("9") },
      evidenceAssessmentHistory: { [SUB]: [ev("2")], "4.1": [ev("8")] },
    } as never);
    useWorkspaceStore.getState().deleteSelfCheckRun(SUB, 1);
    const s = useWorkspaceStore.getState();
    expect(s.evidenceAssessments["4.1"]?.runAt).toBe("2026-09-01T00:00:00.000Z");
    expect(s.evidenceAssessmentHistory["4.1"]).toHaveLength(1);
  });

  it("is a no-op on an index that does not exist, rather than corrupting the pairing", () => {
    for (const bad of [99, -1]) useWorkspaceStore.getState().deleteSelfCheckRun(SUB, bad);
    expect(shape().history).toEqual(["2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
    expect(shape().current).toEqual(["2026-03-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"]);
  });

  // A timeline entry left behind for a run the user deleted is the run still
  // being there, as far as the reader can tell.
  it("removes the deleted run's timeline entry too, at the same position", () => {
    const sum = (at: string) => ({ at, c: 1, p: 0, d: 0, u: 0, n: 1 });
    useWorkspaceStore.setState({
      evidenceRunLog: { [SUB]: [sum("r3"), sum("r2"), sum("r1")] },
      ppdRunLog: { [SUB]: [sum("r3"), sum("r2"), sum("r1")] },
    } as never);
    useWorkspaceStore.getState().deleteSelfCheckRun(SUB, 1);
    expect(useWorkspaceStore.getState().evidenceRunLog[SUB].map((x) => x.at)).toEqual(["r3", "r1"]);
    expect(useWorkspaceStore.getState().ppdRunLog[SUB].map((x) => x.at)).toEqual(["r3", "r1"]);
  });

  it("takes the current run's timeline entry with it when the current run goes", () => {
    const sum = (at: string) => ({ at, c: 1, p: 0, d: 0, u: 0, n: 1 });
    useWorkspaceStore.setState({
      evidenceRunLog: { [SUB]: [sum("r3"), sum("r2"), sum("r1")] },
      ppdRunLog: { [SUB]: [sum("r3"), sum("r2"), sum("r1")] },
    } as never);
    useWorkspaceStore.getState().deleteSelfCheckRun(SUB, 0);
    expect(useWorkspaceStore.getState().evidenceRunLog[SUB].map((x) => x.at)).toEqual(["r2", "r1"]);
    expect(useWorkspaceStore.getState().ppdRunLog[SUB].map((x) => x.at)).toEqual(["r2", "r1"]);
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

  it("keeps the current run's own timeline entry and drops the rest", () => {
    const sum = (at: string) => ({ at, c: 1, p: 0, d: 0, u: 0, n: 1 });
    useWorkspaceStore.setState({
      evidenceRunLog: { [SUB]: [sum("r3"), sum("r2"), sum("r1")] },
      ppdRunLog: { [SUB]: [sum("r3"), sum("r2"), sum("r1")] },
    } as never);
    useWorkspaceStore.getState().clearSelfCheckHistory(SUB);
    expect(useWorkspaceStore.getState().evidenceRunLog[SUB].map((x) => x.at)).toEqual(["r3"]);
    expect(useWorkspaceStore.getState().ppdRunLog[SUB].map((x) => x.at)).toEqual(["r3"]);
  });

  it("touches no other sub-criterion", () => {
    useWorkspaceStore.setState({ evidenceAssessmentHistory: { [SUB]: [ev("2")], "4.1": [ev("8")] } } as never);
    useWorkspaceStore.getState().clearSelfCheckHistory(SUB);
    expect(useWorkspaceStore.getState().evidenceAssessmentHistory["4.1"]).toHaveLength(1);
  });
});
