import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import { DEFAULT_CHECKLISTS, type ChecklistData, type ChecklistItemDef } from "../lib/preAnalysisChecklist";

// The live, editable copy of the pre-analysis checklist — seeded from
// DEFAULT_CHECKLISTS. This is the ONE source of truth: both the Setup page's
// CRUD and the run-flow's Pre-check step read `checklists` from here. New
// items added via the Setup page always start `verified: false`. The only
// way `verified` changes after that is the Setup page's explicit "Approve" /
// "Revert to draft" action (setVerified below) — never as a side effect of
// an unrelated field edit via updateItem, whose type deliberately omits
// `verified` for exactly that reason.

export type PreCheckChecklistState = {
  checklists: ChecklistData;
  addItem: (itemId: string, item: Omit<ChecklistItemDef, "id" | "verified">) => void;
  updateItem: (itemId: string, defId: string, updates: Partial<Omit<ChecklistItemDef, "id" | "verified">>) => void;
  removeItem: (itemId: string, defId: string) => void;
  reorderItem: (itemId: string, defId: string, direction: "up" | "down") => void;
  // Approve a draft item (false → true) or revert an approved one back to
  // draft (true → false) — a deliberately separate, one-click action so
  // flipping `verified` is always intentional and visible, editable at any
  // time in either direction.
  setVerified: (itemId: string, defId: string, verified: boolean) => void;
  // Bulk variants for the Setup page's "All items" view, where a filtered
  // selection can span many different GD4 items at once. Each is a single
  // atomic update rather than N separate set() calls.
  removeItemsBatch: (pairs: { itemId: string; defId: string }[]) => void;
  setVerifiedBatch: (pairs: { itemId: string; defId: string }[], verified: boolean) => void;
  resetToDefaults: () => void;
};

function nextDraftId(itemId: string, existing: ChecklistItemDef[]): string {
  let n = existing.length + 1;
  let id = `${itemId}-custom-${n}`;
  const used = new Set(existing.map((e) => e.id));
  while (used.has(id)) { n += 1; id = `${itemId}-custom-${n}`; }
  return id;
}

export const usePreCheckChecklistStore = create<PreCheckChecklistState>()(
  persist(
    (set) => ({
      checklists: DEFAULT_CHECKLISTS,

      addItem: (itemId, item) =>
        set((s) => {
          const existing = s.checklists[itemId] ?? [];
          const created: ChecklistItemDef = { ...item, id: nextDraftId(itemId, existing), verified: false };
          return { checklists: { ...s.checklists, [itemId]: [...existing, created] } };
        }),

      updateItem: (itemId, defId, updates) =>
        set((s) => {
          const existing = s.checklists[itemId] ?? [];
          return {
            checklists: {
              ...s.checklists,
              [itemId]: existing.map((d) => (d.id === defId ? { ...d, ...updates } : d)),
            },
          };
        }),

      removeItem: (itemId, defId) =>
        set((s) => ({
          checklists: { ...s.checklists, [itemId]: (s.checklists[itemId] ?? []).filter((d) => d.id !== defId) },
        })),

      reorderItem: (itemId, defId, direction) =>
        set((s) => {
          const existing = [...(s.checklists[itemId] ?? [])];
          const idx = existing.findIndex((d) => d.id === defId);
          const swapWith = direction === "up" ? idx - 1 : idx + 1;
          if (idx < 0 || swapWith < 0 || swapWith >= existing.length) return s;
          [existing[idx], existing[swapWith]] = [existing[swapWith], existing[idx]];
          return { checklists: { ...s.checklists, [itemId]: existing } };
        }),

      setVerified: (itemId, defId, verified) =>
        set((s) => {
          const existing = s.checklists[itemId] ?? [];
          return {
            checklists: {
              ...s.checklists,
              [itemId]: existing.map((d) => (d.id === defId ? { ...d, verified } : d)),
            },
          };
        }),

      removeItemsBatch: (pairs) =>
        set((s) => {
          const byItem = new Map<string, Set<string>>();
          for (const { itemId, defId } of pairs) {
            if (!byItem.has(itemId)) byItem.set(itemId, new Set());
            byItem.get(itemId)!.add(defId);
          }
          const checklists = { ...s.checklists };
          for (const [itemId, defIds] of byItem) {
            checklists[itemId] = (checklists[itemId] ?? []).filter((d) => !defIds.has(d.id));
          }
          return { checklists };
        }),

      setVerifiedBatch: (pairs, verified) =>
        set((s) => {
          const byItem = new Map<string, Set<string>>();
          for (const { itemId, defId } of pairs) {
            if (!byItem.has(itemId)) byItem.set(itemId, new Set());
            byItem.get(itemId)!.add(defId);
          }
          const checklists = { ...s.checklists };
          for (const [itemId, defIds] of byItem) {
            checklists[itemId] = (checklists[itemId] ?? []).map((d) => (defIds.has(d.id) ? { ...d, verified } : d));
          }
          return { checklists };
        }),

      resetToDefaults: () => set({ checklists: DEFAULT_CHECKLISTS }),
    }),
    { name: "ucc-gd4-precheck-checklist:v1", storage: workspaceStorage }
  )
);
