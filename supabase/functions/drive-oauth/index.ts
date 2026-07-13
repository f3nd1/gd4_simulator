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

type ExchangeBody = { action: "exchange"; code: string; redirectUri: string };
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
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return json({ error: "Server not configured: the GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET secrets are not set on this Edge Function. See docs/google-drive-server-auth-setup.md." }, 500);
  }
  const supabase = adminClient();

  if (body.action === "exchange") {
    if (!body.code || !body.redirectUri) return json({ error: "Missing code or redirectUri." }, 400);
    const result = await callGoogleToken({
      client_id: clientId,
      client_secret: clientSecret,
      code: body.code,
      redirect_uri: body.redirectUri,
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
