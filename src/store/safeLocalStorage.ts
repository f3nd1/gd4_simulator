// A localStorage that cannot throw on write.
//
// zustand's persist calls storage.setItem synchronously inside setState, so a
// QuotaExceededError from a raw `localStorage` adapter propagates out of the
// action, up through React's render, and blanks the whole app on load. That is
// not theoretical: with a full quota the app rendered an empty page, because
// some stores still used the raw adapter.
//
// This lives in its own leaf module, importing nothing but the save-status
// store, because useSupabaseSettingsStore needs it and taking it from
// supabaseStorage.ts created the cycle
//   settings -> supabaseStorage -> supabaseClient -> settings,
// which left the Supabase credentials unpersisted entirely. Found by running
// the app, not by reading it.
import type { StateStorage } from "zustand/middleware";
import { useSaveStatusStore } from "./useSaveStatusStore";
import { writesBlocked, anyWritesBlocked } from "./hydrationGate";

export const LOCAL_SAVE_FAILED_MESSAGE =
  "Local save failed — storage full. Your work is safe in memory but export or push soon.";

// The single place the app writes to localStorage without risking a throw.
// Returns false when the write was refused, so callers that care can tell.
export function writeLocal(name: string, value: string): boolean {
  // A store that failed to hydrate holds DEFAULTS, and writing those over the
  // stored copy is how a workspace is lost. See hydrationGate.ts.
  if (writesBlocked(name)) return false;
  try {
    localStorage.setItem(name, value);
    // Only a genuine recovery clears the banner. While any store is blocked,
    // another store saving fine says nothing about the one that is not.
    if (!anyWritesBlocked()) useSaveStatusStore.getState().clearLocalSaveError();
    return true;
  } catch (err) {
    console.warn(
      `Local save failed for "${name}" (${err instanceof Error ? err.name : "storage error"}) — localStorage may be full. Continuing with in-memory state.`
    );
    useSaveStatusStore.getState().markLocalSaveError(LOCAL_SAVE_FAILED_MESSAGE);
    return false;
  }
}

export function readLocal(name: string): string | null {
  try { return localStorage.getItem(name); } catch { return null; }
}

export function removeLocal(name: string): void {
  try { localStorage.removeItem(name); } catch { /* nothing to remove from a storage we cannot reach */ }
}

export const safeLocalStorage: StateStorage = {
  getItem: readLocal,
  setItem: (name, value) => { writeLocal(name, value); },
  removeItem: removeLocal,
};
