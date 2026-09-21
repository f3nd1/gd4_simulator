// Supabase Edge Function: server-side Google Drive OAuth token exchange +
// refresh. The ONLY place the Google OAuth Client Secret and the stored
// Drive refresh token exist — never sent to the browser. The browser only
// ever receives short-lived (~1hr) access tokens, exactly like the old
// client-only flow; the difference is this function can mint a new one on
// demand indefinitely (until the stored refresh token itself is revoked),
// instead of the browser needing to re-run Google's consent/silent-reauth
// flow every session.
//
// One-time setup (see docs/google-drive-server-auth-setup.md for the full
// numbered checklist):
//   1. Run this repo's supabase/schema.sql (adds drive_oauth_tokens) in the
//      Supabase SQL Editor.
//   2. supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
//      (the Client ID is the SAME value already pasted into this app's
//      Settings > Google OAuth Client ID; the Client Secret is on the same
//      Google Cloud Console > Credentials > OAuth 2.0 Client IDs entry —
//      Google auto-generates one for every "Web application" client even
//      though the old client-only flow never used it.)
//   3. supabase functions deploy drive-oauth
//   4. In the app, click "Connect Google Drive" ONE more time — this is the
//      last time it should ever be needed; connectSilently()/getFreshToken()
//      take over from here.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// Supabase into every Edge Function — never set those manually.

import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const TABLE = "drive_oauth_tokens";
// This app has no per-user login (see supabase/schema.sql) — one shared row
// holds the single Drive connection for the whole workspace.
const ROW_ID = "default";

// ── WHO IS ALLOWED TO CALL THIS ────────────────────────────────────────────
//
// This endpoint mints Google Drive access tokens (scope drive.readonly) for
// the account holding student records, and can revoke the whole workspace's
// Drive connection. It used to check nothing: the platform's JWT gate is
// satisfied by the PUBLISHABLE key, which ships in the browser bundle, and
// CORS is enforced by browsers only and means nothing to curl. So anyone who
// could load the app could mint a Drive token with it.
//
// It now identifies the caller itself: the Authorization bearer must be a
// real signed-in user, that user's email must be on the allowed domain, AND
// that address must be one of the named people in public.allowed_users. The
// publishable key alone is no longer enough, and neither is any UCC address —
// students and other staff have those too.
//
// The list is read from the SAME table the row-level policies use (see
// supabase/03-restrict-to-named-people.sql), so there is one list, not a copy
// here. The domain test below is kept in front of it as a cheap first gate.
//
// The domain rule is duplicated from src/lib/auth/domain.ts rather than
// imported: an Edge Function is deployed on its own and cannot reach the
// app's source. The test at src/lib/auth/__tests__/edgeFunctionDomain.test.ts
// pins the two copies together so they cannot drift apart.
const ALLOWED_EMAIL_DOMAIN = "unitedceres.edu.sg";
const ALLOWED_USERS_TABLE = "allowed_users";
// The admin short-circuits the list, exactly as public.is_allowed_user() does
// in Postgres. Without this the two disagree: with the admin's own row
// missing, the app would let them in and this function would refuse them
// Google Drive, citing a migration they do not need to run.
const ADMIN_EMAIL = "felix@unitedceres.edu.sg";

export function emailIsAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  return email.slice(at + 1).toLowerCase() === ALLOWED_EMAIL_DOMAIN;
}

type ExchangeBody = { action: "exchange"; code: string };
type RefreshBody = { action: "refresh" };
type DisconnectBody = { action: "disconnect" };
type RequestBody = ExchangeBody | RefreshBody | DisconnectBody;

// Browser origins allowed to invoke this function. Deliberately NOT a
// wildcard — this endpoint mints Google Drive access tokens for a workspace
// holding student/staff records, so only the real app origins may call it.
// localhost is included so local Vite dev (see CLAUDE.md — dev server on
// :5173) can exercise the deployed function; add more here, never "*".
const ALLOWED_ORIGINS = new Set([
  "https://apps.unitedceres.edu.sg", // production
  "http://localhost:5173",           // local Vite dev
]);
// Fallback Access-Control-Allow-Origin for a disallowed/absent Origin: the
// production origin, which won't match a disallowed caller's origin, so the
// browser blocks it — the request is still answered, but never with "*".
const FALLBACK_ORIGIN = "https://apps.unitedceres.edu.sg";

// CORS headers scoped to THIS request's origin. Access-Control-Allow-Origin
// can only carry a single origin value (a list or "*" won't do here), so the
// caller's origin is reflected back only when it's in the allowlist; `Vary:
// Origin` stops a shared cache from serving one origin's ACAO to another.
// Allow-Headers is exactly what @supabase/supabase-js's functions.invoke()
// sends (verified against the installed 2.108.2 client: authorization,
// apikey, x-client-info, and content-type for a JSON body) — a missing one
// here fails the browser's preflight the same way no CORS headers at all did.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : FALLBACK_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Vary": "Origin",
  };
}

function adminClient() {
  // Explicit auth options because this runs in Deno, not a browser: the
  // defaults reach for localStorage to persist a session, start a refresh
  // timer and try to read a session out of the URL, none of which exist
  // here. Harmless while the client was only used for table reads; it is
  // now also used to verify the caller's token, so the auth sub-client
  // actually has to initialise cleanly.
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Google's token endpoint, for both the initial code exchange and every
// later refresh — same shape, different grant_type/credential.
async function callGoogleToken(params: Record<string, string>): Promise<{ ok: true; access_token: string; expires_in?: number; refresh_token?: string } | { ok: false; error: string }> {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    return { ok: false, error: data.error_description || data.error || `Google token endpoint returned ${resp.status}.` };
  }
  return { ok: true, access_token: data.access_token, expires_in: data.expires_in, refresh_token: data.refresh_token };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  // Request-scoped so EVERY response below — success and error alike — carries
  // the CORS headers. Adding them only to the happy path is the classic bug:
  // errors would still fail opaquely in the browser as a CORS message,
  // hiding the real error and making the failure much harder to debug.
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });

  // Preflight: answer immediately, before any auth / body-parse / secret
  // checks — the browser sends this OPTIONS request before the real POST and
  // aborts the whole call if it doesn't pass.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // Service-role client: used both to identify the caller below and to read
  // the stored refresh token afterwards.
  const supabase = adminClient();

  // Identify the caller BEFORE touching secrets or Google. A request with the
  // publishable key and no user session gets nothing.
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!bearer) {
    return json({ error: "Sign in with your United Ceres Google account. (No sign-in was sent with this request.)" }, 401);
  }
  {
    const { data, error } = await supabase.auth.getUser(bearer);
    const email = data?.user?.email ?? null;
    // getUser rejects the publishable key: it is not a user token, so there
    // is no user on it. The reason is included because the app can only show
    // what this body says, and "401" on its own sent one debugging round
    // looking in the wrong place.
    if (error || !data?.user) {
      console.error("[drive-oauth] caller token rejected:", error?.message ?? "no user on the token");
      return json({ error: `Sign in with your United Ceres Google account. (The sign-in sent with this request was not accepted: ${error?.message ?? "it carried no user"}.)` }, 401);
    }
    if (!emailIsAllowed(email)) {
      return json({ error: `That account (${email ?? "unknown"}) is not a United Ceres account.` }, 403);
    }
    const isAdmin = (email ?? "").trim().toLowerCase() === ADMIN_EMAIL;
    // Then the list itself. Matched on the generated lower-cased column, not
    // on `email`, because addresses are typed by hand into the Supabase
    // dashboard and their case cannot be relied on. `.eq` rather than a LIKE:
    // an address can legitimately contain % and _, which a pattern match
    // would treat as wildcards.
    const { data: listed, error: listErr } = await supabase
      .from(ALLOWED_USERS_TABLE)
      .select("email")
      .eq("email_lc", (email ?? "").trim().toLowerCase())
      .maybeSingle();
    // A failure to READ the list is not permission to skip it. This runs with
    // the service-role key, so the only realistic cause is the table not
    // existing yet, which must not silently open the door.
    if (listErr && !isAdmin) {
      console.error("[drive-oauth] could not read the allowed-users list:", listErr.message);
      return json({ error: `The server could not check whether your account is permitted (${listErr.message}). If this project has not had supabase/03-restrict-to-named-people.sql run on it yet, run it.` }, 500);
    }
    if (!listed && !isAdmin) {
      return json({ error: `That account (${email ?? "unknown"}) is not on the list of people permitted to use this app. Ask Felix to add you.` }, 403);
    }
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return json({ error: "Server not configured: the GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET secrets are not set on this Edge Function. See docs/google-drive-server-auth-setup.md." }, 500);
  }

  if (body.action === "exchange") {
    if (!body.code) return json({ error: "Missing authorization code." }, 400);
    const result = await callGoogleToken({
      client_id: clientId,
      client_secret: clientSecret,
      code: body.code,
      // GIS popup mode (initCodeClient, ux_mode: "popup") delivers the code to
      // a JS callback with no redirect ever happening, so Google's token
      // exchange expects the literal "postmessage" here — the carried-over
      // convention from the gapi popup flow. Sending the page origin instead
      // (which isn't a registered "Authorized redirect URI", only a JS origin)
      // is rejected with redirect_uri_mismatch / invalid_grant.
      redirect_uri: "postmessage",
      grant_type: "authorization_code",
    });
    if (!result.ok) return json({ error: result.error }, 400);
    // No refresh_token in the response means Google already had live,
    // consented offline access for this client+account and didn't re-issue
    // one — the ALREADY-stored one (from a prior connect) still works, so
    // this is not an error; only overwrite when a new one actually arrives.
    if (result.refresh_token) {
      const { error } = await supabase.from(TABLE).upsert({ id: ROW_ID, refresh_token: result.refresh_token, updated_at: new Date().toISOString() });
      if (error) return json({ error: `Connected to Google, but could not save the refresh token: ${error.message}` }, 500);
    }
    return json({ accessToken: result.access_token, expiresInSeconds: result.expires_in ?? 3600 });
  }

  if (body.action === "refresh") {
    const { data: row, error: readErr } = await supabase.from(TABLE).select("refresh_token").eq("id", ROW_ID).maybeSingle();
    if (readErr) return json({ error: `Could not read the stored Drive connection: ${readErr.message}` }, 500);
    if (!row) return json({ error: "Not connected — no Google Drive connection has been established yet. Click Connect Google Drive in Settings." }, 401);
    const result = await callGoogleToken({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    });
    if (!result.ok) {
      // invalid_grant means the refresh token itself is dead (revoked at
      // myaccount.google.com, or Google expired it) — delete the stale row
      // so future refresh attempts fail fast with the same clear message
      // instead of repeatedly hitting Google with a token that will never
      // work again.
      await supabase.from(TABLE).delete().eq("id", ROW_ID);
      return json({ error: `Google Drive connection expired or was revoked (${result.error}) — reconnect Google Drive in Settings.` }, 401);
    }
    return json({ accessToken: result.access_token, expiresInSeconds: result.expires_in ?? 3600 });
  }

  if (body.action === "disconnect") {
    const { data: row } = await supabase.from(TABLE).select("refresh_token").eq("id", ROW_ID).maybeSingle();
    if (row?.refresh_token) {
      // Best-effort: also tell Google to revoke it, not just forget it here.
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: row.refresh_token }),
      }).catch(() => {});
    }
    await supabase.from(TABLE).delete().eq("id", ROW_ID);
    return json({ ok: true });
  }

  return json({ error: `Unknown action "${(body as { action?: string }).action}".` }, 400);
});
