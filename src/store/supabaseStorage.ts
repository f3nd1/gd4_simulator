import { createJSONStorage } from "zustand/middleware";
import { wellFormedJsonText } from "../lib/text/wellFormed";
import type { StateStorage } from "zustand/middleware";
import { getSupabaseClient } from "../lib/supabaseClient";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSaveStatusStore } from "../store/useSaveStatusStore";
import { writeLocal, removeLocal, safeLocalStorage } from "./safeLocalStorage";
import { writesBlocked } from "./hydrationGate";

// Single shared row per persisted store key — mirrors the one-blob shape the
// localStorage version already used, so no store/action code has to change.
const TABLE = "workspace_state";

// Per-key debounce. (Previously a single shared timer meant a save to one
// store — e.g. the checklist — could cancel another store's pending save —
// e.g. the workspace — within the 600ms window, silently dropping it.)
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingValues = new Map<string, string>();
// Per-key in-flight upload, held as the PROMISE rather than just the key.
// It used to be a Set, so an overlapping flush had nothing to join: flushKey()
// returned immediately and flushPendingSaves() therefore resolved while an
// upload was still on the wire. Five callers in useWorkspaceStore await it as
// a durability barrier after a completed audit, so that mattered.
const inFlight = new Map<string, Promise<void>>();

// Marks a key whose newest value has NOT reached Supabase. Written to
// localStorage so it survives a reload, and read by getItem() to stop a stale
// remote row overwriting a newer local cache — see the note there.
const unsyncedKey = (name: string) => `${name}::unsynced`;
// Mirrored in memory because the marker is written to localStorage, and the
// case it protects against — a failed save — is most likely exactly when
// localStorage is full and cannot accept the marker either. Without the mirror
// the guard disabled itself in the one situation it exists for. The memory copy
// covers this tab; the localStorage copy still covers a reload.
const unsyncedInMemory = new Set<string>();
function markUnsynced(name: string) {
  unsyncedInMemory.add(name);
  try { localStorage.setItem(unsyncedKey(name), new Date().toISOString()); } catch { /* quota — the in-memory mirror still holds it */ }
}
function clearUnsynced(name: string) {
  unsyncedInMemory.delete(name);
  try { localStorage.removeItem(unsyncedKey(name)); } catch { /* ignore */ }
}
function isUnsynced(name: string): boolean {
  if (unsyncedInMemory.has(name)) return true;
  try { return localStorage.getItem(unsyncedKey(name)) !== null; } catch { return false; }
}

// Bounded retry for a key whose upload failed, so a transient outage recovers
// on its own instead of waiting for the user's next edit. Capped: a persistent
// failure must not hot-loop, and the queued value plus the unsynced marker
// already protect the data until then.
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryCounts = new Map<string, number>();
const MAX_RETRIES = 3;
function scheduleRetry(name: string) {
  if (retryTimers.has(name)) return;
  const attempt = retryCounts.get(name) ?? 0;
  if (attempt >= MAX_RETRIES) return;
  retryCounts.set(name, attempt + 1);
  retryTimers.set(name, setTimeout(() => {
    retryTimers.delete(name);
    void flushKey(name);
  }, 2000 * 2 ** attempt));
}

// The characters PostgreSQL rejects in json/text columns. The rule set now
// lives in lib/text/wellFormed.ts, shared with the guard on outbound AI
// requests: the same lone surrogates break both, and this file's own version
// was missing the lone-ESCAPE case (it removed pairs of escapes and raw
// surrogates, so a single \ud83d went through untouched).
const sanitiseForPostgres = wellFormedJsonText;

// Uploads the newest queued value for one key, draining any value that lands
// while the upload is in flight.
//
// The previous version deleted the pending value BEFORE the upsert and never
// put it back, so any error, throw, or a Supabase client that had become
// unavailable discarded the write permanently. Combined with the read path
// preferring the remote row, one failed save turned into lost work on every
// device. The value now survives a failure and is retried.
async function drainKey(name: string): Promise<void> {
  while (pendingValues.has(name)) {
    const value = pendingValues.get(name)!;
    const supabase = getSupabaseClient();
    // No client right now: keep the value queued rather than dropping it.
    if (!supabase) { markUnsynced(name); return; }
    // NEVER publish while signed out. A store that hydrated from the local
    // cache (or from nothing) and then saves would be writing its defaults
    // over the real row, which is the shape of both workspace losses this
    // repo has already had. Queued, not dropped: it uploads once a session
    // exists.
    if (!(await sessionSettled(supabase))) { markUnsynced(name); scheduleRetry(name); return; }

    let ok = false;
    try {
      const sanitised = sanitiseForPostgres(value);
      const { error } = await supabase.from(TABLE).upsert({ id: name, data: JSON.parse(sanitised), updated_at: new Date().toISOString() });
      if (error) {
        console.error("Supabase save failed:", error.message);
        useSaveStatusStore.getState().markError();
      } else {
        ok = true;
      }
    } catch (err) {
      // Includes a JSON.parse failure on the sanitised blob, which used to
      // discard the value the same way a network error did.
      console.error("Supabase save failed:", err instanceof Error ? err.message : String(err));
      useSaveStatusStore.getState().markError();
    }

    if (!ok) {
      markUnsynced(name);
      scheduleRetry(name);
      return;
    }

    // Drop only the value actually uploaded. A newer one that arrived
    // mid-flight stays queued and the loop picks it up on the next pass,
    // which is what lets an awaiting caller wait for the whole chain.
    if (pendingValues.get(name) === value) pendingValues.delete(name);
    clearUnsynced(name);
    retryCounts.delete(name);
    if (pendingValues.size === 0 && inFlight.size === 1) {
      useSaveStatusStore.getState().markSaved();
    }
  }
}

function flushKey(name: string): Promise<void> {
  const running = inFlight.get(name);
  // Join the existing upload instead of returning early. Its loop will also
  // carry any newer value, so awaiting this is a real barrier.
  if (running) return running;
  const run = drainKey(name).finally(() => { inFlight.delete(name); });
  inFlight.set(name, run);
  return run;
}

// Best-effort flush of all pending saves — wired to `beforeunload` so closing
// the tab inside the debounce window still pushes the last edit to Supabase.
export async function flushPendingSaves(): Promise<void> {
  for (const t of saveTimers.values()) clearTimeout(t);
  saveTimers.clear();
  for (const t of retryTimers.values()) clearTimeout(t);
  retryTimers.clear();
  // Include keys that are mid-upload. They have no entry in pendingValues, so
  // iterating that map alone resolved while they were still running.
  const keys = new Set([...pendingValues.keys(), ...inFlight.keys()]);
  await Promise.all([...keys].map(flushKey));
}

// Keys whose blob is deliberately NOT mirrored into localStorage.
//
// The checklist-verdict sweep is the one store that can fill a browser's 5 MB
// origin quota on its own: a full workspace sweep is 754 entries, and its caps
// allow a 2000-character rationale plus a 1000-character quote each. Lowering
// those caps was the obvious fix and the wrong one - they were raised precisely
// because clipped rationales were unreadable, and the text is recoverable
// nowhere else (the checklist pass writes no AI Run Log entry).
//
// So the blob keeps every character and simply stops being written twice. It is
// display-only, always re-derivable by re-running the audit, and it syncs, so
// the local mirror bought very little and cost the most. Only skipped while
// Supabase is actually available - without it, localStorage is the only
// persistence there is and the trade would be data loss.
const NO_LOCAL_MIRROR = new Set(["ucc-gd4-checklist-verdicts:v1", "ucc-gd4-file-text-cache:v1"]);


// ── ORDERING: the session BEFORE the stored state ──────────────────────────
//
// Every persisted store hydrates when its module is imported, which is long
// before React renders and therefore before the sign-in gate exists. On the
// load that FOLLOWS a Google redirect the session arrives in the URL fragment
// and Supabase establishes it asynchronously, so those reads used to go out
// with no session at all.
//
// That was harmless while the table answered anyone. It is not harmless now
// that the row-level policy requires a signed-in United Ceres account: the
// read comes back EMPTY rather than failing, every store falls back to its
// defaults, and zustand never hydrates a second time. Measured on the built
// bundle at the real subpath: 16 reads on the redirect load, NONE of them
// carrying a session, and three stores then saved their defaults back,
// including ucc-gd4-workspace:v3 with an empty cycle.
//
// getSession() awaits the client's own initialisation (GoTrueClient.js:2362),
// and that initialisation is what consumes the URL fragment. So awaiting it
// is exactly "wait until we know who this is", whether the answer turns out
// to be a user or nobody. It is not a second copy of anything and it stores
// nothing new.
async function sessionSettled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  } catch {
    // Auth unreachable: treat it as "nobody", which makes the read fall back
    // to the local cache rather than hang.
    return false;
  }
}

// localStorage is always written as an offline cache and as the fallback
// when Supabase isn't configured or a request fails, so the app keeps
// working exactly as before if the database is unreachable.
const dbStorage: StateStorage = {
  getItem: async (name) => {
    const supabase = getSupabaseClient();
    if (!supabase) return localStorage.getItem(name);
    // Wait for the session before asking the database, so a read never goes
    // out anonymously and come back empty. Signed out, the local cache is the
    // honest answer: the gate is about to ask for a sign-in anyway.
    if (!(await sessionSettled(supabase))) return localStorage.getItem(name);
    // An unreachable host can take many seconds to actually reject (proxy/tunnel
    // timeouts), during which the UI would otherwise sit on blank default state.
    // Race against the local cache's load time so a slow/dead network never
    // delays first paint of the user's own already-known-good data.
    const TIMEOUT_MS = 2500;
    let timer!: ReturnType<typeof setTimeout>;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([
        supabase.from(TABLE).select("data").eq("id", name).maybeSingle(),
        timeout,
      ]);
      clearTimeout(timer);
      if (result === "timeout") {
        console.error("Supabase load timed out, using local cache");
        return localStorage.getItem(name);
      }
      const { data, error } = result;
      if (error) {
        console.error("Supabase load failed, using local cache:", error.message);
        return localStorage.getItem(name);
      }
      if (data) {
        const remote = JSON.stringify(data.data);
        // This device has a value that never reached Supabase, so the remote
        // row is OLDER than the local cache. Serving remote here (and, worse,
        // writing it over the cache below) is what turned a single failed
        // save into permanently lost work: the newer local copy was destroyed
        // on the next reload. Keep local, and leave the queued value to retry.
        const local = localStorage.getItem(name);
        if (local !== null && isUnsynced(name)) {
          console.warn(`Using the local copy of "${name}": a newer change has not reached Supabase yet.`);
          return local;
        }
        // Keep the offline cache current with what was just served from
        // Supabase — otherwise a later offline reload silently regresses to
        // whatever this device last wrote.
        if (!NO_LOCAL_MIRROR.has(name)) {
          try { localStorage.setItem(name, remote); } catch { /* quota — cache stays stale */ }
        }
        return remote;
      }
      return localStorage.getItem(name);
    } catch (err) {
      clearTimeout(timer);
      // A network-level failure (e.g. unreachable host) rejects the request
      // promise itself rather than resolving with `{error}`, so it must be
      // caught separately from the `error` branch above to still fall back
      // to the local cache instead of silently losing the request entirely.
      console.error("Supabase load failed, using local cache:", err instanceof Error ? err.message : String(err));
      return localStorage.getItem(name);
    }
  },

  setItem: (name, value) => {
    // A store that failed to hydrate holds its DEFAULT state, and zustand keeps
    // letting it write. Publishing that over the real row is exactly how the
    // workspace was lost twice. See hydrationGate.ts.
    if (writesBlocked(name)) return Promise.resolve();
    // A QuotaExceededError here used to propagate out of zustand's persist and
    // silently kill ALL persistence. Local save is best-effort: warn and show
    // a banner, but never throw — Supabase (below) and in-memory state still
    // carry the work.
    const supabase = getSupabaseClient();
    if (!supabase || !NO_LOCAL_MIRROR.has(name)) writeLocal(name, value);
    if (!supabase) return Promise.resolve();
    pendingValues.set(name, value);
    useSaveStatusStore.getState().markSaving();
    const existing = saveTimers.get(name);
    if (existing) clearTimeout(existing);
    return new Promise<void>((resolve) => {
      saveTimers.set(
        name,
        setTimeout(async () => {
          saveTimers.delete(name);
          await flushKey(name);
          resolve();
        }, 600)
      );
    });
  },

  removeItem: async (name) => {
    removeLocal(name);
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      await supabase.from(TABLE).delete().eq("id", name);
    } catch (err) {
      console.error("Supabase delete failed:", err instanceof Error ? err.message : String(err));
    }
  },
};

export { safeLocalStorage };

export const workspaceStorage = createJSONStorage(() => dbStorage);
