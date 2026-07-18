# Investigation: repeated Google Drive consent screen

Date: 2026-07-18. Investigation only, zero code/config/secret changes. Checkout
at `bceec15` (HEAD == origin/main, clean tree).

## Summary of the symptom

The user is repeatedly hitting Google's OAuth consent screen when using a
Drive-dependent feature (most recently, the new "Run Hybrid first draft"
button), instead of the connection being remembered as the server-side
refresh-token design intends.

## How the flow is SUPPOSED to work (confirmed from code)

- **Client ID** (not secret) is entered once in Settings, persisted in
  `useGoogleDriveStore` (`ucc-gd4-google-drive:v1`).
- **Access token** (short-lived, ~1hr) lives in memory only in
  `useGoogleDriveStore` - never persisted (`partialize: (s) => ({ clientId: s.clientId })`,
  `src/store/useGoogleDriveStore.ts:144`).
- **Refresh token** (long-lived) is the ONLY thing that should make
  reconnection unnecessary. It is minted by Google on first consent and held
  server-side in Supabase, in the `drive_oauth_tokens` table (`id`,
  `refresh_token`, `updated_at`; RLS enabled with zero policies, so only the
  Edge Function's service-role key can touch it - `supabase/schema.sql:30-39`).
- Every Drive-dependent RUN in the app calls `getFreshToken()`
  (`useGoogleDriveStore.ts:129-139`), never the interactive `connect()`.
  `getFreshToken` returns the cached access token if it still has >60s of
  life; otherwise it calls the `drive-oauth` Edge Function's `refresh` action,
  which reads the stored refresh token and exchanges it for a new access
  token - with NO Google popup at all
  (`supabase/functions/drive-oauth/index.ts:150-169`). I confirmed by grep
  that every run call site (`runPPDReview`, `runEvidenceAssessment`,
  `auditFolderStaged`, the bulk sweep, `calibrationRunner.ts`, and the new
  `runHybridFirstDraft`'s underlying `runFullAudit`) uses `getFreshToken`,
  never `connect()`. This is confirmed correct by an existing unit test
  (`src/store/__tests__/googleDriveTokenRefresh.test.ts`), which asserts the
  refresh path never opens a popup.
- The interactive, popup-showing `connect()` is called ONLY from three
  explicit "Connect"/"Reconnect" buttons (`EvidenceFolder.tsx:1070,2139`,
  `PPDReview.tsx:420`), each behind an `onClick`, never from a `useEffect` or
  automatically inside a run. A run that cannot get a token instead sets
  `driveBlockedReason` and shows a banner with a Connect button for the human
  to click (`useWorkspaceStore.ts:1333,1755,3924,5318,6283`) - it never pops
  the consent screen itself.

**So a Drive-dependent feature does not, by itself, contain code that opens
Google's consent screen.** If the user sees the consent screen when clicking
"Run Hybrid first draft", the real sequence must be: the run's `getFreshToken`
call failed silently (no popup, just a failure) -> the app showed a "not
connected" banner -> the user (or the banner's own auto-guidance) led them to
click "Connect" -> THAT click is what shows the popup. This distinction matters
for the next section.

## Design fact that amplifies the symptom, confirmed in code and docs

`requestDriveAuthCode` (`driveClient.ts:174-196`) ALWAYS passes
`prompt: "consent"` on every call, by design:

> "prompt: consent is forced so Google reliably re-issues a refresh token on
> every Connect click - Google only issues one on first consent (or when
> explicitly re-prompted), and silently omits it on a plain repeat request."

`docs/google-drive-server-auth-setup.md:64` confirms the same for the
one-time setup: "You'll see Google's consent screen (this happens every time
now, by design...)."

This means: **every single click of "Connect"/"Reconnect", for any reason,
always shows the full Google consent screen** - there is no lighter-weight
"just re-approve" step. This is intentional (it is what guarantees a refresh
token is actually issued), but it means that if the user is having to click
Connect more than once - for any of the reasons below - each occurrence looks
identical to the very first time, which reads exactly like "it keeps asking
me to approve, over and over, rather than remembering."

## Why the user might be forced back to Connect repeatedly (ranked by probability)

### 1. (Most likely) The stored refresh token is failing on `refresh`, and the Edge Function deletes it on every failure

`supabase/functions/drive-oauth/index.ts:160-167`: any failed `refresh` call
(any Google error, not only revocation) causes the Edge Function to
**delete the stored row**:

```
if (!result.ok) {
  await supabase.from(TABLE).delete().eq("id", ROW_ID);
  return json({ error: `Google Drive connection expired or was revoked (${result.error}) ...` }, 401);
}
```

So a refresh token that fails even once forces a full reconnect (full
consent screen, per above) - and if the SAME underlying cause makes the next
refresh token fail too, the cycle repeats indefinitely. Two concrete causes
that would make every refresh fail, tied directly to the user's own recollection
of a past incident:

- **A rotated/mismatched Client Secret.** If the Google Cloud Console OAuth
  Client Secret was rotated (e.g. after the past incident where a live secret
  was pasted in chat) but the Supabase Edge Function's `GOOGLE_CLIENT_SECRET`
  was not updated to match (or vice versa - Supabase updated but Console
  wasn't, or an old secret was accidentally restored), Google's token endpoint
  rejects every exchange/refresh call from the mismatched secret with
  `invalid_client`. This fails the connect-time exchange too (not just
  refresh), so the user could click Connect, approve the consent screen, and
  still land back at "not connected" because the server-side exchange step
  (which does use the secret) fails invisibly to Google's popup UI - the popup
  itself always "succeeds" (it only needs the Client ID, not the secret), so
  it looks like consent didn't stick even though the user genuinely approved it.
- **A Client ID mismatch between the browser and the server.** The Client ID
  used to request the authorization code (Settings page, browser-side) and the
  `GOOGLE_CLIENT_ID` secret used server-side to exchange it must be the exact
  same value. If they differ (e.g. Settings was updated to a new Client ID
  without also updating the Supabase secret, or vice versa), the exchange
  fails the same way.

**I cannot confirm or rule this out from the repository alone** - the actual
secret values are never in this repo (by design; `GOOGLE_CLIENT_SECRET` is
referenced only by name, `index.ts:117`, never its value), and I have no
access to Supabase's live secrets or Google Cloud Console. This needs live
verification (see checklist below).

### 2. (Plausible, independent of any past incident) The Google OAuth app is in "Testing" publishing status

This is a very common, well-known Google OAuth behaviour, and produces
EXACTLY this symptom regardless of whether any secret was ever rotated: an
OAuth consent screen left in **Testing** (unverified) publishing status in
Google Cloud Console issues refresh tokens that **expire after 7 days**,
after which every refresh call fails with `invalid_grant` and the app must
reconnect - repeating every week indefinitely. Nothing in this repository
sets or checks publishing status (it is a Google Cloud Console setting, not
app config), so this cannot be confirmed or ruled out from code. This matches
the user's own account of "a similar issue happened before" - a 7-day
expiry would recur on a regular cadence, which reads as a recurring problem
rather than a one-off.

### 3. (Less likely, but distinguishable) The refresh token was never actually saved after a past "Connect"

`index.ts:143-146`: the exchange handler only overwrites the stored refresh
token when Google's response actually includes one (`if (result.refresh_token)`),
and if the `upsert` fails, it returns an explicit 500 error to the browser
(`Connected to Google, but could not save the refresh token: ...`). This
means a genuine save failure would have been visible as an error message at
connect time, not a silent, later "keeps asking" pattern - so this is a less
likely explanation for a REPEATING problem, though it remains possible for a
single historical occurrence if that error was seen and dismissed without
being reported.

### 4. Ruled out by code inspection

- **Missing `access_type=offline` / `prompt=consent` in the auth request.**
  Confirmed present and correct (`driveClient.ts:184-185`).
- **A code bug that calls the popup `connect()` automatically from a
  Drive-dependent feature.** Confirmed false by grep - every run path uses
  `getFreshToken`, and `connect()` is wired only to explicit button clicks.
- **RLS blocking the Edge Function's read/write of the stored token.**
  Confirmed the Edge Function uses the service-role client (`adminClient()`,
  `index.ts:74-76`), which bypasses RLS entirely - RLS is irrelevant here.

## On the earlier "unrotated secret" concern specifically

I searched this repository's git history and every doc/CLAUDE.md for any
record of a secret-leak incident or a rotation being completed - **there is
none**. This is expected either way: a real secret would never be committed
here (the Edge Function only ever references `GOOGLE_CLIENT_SECRET` by name,
never its value, `index.ts:117`), so the repo would show nothing whether the
incident happened and was properly resolved, or happened and was never fully
rotated. **This cannot be confirmed or ruled out from the code alone** - it
requires checking the actual secret value's rotation timestamp in Google Cloud
Console against when `supabase secrets set GOOGLE_CLIENT_SECRET=...` was last
run (Supabase does not expose secret VALUES after setting them, but
`supabase secrets list` shows when each was last updated).

If reason 1 above (mismatched secret) is confirmed, it would directly connect
to that earlier incident: a rotation that updated Google Cloud Console but was
never followed by re-running `supabase secrets set GOOGLE_CLIENT_SECRET=...`
and `supabase functions deploy drive-oauth` (steps 3 in
`docs/google-drive-server-auth-setup.md`) would produce exactly this failure
mode from the moment of rotation onward.

## Is this per-user or systemic?

This app has **no per-user login** - `drive_oauth_tokens` holds a single
shared row (`id = "default"`, confirmed in `index.ts:35` and
`schema.sql:30-34`) for the whole workspace. There is no per-account
credential to go wrong; whatever is happening affects the ONE shared Drive
connection for everyone using this deployment. This rules out "it's specific
to this one Google account" as a code-level explanation - if the connection is
unstable, it is unstable for the whole workspace, not one user's login. (It
remains possible that only one person happens to be the one clicking through
it and reporting it.)

## What is confirmed from code vs what needs live verification

**Confirmed from code (high confidence):**
- The token architecture is exactly as documented: short-lived access token
  in the browser, long-lived refresh token server-side only.
- No code path opens the consent popup automatically from a Drive-dependent
  feature; it only opens from an explicit Connect/Reconnect click.
- Every Connect/Reconnect click ALWAYS shows the full consent screen, by
  design - not a bug, but a real contributor to how repeated reconnection
  feels to the user.
- Any refresh failure (for any reason) deletes the stored token, forcing a
  full reconnect next time.
- RLS is not a factor; the Edge Function bypasses it correctly.
- No record in this repository of a secret-rotation incident being logged or
  completed.

**Needs live verification (cannot be determined from the repo):**
1. Whether the Google Cloud Console OAuth consent screen's **Publishing
   status** is "Testing" (would explain a recurring ~7-day failure
   independent of any secret issue) or "In production".
2. Whether the Supabase Edge Function's `GOOGLE_CLIENT_SECRET` and
   `GOOGLE_CLIENT_ID` secrets currently match the values actually shown on
   the Google Cloud Console credential in use - in particular, whether the
   secret was ever rotated in Console without a matching
   `supabase secrets set` + `supabase functions deploy drive-oauth`.
3. Whether the `drive_oauth_tokens` table currently holds a row at all, and
   its `updated_at` - a row that keeps getting deleted and recreated at short
   intervals would show this directly.
4. The actual error captured when a refresh fails - the Edge Function
   returns Google's own `error`/`error_description` in its response
   (`callGoogleToken`, `index.ts:80-91`); this exact string (`invalid_client`,
   `invalid_grant`, etc.) would immediately distinguish cause 1 (secret
   mismatch, `invalid_client`) from cause 2 (Testing-status expiry or true
   revocation, `invalid_grant`) - see the checklist below for where to find it.

## What to check / do next

1. **Google Cloud Console -> APIs & Services -> OAuth consent screen**: confirm
   **Publishing status**. If it says "Testing", that alone explains a
   recurring weekly reconnect regardless of any secret issue - moving it to
   "In production" (or adding the account as a Test user does NOT fix the
   7-day expiry; only publishing removes it) is the fix.
2. **Google Cloud Console -> APIs & Services -> Credentials -> the OAuth 2.0
   Client ID in use**: note its Client Secret's last-generated/rotated
   indicator if shown, and copy the current secret value.
3. **Supabase -> Edge Functions -> drive-oauth -> Secrets** (or
   `supabase secrets list` via CLI): confirm `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` are set, and check their last-updated time against
   when any rotation in Console happened. If in doubt, re-run step 3 of
   `docs/google-drive-server-auth-setup.md` (`supabase secrets set ...` with
   the CURRENT Console values, then `supabase functions deploy drive-oauth`)
   - this is safe and idempotent.
4. **Supabase -> Table Editor -> drive_oauth_tokens**: check whether a row
   exists and its `updated_at`. If it is missing right after a "successful"
   Connect, or its `updated_at` keeps resetting, that confirms the
   delete-on-refresh-failure cycle from cause 1 above.
5. **Supabase -> Edge Functions -> drive-oauth -> Logs**: find the most
   recent `refresh` call's response body/error. The exact Google error string
   (`invalid_client` vs `invalid_grant`) pinpoints which of the two leading
   causes is actually happening - I cannot see this without live access.
6. Once the specific error is known, the fix is either: re-sync the Client
   Secret (checklist item 3) if `invalid_client`, or move the OAuth consent
   screen to "In production" publishing status if `invalid_grant` is
   recurring on a roughly weekly cadence with no explicit revocation at
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

No code, secret, or configuration change was made as part of this
investigation.
