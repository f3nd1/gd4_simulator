// Tests for useWorkspaceStore's checkEvidenceDrift action — the full
// production path (folder lookup, ledger gating, Drive token, live listing,
// diffing) not just the pure diffEvidenceFiles helper it delegates to.
import { describe, it, expect, vi, beforeEach } from "vitest";

const _localStorageData: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  setItem(key: string, value: string) { _localStorageData[key] = value; },
  getItem(key: string) { return _localStorageData[key] ?? null; },
  removeItem(key: string) { delete _localStorageData[key]; },
  clear() { Object.keys(_localStorageData).forEach((k) => delete _localStorageData[k]); },
});

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

// Real parseFolderId/classifyFileBucket etc. are kept — only the network call
// (listFolderFilesRecursive) is replaced, so the action's real folder-
// resolution and bucket-classification logic is exercised, not bypassed.
vi.mock("../drive/driveClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../drive/driveClient")>();
  return { ...actual, listFolderFilesRecursive: vi.fn() };
});

const { listFolderFilesRecursive } = await import("../drive/driveClient");
const { useWorkspaceStore } = await import("../../store/useWorkspaceStore");
const { useGoogleDriveStore } = await import("../../store/useGoogleDriveStore");

const mockList = vi.mocked(listFolderFilesRecursive);

const FOLDER_LINK = "https://drive.google.com/drive/folders/FOLDER123";

function seedFolderAndAssessment(fileLedger: ReturnType<typeof ledgerRec>[] | undefined) {
  useWorkspaceStore.setState((s) => ({
    folders: [{ id: "F1", auditCycleId: s.cycle.id, criterionId: "4", subCriterionId: "4.4", folderName: "4.4 Refund", sourceSystem: "Google Drive", folderLink: FOLDER_LINK, owner: "Test", status: "In Progress" }],
    evidenceAssessments: {
      "4.4": {
        subCriterionId: "4.4", rows: [], runAt: "2026-01-01T00:00:00.000Z", live: true,
        ...(fileLedger ? { fileLedger } : {}),
      },
    },
  }));
}

function ledgerRec(name: string, driveFileId: string, driveModifiedTime: string) {
  return {
    path: `2. Actual Evidence/${name}`, name, mimeType: "application/pdf", fileKind: "PDF",
    bucket: "evidence" as const, readStatus: "read" as const, auditStatus: "cited" as const, driveFileId, driveModifiedTime,
  };
}

beforeEach(() => {
  mockList.mockReset();
  useWorkspaceStore.setState({ folders: [], evidenceAssessments: {} });
  useGoogleDriveStore.setState({ accessToken: null, tokenExpiresAt: null, clientId: "" });
});

describe("checkEvidenceDrift", () => {
  it("errors honestly when there's no fileLedger to compare against (e.g. a staged-audit-derived assessment)", async () => {
    seedFolderAndAssessment(undefined);
    const r = await useWorkspaceStore.getState().checkEvidenceDrift("4.4");
    expect(r.status).toBe("error");
    expect(r.errorMessage).toMatch(/no prior file ledger/i);
  });

  it("errors honestly when Drive isn't connected — never claims 'unchanged' without checking", async () => {
    seedFolderAndAssessment([ledgerRec("A.pdf", "f1", "t1")]);
    // No accessToken/clientId seeded — getFreshToken() resolves null.
    const r = await useWorkspaceStore.getState().checkEvidenceDrift("4.4");
    expect(r.status).toBe("error");
    expect(r.errorMessage).toMatch(/drive isn't connected/i);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("reports 'unchanged' when the live Drive listing matches the stored ledger exactly", async () => {
    seedFolderAndAssessment([ledgerRec("A.pdf", "f1", "t1")]);
    useGoogleDriveStore.setState({ accessToken: "tok", tokenExpiresAt: Date.now() + 3_600_000, clientId: "client" });
    mockList.mockResolvedValue([{ id: "f1", name: "A.pdf", mimeType: "application/pdf", modifiedTime: "t1", path: "A.pdf" }]);
    const r = await useWorkspaceStore.getState().checkEvidenceDrift("4.4");
    expect(r.status).toBe("unchanged");
  });

  it("reports 'changed' with the specific added file when the live listing has a new file", async () => {
    seedFolderAndAssessment([ledgerRec("A.pdf", "f1", "t1")]);
    useGoogleDriveStore.setState({ accessToken: "tok", tokenExpiresAt: Date.now() + 3_600_000, clientId: "client" });
    mockList.mockResolvedValue([
      { id: "f1", name: "A.pdf", mimeType: "application/pdf", modifiedTime: "t1", path: "A.pdf" },
      { id: "f2", name: "New_Receipt.pdf", mimeType: "application/pdf", modifiedTime: "t2", path: "New_Receipt.pdf" },
    ]);
    const r = await useWorkspaceStore.getState().checkEvidenceDrift("4.4");
    expect(r.status).toBe("changed");
    expect(r.added).toContain("New_Receipt.pdf");
  });

  it("reports 'changed' when a ledger file's modifiedTime no longer matches (edited since the run)", async () => {
    seedFolderAndAssessment([ledgerRec("A.pdf", "f1", "t1")]);
    useGoogleDriveStore.setState({ accessToken: "tok", tokenExpiresAt: Date.now() + 3_600_000, clientId: "client" });
    mockList.mockResolvedValue([{ id: "f1", name: "A.pdf", mimeType: "application/pdf", modifiedTime: "t1-EDITED", path: "A.pdf" }]);
    const r = await useWorkspaceStore.getState().checkEvidenceDrift("4.4");
    expect(r.status).toBe("changed");
    expect(r.modified).toContain("A.pdf");
  });

  it("errors (not 'unchanged') when the Drive listing call itself fails", async () => {
    seedFolderAndAssessment([ledgerRec("A.pdf", "f1", "t1")]);
    useGoogleDriveStore.setState({ accessToken: "tok", tokenExpiresAt: Date.now() + 3_600_000, clientId: "client" });
    mockList.mockRejectedValue(new Error("network down"));
    const r = await useWorkspaceStore.getState().checkEvidenceDrift("4.4");
    expect(r.status).toBe("error");
    expect(r.errorMessage).toMatch(/network down/i);
  });
});
