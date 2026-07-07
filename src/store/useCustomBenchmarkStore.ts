import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import type { BenchmarkAFI, BenchmarkSource } from "../data/benchmarkAFIs";

// User-added benchmark ground truth, layered on top of the static
// BENCHMARK_AFIS in benchmarkAFIs.ts (see combineBenchmarkAfis there) — the
// same "static defaults + user additions" shape as usePreCheckChecklistStore.
// Entries here come from the Benchmark tab's upload panel: an uploaded audit
// report (internal or external) gets AI-extracted into draft findings, a
// human reviews/edits them, and only the confirmed batch lands here via
// addEntries. Persisted via workspaceStorage (Supabase-synced) since this is
// curated real audit content the user builds up over time, not scratch
// measurement state (unlike useCalibrationStore, which stays plain
// localStorage).

export type CustomBenchmarkState = {
  entries: BenchmarkAFI[];
  // One call for a whole reviewed batch, not N separate calls.
  addEntries: (items: Omit<BenchmarkAFI, "id">[]) => void;
  updateEntry: (id: string, updates: Partial<Omit<BenchmarkAFI, "id">>) => void;
  removeEntry: (id: string) => void;
  removeEntriesBatch: (ids: string[]) => void;
};

function nextCustomId(source: BenchmarkSource, existing: BenchmarkAFI[]): string {
  const prefix = source === "Internal" ? "CUST-INT" : "CUST-EXT";
  // Seed the counter from same-source entries only, so Internal/External
  // numbering stays independently sequential (CUST-INT-1, CUST-INT-2, …)
  // instead of interleaving/skipping numbers when a batch mixes sources.
  const sameSource = existing.filter((e) => e.source === source);
  let n = sameSource.length + 1;
  let id = `${prefix}-${n}`;
  const used = new Set(existing.map((e) => e.id));
  while (used.has(id)) { n += 1; id = `${prefix}-${n}`; }
  return id;
}

export const useCustomBenchmarkStore = create<CustomBenchmarkState>()(
  persist(
    (set) => ({
      entries: [],

      addEntries: (items) =>
        set((s) => {
          const created: BenchmarkAFI[] = [];
          for (const item of items) {
            const id = nextCustomId(item.source, [...s.entries, ...created]);
            created.push({ ...item, id });
          }
          return { entries: [...s.entries, ...created] };
        }),

      updateEntry: (id, updates) =>
        set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...updates } : e)) })),

      removeEntry: (id) =>
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

      removeEntriesBatch: (ids) =>
        set((s) => {
          const drop = new Set(ids);
          return { entries: s.entries.filter((e) => !drop.has(e.id)) };
        }),
    }),
    { name: "ucc-gd4-custom-benchmark:v1", storage: workspaceStorage }
  )
);
