// Pure, append-only helpers for the Change Log. Kept store-free so the
// dedupe / union / never-shrink guarantees are unit-testable in isolation.
//
// The Change Log is an append-only history of every push/pull the app has seen.
// It must only ever grow: no reset, restore, demo-load, or stale hydrate may
// drop entries. These helpers enforce that — every combine is a UNION, never a
// replace, and every entry is deduped by commit hash + action.

import type { ChangeLogEntry } from "../types";

// Identity of a change: one row per (commit, action). Re-deploying or reloading
// the same pushed build is the same event, so it must not stack duplicates.
export function changeLogKey(e: Pick<ChangeLogEntry, "commitHash" | "action">): string {
  return `${e.action}:${e.commitHash}`;
}

// Newest first, one row per commit+action. When the same key appears more than
// once (e.g. a legacy log recorded the same build many times), the entry with
// the most recent timestamp wins.
export function dedupeChangeLog(entries: ChangeLogEntry[]): ChangeLogEntry[] {
  const byKey = new Map<string, ChangeLogEntry>();
  for (const e of entries) {
    const k = changeLogKey(e);
    const existing = byKey.get(k);
    if (!existing || e.timestamp > existing.timestamp) byKey.set(k, e);
  }
  return [...byKey.values()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
}

// Union of two logs — the core "never shrink" operation. Used both on hydrate
// (persisted ∪ in-memory) and on write (existing-remote ∪ outgoing) so a slow
// or empty load can never overwrite a fuller history with a thinner one.
export function mergeChangeLogs(a: ChangeLogEntry[], b: ChangeLogEntry[]): ChangeLogEntry[] {
  return dedupeChangeLog([...a, ...b]);
}

// Append one freshly-observed entry. Returns the SAME array reference when the
// entry is a duplicate, so callers can skip a no-op persist.
export function appendChangeLogEntry(list: ChangeLogEntry[], entry: ChangeLogEntry): ChangeLogEntry[] {
  const k = changeLogKey(entry);
  if (list.some((e) => changeLogKey(e) === k)) return list;
  return [entry, ...list];
}
