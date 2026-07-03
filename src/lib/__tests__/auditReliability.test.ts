// Tests for audit reliability fixes:
//   1. replaceAuditEvidence replaces auto-audit evidence, keeps manual
//   2. cancelBusy increments auditRunToken (cancel-guard counter)
//   3. parseJSONArray handles { "lines": [...] } format (checklist generation)
//   4. Drive pagination nextPageToken logic (pure logic test)
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub browser-only globals that the Zustand persist middleware uses —
// localStorage and Worker are not available in the Vitest Node.js environment.
const _localStorageData: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  setItem(key: string, value: string) { _localStorageData[key] = value; },
  getItem(key: string) { return _localStorageData[key] ?? null; },
  removeItem(key: string) { delete _localStorageData[key]; },
  clear() { Object.keys(_localStorageData).forEach((k) => delete _localStorageData[k]); },
});

// Stub browser-only APIs that the store imports drag in at module-load time in
// Node.js. These must be declared before the dynamic imports below.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
// The ?worker Vite transform produces a constructor; stub it as a no-op class.
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

// Dynamic imports AFTER vi.mock declarations so mocks are hoisted properly.
const { useChecklistModuleStore } = await import("../../store/useChecklistModuleStore");
const { useWorkspaceStore } = await import("../../store/useWorkspaceStore");

// ---- replaceAuditEvidence -------------------------------------------------

function seedLine(itemId: string) {
  useChecklistModuleStore.getState().ensureEntry(itemId);
  useChecklistModuleStore.getState().addSpecificLine(itemId, "Test line text", `GD4 ${itemId}`);
  const lines = useChecklistModuleStore.getState().entries[itemId]?.specific ?? [];
  return lines[lines.length - 1]?.id ?? "";
}

describe("replaceAuditEvidence", () => {
  beforeEach(() => {
    useChecklistModuleStore.getState().replaceAllEntries({});
  });

  it("removes prior auto-audit evidence (runId set) and adds new evidence", () => {
    const itemId = "1.1";
    const lid = seedLine(itemId);

    useChecklistModuleStore.getState().addEvidence(itemId, lid, {
      title: "Drive audit AR-1.1-OLD — folder",
      type: "Record/Log",
      date: "2024-01-01",
      sufficiency: "Missing",
      auditorNote: "old run",
      approved: false,
      reviewed: false,
      owner: "SQ",
      runId: "AR-1.1-OLD",
    });

    useChecklistModuleStore.getState().addEvidence(itemId, lid, {
      title: "My manual policy doc",
      type: "Policy/Procedure",
      date: "2024-02-01",
      sufficiency: "Present",
      auditorNote: "manually added",
      approved: false,
      reviewed: false,
      owner: "SQ",
    });

    const before = useChecklistModuleStore.getState().entries[itemId].specific.find((l) => l.id === lid)!;
    expect(before.evidence).toHaveLength(2);

    useChecklistModuleStore.getState().replaceAuditEvidence(itemId, lid, {
      title: "Drive audit AR-1.1-NEW — folder",
      type: "Record/Log",
      date: "2024-03-01",
      sufficiency: "Present",
      auditorNote: "new run",
      approved: false,
      reviewed: false,
      owner: "SQ",
      runId: "AR-1.1-NEW",
    });

    const after = useChecklistModuleStore.getState().entries[itemId].specific.find((l) => l.id === lid)!;
    expect(after.evidence).toHaveLength(2); // manual + new auto
    expect(after.evidence.find((e) => e.runId === "AR-1.1-OLD")).toBeUndefined(); // old gone
    expect(after.evidence.find((e) => e.runId === "AR-1.1-NEW")).toBeDefined(); // new present
    expect(after.evidence.find((e) => !e.runId)?.title).toBe("My manual policy doc"); // manual kept
  });

  it("keeps all evidence when there is no prior auto-audit evidence", () => {
    const itemId = "1.2";
    const lid = seedLine(itemId);

    useChecklistModuleStore.getState().addEvidence(itemId, lid, {
      title: "Manual evidence A",
      type: "Other",
      date: "2024-01-01",
      sufficiency: "Present",
      auditorNote: "",
      approved: false,
      reviewed: false,
      owner: "SQ",
    });

    useChecklistModuleStore.getState().replaceAuditEvidence(itemId, lid, {
      title: "Drive audit AR-1.2-NEW — folder",
      type: "Record/Log",
      date: "2024-03-01",
      sufficiency: "Present",
      auditorNote: "new run",
      approved: false,
      reviewed: false,
      owner: "SQ",
      runId: "AR-1.2-NEW",
    });

    const after = useChecklistModuleStore.getState().entries[itemId].specific.find((l) => l.id === lid)!;
    expect(after.evidence).toHaveLength(2); // both kept
  });
});

// ---- Cancel token guard ---------------------------------------------------

describe("auditRunToken", () => {
  it("is a number in the store state", () => {
    expect(typeof useWorkspaceStore.getState().auditRunToken).toBe("number");
  });

  it("increments when cancelBusy is called", () => {
    const before = useWorkspaceStore.getState().auditRunToken;
    useWorkspaceStore.getState().cancelBusy();
    expect(useWorkspaceStore.getState().auditRunToken).toBe(before + 1);
  });

  it("also clears busy and bulkAuditStatus", () => {
    useWorkspaceStore.setState({ busy: "folderauditSOME", bulkAuditStatus: "running…" });
    useWorkspaceStore.getState().cancelBusy();
    expect(useWorkspaceStore.getState().busy).toBeNull();
    expect(useWorkspaceStore.getState().bulkAuditStatus).toBeNull();
  });
});

// ---- parseJSONArray (checklist generation format) -------------------------
// Replicated inline (not exported from agentRuntime.ts) to verify both response
// formats the prompt can produce are parsed correctly.

function extractFirstJSONArray(text: string): string | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "]") {
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseJSONArray(text: string): unknown[] {
  const tryArr = (s: string): unknown[] | null => {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray((parsed as Record<string, unknown>).lines))
        return (parsed as Record<string, unknown>).lines as unknown[];
    } catch { /* fall through */ }
    return null;
  };
  return tryArr(text) ?? (extractFirstJSONArray(text) ? tryArr(extractFirstJSONArray(text)!) : null) ?? [];
}

describe("parseJSONArray (checklist generation response formats)", () => {
  it("parses bare JSON array", () => {
    const input = '[{"text":"Line A","clause":"GD4 1.1"},{"text":"Line B","clause":"GD4 1.1"}]';
    const result = parseJSONArray(input);
    expect(result).toHaveLength(2);
    expect((result[0] as { text: string }).text).toBe("Line A");
  });

  it('parses {"lines": [...]} object (new prompt format)', () => {
    const input = '{"lines":[{"text":"Line A","clause":"GD4 1.1"},{"text":"Line B","clause":"GD4 1.1"}]}';
    const result = parseJSONArray(input);
    expect(result).toHaveLength(2);
    expect((result[0] as { text: string }).text).toBe("Line A");
  });

  it("extracts JSON array embedded in prose", () => {
    const input = 'Here are the lines:\n[{"text":"Line A","clause":"GD4 1.1"}]';
    const result = parseJSONArray(input);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for unparseable input", () => {
    expect(parseJSONArray("not json at all")).toHaveLength(0);
    expect(parseJSONArray("")).toHaveLength(0);
  });
});

// ---- Drive pagination logic -----------------------------------------------
// listFolderFiles now loops on nextPageToken. Pure logic test — replicates the
// loop body from driveClient.ts using a fake fetch stub.

describe("Drive pagination (nextPageToken loop logic)", () => {
  type DriveFile = { id: string; name: string; mimeType: string };

  it("accumulates results across multiple pages", async () => {
    const pages: { files: DriveFile[]; nextPageToken?: string }[] = [
      { files: [{ id: "1", name: "a.pdf", mimeType: "application/pdf" }], nextPageToken: "PAGE2" },
      { files: [{ id: "2", name: "b.pdf", mimeType: "application/pdf" }], nextPageToken: "PAGE3" },
      { files: [{ id: "3", name: "c.pdf", mimeType: "application/pdf" }] },
    ];
    let callCount = 0;
    const fakeFetch = async () => pages[callCount++];

    const all: DriveFile[] = [];
    let pageToken: string | undefined;
    const MAX_PAGES = 5;
    let pagesConsumed = 0;
    do {
      const data = await fakeFetch();
      all.push(...data.files);
      pageToken = data.nextPageToken;
      pagesConsumed++;
    } while (pageToken && pagesConsumed < MAX_PAGES);

    expect(all).toHaveLength(3);
    expect(pagesConsumed).toBe(3);
  });

  it("stops after MAX_PAGES even if server keeps returning nextPageToken", async () => {
    let callCount = 0;
    const fakeFetch = async () => ({
      files: [{ id: String(callCount), name: `f${callCount}.pdf`, mimeType: "application/pdf" }] as DriveFile[],
      nextPageToken: `PAGE${++callCount}`,
    });

    const all: DriveFile[] = [];
    let pageToken: string | undefined;
    const MAX_PAGES = 5;
    let pagesConsumed = 0;
    do {
      const data = await fakeFetch();
      all.push(...data.files);
      pageToken = data.nextPageToken;
      pagesConsumed++;
    } while (pageToken && pagesConsumed < MAX_PAGES);

    expect(pagesConsumed).toBe(5);
    expect(all).toHaveLength(5);
  });
});
