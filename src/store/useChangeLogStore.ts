import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { getSupabaseClient } from "../lib/supabaseClient";
import { summariseCommitMessage } from "../lib/changeLogSummary";
import { appendChangeLogEntry, mergeChangeLogs } from "../lib/changeLogMerge";
import type { ChangeLogEntry } from "../types";

// ── Why a DEDICATED store (separate Supabase row) ────────────────────────────
// The Change Log is an append-only history of every push/pull the app has seen.
// It previously lived inside the single monolithic workspace blob, where two
// things could wipe it: (1) any load that hydrated from empty/stale state and
// then saved overwrote the whole row, dropping the accumulated history; and
// (2) version snapshots never captured it, so it wasn't recoverable. Neither
// createNewCycle nor restoreVersion listed it, so it "survived" resets only by
// omission — one bad hydrate-then-save still lost everything.
//
// Isolating it in its own key removes it from every workspace reset/restore/
// demo path, and the append-only storage below makes a stale write unable to
// shrink the remote row. It only ever grows.

const STORAGE_KEY = "ucc-gd4-changelog:v1";
const TABLE = "workspace_state";

// Append-only storage: on WRITE, union the outgoing log with whatever is
// already in Supabase before upserting, so a browser that loaded a stale/empty
// log can never overwrite a fuller remote history with a thinner one. Reads
// prefer Supabase, falling back to localStorage (offline / no DB configured).
const appendOnlyStorage: StateStorage = {
  getItem: async (name) => {
    const supabase = getSupabaseClient();
    if (!supabase) return localStorage.getItem(name);
    const TIMEOUT_MS = 2500;
    let timer!: ReturnType<typeof setTimeout>;
    const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), TIMEOUT_MS); });
    try {
      const result = await Promise.race([
        supabase.from(TABLE).select("data").eq("id", name).maybeSingle(),
        timeout,
      ]);
      clearTimeout(timer);
      if (result === "timeout") return localStorage.getItem(name);
      const { data, error } = result;
      if (error) return localStorage.getItem(name);
      return data ? JSON.stringify(data.data) : localStorage.getItem(name);
    } catch {
      clearTimeout(timer);
      return localStorage.getItem(name);
    }
  },

  setItem: async (name, value) => {
    // Parse the outgoing snapshot's changeLog.
    let outgoing: ChangeLogEntry[] = [];
    try { outgoing = (JSON.parse(value)?.state?.changeLog ?? []) as ChangeLogEntry[]; } catch { /* keep [] */ }

    const supabase = getSupabaseClient();
    if (!supabase) {
      try { localStorage.setItem(name, value); } catch { /* quota — in-memory only */ }
      return;
    }
    try {
      // Read-modify-write UNION: never let this write shrink the remote log.
      const { data } = await supabase.from(TABLE).select("data").eq("id", name).maybeSingle();
      const remote = (data?.data?.state?.changeLog ?? []) as ChangeLogEntry[];
      const merged = mergeChangeLogs(remote, outgoing);
      const payload = { state: { changeLog: merged }, version: 1 };
      const serialised = JSON.stringify(payload);
      try { localStorage.setItem(name, serialised); } catch { /* quota — in-memory only */ }
      await supabase.from(TABLE).upsert({ id: name, data: payload, updated_at: new Date().toISOString() });
    } catch {
      try { localStorage.setItem(name, value); } catch { /* ignore */ }
    }
  },

  removeItem: async (name) => {
    // Deliberately a no-op on the remote: the append-only history is never
    // cleared, even if persist middleware asks. Only the local cache is dropped.
    localStorage.removeItem(name);
  },
};

let counter = 0;
// Suppresses an exact double-fire within ONE page load (React's double-invoked
// mount effect). Resets on reload — a real re-deploy of a NEW commit still logs.
let lastKeyThisLoad = "";

type NewEntry = Omit<ChangeLogEntry, "id" | "summary"> & { summary?: string };

type ChangeLogStoreState = {
  changeLog: ChangeLogEntry[];
  recordChangeLogEntry: (entry: NewEntry) => void;
  // Merge externally-sourced entries (e.g. the legacy workspace-store log) in,
  // append-only. Idempotent — safe to call on every load.
  importEntries: (entries: ChangeLogEntry[]) => void;
};

export const useChangeLogStore = create<ChangeLogStoreState>()(
  persist(
    (set, get) => ({
      changeLog: [],

      recordChangeLogEntry: (entry) => {
        if (!entry.commitHash || entry.commitHash === "unknown") return;
        const loadKey = `${entry.action}:${entry.commitHash}:${entry.timestamp}`;
        if (loadKey === lastKeyThisLoad) return;
        lastKeyThisLoad = loadKey;
        const full: ChangeLogEntry = {
          ...entry,
          id: `CL-${entry.commitHash}-${entry.action}-${Date.now().toString(36)}-${++counter}`,
          summary: entry.summary?.trim() || summariseCommitMessage(entry.commitMessage),
        };
        const next = appendChangeLogEntry(get().changeLog, full);
        if (next !== get().changeLog) set({ changeLog: next }); // skip no-op writes
      },

      importEntries: (entries) => {
        if (!entries.length) return;
        const merged = mergeChangeLogs(get().changeLog, entries);
        if (merged.length !== get().changeLog.length) set({ changeLog: merged });
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => appendOnlyStorage),
      // UNION on hydrate: a slow/empty remote load can never shrink an already
      // populated in-memory log. Persisted ∪ current, deduped, newest first.
      merge: (persisted, current) => {
        const p = (persisted as Partial<ChangeLogStoreState> | undefined)?.changeLog ?? [];
        return { ...current, changeLog: mergeChangeLogs(p, current.changeLog) };
      },
    }
  )
);
