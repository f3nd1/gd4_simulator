// The empty-folder guard, at the store level.
//
// "Not evident" is the BOTTOM of the ApsrBreakdown scale — there is no
// "not assessed" value in those unions — so a pass that judges nothing publishes
// a Band 1 on every requirement line of the scope. The pure decision lives in
// lib/selfCheckOutcome.ts and is tested there; this pins that the store actually
// consults it, and above all that a results-and-review folder which LISTS files
// and then fails to read every one of them is refused exactly as hard as an
// empty one. That case is the dangerous one: from the outside it looks like a
// working folder.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

// Drive: the folder lists files; what each read returns is per-test.
const listed = vi.fn();
const readText = vi.fn();
vi.mock("../../lib/drive/driveClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/drive/driveClient")>();
  return {
    ...actual,
    listFolderFilesRecursive: (...a: unknown[]) => listed(...a),
    exportFileText: (...a: unknown[]) => readText(...a),
  };
});

// The one thing that must not happen on a refused folder.
const stagedOutcomePass = vi.fn();
vi.mock("../../lib/ai/agentRuntime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ai/agentRuntime")>();
  return { ...actual, runStagedOutcomeReviewAudit: (...a: unknown[]) => stagedOutcomePass(...a) };
});

const { useWorkspaceStore } = await import("../useWorkspaceStore");
const { useAISettingsStore } = await import("../useAISettingsStore");
const { useGoogleDriveStore } = await import("../useGoogleDriveStore");

const SUB = "6.1";
const OUTCOME_LINK = "https://drive.google.com/drive/folders/RESULTSFOLDERID";

const file = (name: string) => ({ id: `id-${name}`, name, path: name, mimeType: "text/plain", modifiedTime: "2026-09-01T00:00:00Z" });

function seed(outcomeLink: string | undefined) {
  useAISettingsStore.setState({ enabled: true, apiKey: "test-key" } as never);
  useGoogleDriveStore.setState({ getFreshToken: async () => "token" } as never);
  useWorkspaceStore.setState({
    auditors: [{ id: "A1", name: "Tester", email: "t@example.com", role: "Lead Auditor" }] as never,
    activeAuditorId: "A1",
    folders: [{ id: "F1", scopeId: SUB, subCriterionId: SUB, folderName: "6.1", sourceSystem: "Google Drive", owner: "", status: "Linked", policyLink: "https://drive.google.com/drive/folders/POLICY", folderLink: "https://drive.google.com/drive/folders/EVIDENCE", outcomeLink }] as never,
    // The pass reads the Option A run's own documents too, so both results must
    // exist with a ledger or it stops before reaching the third folder.
    ppdReviewResults: { [SUB]: { subCriterionId: SUB, rows: [{}], fileLedger: [{ path: "p.docx", name: "p.docx", mimeType: "text/plain", fileKind: "text", bucket: "policy", readStatus: "read", auditStatus: "audited", driveFileId: "p1" }] } } as never,
    evidenceAssessments: { [SUB]: { subCriterionId: SUB, rows: [{ verdict: "Met" }], fileLedger: [{ path: "e.docx", name: "e.docx", mimeType: "text/plain", fileKind: "text", bucket: "evidence", readStatus: "read", auditStatus: "audited", driveFileId: "e1" }] } } as never,
    outcomeReviewResults: {},
    fileTextCache: {},
    calibrationMemories: [],
  });
}

beforeEach(() => {
  listed.mockReset();
  readText.mockReset();
  stagedOutcomePass.mockReset();
});

describe("the results-and-review folder guard, in the store", () => {
  it("refuses the pass when the folder lists files but every one fails to read", async () => {
    seed(OUTCOME_LINK);
    listed.mockResolvedValue([file("KPI 2025.pdf"), file("minutes.docx"), file("CAP log.xlsx")]);
    // Every read comes back with no usable text — a scan with no vision, an
    // empty export, a permission-stripped file. The folder still LOOKS fine.
    readText.mockResolvedValue("");

    await useWorkspaceStore.getState().runOutcomeReviewPass(SUB);

    // The AI never saw it. Nothing was judged, so nothing can be "Not evident".
    expect(stagedOutcomePass).not.toHaveBeenCalled();
    const res = useWorkspaceStore.getState().outcomeReviewResults[SUB];
    expect(res).toBeTruthy();
    expect(res.rows).toEqual([]);
    expect(res.skippedReason).toMatch(/none of them could be read/i);
    expect(res.skippedReason).toContain("KPI 2025.pdf");
    expect(res.outcomeFilesListed).toBe(3);
    expect(res.outcomeFilesRead).toBe(0);
    // The ledger still names every file, so the refusal is checkable.
    expect(res.outcomeLedger?.map((f) => f.readStatus)).toEqual(["failed", "failed", "failed"]);
    expect(res.outcomeLedger?.every((f) => f.bucket === "outcome")).toBe(true);
  });

  it("refuses the pass on a linked but empty folder", async () => {
    seed(OUTCOME_LINK);
    listed.mockResolvedValue([]);

    await useWorkspaceStore.getState().runOutcomeReviewPass(SUB);

    expect(stagedOutcomePass).not.toHaveBeenCalled();
    const res = useWorkspaceStore.getState().outcomeReviewResults[SUB];
    expect(res.rows).toEqual([]);
    expect(res.skippedReason).toMatch(/no files in it/i);
    expect(res.outcomeFilesListed).toBe(0);
  });

  // One readable file is enough to judge from, so the pass runs. It reads the
  // run's own documents as well, which is why review minutes filed in the
  // records folder still count.
  it("runs the pass as soon as one file in the folder is readable", async () => {
    seed(OUTCOME_LINK);
    listed.mockResolvedValue([file("KPI 2025.txt"), file("broken.txt")]);
    readText.mockImplementation((f: { name: string }) => Promise.resolve(f.name === "KPI 2025.txt" ? "Attendance 94% against a 90% target." : ""));
    stagedOutcomePass.mockResolvedValue({ rows: [{ ref: "6.1.1.DS1", pointText: "x", outcomeEvident: true, reviewEvident: false, note: "n", chunkIds: ["C001"] }], windowErrors: [] });

    await useWorkspaceStore.getState().runOutcomeReviewPass(SUB);

    expect(stagedOutcomePass).toHaveBeenCalledTimes(1);
    // The folder's text reached the prompt alongside the run's own documents.
    const docText = String(stagedOutcomePass.mock.calls[0][1]);
    expect(docText).toContain("Attendance 94% against a 90% target.");
    const res = useWorkspaceStore.getState().outcomeReviewResults[SUB];
    expect(res.skippedReason).toBeUndefined();
    expect(res.rows).toHaveLength(1);
    expect(res.outcomeFilesRead).toBe(1);
    expect(res.outcomeFilesListed).toBe(2);
  });

  // With no third folder the pass keeps its original behaviour: it reads the
  // documents the Option A run already read. The self-check never calls it in
  // that state, so the two dimensions simply stay not assessed there.
  it("does not look for a third folder when none is linked", async () => {
    seed(undefined);
    stagedOutcomePass.mockResolvedValue({ rows: [{ ref: "6.1.1.DS1", pointText: "x", outcomeEvident: false, reviewEvident: false, note: "n", chunkIds: [] }], windowErrors: [] });
    readText.mockResolvedValue("some policy text");

    await useWorkspaceStore.getState().runOutcomeReviewPass(SUB);

    expect(listed).not.toHaveBeenCalled();
    const res = useWorkspaceStore.getState().outcomeReviewResults[SUB];
    expect(res.outcomeFilesListed).toBeUndefined();
    expect(res.skippedReason).toBeUndefined();
  });
});
