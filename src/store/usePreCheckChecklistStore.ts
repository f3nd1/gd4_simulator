import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import { DEFAULT_CHECKLISTS, type ChecklistData, type ChecklistItemDef } from "../lib/preAnalysisChecklist";

// The live, editable copy of the pre-analysis checklist — seeded from
// DEFAULT_CHECKLISTS. This is the ONE source of truth: both the Setup page's
// CRUD and the run-flow's Pre-check step read `checklists` from here. New
// items added via the Setup page always start `verified: false` — only the
// original 4.2.2/6.2.1 seed items may ever carry `verified: true`, and that
// happens in preAnalysisChecklist.ts, not through this store.

export type PreCheckChecklistState = {
  checklists: ChecklistData;
  addItem: (itemId: string, item: Omit<ChecklistItemDef, "id" | "verified">) => void;
  updateItem: (itemId: string, defId: string, updates: Partial<Omit<ChecklistItemDef, "id" | "verified">>) => void;
  removeItem: (itemId: string, defId: string) => void;
  reorderItem: (itemId: string, defId: string, direction: "up" | "down") => void;
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

      resetToDefaults: () => set({ checklists: DEFAULT_CHECKLISTS }),
    }),
    { name: "ucc-gd4-precheck-checklist:v1", storage: workspaceStorage }
  )
);
