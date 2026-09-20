// What signing out does and does not remove from THIS computer.
//
// Supabase's signOut() removes exactly three localStorage keys, all prefixed
// with its own storage key (auth-js GoTrueClient._removeSession: the token,
// the code verifier and the cached user). Every one of this app's own keys
// survives it — the whole workspace, the findings, the OpenAI key. On a
// personal machine that is the point; on a shared one it is the difference
// between safe and not, which is why the sign-out panel says so and offers
// this.
//
// Pure functions so the rules are testable: importing a store here would pull
// in driveClient's pdfjs Worker (CLAUDE.md, Tests).

// The one key that must survive a wipe: it holds the database address and
// publishable key this app needs to reach Supabase at all. Clear it and the
// next person meets "Not connected yet" and cannot even sign in.
export const KEEP_ON_WIPE = "ucc-gd4-supabase-settings:v1";

const isOurs = (k: string) => k.startsWith("ucc-gd4-") || k.startsWith("profile-of-pei");

// Keys whose local copy is NEWER than Supabase's, written by supabaseStorage
// when an upload failed. Wiping one of these destroys work that exists
// nowhere else, so a wipe refuses while any is present rather than asking the
// user to weigh it.
export function unsyncedStoreKeys(allKeys: string[]): string[] {
  return allKeys.filter((k) => k.endsWith("::unsynced")).map((k) => k.slice(0, -"::unsynced".length));
}

export function keysToWipe(allKeys: string[]): string[] {
  return allKeys.filter((k) => isOurs(k) && k !== KEEP_ON_WIPE);
}

export type WipePlan =
  | { ok: true; keys: string[] }
  | { ok: false; reason: string };

export function planWipe(allKeys: string[]): WipePlan {
  const unsynced = unsyncedStoreKeys(allKeys);
  if (unsynced.length) {
    return {
      ok: false,
      reason: `Some of your work has not reached the database yet (${unsynced.length} item${unsynced.length === 1 ? "" : "s"}), so removing it from this computer would lose it. Stay signed in until the top of the screen says Saved, then try again.`,
    };
  }
  return { ok: true, keys: keysToWipe(allKeys) };
}

// Reads localStorage, so it is separate from the rules above.
export function wipeThisDevice(): WipePlan {
  let all: string[] = [];
  try { all = Object.keys(localStorage); } catch { return { ok: false, reason: "This browser is not letting the app read its own storage, so nothing could be removed." }; }
  const plan = planWipe(all);
  if (!plan.ok) return plan;
  for (const k of plan.keys) { try { localStorage.removeItem(k); } catch { /* best effort — the reload below is what matters */ } }
  return plan;
}
