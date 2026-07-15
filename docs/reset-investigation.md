# Resetting the workspace to a clean state: investigation

Investigation only. No data, code or configuration was changed. This document
explains how workspace state is stored, what the existing "reset" style actions
actually do, and the safest concrete sequence to get a genuinely clean slate
before starting real audit work.

One thing to state up front, because it governs everything below: this
deployment syncs to Supabase, and on load the app reads Supabase FIRST and
overwrites the browser cache with the remote copy
(src/store/supabaseStorage.ts:97-104). So clearing the browser alone does not
reset anything; the next page load pulls the old state back down from Supabase.
A real reset has to clear both sides.

## The short answer

- There is NO single "reset everything" button in the app. Not "Start Audit", not "New cycle".
- "Start Audit" resets nothing at all. It only records a mode preference.
- "Start a new blank cycle" (createNewCycle) is the closest built-in action, but it deliberately keeps saved versions, archives and carries forward open findings, and does not touch any of the configuration stores (scoring scale, benchmark, calibration, rule tuning, pre-check checklist, Profile of PEI, AI/Drive/Supabase settings).
- Because Supabase is the source of truth on load, a genuinely clean slate requires clearing the Supabase rows as well as the browser storage. This cannot be done fully from the app UI; part of it is a manual step in Supabase.

## 1. What "Start Audit" actually does

Route /start-audit (src/nav.ts:47, wired in src/App.tsx:48 to
src/pages/StartAudit.tsx). Its only action is `setAuditMode(...)` on a card
click (StartAudit.tsx:77), which writes the single cycle-level `auditMode`
preference. Its own copy says "your work carries over" (StartAudit.tsx:66-69).
It initialises nothing and clears nothing. There is no audit "run" object
created here; the per-sub-criterion runs happen later on the Evidence Folder
page. So it is not a reset in any sense.

## 2. Everywhere workspace state is stored

15 browser localStorage keys, plus 2 Supabase tables. "Synced" means the
adapter also writes a row into the Supabase `workspace_state` table; the app
loads that row first and refreshes the browser cache from it.

| localStorage key | Store | Holds | Synced to Supabase |
|---|---|---|---|
| `ucc-gd4-workspace:v3` (version 6) | useWorkspaceStore | The main workspace: cycle, evidence, reviewer/confirmed scores, auditors, folders, audit runs, findings (`customFindings`), closures, calibration memories, human-decision log, `auditJournal`, snapshots (`versions`), archived prior findings (`priorCycleFindings`) | Yes |
| `ucc-gd4-checklist:v2` (version 1) | useChecklistModuleStore | Per-item checklist lines, evidence, drafts, saved bands/APSR matrix | Yes |
| `ucc-gd4-ai-settings:v1` | useAISettingsStore | OpenAI API key and model choice | Yes (key included) |
| `ucc-gd4-custom-benchmark:v1` | useBenchmarkAfiStore | The 67 seeded SSG findings plus any uploaded audit reports | Yes |
| `ucc-gd4-calibration:v1` (version 2) | useCalibrationStore | Benchmark match assessments, consistency/A-vs-B test records | NO (localStorage only) |
| `ucc-gd4-precheck-checklist:v1` | usePreCheckChecklistStore | The live pre-check checklist | Yes |
| `ucc-gd4-finding-drafts:v1` | useFindingDraftStore | Grouped finding drafts | NO (localStorage only) |
| `ucc-gd4-rule-tuning:v1` | useRuleTuningStore | Rule-tuning versions and the champion pointer | Yes |
| `ucc-gd4-prompt-review:v1` | usePromptReviewStore | Prompt Review prompts and records | Yes |
| `ucc-gd4-scoring-config:v1` | useScoringConfigStore | Award thresholds, AI strictness, the APSR percentage scale | Yes |
| `ucc-gd4-google-drive:v1` | useGoogleDriveStore | Google Drive client id only (the access token is never persisted) | Yes (client id only) |
| `profile-of-pei-v2` | useProfileOfPeiStore | The PEI profile | Yes |
| `ucc-gd4-supabase-settings:v1` | useSupabaseSettingsStore | The Supabase URL and publishable key themselves | NO (localStorage only, deliberately) |
| `ucc-gd4-changelog:v1` (version 1) | useChangeLogStore | Change-log cache; append-only adapter | Yes, but append-only (see the trap below) |
| `ucc-gd4-guidance:v1` | useGuidanceStore | Walkthrough/guidance dismissals | NO (localStorage only) |

In-memory only, nothing to reset: useAIDebugLogStore (the AI system-prompt log)
and useSaveStatusStore (the saving indicator).

Supabase tables (supabase/schema.sql):
- `workspace_state` (schema.sql:2-6): columns `id, data jsonb, updated_at`. One row per SYNCED store key above; `id` equals the localStorage key. Anon/publishable key has full read/write/delete (schema.sql:8-18).
- `drive_oauth_tokens` (schema.sql:30-34): one row `id='default'` holding the workspace-wide Google refresh token. Zero anon policies (schema.sql:36-39); only the drive-oauth Edge Function (service-role key) can read or delete it.

## 3. What a "reset" does NOT clear (the traps)

The most complete built-in action is `createNewCycle`
(useWorkspaceStore.ts:2859; the "Start a new blank cycle" button on Draft
Workspace and Audit Cycle). Its own dialog only promises to clear "evidence,
findings, checklist entries and other current workspace data". Here is what it
leaves behind that a user could reasonably assume was wiped:

- Saved snapshot versions (`versions`) and `restoreLog` (by design; the dialog says versions are not affected).
- Archived prior findings (`priorCycleFindings`) and any OPEN findings, which are carried FORWARD into the new cycle along with their closures (this is the ISO carryover feature, useWorkspaceStore.ts:2865-2899, not a bug). So the "new" cycle can start already holding last cycle's open findings.
- Departments, the folder skeleton, and the `auditMode` preference.
- Every configuration store, untouched: the APSR scale and award thresholds (scoring-config), the 67 benchmark findings plus uploads (custom-benchmark), calibration test records (calibration), rule-tuning versions (rule-tuning), the pre-check checklist (precheck-checklist), the Profile of PEI (profile-of-pei), AI settings including the OpenAI key (ai-settings), Google Drive (google-drive), Supabase settings (supabase-settings), the change log (changelog), and guidance flags (guidance).

`clearSampleData` (useWorkspaceStore.ts:2604, the "Clear all sample data" action
in the top menu) is NARROWER still. It is the reverse of loading the demo
dataset. It clears evidence, scores, findings, closures, checklist entries and
finding drafts, but it also leaves versions, departments, folders, auditMode,
the AI review log, the human decision log, calibration memories, school
context, `priorCycleFindings`, and every configuration store untouched.

Two traps that matter even if you delete Supabase rows by hand:

- The change log is append-only on the server. `useChangeLogStore` uses a custom adapter whose `removeItem` is a no-op and whose `setItem` does a read-modify-write UNION, so a reset can never SHRINK the remote change log (useChangeLogStore.ts:51-79). The `workspace_state` row `ucc-gd4-changelog:v1` will survive an in-app reset and must be deleted directly in Supabase if you want it gone.
- The Google refresh token lives only in `drive_oauth_tokens` server-side. No browser or app action reaches it. Clearing the workspace does NOT disconnect Drive; the connection survives. To actually disconnect you must use the Drive "disconnect" action (which calls the Edge Function to revoke with Google and delete the row) or delete that row directly in Supabase.

## 4. Is there a safe built-in way? No

There is no built-in action that produces a clean slate, and no code anywhere
calls `localStorage.clear()` or a store `clearStorage()` (confirmed by search:
zero hits). The only built-in delete that removes a Supabase row is the
adapter's `removeItem` (supabaseStorage.ts:151-160), and nothing in the UI
invokes it for a full wipe. So a genuine reset is unavoidably manual in part.

The exact surfaces a manual reset must address:
- 15 localStorage keys (the table above).
- 11 `workspace_state` rows (the synced keys), including the append-only `ucc-gd4-changelog:v1` row.
- Optionally the `drive_oauth_tokens` row (only if you want to disconnect Drive).

Orphan risk if done manually or incompletely:
- Clear only localStorage: the reset reverts on next load, because Supabase is read first and re-populates the cache (supabaseStorage.ts:97-104). This is the single biggest trap.
- Clear only Supabase while the app is still open: the app can re-upload its current in-memory state. Every store edit debounces a save (600ms) and the tab's `beforeunload` flushes pending saves (supabaseStorage.ts:60-64, 135-148). So deleting rows under a live tab can be immediately undone. The Supabase rows must be deleted with the app CLOSED.
- Miss the non-synced keys (`ucc-gd4-calibration:v1`, `ucc-gd4-finding-drafts:v1`, `ucc-gd4-guidance:v1`, `ucc-gd4-supabase-settings:v1`): these have no Supabase row, so they only clear from the browser; on a different device they still hold old state.
- The `profile-of-pei-v2` key does not follow the `ucc-gd4-*` naming, so a "delete every ucc-gd4-* key" script would silently miss the PEI profile.

## 5. What should be preserved versus wiped

Preserve (this is setup, not audit-work test data):
- `ucc-gd4-supabase-settings:v1` if the Supabase URL and publishable key were entered in the app rather than baked into the build. If they come from the build environment (VITE_SUPABASE_URL etc.), clearing this key is harmless because the app reconnects from the environment. You cannot tell which from the repository alone; check the Settings page (does it show the creds as entered, or blank with the app still connected). If in doubt, keep this key.
- `ucc-gd4-scoring-config:v1` if you want to keep your tuned APSR percentage scale and award thresholds. You asked for this to be preserved; deleting it resets the scale to the reconstructed default.
- `ucc-gd4-ai-settings:v1` if you want to keep the OpenAI key rather than re-entering it.
- `ucc-gd4-google-drive:v1` and the `drive_oauth_tokens` row if you want to keep the Drive connection. The token is a workspace-wide server-side credential; keeping it means Drive stays connected for the real audit.
- Account/auth: there is no per-user login in this app (the anon/publishable key is the only client credential). There is nothing user-account-shaped to preserve beyond the Supabase settings above.

Wipe (this is the workspace/audit-work data that is the test/demo content):
- `ucc-gd4-workspace:v3` (cycle, evidence, scores, findings, closures, auditors, folders, runs, snapshots/versions, archived prior findings, journal, calibration memories, human decision log).
- `ucc-gd4-checklist:v2` (all checklist lines, bands, matrices).
- `ucc-gd4-custom-benchmark:v1` (returns to the 67 seeded findings on reload; only removes your uploads).
- `ucc-gd4-calibration:v1`, `ucc-gd4-finding-drafts:v1`, `ucc-gd4-precheck-checklist:v1`, `ucc-gd4-rule-tuning:v1`, `ucc-gd4-prompt-review:v1`, `profile-of-pei-v2`, `ucc-gd4-changelog:v1`, `ucc-gd4-guidance:v1`.

## Final recommendation: the safest concrete sequence

There is no one-click path, so this is a short manual procedure. It clears both
sides in the correct order and preserves your setup. Do it once, carefully.

Step 0 (decide what to keep). From the "preserve" list above, the sensible keep
set is: `ucc-gd4-ai-settings:v1` (OpenAI key), `ucc-gd4-scoring-config:v1` (APSR
scale), `ucc-gd4-google-drive:v1` plus the `drive_oauth_tokens` row (Drive
connection), and `ucc-gd4-supabase-settings:v1` (Supabase creds, unless they
come from the build environment).

Step 1. Close every open tab of the app on every device. This is essential: an
open tab can re-upload the old state to Supabase on close or on its next
debounced save, undoing the reset.

Step 2. In Supabase (Table editor or SQL editor), delete the workspace-data rows
from `workspace_state`, keeping the setup rows. For example:
`delete from workspace_state where id not in ('ucc-gd4-ai-settings:v1', 'ucc-gd4-scoring-config:v1', 'ucc-gd4-google-drive:v1');`
This removes the workspace, checklist, benchmark, pre-check, rule-tuning,
prompt-review, Profile of PEI, and change-log rows in one statement, and keeps
the three setup rows. (The calibration, finding-drafts, guidance and
supabase-settings stores have no row here; they are browser-only.) Do NOT touch
`drive_oauth_tokens` unless you also want to disconnect Drive.

Step 3. On each device you use, clear the browser storage for the app's origin.
Two options:
- Simplest and safest: open the app in a fresh browser profile or a private/incognito window for the real audit. It has no old localStorage at all, and loads the (now-empty-except-setup) state from Supabase. You will re-enter the Supabase URL and publishable key once if they are not build-supplied.
- Or, on your existing profile, open DevTools on the app's page and either run `localStorage.clear()` (clears everything, including the setup keys, so you re-enter Supabase creds and re-check the OpenAI key and scale once), or delete just the "wipe" keys listed in section 5 and keep the setup keys.

Step 4. Reopen the app and confirm it loads clean: dashboard total 0/1000, no
findings, no checklist entries, empty evidence folders. Then run the Consistency
Checker on the Finalisation Checklist; it should report no issues on the empty
workspace.

### Warning list (things that need separate or manual attention)

1. Clearing the browser alone does nothing lasting; the Supabase rows are the real state. Step 2 is the one that actually resets.
2. Delete the Supabase rows with the app closed, or a live tab will re-upload the old state.
3. The change log (`ucc-gd4-changelog:v1` row) is append-only and will NOT clear from inside the app; it only goes away if you delete its `workspace_state` row in step 2.
4. The Google Drive refresh token (`drive_oauth_tokens`) is server-side and survives every browser/app reset. It is preserved by default here; disconnect it explicitly only if you want a fresh Drive link.
5. The Supabase credentials key (`ucc-gd4-supabase-settings:v1`) is browser-only. A blanket `localStorage.clear()` removes it; be ready to re-enter the Supabase URL and publishable key on Settings (unless they are supplied by the build environment).
6. `profile-of-pei-v2` does not use the `ucc-gd4-*` prefix, so any "delete all ucc-gd4-* keys" shortcut misses it. Delete it explicitly.
7. Verify on EVERY device/browser you use the app from. The non-synced keys (calibration, finding-drafts, guidance, supabase-settings) live only in that device's browser and are not cleared by the Supabase step.

### Documentation drift noticed during this investigation (not changed here)

The CLAUDE.md stores table is slightly out of date and could mislead a reset:
useCalibrationStore is version 2 in code (not 1) and is localStorage-only (not
synced); useFindingDraftStore and useGuidanceStore are also localStorage-only;
useProfileOfPeiStore uses the key `profile-of-pei-v2` (not a `ucc-gd4-*` key);
and useChangeLogStore uses a bespoke append-only Supabase adapter that a reset
cannot shrink. These are recorded here for accuracy; no code or docs were
changed as part of this investigation.
