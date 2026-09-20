// Is this signed-in person one of the named people?
//
// The domain rule in domain.ts is no longer enough on its own: students and
// other staff also hold @unitedceres.edu.sg addresses. The list of named
// people lives in ONE place, the public.allowed_users table (see
// supabase/03-restrict-to-named-people.sql), read here by the app and — from
// the same table — by the drive-oauth Edge Function. An allow-list written
// into this file would be a third copy of a security rule, plus a rebuild and
// a redeploy every time somebody joins.
//
// Like every check in the browser, this one is COSMETIC: it decides what to
// render. The row-level policies are what actually refuse the data, and they
// apply to a request made with curl and the publishable key, which this
// cannot see at all.
import type { SupabaseClient } from "@supabase/supabase-js";

export type AllowCheck =
  | { allowed: true }
  | { allowed: false }
  // The question could not be asked — offline, or the database refused for
  // some reason other than "no such person". Deliberately NOT folded into
  // `allowed: false`: telling somebody they are not permitted because their
  // wifi dropped is both wrong and alarming.
  | { allowed: "unknown"; reason: string };

// Zero rows means not on the list: the read policy lets a signed-in person
// see their own row and nothing else, so "no row" is the answer, not an
// error. An actual error means the question never got answered.
export async function checkAllowList(supabase: SupabaseClient, email: string): Promise<AllowCheck> {
  try {
    const { data, error } = await supabase
      .from("allowed_users")
      .select("email")
      .eq("email_lc", email.trim().toLowerCase())
      .maybeSingle();
    if (error) return { allowed: "unknown", reason: error.message };
    return { allowed: !!data };
  } catch (e) {
    return { allowed: "unknown", reason: e instanceof Error ? e.message : String(e) };
  }
}

// What a refused person reads. Names no page, no data and no other person,
// and never says "pending" — there is no queue, and a false promise leaves
// somebody waiting for an approval that is not coming.
export function notOnListMessage(email: string): string {
  return `You are signed in as ${email}, but this app is limited to the audit team. If you should have access, ask Felix to add you.`;
}
