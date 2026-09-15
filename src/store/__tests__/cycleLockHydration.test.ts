// The guards must not be installed before the store has hydrated.
//
// installCycleLock patches its no-op actions in with setState, and setState is
// what zustand's persist middleware writes on — it serialises and writes the
// WHOLE persisted slice. Calling it at module load, before the async storage
// adapter had resolved, therefore pushed the store's DEFAULT state to Supabase
// and permanently overwrote the real row. Reproduced live: an auditor created
// seconds earlier came back as auditors: [] on the next load, on any device
// that had to fall back to the remote copy.
//
// This pins the ordering rather than the symptom, because the symptom only
// shows against a real async adapter.
import { describe, it, expect, vi } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { installCycleLockGuards } = await import("../installCycleLock");
const { useWorkspaceStore } = await import("../useWorkspaceStore");
const { useChecklistModuleStore } = await import("../useChecklistModuleStore");
const { useFindingDraftStore } = await import("../useFindingDraftStore");

const STORES = [
  ["workspace", useWorkspaceStore],
  ["checklist", useChecklistModuleStore],
  ["finding drafts", useFindingDraftStore],
] as const;

describe("cycle-lock guards wait for hydration", () => {
  it("every guarded store exposes the persist hydration API the installer relies on", () => {
    for (const [name, store] of STORES) {
      const p = (store as unknown as { persist?: { hasHydrated?: unknown; onFinishHydration?: unknown } }).persist;
      expect(p, `${name} store has no persist API`).toBeTruthy();
      expect(typeof p!.hasHydrated, `${name}.persist.hasHydrated`).toBe("function");
      expect(typeof p!.onFinishHydration, `${name}.persist.onFinishHydration`).toBe("function");
    }
  });

  it("defers installation on a store that has not hydrated, and never calls setState first", () => {
    const calls: string[] = [];
    for (const [name, store] of STORES) {
      const s = store as unknown as {
        persist: { hasHydrated: () => boolean; onFinishHydration: (cb: () => void) => void };
        setState: (p: unknown) => void;
      };
      vi.spyOn(s.persist, "hasHydrated").mockReturnValue(false);
      vi.spyOn(s.persist, "onFinishHydration").mockImplementation(() => { calls.push(`deferred:${name}`); });
      vi.spyOn(s, "setState").mockImplementation(() => { calls.push(`WROTE:${name}`); });
    }

    installCycleLockGuards();

    // The whole point: three deferrals, and not one write.
    expect(calls.filter((c) => c.startsWith("deferred:"))).toHaveLength(3);
    expect(calls.filter((c) => c.startsWith("WROTE:"))).toEqual([]);
    vi.restoreAllMocks();
  });

  it("installs immediately on a store that has already hydrated", () => {
    const ran: string[] = [];
    for (const [name, store] of STORES) {
      const s = store as unknown as {
        persist: { hasHydrated: () => boolean; onFinishHydration: (cb: () => void) => void };
        setState: (p: unknown) => void;
      };
      vi.spyOn(s.persist, "hasHydrated").mockReturnValue(true);
      vi.spyOn(s.persist, "onFinishHydration").mockImplementation(() => { ran.push(`deferred:${name}`); });
      vi.spyOn(s, "setState").mockImplementation(() => { ran.push(`installed:${name}`); });
    }

    installCycleLockGuards();

    expect(ran.filter((c) => c.startsWith("installed:"))).toHaveLength(3);
    expect(ran.filter((c) => c.startsWith("deferred:"))).toEqual([]);
    vi.restoreAllMocks();
  });
});
