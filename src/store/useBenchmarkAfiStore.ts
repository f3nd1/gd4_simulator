import { create } from "zustand";
import { persist } from "zustand/middleware";
import { workspaceStorage } from "./supabaseStorage";
import { BENCHMARK_AFIS } from "../data/benchmarkAFIs";
import type { BenchmarkAFI, BenchmarkSource } from "../data/benchmarkAFIs";

// The FULL, live benchmark ground-truth set the AI Calibration page's
// Benchmark tab measures against — every entry is editable/removable,
// including the 67 seeded findings from the two real SSG EduTrust
// assessment reports (BENCHMARK_AFIS), not just uploaded ones. A brand-new
// store starts seeded with a copy of BENCHMARK_AFIS (see the initial
// `entries` value below); anyone who already had upload-only entries from
// before this store existed gets the 67 merged in once via the version-1
// `migrate`, idempotently (never duplicates on a later reload). Persisted
// via workspaceStorage (Supabase-synced) since this is curated real audit
// content the user builds up over time, not scratch measurement state
// (unlike useCalibrationStore, which stays plain localStorage).
//
// Renamed from useCustomBenchmarkStore now that it holds everything, not
// just uploads — the persisted storage key is DELIBERATELY unchanged
// ("ucc-gd4-custom-benchmark:v1") so no existing user data is at risk.

export type BenchmarkAfiState = {
  entries: BenchmarkAFI[];
  // One call for a whole reviewed batch, not N separate calls.
  addEntries: (items: Omit<BenchmarkAFI, "id">[]) => void;
  updateEntry: (id: string, updates: Partial<Omit<BenchmarkAFI, "id">>) => void;
  removeEntry: (id: string) => void;
  removeEntriesBatch: (ids: string[]) => void;
  // Scoped reset: reinstates the 67 seeded ids (undoing edits, un-deleting
  // any removed ones) — every entry whose id is NOT one of the 67 (i.e.
  // every uploaded CUST-* finding) is left exactly as-is, never touched.
  // Deliberately NOT a full wipe: a button named "reset the original 67"
  // should never destroy audit reports the user uploaded themselves.
  resetToDefaults: () => void;
};

// Merges the static 67 into `existing` without duplicating ids already
// present. Used for both a brand-new store's initial state and the
// version-1 migration of anyone with pre-existing upload-only entries.
// Exported so tests can verify idempotency/merging directly, without
// simulating zustand's async hydration lifecycle.
export function seedStaticIntoEntries(existing: BenchmarkAFI[]): BenchmarkAFI[] {
  const existingIds = new Set(existing.map((e) => e.id));
  return [...BENCHMARK_AFIS.filter((a) => !existingIds.has(a.id)), ...existing];
}

function nextCustomId(source: BenchmarkSource, existing: BenchmarkAFI[]): string {
  const prefix = source === "Internal" ? "CUST-INT" : "CUST-EXT";
  // Seed the counter from same-source, PREVIOUSLY-UPLOADED entries only
  // (ids already starting with "CUST-") — `existing` now also contains the
  // 67 seeded findings (all source: "External"), which must never inflate
  // this count, or numbering would start at ~68 instead of 1. Independently
  // sequential per source (CUST-INT-1, CUST-INT-2, …) so a batch mixing
  // sources doesn't interleave/skip numbers.
  const sameSourceUploaded = existing.filter((e) => e.source === source && e.id.startsWith("CUST-"));
  let n = sameSourceUploaded.length + 1;
  let id = `${prefix}-${n}`;
  const used = new Set(existing.map((e) => e.id));
  while (used.has(id)) { n += 1; id = `${prefix}-${n}`; }
  return id;
}

export const useBenchmarkAfiStore = create<BenchmarkAfiState>()(
  persist(
    (set) => ({
      entries: seedStaticIntoEntries([]), // == a fresh copy of BENCHMARK_AFIS

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

      resetToDefaults: () =>
        set((s) => {
          const staticIds = new Set(BENCHMARK_AFIS.map((a) => a.id));
          const keepCustom = s.entries.filter((e) => !staticIds.has(e.id));
          return { entries: [...BENCHMARK_AFIS, ...keepCustom] };
        }),
    }),
    {
      name: "ucc-gd4-custom-benchmark:v1", // UNCHANGED persisted key
      storage: workspaceStorage,
      version: 1,
      migrate: (persisted, fromVersion) => {
        const s = (persisted ?? {}) as Partial<BenchmarkAfiState>;
        if (fromVersion >= 1) return s as BenchmarkAfiState;
        return { ...s, entries: seedStaticIntoEntries(s.entries ?? []) };
      },
    }
  )
);
