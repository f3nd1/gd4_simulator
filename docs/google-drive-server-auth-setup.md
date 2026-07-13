# Google Drive persistent login — one-time setup

Before this change, the "Connect Google Drive" button used a browser-only
OAuth flow: no refresh token existed anywhere, so every page reload (and
every session past ~1hr) needed a fresh "Connect" click. This setup adds a
small Supabase server function that holds a long-lived Google refresh
token, so the connection survives reloads and stays live for days.

**This app still has no backend of its own** — this uses a Supabase Edge
Function (a small serverless function that runs on Supabase's
infrastructure, not a server you host). Nothing here changes how the rest
of the app works.

Do these steps once, in order. Nothing here is reversed by re-running it —
each command is idempotent (safe to run again if a step fails partway).

## 1. Google Cloud Console — get the Client Secret

You already have an OAuth Client ID pasted into this app's Settings page.

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials), in the same project that Client ID came from.
2. Click the OAuth 2.0 Client ID you're already using (the one ending in `.apps.googleusercontent.com`).
3. Copy the **Client secret** value shown there. Google auto-generates one for every "Web application" client type, even though the old flow never used it.
4. ✅ Pass if: you have a Client Secret string copied (looks like `GOCSPX-...`). **Do not paste it into this app anywhere** — it only ever goes into Supabase (step 3 below).

No other Google Cloud Console change is needed — the existing "Authorized JavaScript origins" and enabled Drive API stay exactly as they are. No new redirect URI needs to be added.

## 2. Supabase — run the schema migration

1. Open your Supabase project → **SQL Editor**.
2. Open this repo's `supabase/schema.sql`, copy its full contents, paste into the SQL Editor, and run it.
   - This is safe to run even if you've run an earlier version before — every statement uses `create table if not exists` / `create policy` guards.
3. ✅ Pass if: a new `drive_oauth_tokens` table appears under Table Editor, with Row Level Security **enabled** and **zero policies** listed (that's intentional — see the comment in `schema.sql`).

## 3. Supabase — set the secrets and deploy the function

You'll need the [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) installed and logged in.

```bash
# one-time: install + login (skip if you already have the CLI set up)
npm install -g supabase
supabase login

# one-time per project: link this repo to your Supabase project
# (find <project-ref> in your Supabase project's Settings → General)
supabase link --project-ref <project-ref>

# set the two secrets — GOOGLE_CLIENT_ID is the SAME value already in this
# app's Settings page; GOOGLE_CLIENT_SECRET is what you copied in step 1
supabase secrets set GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
supabase secrets set GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxx

# deploy the function
supabase functions deploy drive-oauth
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` do NOT need to be set manually — Supabase injects those into every Edge Function automatically.

✅ Pass if: `supabase functions deploy drive-oauth` finishes with no error, and the function shows up under your Supabase project → Edge Functions.

## 4. Reconnect one last time

1. Reload the app, go to **Settings**, and click **Connect Google Drive**.
2. You'll see Google's consent screen (this happens every time now, by design, to guarantee Google issues a refresh token — see the comment in `driveClient.ts`'s `requestDriveAuthCode`). Approve it.
3. ✅ Pass if: after approving, the Settings page shows "Connected". Reload the page — it should stay connected with no further clicks. Come back the next day — same.

## Troubleshooting

- **"Google Drive requires Supabase to be configured"** — Settings → Supabase database isn't filled in (URL + publishable key), or `.env.local` is missing them. This has nothing to do with Drive specifically; check Supabase sync is working elsewhere in the app first.
- **"Server not configured: the GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET secrets are not set"** — step 3 wasn't completed, or the function wasn't redeployed after setting secrets. Re-run `supabase functions deploy drive-oauth` after confirming secrets with `supabase secrets list`.
- **"Google Drive connection expired or was revoked ... reconnect"** — the refresh token stopped working (someone revoked access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), or Google expired it after long inactivity). Click "Connect Google Drive" again — this is the honest failure path, not a bug.
- **Google rejects the exchange with a redirect_uri mismatch or similar** — this is the one part of the flow that couldn't be tested without a live Google account during development (see the code comments in `driveClient.ts` and `supabase/functions/drive-oauth/index.ts`). If you hit this, check that the Edge Function's `redirectUri` (passed from the browser as `window.location.origin`) is being sent correctly, and report back — this is the most likely place for a real bug to surface.
