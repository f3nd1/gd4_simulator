import { describe, it, expect, afterEach, vi } from "vitest";

// Importing useWorkspaceStore (for the mirror tests at the bottom) pulls in
// driveClient, which builds a pdfjs Worker at module load — unavailable in
// Node. Same stubs as checkEvidenceDrift.test.ts, which imports it for the
// same reason.
const _ls: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  setItem(k: string, v: string) { _ls[k] = v; },
  getItem(k: string) { return _ls[k] ?? null; },
  removeItem(k: string) { delete _ls[k]; },
  clear() { Object.keys(_ls).forEach((k) => delete _ls[k]); },
});
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));
import { useFileTextCacheStore, getCachedFileText, putCachedFileText, trimToBudget, type CachedFileText } from "../useFileTextCacheStore";

const entry = (text: string, cachedAt = Date.now()): CachedFileText =>
  ({ text, charCount: text.length, fileKind: "PDF", fileName: "f.pdf", cachedAt, readMethod: "vision" });

afterEach(() => useFileTextCacheStore.setState({ entries: {} }));

describe("the persisted extracted-text cache", () => {
  it("stores and returns a file's text", () => {
    putCachedFileText("id1:2026-01-01", entry("hello world"));
    expect(getCachedFileText("id1:2026-01-01")?.text).toBe("hello world");
  });

  it("keeps the read method and pdf quality, so the File Ledger stays accurate on a reused read", () => {
    putCachedFileText("id2:t", { ...entry("x"), pdfQuality: { suspectedScannedPdf: true, extractedTextQuality: "low" }, visionModel: "m" });
    const got = getCachedFileText("id2:t");
    expect(got?.readMethod).toBe("vision");
    expect(got?.pdfQuality?.suspectedScannedPdf).toBe(true);
    expect(got?.visionModel).toBe("m");
  });

  it("misses when the file's modifiedTime changes — a re-run never reuses an edited file", () => {
    putCachedFileText("id3:2026-01-01", entry("old"));
    expect(getCachedFileText("id3:2026-06-01")).toBeUndefined();
  });

  it("refuses an oversized entry rather than storing a shortened one", () => {
    putCachedFileText("big:t", entry("x".repeat(600_001)));
    expect(getCachedFileText("big:t")).toBeUndefined();
  });

  it("never stores a truncated copy of anything it does accept", () => {
    const text = "y".repeat(599_999);
    putCachedFileText("ok:t", entry(text));
    expect(getCachedFileText("ok:t")?.text).toHaveLength(text.length);
  });

  it("treats an empty entry as no entry", () => {
    putCachedFileText("empty:t", entry(""));
    expect(getCachedFileText("empty:t")).toBeUndefined();
  });
});

describe("trimToBudget", () => {
  it("leaves everything alone under the ceiling", () => {
    const e = { a: entry("a"), b: entry("b") };
    expect(Object.keys(trimToBudget(e)).sort()).toEqual(["a", "b"]);
  });

  it("evicts oldest-first, whole entries only, until it fits", () => {
    const big = "z".repeat(500_000);
    const e: Record<string, CachedFileText> = {};
    for (let i = 0; i < 10; i++) e[`k${i}`] = entry(big, 1_000 + i);
    const out = trimToBudget(e);
    const kept = Object.keys(out).sort();
    // 4,000,000 / 500,000 = 8 entries fit; the two oldest go.
    expect(kept).toEqual(["k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9"]);
    for (const v of Object.values(out)) expect(v.text).toHaveLength(big.length);
  });
});

// The mirror is what actually makes the cache survive a reload: every write to
// useWorkspaceStore's in-memory fileTextCache has to reach the persisted store.
// It is a subscription rather than an edit at each of the seven write sites,
// so this test is the only thing proving the subscription is wired at all.
describe("the in-memory to persisted mirror", () => {
  it("copies a new in-memory cache entry into the persisted store", async () => {
    const { useWorkspaceStore } = await import("../useWorkspaceStore");
    useFileTextCacheStore.setState({ entries: {} });
    useWorkspaceStore.setState((s) => ({
      fileTextCache: {
        ...s.fileTextCache,
        "mirrored:2026-02-04": { text: "extracted body", charCount: 14, fileKind: "PDF", fileName: "m.pdf", cachedAt: 1_700_000_000_000, readMethod: "vision" },
      },
    }));
    expect(getCachedFileText("mirrored:2026-02-04")?.text).toBe("extracted body");
    expect(getCachedFileText("mirrored:2026-02-04")?.readMethod).toBe("vision");
  });

  it("clearing the cache clears both tiers, or 'clear' would be a lie", async () => {
    const { useWorkspaceStore } = await import("../useWorkspaceStore");
    putCachedFileText("stale:t", entry("old text"));
    useWorkspaceStore.getState().clearFileTextCache();
    expect(getCachedFileText("stale:t")).toBeUndefined();
    expect(useWorkspaceStore.getState().fileTextCache).toEqual({});
  });
});
