import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import type { WorksheetAsk } from "../lib/manualWorksheet";

// Cache for the Manual audit worksheet's AI conversion.
//
// Converting all 186 checks is ~10 AI calls and a real wait. Felix re-exports
// whenever he edits the Library, and an edit usually touches one check, so
// almost every export after the first is asking the model to redo work that
// has not changed. Entries are keyed by a hash of the EXACT source text plus
// the prompt version (worksheetCacheKey), so a check that changed misses and
// every untouched one hits.
//
// This holds derived wording only. It never feeds a prompt, a verdict or a
// score, and dropping it costs nothing but one slow export.

// Capped because this persists through workspaceStorage and syncs to Supabase.
// 186 checks is the live corpus; the headroom absorbs edits (each edit strands
// its predecessor's entry) without the blob growing without bound.
const MAX_ENTRIES = 500;

export type WorksheetCacheState = {
  entries: Record<string, WorksheetAsk[]>;
  putMany: (next: Record<string, WorksheetAsk[]>) => void;
  clear: () => void;
};

export const useWorksheetCacheStore = create<WorksheetCacheState>()(
  persist(
    (set) => ({
      entries: {},

      putMany: (next) =>
        set((s) => {
          const merged = { ...s.entries, ...next };
          const keys = Object.keys(merged);
          if (keys.length <= MAX_ENTRIES) return { entries: merged };
          // Oldest-inserted first: JS object key order preserves insertion for
          // string keys, and the freshly written keys were merged in last, so
          // trimming from the front drops the least recently written.
          const keep = keys.slice(keys.length - MAX_ENTRIES);
          const trimmed: Record<string, WorksheetAsk[]> = {};
          for (const k of keep) trimmed[k] = merged[k];
          return { entries: trimmed };
        }),

      clear: () => set({ entries: {} }),
    }),
    { name: "ucc-gd4-worksheet-cache:v1", storage: workspaceStorage }
  )
);

export function currentWorksheetCache(): Record<string, WorksheetAsk[]> {
  return useWorksheetCacheStore.getState().entries;
}
