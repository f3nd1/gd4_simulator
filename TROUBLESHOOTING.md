# Troubleshooting

Common issues and fixes when running the GD4 EduTrust Audit Simulator.

---

## Browser downloads the app instead of rendering it

**Symptom:** Opening the forwarded port URL downloads a file (often `index.html` or a `.js` bundle)
instead of showing the app.

**Cause:** GitHub Codespaces defaults new port forwards to **HTTPS**. Vite's dev server sends
JavaScript with `Content-Type: text/javascript`. When the port is forwarded as HTTPS some
browsers receive a mismatched MIME hint and treat the response as a file download.

**Fix:**
1. Open the **Ports** tab in VS Code (bottom panel).
2. Find the row for port **5173**.
3. Look at the **Protocol** column.
4. If it shows **HTTPS**, right-click the row → **Change Port Protocol → HTTP**.
5. Click the globe icon (or copy the URL) to open the app — it should now render.

The `devcontainer.json` sets `"protocol": "http"` automatically, but this can be reset if you
remove and re-add the port manually. Re-running `npm run dev` from the terminal usually restores it.

---

## Blank screen after the page loads

**Symptom:** The browser shows a white or blank page with no UI.

**Possible causes and fixes:**

1. **JavaScript bundle failed to load** — open DevTools → Console. If you see a `MIME type`
   error or `Failed to fetch`, follow the [protocol fix](#browser-downloads-the-app-instead-of-rendering-it) above.

2. **React crashed on startup** — look for a red error in the Console. Common causes:
   - Missing `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`
     (the app starts without them, but check for any startup errors).
   - A corrupted `localStorage` state — open DevTools → Application → Local Storage →
     right-click `localhost` or the Codespaces origin → **Clear** → reload the page.

3. **Vite not running** — make sure `npm run dev` is still running in the terminal.

---

## Port 5173 is not appearing in the Ports tab

**Symptom:** No forwarded port appears even though `npm run dev` is running.

**Fix:**
- Codespaces auto-forwards ports listed in `devcontainer.json` → `forwardPorts`. Port 5173 is
  already listed, so it should appear automatically.
- If it does not, run `npm run dev`, then use the **Ports** tab → **Add Port** → `5173`.
- Make sure the terminal shows `Local: http://0.0.0.0:5173` — if it shows only `localhost`,
  the server is not binding to all interfaces. Check `vite.config.ts` for `host: '0.0.0.0'`.

---

## Supabase is not saving data

**Symptom:** Data saved in one session disappears after a Codespace rebuild, or you see
"Supabase save failed" in the console.

**Checks:**

1. **Environment variables not set** — open `Settings` in the app and check whether the
   Supabase URL and key are pre-filled. If blank, create `.env.local` with:
   ```
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
   ```
   Restart `npm run dev` after editing `.env.local`.

2. **Wrong key type** — use the `anon` / `publishable` key, **not** the `service_role` key.
   In your Supabase dashboard: Project Settings → API → `anon public`.

3. **Supabase project paused** — free-tier projects pause after 1 week of inactivity.
   Go to `app.supabase.com` and resume the project.

4. **Row-level security blocks writes** — if you applied RLS policies, make sure the `anon`
   role has `INSERT` and `UPDATE` rights on the workspace table. For a prototype, you can
   disable RLS on the workspace table entirely.

5. **Network egress blocked** — the Vitest test suite logs
   `"Supabase load failed: Host not in allowlist"`. This is expected in the test environment
   and does not affect normal usage.

---

## OpenAI call times out during Run Audit

**Symptom:** The audit progress modal shows "Something went wrong" with a timeout message, or the
AI audit step hangs for more than 2–3 minutes.

**Checks:**

1. **Too many checklist lines** — the audit splits lines into batches of 4 and runs them in
   parallel. Very large sub-criteria (10+ lines) may still exceed the per-batch 90-second
   timeout if the document folder is also large. Try reducing the folder size to the most
   relevant 10–15 files.

2. **API key not set** — go to **Settings → AI Settings** and confirm the OpenAI key is
   entered and the toggle is on.

3. **Wrong API key** — the key must start with `sk-`. Project keys start with `sk-proj-`.

4. **Insufficient quota** — check your OpenAI usage at `platform.openai.com/usage`. The audit
   uses `gpt-4o` (analysis) and `gpt-4o-mini` (image descriptions, document condensing).

5. **Cancel button** — if the UI shows "Auditing…" and the spinner won't stop, click the
   red **Cancel** button on the Evidence Folder row. This immediately releases the busy state.
   Any results already saved before you cancelled are kept.

---

## Google Drive is not connecting

**Symptom:** Clicking "Connect Google Drive" does nothing, or shows "Failed to load Google
Identity Services" / "Google did not return an access token."

**Checks:**

1. **OAuth Client ID not configured** — go to **Settings → Google Drive** and enter your
   Google Cloud Console OAuth Client ID. This must be a **Web application** type client with
   your Codespaces preview origin in "Authorized JavaScript origins"
   (e.g. `https://<codespace-name>-5173.preview.app.github.dev`).

2. **Origin not allowlisted** — if the app URL changes (new Codespace, different port),
   update the authorized origins in Google Cloud Console.

3. **Popup blocked** — the Google consent popup requires the browser to allow popups for the
   app's origin. Check the browser's popup blocker notification and allow it.

4. **Drive API not enabled** — in Google Cloud Console, make sure the **Google Drive API** is
   enabled for the project that owns your Client ID.

5. **Token expired** — the access token lasts 1 hour and is held in memory only (never
   persisted). After an hour, or on page reload, click **Connect Google Drive** again to
   re-authenticate silently (no popup if you already granted access in this browser).

6. **Shared Drive 403** — if your evidence folder is in a Shared/Team Drive and you see a
   "403 / insufficientFilePermissions" error, check that the connected Google account has at
   least **Viewer** access to the folder in Google Drive.

---

## Audit button stays stuck on "Auditing…" forever

**Symptom:** The Evidence Folder row shows "Auditing…" with no progress modal, or the modal
closed but the button never returned to "Run audit".

**Fix:** Click the red **Cancel** button that appears next to the "Auditing…" label on the
folder row. This calls `cancelBusy()`, increments the run token, releases the busy lock, and
discards any in-flight results. Then try running the audit again.

If no Cancel button is visible, try refreshing the page — the busy state is not persisted
across reloads, so a refresh always resets it.
