// The unread-records guard, at the store level.
//
// "Not evident" is the BOTTOM of the ApsrBreakdown scale — there is no
// "not assessed" value in those unions — so a pass that judges nothing publishes
// a Band 1 on every requirement line of the scope. The pure decision lives in
// lib/selfCheckOutcome.ts and is tested there; this pins that the store actually
// consults it, and above all that a records folder which LISTS files and then
// fails to read every one of them is refused. That case is the dangerous one:
// from the outside it looks like a working folder.
//
// The pass reads the same documents the run already opened, so these tests
// drive it through the session text cache (a cache hit) and through an empty
// cache with a failing Drive re-read (nothing readable).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

// Every Drive re-read comes back with no usable text unless a test says otherwise.
const readText = vi.fn();
vi.mock("../../lib/drive/driveClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/drive/driveClient")>();
  return { ...actual, exportFileText: (...a: unknown[]) => readText(...a) };
});

// The one thing that must not happen when the records could not be read.
const stagedOutcomePass = vi.fn();
vi.mock("../../lib/ai/agentRuntime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ai/agentRuntime")>();
  return { ...actual, runStagedOutcomeReviewAudit: (...a: unknown[]) => stagedOutcomePass(...a) };
});

const { useWorkspaceStore } = await import("../useWorkspaceStore");
const { useAISettingsStore } = await import("../useAISettingsStore");
const { useGoogleDriveStore } = await import("../useGoogleDriveStore");

const SUB = "6.1";

const ledgerFile = (name: string, bucket: "policy" | "evidence") => ({
  path: name, name, mimeType: "text/plain", fileKind: "text", bucket,
  readStatus: "read" as const, auditStatus: "audited" as const,
  driveFileId: `id-${name}`, driveModifiedTime: "2026-09-01T00:00:00Z",
});

const cacheEntry = (name: string, text: string) => [`id-${name}:2026-09-01T00:00:00Z`, {
  text, charCount: text.length, fileKind: "text/plain", fileName: name, filePath: name, cachedAt: Date.now(), readMethod: "text" as const,
}] as const;

function seed(opts: { records: string[]; policy?: string[]; cached?: Record<string, string> }) {
  useAISettingsStore.setState({ enabled: true, apiKey: "test-key" } as never);
  useGoogleDriveStore.setState({ getFreshToken: async () => "token" } as never);
  useWorkspaceStore.setState({
    auditors: [{ id: "A1", name: "Tester", email: "t@example.com", role: "Lead Auditor" }] as never,
    activeAuditorId: "A1",
    folders: [{ id: "F1", scopeId: SUB, subCriterionId: SUB, folderName: "6.1", sourceSystem: "Google Drive", owner: "", status: "Linked", policyLink: "https://drive.google.com/drive/folders/POLICY", folderLink: "https://drive.google.com/drive/folders/EVIDENCE" }] as never,
    ppdReviewResults: { [SUB]: { subCriterionId: SUB, rows: [{}], fileLedger: (opts.policy ?? ["procedure.docx"]).map((n) => ledgerFile(n, "policy")) } } as never,
    evidenceAssessments: { [SUB]: { subCriterionId: SUB, rows: [{ verdict: "Met" }], fileLedger: opts.records.map((n) => ledgerFile(n, "evidence")) } } as never,
    outcomeReviewResults: {},
    fileTextCache: Object.fromEntries(Object.entries(opts.cached ?? {}).map(([n, t]) => cacheEntry(n, t))) as never,
    calibrationMemories: [],
  });
}

beforeEach(() => {
  readText.mockReset();
  readText.mockResolvedValue("");   // nothing readable, unless a test overrides
  stagedOutcomePass.mockReset();
});

describe("the unread-records guard, in the store", () => {
  it("refuses the pass when the records folder lists files but every one fails to read", async () => {
    seed({ records: ["KPI 2025.pdf", "minutes.docx", "CAP log.xlsx"], cached: {} });

    await useWorkspaceStore.getState().runOutcomeReviewPass(SUB);

    // The AI never saw it. Nothing was judged, so nothing can be "Not evident".
    expect(stagedOutcomePass).not.toHaveBeenCalled();
    const res = useWorkspaceStore.getState().outcomeReviewResults[SUB];
    expect(res).toBeTruthy();
    expect(res.rows).toEqual([]);
    expect(res.skippedReason).toMatch(/none of them could be read/i);
    expect(res.skippedReason).toContain("KPI 2025.pdf");
  });

  it("refuses when the run opened no records at all", async () => {
    seed({ records: [], cached: { "procedure.docx": "A documented procedure." } });

    await useWorkspaceStore.getState().runOutcomeReviewPass(SUB);

    expect(stagedOutcomePass).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().outcomeReviewResults[SUB].skippedReason).toMatch(/opened no records/i);
  });

  // A readable POLICY folder is not a substitute for readable records: outcome
  // data and review records are records. This is the subtle version of the same
  // error, and the gate counts records only.
  it("refuses when only the written procedure could be read", async () => {
    seed({ records: ["minutes.docx"], cached: { "procedure.docx": "A documented procedure." } });

    await useWorkspaceStore.getState().runOutcomeReviewPass(SUB);

    expect(stagedOutcomePass).not.toHaveBeenCalled();
    const res = useWorkspaceStore.getState().outcomeReviewResults[SUB];
    expect(res.skippedReason).toMatch(/none of it could be read/i);
    expect(res.skippedReason).toContain("minutes.docx");
  });

  it("runs the pass as soon as one record is readable", async () => {
    seed({
      records: ["KPI 2025.txt", "broken.txt"],
      cached: { "procedure.docx": "A documented procedure.", "KPI 2025.txt": "Pass rate 94% against a 90% target." },
    });
    stagedOutcomePass.mockResolvedValue({ rows: [{ ref: "6.1.1.DS1", pointText: "x", outcomeEvident: true, reviewEvident: false, note: "n", chunkIds: ["C001"] }], windowErrors: [] });

    await useWorkspaceStore.getState().runOutcomeReviewPass(SUB);

    expect(stagedOutcomePass).toHaveBeenCalledTimes(1);
    // Both sides reached the prompt: the pass judges policy and records
    // together, exactly as Option B's third pass does.
    const docText = String(stagedOutcomePass.mock.calls[0][1]);
    expect(docText).toContain("Pass rate 94% against a 90% target.");
    expect(docText).toContain("A documented procedure.");
    const res = useWorkspaceStore.getState().outcomeReviewResults[SUB];
    expect(res.skippedReason).toBeUndefined();
    expect(res.rows).toHaveLength(1);
  });

  // The pass must never disturb what the evidence pass concluded.
  it("leaves the evidence assessment's rows untouched", async () => {
    seed({ records: ["KPI 2025.txt"], cached: { "KPI 2025.txt": "Pass rate 94%." } });
    const before = JSON.stringify(useWorkspaceStore.getState().evidenceAssessments[SUB]);
    stagedOutcomePass.mockResolvedValue({ rows: [{ ref: "6.1.1.DS1", pointText: "x", outcomeEvident: false, reviewEvident: false, note: "n", chunkIds: [] }], windowErrors: [] });

    await useWorkspaceStore.getState().runOutcomeReviewPass(SUB);

    expect(JSON.stringify(useWorkspaceStore.getState().evidenceAssessments[SUB])).toBe(before);
    expect(JSON.stringify(useWorkspaceStore.getState().ppdReviewResults[SUB])).toBeTruthy();
  });
});

// Regression: `files` is the policy and evidence ledgers concatenated and
// deduplicated with the policy one FIRST, so when both boxes hold the same
// folder every record survives wearing the policy copy's bucket. Counting
// records by bucket then reported "no records" on a folder that had just been
// read, and refused a pass that should have run. Found live, not in review.
describe("both boxes pointing at one folder", () => {
  it("still counts the records, though the deduplicated copy is tagged policy", async () => {
    useAISettingsStore.setState({ enabled: true, apiKey: "test-key" } as never);
    useGoogleDriveStore.setState({ getFreshToken: async () => "token" } as never);
    const shared = ["Procedure.txt", "Intervention Log.txt"];
    useWorkspaceStore.setState({
      auditors: [{ id: "A1", name: "Tester", email: "t@example.com", role: "Lead Auditor" }] as never,
      activeAuditorId: "A1",
      folders: [{ id: "F1", scopeId: SUB, subCriterionId: SUB, folderName: "6.1", sourceSystem: "Google Drive", owner: "", status: "Linked", policyLink: "https://drive.google.com/drive/folders/ONE", folderLink: "https://drive.google.com/drive/folders/ONE" }] as never,
      // The SAME two files, read by both passes, tagged per pass.
      ppdReviewResults: { [SUB]: { subCriterionId: SUB, rows: [{}], fileLedger: shared.map((n) => ledgerFile(n, "policy")) } } as never,
      evidenceAssessments: { [SUB]: { subCriterionId: SUB, rows: [{ verdict: "Met" }], fileLedger: shared.map((n) => ledgerFile(n, "evidence")) } } as never,
      outcomeReviewResults: {},
      fileTextCache: Object.fromEntries(shared.map((n) => cacheEntry(n, `Contents of ${n}.`))) as never,
      calibrationMemories: [],
    });
    stagedOutcomePass.mockResolvedValue({ rows: [{ ref: "6.1.1.DS1", pointText: "x", outcomeEvident: false, reviewEvident: true, note: "n", chunkIds: ["C001"] }], windowErrors: [] });

    await useWorkspaceStore.getState().runOutcomeReviewPass(SUB);

    expect(stagedOutcomePass).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().outcomeReviewResults[SUB].skippedReason).toBeUndefined();
  });
});
