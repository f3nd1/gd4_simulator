import { create } from "zustand";

// In-memory only (never persisted): tracks whether the Supabase sync is
// in-flight so the Header can show "Saving… / Saved". localStorage is always
// written synchronously, so this reflects the remote sync, not local safety.
export type SaveStatus = "idle" | "saving" | "saved" | "error";

export const useSaveStatusStore = create<{
  status: SaveStatus;
  // Set when writing the local cache itself failed (e.g. QuotaExceededError).
  // Shown as a persistent non-blocking banner — unlike `status`, which only
  // reflects the remote sync.
  localSaveError: string | null;
  markSaving: () => void;
  markSaved: () => void;
  markError: () => void;
  markLocalSaveError: (message: string) => void;
  clearLocalSaveError: () => void;
}>((set) => ({
  status: "idle",
  localSaveError: null,
  markSaving: () => set({ status: "saving" }),
  markSaved: () => set({ status: "saved" }),
  markError: () => set({ status: "error" }),
  markLocalSaveError: (message) => set({ localSaveError: message }),
  clearLocalSaveError: () => set({ localSaveError: null }),
}));
