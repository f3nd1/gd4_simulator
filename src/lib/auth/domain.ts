// Who is allowed in, defined once.
//
// Leaf module with no imports so the Edge Function, the client and the tests
// can all agree on the rule without pulling anything else in. The SAME check
// exists in three places on purpose, and only two of them count:
//
//   1. The browser (cosmetic). It decides what to render and can be edited
//      by anyone with developer tools, so it protects nothing.
//   2. Postgres, as a row-level security policy (real). Every read and write
//      goes through it, including a request made with curl and the
//      publishable key.
//   3. The drive-oauth Edge Function (real). It mints Google Drive access
//      tokens, so it has to decide for itself rather than trust the caller.
//
// Google's "hd" sign-in parameter is a HINT that pre-fills the account
// chooser, not a restriction: a consumer Google account can still complete
// the flow. The two server-side checks are what actually close the door.
export const ALLOWED_EMAIL_DOMAIN = "unitedceres.edu.sg";

export function emailIsAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  // Case-insensitive, and the domain must be the WHOLE tail: a lookalike like
  // "unitedceres.edu.sg.attacker.com" must not pass, and neither must
  // "notunitedceres.edu.sg".
  return email.slice(at + 1).toLowerCase() === ALLOWED_EMAIL_DOMAIN;
}

export const WRONG_DOMAIN_MESSAGE =
  `That Google account is not a United Ceres account. Sign in with your @${ALLOWED_EMAIL_DOMAIN} address.`;

// ── Who manages the allow-list ────────────────────────────────────────────
//
// COSMETIC, like everything else in this file: it decides whether the People
// screen is drawn. The control is public.is_admin() in Postgres (see
// supabase/04-admin-manages-the-list.sql), which the insert and delete
// policies on allowed_users consult on every write, including a write made
// with curl and the publishable key. Editing this constant in a browser grants
// nothing: the screen appears and every button it offers is refused.
//
// A test pins this to the address inside that SQL function, because two copies
// of a rule is how one of them quietly stops matching.
export const ADMIN_EMAIL = "felix@unitedceres.edu.sg";

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === ADMIN_EMAIL;
}
