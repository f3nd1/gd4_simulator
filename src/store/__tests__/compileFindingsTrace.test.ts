// Task 1 (2026-07-13): findings compiled from an Option A run must carry a
// frozen source trace — evidence file names, chunk ids resolved to files, and
// verified verbatim quotes — plus the run id back-link, so a register finding
// traces to the documents on its own (the confirmed traceability gap:
// buildDraftFinding only ever saw the checklist line, never the row).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { useWorkspaceStore } = await import("../useWorkspaceStore");
const { useChecklistModuleStore } = await import("../useChecklistModuleStore");

const SUB = "6.3";

beforeEach(() => {
  useChecklistModuleStore.setState({ entries: {} });
  useWorkspaceStore.setState({
    customFindings: [],
    closures: {},
    pendingCommits: {},
    evidenceAssessments: {
      [SUB]: {
        subCriterionId: SUB,
        runAt: "2026-07-13T00:00:00.000Z",
        live: true,
        runId: "EV-6.3-TEST1",
        chunkFileNames: { C002: "agent_monitoring_log.xlsx" },
        rows: [{
          gdRef: "6.3.1.DS1",
          gd4ItemId: "6.3.1",
          requirementText: "Recruitment agents are monitored.",
          ppdExtract: "…",
          ppdVerdict: "Adequate" as const,
          evidenceSummary: "Monitoring log sighted.",
          evidenceFiles: [{ name: "agent_monitoring_log.xlsx", url: "https://drive/x" }],
          evidenceChunkIds: ["C002"],
          verdict: "Partial" as const,
          comment: "Partially evidenced.",
          promiseChecks: [{
            promiseText: "Annual due diligence on every agent",
            verdict: "evidenced" as const,
            evidence: "Log on file.",
            chunkIds: ["C002"],
            quote: "due diligence is conducted annually",
          }],
        }],
      },
    },
    ppdReviewResults: {
      [SUB]: {
        subCriterionId: SUB,
        runAt: "2026-07-13T00:00:00.000Z",
        live: true,
        chunkFileNames: { C001: "PPD_v3.pdf" },
        rows: [{
          ref: "6.3.1.DS1",
          gd4ItemId: "6.3.1",
          requirementText: "Recruitment agents are monitored.",
          verdict: "Adequate" as const,
          shortComment: "Documented.",
          fullComment: "Documented in section 4.",
          chunkIds: ["C001"],
          supportQuote: "Agents shall be monitored annually.",
        }],
      },
    },
  });
});

describe("compileEvidenceFindings — source trace + run back-link on the finding", () => {
  it("embeds evidence file, resolved chunk citation, verified quotes and PPD basis in the observation, and stamps auditRunId", () => {
    const raised = useWorkspaceStore.getState().compileEvidenceFindings(SUB);
    expect(raised).toBe(1);
    const f = useWorkspaceStore.getState().customFindings.find((x) => x.gd4ItemId === "6.3.1");
    expect(f).toBeTruthy();
    expect(f!.auditRunId).toBe("EV-6.3-TEST1");
    const obs = f!.observation ?? "";
    expect(obs).toContain("Source evidence (run EV-6.3-TEST1):");
    expect(obs).toContain("Evidence files: agent_monitoring_log.xlsx");
    expect(obs).toContain("Cited passages: agent_monitoring_log.xlsx · C002");
    expect(obs).toContain(`"due diligence is conducted annually" (agent_monitoring_log.xlsx · C002) — evidenced: Annual due diligence on every agent`);
    // PPD chunk resolves through the PPD run's chunkFileNames fallback.
    expect(obs).toContain(`PPD basis: "Agents shall be monitored annually." (PPD_v3.pdf · C001)`);
    // The paraphrase body still opens the observation — the trace is appended.
    expect(obs.startsWith("Source evidence")).toBe(false);
  });

  it("still raises with the honest file-ledger fallback when a Not met row has nothing citable", () => {
    useWorkspaceStore.setState((s) => ({
      evidenceAssessments: {
        [SUB]: {
          ...s.evidenceAssessments[SUB],
          rows: [{
            ...s.evidenceAssessments[SUB].rows[0],
            verdict: "Not met" as const,
            evidenceFiles: [],
            evidenceChunkIds: [],
            promiseChecks: [],
          }],
        },
      },
      ppdReviewResults: {},
    }));
    const raised = useWorkspaceStore.getState().compileEvidenceFindings(SUB);
    expect(raised).toBe(1);
    const f = useWorkspaceStore.getState().customFindings.find((x) => x.gd4ItemId === "6.3.1");
    expect(f!.observation).toContain("no evidence passages were cited for this line");
    expect(f!.auditRunId).toBe("EV-6.3-TEST1");
  });
});
