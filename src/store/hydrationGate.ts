// The write barrier for a store that failed to hydrate.
//
// zustand's persist middleware swallows a throw from `migrate` (or from parsing
// a corrupt blob) into its own `.catch`: `hasHydrated` stays false forever, no
// `onFinishHydration` listener fires, and the store simply keeps its DEFAULT
// state. Nothing stops writing, so the next setState — creating an auditor,
// opening a folder, anything — serialises those defaults and publishes them
// over the real Supabase row. The stored workspace is then gone.
//
// Reproduced live on 2026-09-17: one `versions` entry without a `snapshot` made
// the v10 -> v11 migration throw, and a workspace with an auditor and two saved
// versions came back as an empty default with a single new auditor in it.
//
// This is deliberately about the CLASS, not that one bug. Whatever makes
// hydration fail, the consequence is the same and so is the remedy: stop
// writing that key, say so, and leave the stored copy intact to be rescued.
//
// A leaf module on purpose. Both storage adapters import it, and safeLocalStorage
// must not reach supabaseStorage (see the cycle documented there), so the
// registry cannot live in either adapter.
import { useSaveStatusStore } from "./useSaveStatusStore";

const failed = new Set<string>();

export const HYDRATION_FAILED_MESSAGE =
  "Some of your saved work could not be loaded, so saving is switched off to protect it. Nothing you have stored has been changed. Reload the page; if this keeps happening, tell your audit lead BEFORE entering anything new.";

// Wired as each persisted store's `onRehydrateStorage`. zustand calls the
// returned function with (state, error); an error is the only case we act on.
// Generic in the store's state so it infers from the persist options it sits
// in rather than pinning them to `unknown`.
export function blockWritesIfHydrationFailed<S>(name: string): (state: S) => (state?: S, error?: unknown) => void {
  return () => (_state?: S, error?: unknown) => {
    if (!error) return;
    failed.add(name);
    console.error(
      `Hydration failed for "${name}". Writes to it are now blocked so the stored copy is not overwritten by default state.`,
      error
    );
    useSaveStatusStore.getState().markError();
    useSaveStatusStore.getState().markLocalSaveError(HYDRATION_FAILED_MESSAGE);
  };
}

export function writesBlocked(name: string): boolean {
  return failed.has(name);
}

// The banner for this condition must not be cleared by some OTHER store's
// successful write, which is what happens when a shared banner field is reset
// on every good local save.
export function anyWritesBlocked(): boolean {
  return failed.size > 0;
}

// Test-only reset; the real app never clears this without a reload.
export function resetHydrationGate(): void {
  failed.clear();
}
