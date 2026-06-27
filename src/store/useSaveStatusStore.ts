import { create } from "zustand";

// In-memory only (never persisted): tracks whether the Supabase sync is
// in-flight so the Header can show "Saving… / Saved". localStorage is always
// written synchronously, so this reflects the remote sync, not local safety.
export type SaveStatus = "idle" | "saving" | "saved" | "error";

export const useSaveStatusStore = create<{
  status: SaveStatus;
  lastSavedAt: number | null;
  markSaving: () => void;
  markSaved: () => void;
  markError: () => void;
}>((set) => ({
  status: "idle",
  lastSavedAt: null,
  markSaving: () => set({ status: "saving" }),
  markSaved: () => set({ status: "saved", lastSavedAt: Date.now() }),
  markError: () => set({ status: "error" }),
}));
