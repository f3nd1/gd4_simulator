import { describe, it, expect, beforeEach, vi } from "vitest";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import { blockWritesIfHydrationFailed, writesBlocked, resetHydrationGate, HYDRATION_FAILED_MESSAGE } from "../hydrationGate";
import { useSaveStatusStore } from "../useSaveStatusStore";
import { writeLocal } from "../safeLocalStorage";

// THE CLASS, not the bug.
//
// Twice now a workspace has been destroyed by the same shape of failure: the
// store ends up holding its DEFAULT state while writes are still allowed, and
// the next write publishes those defaults over the real Supabase row.
//
//   59d0009 — a module wrote before hydration had finished.
//   this one — hydration never finished at all, because `migrate` threw and
//              zustand swallows that into its own catch: hasHydrated stays
//              false, the store keeps its defaults, and nothing stops writing.
//
// The 59d0009 regression test pins the ORDERING of one specific installer, so
// it could not see the second case. This pins the PROPERTY instead: whatever
// makes hydration fail, no write may reach storage afterwards. Any future
// trigger - a throwing migration, a corrupt blob, a deserialiser change - is
// covered without naming it.

type Counter = { n: number; bump: () => void };

function storeWithFailingHydration(name: string, storage: StateStorage) {
  return create<Counter>()(
    persist(
      (set) => ({ n: 0, bump: () => set((s) => ({ n: s.n + 1 })) }),
      {
        name,
        version: 2,
        storage: createJSONStorage(() => storage),
        // The real failure mode: a migration that throws on stored data it did
        // not expect.
        migrate: () => { throw new Error("migrate blew up on stored data"); },
        onRehydrateStorage: blockWritesIfHydrationFailed<Counter>(name),
      }
    )
  );
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// Node environment: no DOM Storage, and writeLocal is the real adapter.
beforeEach(() => {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } },
    configurable: true, writable: true,
  });
  resetHydrationGate();
  useSaveStatusStore.setState({ status: "idle", localSaveError: null });
});

describe("a store that failed to hydrate never publishes its defaults", () => {
  it("blocks every write after a migration throws, leaving the stored copy intact", async () => {
    const REAL = JSON.stringify({ state: { n: 42 }, version: 1 });
    const writes: string[] = [];
    let stored = REAL;
    // The REAL app adapter for the local half of every persisted store, wrapped
    // only so the stored value can be seen. Using a synthetic storage here
    // would have tested the test: the gate lives in the adapters.
    const storage: StateStorage = {
      getItem: async () => stored,
      setItem: (n, v) => { if (writeLocal(n, v)) { writes.push(v); stored = v; } },
      removeItem: async () => {},
    };

    const useStore = storeWithFailingHydration("wipe-me", storage);
    await flush(); await flush(); await flush();

    // Hydration failed, so the store is on its defaults. That part is zustand's
    // behaviour and is not what this test is about.
    expect(useStore.getState().n).toBe(0);
    expect(writesBlocked("wipe-me")).toBe(true);

    // The user carries on working. Before the gate, THIS is the write that
    // destroyed the workspace.
    useStore.getState().bump();
    useStore.getState().bump();
    await flush(); await flush();

    expect(writes).toEqual([]);
    expect(stored).toBe(REAL);
  });

  it("says so, rather than failing silently", async () => {
    const storage: StateStorage = {
      getItem: async () => JSON.stringify({ state: { n: 7 }, version: 1 }),
      setItem: async () => {},
      removeItem: async () => {},
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    storeWithFailingHydration("noisy", storage);
    await flush(); await flush(); await flush();
    expect(useSaveStatusStore.getState().localSaveError).toBe(HYDRATION_FAILED_MESSAGE);
    expect(useSaveStatusStore.getState().status).toBe("error");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  // The banner is shared with the quota warning, so a healthy store saving must
  // not wipe the message about the broken one.
  it("keeps the warning up while another store keeps saving happily", async () => {
    const storage: StateStorage = {
      getItem: async () => JSON.stringify({ state: { n: 1 }, version: 1 }),
      setItem: (n, v) => { writeLocal(n, v); },
      removeItem: async () => {},
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    storeWithFailingHydration("broken-one", storage);
    await flush(); await flush(); await flush();
    expect(useSaveStatusStore.getState().localSaveError).toBe(HYDRATION_FAILED_MESSAGE);

    writeLocal("a-healthy-store", JSON.stringify({ state: { ok: true }, version: 1 }));
    expect(useSaveStatusStore.getState().localSaveError).toBe(HYDRATION_FAILED_MESSAGE);
    vi.restoreAllMocks();
  });

  it("leaves a store that hydrated cleanly free to write", async () => {
    const writes: string[] = [];
    const storage: StateStorage = {
      getItem: async () => JSON.stringify({ state: { n: 5 }, version: 2 }),
      setItem: (n, v) => { if (writeLocal(n, v)) writes.push(v); },
      removeItem: async () => {},
    };
    const useStore = create<Counter>()(
      persist((set) => ({ n: 0, bump: () => set((s) => ({ n: s.n + 1 })) }), {
        name: "healthy",
        version: 2,
        storage: createJSONStorage(() => storage),
        onRehydrateStorage: blockWritesIfHydrationFailed<Counter>("healthy"),
      })
    );
    await flush(); await flush(); await flush();
    expect(useStore.getState().n).toBe(5);
    expect(writesBlocked("healthy")).toBe(false);
    useStore.getState().bump();
    await flush(); await flush();
    expect(writes.length).toBeGreaterThan(0);
    expect(JSON.parse(writes.at(-1)!).state.n).toBe(6);
  });

  // The gate is only reachable if every persisted store actually wires it, so
  // that is asserted from the real source in storeAdapters.test.ts.
  it("is exported with a stable name the stores import", () => {
    expect(typeof blockWritesIfHydrationFailed).toBe("function");
    expect(typeof writesBlocked).toBe("function");
  });
});
