// Locked-cycle write barrier (issue 1).
//
// lockCycle() was a status label plus a snapshot, never a barrier: zero of the
// workspace store's actions read cycle.status, so a locked cycle could still
// have findings deleted, checklist verdicts rewritten and folders re-audited.
// Two things have to hold: the barrier actually blocks (and says so), and
// every NAME in the block lists is a real action — a typo would leave an
// action silently unguarded, which is the exact failure being fixed.
import { describe, it, expect, vi } from "vitest";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  default: { GlobalWorkerOptions: { workerPort: null }, getDocument: vi.fn() },
  GlobalWorkerOptions: { workerPort: null },
  getDocument: vi.fn(),
}));
vi.mock("mammoth", () => ({ default: { extractRawText: vi.fn() } }));
vi.mock("../../lib/drive/pdfWorker?worker", () => ({ default: class MockWorker { postMessage() {} addEventListener() {} terminate() {} } }));

const { installCycleLock, LOCKED_WORKSPACE_ACTIONS, LOCKED_CHECKLIST_ACTIONS, LOCKED_FINDING_DRAFT_ACTIONS, LOCKED_CYCLE_MESSAGE } = await import("../../lib/cycleLock");
const { useWorkspaceStore } = await import("../useWorkspaceStore");
const { useChecklistModuleStore } = await import("../useChecklistModuleStore");
const { useFindingDraftStore } = await import("../useFindingDraftStore");

describe("installCycleLock", () => {
  function fakeStore() {
    let state: Record<string, unknown> = { hits: 0, guarded: () => { (state.hits as number)++; return "ran"; }, open: () => { (state.hits as number)++; } };
    return {
      getState: () => state as never,
      setState: (p: Record<string, unknown>) => { state = { ...state, ...p }; },
      raw: () => state,
    };
  }

  it("blocks a listed action while locked and reports the reason", () => {
    const api = fakeStore();
    let locked = false;
    let reason: string | null = null;
    installCycleLock(api, ["guarded"], () => locked, () => { reason = LOCKED_CYCLE_MESSAGE; });

    expect((api.raw().guarded as () => string)()).toBe("ran");
    expect(api.raw().hits).toBe(1);

    locked = true;
    expect((api.raw().guarded as () => string)()).toBeUndefined();
    expect(api.raw().hits).toBe(1); // the original never ran
    expect(reason).toBe(LOCKED_CYCLE_MESSAGE);
  });

  it("leaves unlisted actions open while locked", () => {
    const api = fakeStore();
    installCycleLock(api, ["guarded"], () => true, () => {});
    (api.raw().open as () => void)();
    expect(api.raw().hits).toBe(1);
  });

  it("ignores names that are not functions instead of throwing", () => {
    const api = fakeStore();
    expect(() => installCycleLock(api, ["hits", "doesNotExist"], () => true, () => {})).not.toThrow();
    expect(api.raw().hits).toBe(0);
  });
});

describe("every blocked action name exists on its store", () => {
  const check = (state: Record<string, unknown>, names: readonly string[], label: string) => {
    const missing = names.filter((n) => typeof state[n] !== "function");
    expect(missing, `${label}: not real actions`).toEqual([]);
  };
  it("workspace store", () => check(useWorkspaceStore.getState() as never, LOCKED_WORKSPACE_ACTIONS, "workspace"));
  it("checklist store", () => check(useChecklistModuleStore.getState() as never, LOCKED_CHECKLIST_ACTIONS, "checklist"));
  it("finding draft store", () => check(useFindingDraftStore.getState() as never, LOCKED_FINDING_DRAFT_ACTIONS, "drafts"));
});

describe("the barrier covers the actions the repro used", () => {
  // From the confirmed repro: lock, then delete a finding, re-audit a folder,
  // change a checklist line status. All three must be blocked.
  it("names removeCustomFinding, auditFolderStaged and setSpecificStatus", () => {
    expect(LOCKED_WORKSPACE_ACTIONS).toContain("removeCustomFinding");
    expect(LOCKED_WORKSPACE_ACTIONS).toContain("auditFolderStaged");
    expect(LOCKED_CHECKLIST_ACTIONS).toContain("setSpecificStatus");
  });
  it("leaves export, restore, duplicate and unlock open", () => {
    for (const open of ["addExportLogEntry", "restoreVersion", "duplicateCycle", "unlockCycle", "saveAsNewVersion"]) {
      expect(LOCKED_WORKSPACE_ACTIONS).not.toContain(open);
    }
  });
});
