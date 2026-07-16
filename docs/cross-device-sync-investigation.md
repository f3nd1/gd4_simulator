# Cross-device sync investigation

Investigation only. No application logic was changed. No data was modified.

---

## DO THIS FIRST — on the original computer, before touching anything else

These steps must be done in order. Do not open the home computer until step 4
tells you to.

**Step 1. Do not reload or close the original computer's browser tab yet.**
If the tab is still open, the in-memory state is still there and can still be
saved. Closing it first is the most common way to lose data that was never
confirmed to Supabase.

**Step 2. Check the save-status indicator in the header.**
The header shows a small coloured dot:
- "● Saved" (green) = Supabase confirmed the write. Your data is safe on the
  server. Cross-device should work.
- "● Saving…" (amber) = a write is in flight or the 600ms debounce has not
  expired yet. Wait for it to resolve before closing the tab.
- "● Sync error" (red) = the Supabase upsert failed. Your data is in local
  browser storage only; it will not appear on another device.
- Nothing visible = idle. The last write either completed successfully or was
  never triggered (possible if the tab has been open but no changes were made
  since load).

If you see "Sync error", do not close the tab. Move to Step 3.

**Step 3. Check the Settings page — Supabase credentials.**
Go to Settings and confirm the Supabase URL and publishable key shown there.
They should match the values in your `.env.local` file on the server. Copy them
down (or screenshot them). You will compare them with the home computer in
step 5.

If the URL field is blank and the app is still connected, the credentials come
from the build environment variables (`VITE_SUPABASE_URL` /
`VITE_SUPABASE_PUBLISHABLE_KEY`) baked into the deployed bundle — not from the
Settings page. In that case, both computers will always use the same Supabase
project automatically, and credential mismatch is not the cause.

If the URL field is non-blank, these values are stored in this browser's
localStorage only (key `ucc-gd4-supabase-settings:v1`). They do not sync to
Supabase. Write them down.

**Step 4. Open the home computer now and check the same Settings page.**
Compare the Supabase URL and publishable key on the home computer against what
you wrote down in step 3. If they differ, or if one is blank and the other is
not, the two computers are pointing at different Supabase projects. This is the
most likely cause of the missing data — see Finding 1 below.

**Step 5. On the original computer, make a trivial edit and watch the header.**
If you have already confirmed credentials match and the data is still missing,
make a small edit (e.g. open a checklist item and press space then delete), then
watch the header. If it shows "Saving…" and then "Saved", Supabase is accepting
writes. If it stays on "Sync error", Supabase is rejecting writes — check the
browser console (F12 → Console) for the error message.

---

## What data this affects

The user's report says work on checklist lines for items 6.2.1 and 6.3.1 and
the findings raised from that work were not visible on the home computer.

- Checklist lines: stored in `useChecklistModuleStore`, persist key
  `ucc-gd4-checklist:v2`, **synced to Supabase** via `workspaceStorage`.
- Findings (`customFindings`): stored in `useWorkspaceStore`, persist key
  `ucc-gd4-workspace:v3`, **synced to Supabase** via `workspaceStorage`.
- Final Report content: derived from the above two stores on render; not stored
  separately.

Both affected stores ARE included in Supabase sync. If the data reached
Supabase, it should appear on any device that connects to the same project.

---

## Finding 1 — Supabase credential mismatch (most likely cause)

**Confidence: HIGH that this is the root cause, unless the credentials on both
computers are confirmed identical.**

The Supabase credentials (`ucc-gd4-supabase-settings:v1`) are stored in
browser localStorage only. This key is deliberately excluded from Supabase sync
— it holds the connection credentials themselves, so syncing them through the
connection they describe would be circular
(`src/store/useSupabaseSettingsStore.ts`, comment at top of file).

This means:

- If you entered the Supabase URL and key manually on the Settings page on the
  original computer, that value is in that computer's localStorage only.
- The home computer's localStorage has no entry for this key (or a different
  one if it was set up separately).
- The home computer falls back to the build-time environment variables
  (`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`). If those are
  blank (as they are in the `.env.example`), the home computer has no Supabase
  connection at all.

**What happens when there are no credentials:** `getSupabaseClient()` in
`src/lib/supabaseClient.ts` returns `null`. The `setItem` function in
`src/store/supabaseStorage.ts` (lines 91-148) checks for null client and
returns `Promise.resolve()` immediately — a silent no-op. No error is shown.
The data is saved to that computer's localStorage only. "Saving…" is called
immediately when a write is triggered, but if the client is null, "Saved" is
never marked either... actually re-checking this: `markSaving()` is called
before the null-client check, but `markSaved()` is only called inside the
successful upsert path. So the status indicator may show "Saving…" briefly then
go idle, not "Sync error", if the client is null. The "Sync error" path is only
reached on a thrown exception from the upsert.

**Resolution:** On the original computer, check Settings for the Supabase URL.
Compare with the home computer. If they differ, enter the same URL and key on
the home computer's Settings page. On next load, the home computer will read the
Supabase project and pull down the synced state.

---

## Finding 2 — `beforeunload` flush is async and may not complete (second most likely)

**Confidence: HIGH that this is a real risk; MEDIUM that it explains this specific incident.**

When a browser tab or laptop is closed, `Layout.tsx` fires `flushPendingSaves()`
on the `beforeunload` event. This function calls `Promise.all()` over all
pending debounced writes (`src/store/supabaseStorage.ts`, `flushPendingSaves`).

However, `beforeunload` handlers that start async operations (network fetches)
are not guaranteed to complete before the browser kills the page. Modern
browsers cancel in-flight `fetch` calls when a page unloads unless the request
uses the `keepalive: true` flag. The Supabase upsert in `setItem` uses a
standard `fetch` via the `@supabase/supabase-js` client, without `keepalive`.

This means: if you closed the laptop within 600ms of your last edit (before the
debounce timer fired), or if you closed it while "Saving…" was still showing,
the Supabase write may have been cancelled mid-flight. The data would be in the
original computer's localStorage but not in Supabase.

**What to look for:** If the original computer's browser tab still shows the
checklist and findings correctly when reopened, the data is still in that
browser's localStorage. It was never lost — it just never reached Supabase.
Navigating away or editing any field will re-trigger the debounced save; if the
Supabase credentials are correct and the connection is live, "Saved" will appear
and the data will then sync.

---

## Finding 3 — Silent write failure, no UI error in the null-client case

**Confidence: HIGH as a code fact; MEDIUM as the cause of this incident.**

As described in Finding 1, when `getSupabaseClient()` returns null (no
credentials), `setItem` does nothing for Supabase but calls `markSaving()`
briefly. It does NOT call `markError()`. The save-status indicator does not
show "Sync error" in this case.

This is the most dangerous silent failure path: the user sees "Saved" is not
shown, but also no error, so there is no signal that data is not syncing. The
only way to detect it is to notice that "Saved" never appears, or to check the
Settings page and see that the URL is blank.

---

## Finding 4 — 600ms debounce window

**Confidence: HIGH as a code fact; LOW as the sole cause without other factors.**

All writes go through a per-key debounce of approximately 600ms
(`src/store/supabaseStorage.ts`). If the app is closed or navigated away from
within 600ms of an edit, the `beforeunload` flush is the only chance to save.
As noted in Finding 2, that flush is not guaranteed to complete.

In practice, closing a laptop lid triggers suspend before the OS closes browser
tabs, so this window is rarely hit on a lid-close. It is more relevant if the
tab is closed directly or the browser is quit. On a normal laptop-to-home-device
handoff (close lid, travel, open home device), the original tab usually stays
alive across suspend/resume and the debounce window is not the issue.

---

## Finding 5 — Stores that are browser-local only

The following stores are browser-local and will never appear on another device,
regardless of Supabase configuration. If the missing data lives in any of these,
it cannot be recovered on the home computer without manual re-entry:

- `ucc-gd4-calibration:v1` — benchmark match assessments
- `ucc-gd4-finding-drafts:v1` — finding drafts
- `ucc-gd4-guidance:v1` — walkthrough dismissals
- `ucc-gd4-supabase-settings:v1` — Supabase credentials

For the current incident, the affected data (checklist lines and findings) is
NOT in these stores — both are in Supabase-synced stores. So this finding does
not explain the incident directly.

---

## Likelihood ranking

1. **Credential mismatch** (Finding 1) — the two computers are pointing at
   different Supabase projects, or the home computer has no credentials at all.
   Silent, produces no error, fits the "works on one machine, missing on the
   other" pattern exactly. Check Settings first.

2. **`beforeunload` async race** (Finding 2) — the original computer was closed
   before "Saved" confirmed. Data is still in the original browser's
   localStorage; re-opening that tab and making any edit will re-sync. Check
   by opening the original tab and seeing if the data is still there.

3. **Silent null-client no-op** (Finding 3) — caused by Finding 1. Same root:
   credentials missing or wrong. If Finding 1 is confirmed, Finding 3 is the
   mechanism.

4. **600ms debounce alone** (Finding 4) — unlikely to be the sole cause without
   a simultaneous `beforeunload` failure. If the tab stayed open for more than a
   second after the last edit, the debounce fired and the write completed.

---

## What live evidence would resolve remaining uncertainty

The following cannot be determined from the repository alone:

- **Whether the two computers have the same Supabase URL in Settings** — only
  visible by opening Settings on each device. This is the single most important
  thing to check.

- **Whether "Saved" appeared on the original computer after the last edit** —
  only the user knows this. If it showed "Saved" and the data is still missing,
  that points to a credential mismatch on the home computer (the original wrote
  to Supabase; the home computer is reading a different project).

- **Whether the original tab still shows the data** — if the original browser is
  still open and the tab still shows the checklist/findings correctly, the data
  is at minimum in localStorage and re-syncing is possible.

- **Browser console errors on either device** — `F12 → Console` during a page
  load on the home computer would show any Supabase authentication errors if
  credentials are wrong.

---

## How `workspaceStorage` works (for reference)

Source: `src/store/supabaseStorage.ts`.

1. On store initialisation (`getItem`), the adapter reads from Supabase first.
   If a row exists, it overwrites the browser's localStorage with the remote
   copy. If Supabase is unavailable or credentials are wrong, it falls back to
   localStorage.

2. On every store write (`setItem`), the adapter writes to localStorage
   immediately (synchronous), then starts a 600ms debounced timer to upsert
   to Supabase. The header shows "Saving…" immediately; "Saved" only appears
   once the Supabase upsert resolves successfully.

3. On `beforeunload`, `flushPendingSaves()` fires all pending debounced writes
   immediately, but as `Promise.all` over async fetches. Browser may cancel
   them before they complete.

4. Supabase table: `workspace_state`. One row per store, keyed by the store's
   persist key (e.g. `ucc-gd4-workspace:v3`). The anon/publishable key has
   full read/write access (no RLS restriction on this table).

---

## Summary

The data is not lost if the original browser tab is still intact. The most
likely cause is that the home computer does not have the correct Supabase
credentials in its browser's Settings store, so it connects to a different
project (or no project) and reads empty state. Confirming the Supabase URL on
both machines — and entering the correct value on the home machine's Settings
page if needed — is the first and most likely fix.
