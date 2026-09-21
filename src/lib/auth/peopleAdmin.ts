// The People screen's rules, kept out of the component so they can be tested.
// Importing the page would pull in the store and then driveClient's pdfjs
// Worker, which does not exist under Node (CLAUDE.md, Tests).
//
// NONE of this is the control. Every rule below is also enforced by a policy
// in Postgres (supabase/04-admin-manages-the-list.sql), because anyone signed
// in can call the table directly with the publishable key. What these give is
// a clear refusal instead of a raw database error.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, ALLOWED_EMAIL_DOMAIN, isAdminEmail } from "./domain";

export type Person = { email: string; note: string | null; addedAt: string | null };

// Deliberately not an RFC-5322 parser. The address has to be a United Ceres
// Google account for sign-in to work at all, so anything outside this shape is
// a typo the person adding it should see now rather than when the colleague
// cannot get in.
const LOCAL_PART = /^[a-z0-9._%+-]+$/i;

export type AddressCheck = { ok: true; email: string } | { ok: false; reason: string };

export function checkAddress(raw: string, existing: readonly string[]): AddressCheck {
  const email = raw.trim().toLowerCase();
  if (!email) return { ok: false, reason: "Type the person's email address first." };
  const at = email.lastIndexOf("@");
  if (at < 1) return { ok: false, reason: "That does not look like an email address. It needs an @ in it." };
  if (email.slice(at + 1) !== ALLOWED_EMAIL_DOMAIN) {
    return { ok: false, reason: `Only @${ALLOWED_EMAIL_DOMAIN} addresses can sign in, so only those can be added.` };
  }
  if (!LOCAL_PART.test(email.slice(0, at))) {
    return { ok: false, reason: "There is a space or an unusual character before the @. Check the spelling." };
  }
  if (existing.some((e) => e.trim().toLowerCase() === email)) {
    return { ok: false, reason: "That person is already on the list." };
  }
  return { ok: true, email };
}

// Why a row cannot be removed, or null when it can. The admin's own row is
// pinned: the delete policy refuses it too, so this is the readable version of
// a refusal that would otherwise arrive as "no rows deleted".
export function removalBlockedReason(email: string): string | null {
  return isAdminEmail(email)
    ? `This is your own account, and it is the one that manages this list. It cannot be removed here. To hand this over to somebody else, change the admin address in supabase/04-admin-manages-the-list.sql.`
    : null;
}

// Said at the moment of removing, not buried in a help page. Two of these three
// sentences are the part people get wrong: access stops at the database within
// seconds, but the browser in front of them keeps rendering what it already
// has until it reloads, and only Supabase can end the session itself.
export function removalConsequence(email: string): string {
  return `${email} will lose access to the data within seconds, because the database checks this list on every request. `
    + `Their screen will keep showing whatever it has already loaded until they reload the page. `
    + `To end their sign-in session there and then, remove them in the Supabase dashboard under Authentication, Users.`;
}

export const ADMIN_ONLY_REFUSAL =
  "This page is not available to your account. If you think it should be, ask Felix.";

// ── The database calls ────────────────────────────────────────────────────

export async function listPeople(supabase: SupabaseClient): Promise<{ people: Person[] } | { error: string }> {
  let data: unknown[] | null = null;
  try {
    const res = await supabase.from("allowed_users").select("email, note, added_at").order("email");
    if (res.error) return { error: res.error.message };
    data = res.data as unknown[] | null;
  } catch (e) {
    // Never throw out of here: the People screen loads three lists side by
    // side and one of them failing must not blank the other two.
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (!Array.isArray(data)) return { error: "The sign-in list came back in an unexpected shape." };
  const people = data.map((raw) => {
    const r = raw as { email: unknown; note: unknown; added_at: unknown };
    return { email: String(r.email), note: r.note == null ? null : String(r.note), addedAt: r.added_at == null ? null : String(r.added_at) };
  });
  // The admin first, because the screen pins it. Then everyone else, as
  // ordered by the database.
  return { people: [...people].sort((a, b) => Number(isAdminEmail(b.email)) - Number(isAdminEmail(a.email))) };
}

// A refusal from the policy comes back as an error on insert (RLS rejects the
// row), and as ZERO ROWS DELETED on delete — no error at all. The second is
// the one that reads as success if nobody checks, so the delete path counts.
export async function addPerson(supabase: SupabaseClient, email: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { error } = await supabase.from("allowed_users").insert({ email });
  if (!error) return { ok: true };
  if (error.code === "23505") return { ok: false, reason: "That person is already on the list." };
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return { ok: false, reason: "The database refused that. Only the admin account can add people." };
  }
  return { ok: false, reason: error.message };
}

export async function removePerson(supabase: SupabaseClient, email: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const blocked = removalBlockedReason(email);
  if (blocked) return { ok: false, reason: blocked };
  const { data, error } = await supabase.from("allowed_users").delete().eq("email_lc", email.trim().toLowerCase()).select("email");
  if (error) return { ok: false, reason: error.message };
  // Zero rows back means the policy refused it. Reporting success here would
  // tell the admin somebody had lost access when they had not.
  if (!data || data.length === 0) {
    return { ok: false, reason: "The database refused that. Only the admin account can remove people, and the admin's own row cannot be removed." };
  }
  return { ok: true };
}

export { ADMIN_EMAIL };
