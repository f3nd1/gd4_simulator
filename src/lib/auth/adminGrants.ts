// Additional admins, granted by the root.
//
// FAILURE-TOLERANT ON PURPOSE. Every function here answers "false" or "empty"
// when anything goes wrong, including the table not existing yet. Deploying
// the build before running 06 must NOT lock anybody out: the worst case is
// that a granted admin does not see the admin screens until the SQL is run,
// which is a visible inconvenience rather than a silent lockout. This project
// has already had one lockout from a build that required a table before the
// migration creating it had run (a43c855).
//
// As always, cosmetic. public.is_any_admin() in Postgres is what the write
// policies consult, and it applies to a request made with curl.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdminEmail } from "./domain";

export type Grant = { email: string; grantedAt: string | null };

// Is this person an admin at all: the root, or holding a grant. The root
// answer never touches the database, so it cannot be broken by one.
export async function isAnyAdmin(supabase: SupabaseClient | null, email: string): Promise<boolean> {
  if (isAdminEmail(email)) return true;
  if (!supabase) return false;
  try {
    const { data, error } = await supabase
      .from("admin_grants").select("email").eq("email_lc", email.trim().toLowerCase()).maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}

// Only the root can read the whole list; a granted admin's own policy returns
// just their row, which is all they need to know.
export async function listGrants(supabase: SupabaseClient): Promise<Grant[]> {
  try {
    const { data, error } = await supabase.from("admin_grants").select("email, granted_at").order("email");
    if (error) return [];
    return (data ?? []).map((r) => ({ email: String(r.email), grantedAt: r.granted_at == null ? null : String(r.granted_at) }));
  } catch {
    return [];
  }
}

export async function grantAdmin(supabase: SupabaseClient, email: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { error } = await supabase.from("admin_grants").insert({ email: email.trim().toLowerCase() });
  if (!error) return { ok: true };
  if (error.code === "23505") return { ok: false, reason: "That person is already an admin." };
  if (error.code === "42P01" || /schema cache/i.test(error.message)) {
    return { ok: false, reason: "Additional admins are not set up on this database yet. Run supabase/06-second-admin-and-locked-stores.sql in the Supabase SQL Editor." };
  }
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return { ok: false, reason: "The database refused that. Only the main admin account can grant admin." };
  }
  return { ok: false, reason: error.message };
}

// Like removing from the sign-in list, a refused DELETE comes back as zero
// rows and no error. Reporting that as success would tell the root somebody
// had lost admin when they had not.
export async function revokeAdmin(supabase: SupabaseClient, email: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await supabase
    .from("admin_grants").delete().eq("email_lc", email.trim().toLowerCase()).select("email");
  if (error) return { ok: false, reason: error.message };
  if (!data || data.length === 0) {
    return { ok: false, reason: "The database refused that. Only the main admin account can take admin away." };
  }
  return { ok: true };
}

export const GRANT_CONSEQUENCE =
  "An extra admin can add and remove people from this list, and can change the configuration pages. They cannot make anybody else an admin, including themselves, and they cannot take your admin away.";
