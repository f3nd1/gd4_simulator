// Which configuration rows the database refuses a normal user's write on,
// read and changed from the People screen.
//
// This is the one place in the app where a screen control IS the control.
// Toggling here inserts or deletes a row in public.locked_stores, and the
// workspace_state policies consult that table on every write via
// public.is_admin_only_row() (supabase/07-locks-live-in-a-table.sql). The
// database refuses the write, not this file, and it refuses a request made
// with curl just the same.
//
// Failure-tolerant in the honest direction: when the lock list cannot be
// read, the screen says it does not know rather than claiming "locked". A
// green badge that is a guess is worse than no badge.
import type { SupabaseClient } from "@supabase/supabase-js";
import { NEVER_LOCKABLE } from "./pageAccess";

export type LockState = { keys: Set<string> } | { error: string };

export async function listLocks(supabase: SupabaseClient): Promise<LockState> {
  try {
    const { data, error } = await supabase.from("locked_stores").select("store_key");
    if (error) {
      if (error.code === "42P01" || /schema cache/i.test(error.message)) {
        return { error: "Editable locks are not set up on this database yet. Run supabase/07-locks-live-in-a-table.sql in the Supabase SQL Editor." };
      }
      return { error: error.message };
    }
    return { keys: new Set((data ?? []).map((r) => String(r.store_key))) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// Refused by a CHECK constraint on the table, not by a policy, so it binds
// everybody including the admin and the Supabase dashboard. Checked here too
// only so the screen can explain rather than relay error 23514.
export function neverLockableReason(storeKey: string): string | null {
  return NEVER_LOCKABLE[storeKey] ?? null;
}

// Unlocking widens who may change something; locking narrows it. The
// dangerous direction gets the friction, the safe one does not. The page's
// own name is the phrase, so the confirmation cannot be muscle-memory.
export function unlockConfirmationPhrase(pageLabel: string): string {
  return pageLabel.trim();
}

export function unlockPhraseMatches(typed: string, pageLabel: string): boolean {
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
  return norm(typed) !== "" && norm(typed) === norm(unlockConfirmationPhrase(pageLabel));
}

export function unlockWarning(pageLabel: string, what: string): string {
  return `Unlocking means everyone who can sign in, not only admins, will be able to change ${what.toLowerCase()} on ${pageLabel}. `
    + `They will still not see the page in their sidebar, but the database will no longer refuse the change.`;
}

export async function lockStore(supabase: SupabaseClient, storeKey: string, by: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const never = neverLockableReason(storeKey);
  if (never) return { ok: false, reason: never };
  const { error } = await supabase.from("locked_stores").insert({ store_key: storeKey, locked_by: by });
  if (!error) return { ok: true };
  if (error.code === "23514") return { ok: false, reason: neverLockableReason(storeKey) ?? "The database refuses to lock this one: the app writes it for everyone." };
  if (error.code === "23505") return { ok: false, reason: "That one is already locked." };
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return { ok: false, reason: "The database refused that. Only an admin can change the locks." };
  }
  return { ok: false, reason: error.message };
}

// A refused DELETE returns zero rows and NO error, the same trap as removing
// somebody from the sign-in list. Reporting it as success would tell an admin
// a page was unlocked when it was not.
export async function unlockStore(supabase: SupabaseClient, storeKey: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await supabase.from("locked_stores").delete().eq("store_key", storeKey).select("store_key");
  if (error) return { ok: false, reason: error.message };
  if (!data || data.length === 0) {
    return { ok: false, reason: "The database refused that. Only an admin can change the locks." };
  }
  return { ok: true };
}
