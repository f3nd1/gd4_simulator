import { createJSONStorage } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import { getSupabaseClient } from "../lib/supabaseClient";
import { useSaveStatusStore } from "../store/useSaveStatusStore";

// Single shared row per persisted store key — mirrors the one-blob shape the
// localStorage version already used, so no store/action code has to change.
const TABLE = "workspace_state";

// Per-key debounce. (Previously a single shared timer meant a save to one
// store — e.g. the checklist — could cancel another store's pending save —
// e.g. the workspace — within the 600ms window, silently dropping it.)
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingValues = new Map<string, string>();

async function flushKey(name: string): Promise<void> {
  const value = pendingValues.get(name);
  if (value === undefined) return;
  pendingValues.delete(name);
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    const { error } = await supabase.from(TABLE).upsert({ id: name, data: JSON.parse(value), updated_at: new Date().toISOString() });
    if (error) {
      console.error("Supabase save failed:", error.message);
      useSaveStatusStore.getState().markError();
    } else if (pendingValues.size === 0) {
      useSaveStatusStore.getState().markSaved();
    }
  } catch (err) {
    console.error("Supabase save failed:", err instanceof Error ? err.message : String(err));
    useSaveStatusStore.getState().markError();
  }
}

// Best-effort flush of all pending saves — wired to `beforeunload` so closing
// the tab inside the debounce window still pushes the last edit to Supabase.
export async function flushPendingSaves(): Promise<void> {
  for (const t of saveTimers.values()) clearTimeout(t);
  saveTimers.clear();
  await Promise.all([...pendingValues.keys()].map(flushKey));
}

// localStorage is always written as an offline cache and as the fallback
// when Supabase isn't configured or a request fails, so the app keeps
// working exactly as before if the database is unreachable.
const dbStorage: StateStorage = {
  getItem: async (name) => {
    const supabase = getSupabaseClient();
    if (!supabase) return localStorage.getItem(name);
    // An unreachable host can take many seconds to actually reject (proxy/tunnel
    // timeouts), during which the UI would otherwise sit on blank default state.
    // Race against the local cache's load time so a slow/dead network never
    // delays first paint of the user's own already-known-good data.
    const TIMEOUT_MS = 2500;
    let timer!: ReturnType<typeof setTimeout>;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([
        supabase.from(TABLE).select("data").eq("id", name).maybeSingle(),
        timeout,
      ]);
      clearTimeout(timer);
      if (result === "timeout") {
        console.error("Supabase load timed out, using local cache");
        return localStorage.getItem(name);
      }
      const { data, error } = result;
      if (error) {
        console.error("Supabase load failed, using local cache:", error.message);
        return localStorage.getItem(name);
      }
      return data ? JSON.stringify(data.data) : localStorage.getItem(name);
    } catch (err) {
      clearTimeout(timer);
      // A network-level failure (e.g. unreachable host) rejects the request
      // promise itself rather than resolving with `{error}`, so it must be
      // caught separately from the `error` branch above to still fall back
      // to the local cache instead of silently losing the request entirely.
      console.error("Supabase load failed, using local cache:", err instanceof Error ? err.message : String(err));
      return localStorage.getItem(name);
    }
  },

  setItem: (name, value) => {
    localStorage.setItem(name, value);
    const supabase = getSupabaseClient();
    if (!supabase) return Promise.resolve();
    pendingValues.set(name, value);
    useSaveStatusStore.getState().markSaving();
    const existing = saveTimers.get(name);
    if (existing) clearTimeout(existing);
    return new Promise<void>((resolve) => {
      saveTimers.set(
        name,
        setTimeout(async () => {
          saveTimers.delete(name);
          await flushKey(name);
          resolve();
        }, 600)
      );
    });
  },

  removeItem: async (name) => {
    localStorage.removeItem(name);
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      await supabase.from(TABLE).delete().eq("id", name);
    } catch (err) {
      console.error("Supabase delete failed:", err instanceof Error ? err.message : String(err));
    }
  },
};

export const workspaceStorage = createJSONStorage(() => dbStorage);
